import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Api, createTestApp, resetDatabase, type TestUser } from './setup/test-app.js';
import { ReelDiscoveryCycles1760191000000 } from '../src/database/migrations/1760191000000-ReelDiscoveryCycles.js';

type Entry = { key: string; postId: string; cycle: number;position:number };
type Page = { items: { id: string; author: { id: string } }[]; entries: Entry[]; nextCursor: string | null; hasMore: boolean; sessionId: string };

/** Continuous Reels discovery: automatic cycles, small libraries and cursor safety across cycles. */
describe('Reels discovery cycles (e2e)', () => {
  let app: INestApplication, api: Api, db: DataSource, viewer: TestUser, a: TestUser, b: TestUser, c: TestUser;
  beforeAll(async () => {
    app = await createTestApp();
    api = new Api(app);
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    viewer = await api.register('viewer');
    a = await api.register('creator');
    b = await api.register('other');
    c = await api.register('third');
  });
  afterAll(() => app.close());

  // SQL fixtures live only in the *_test database.
  async function reels(user: TestUser, count = 1) {
    const ids: string[] = Array.from({ length: count }, () => randomUUID()), media = ids.map(() => randomUUID());
    await db.query(`INSERT INTO posts(id,author_id,content,created_at) SELECT id,$2,'cycle fixture',now()-ord*interval '1 second' FROM unnest($1::uuid[]) WITH ORDINALITY x(id,ord)`, [ids, user.id]);
    await db.query(`INSERT INTO media(id,owner_id,type,status,storage_key,mime_type,size_bytes,width,height,duration_ms)
      SELECT id,$2,'VIDEO','READY','test-reel/'||id,'video/mp4',10,1080,1920,10000 FROM unnest($1::uuid[]) id`, [media, user.id]);
    await db.query(`INSERT INTO post_media(post_id,media_id,position) SELECT post,media,0 FROM unnest($1::uuid[],$2::uuid[]) x(post,media)`, [ids, media]);
    return ids;
  }
  const get = async (query = '', user: TestUser | undefined = viewer): Promise<Page> => (await api.get('/feed/reels' + query, user).expect(200)).body;
  /** Follows cursors until `count` entries were served (or the feed genuinely ends). */
  async function scroll(count: number, limit: number, user: TestUser | undefined = viewer) {
    let p = await get(`?limit=${limit}`, user);
    const entries: Entry[] = [], cursors = new Set<string>();
    for (let guard = 0; guard < 200; guard++) {
      expect(p.entries.map((e) => e.postId)).toEqual(p.items.map((i) => i.id));
      expect(p.items.length).toBeLessThanOrEqual(limit);
      entries.push(...p.entries);
      if (entries.length >= count || !p.hasMore) break;
      expect(p.items.length).toBeGreaterThan(0); // never an empty page that claims more
      expect(cursors.has(p.nextCursor!)).toBe(false); // the cursor always advances
      cursors.add(p.nextCursor!);
      p = await get(`?cursor=${encodeURIComponent(p.nextCursor!)}&limit=${limit}`, user);
    }
    return { entries, last: p };
  }
  const noBackToBack = (entries: Entry[]) => {
    for (let i = 1; i < entries.length; i++) expect(entries[i].postId).not.toBe(entries[i - 1].postId);
  };

  it('returns a genuine empty feed when no Reel is eligible', async () => {
    const p = await get();
    expect(p).toMatchObject({ items: [], entries: [], hasMore: false, nextCursor: null });
  });

  it('serves a single Reel once and lets it loop instead of queuing copies', async () => {
    const [only] = await reels(a);
    const p = await get();
    expect(p.entries).toEqual([expect.objectContaining({postId:only,cycle:1})]);
    expect(p).toMatchObject({ hasMore: false, nextCursor: null });
    expect((await get(`?session=${p.sessionId}`)).entries).toHaveLength(1);
  });

  it('alternates two Reels across cycles without consecutive repeats', async () => {
    const pair = [...(await reels(a)), ...(await reels(b))];
    const { entries } = await scroll(12, 3);
    expect(entries.length).toBeGreaterThanOrEqual(12);
    noBackToBack(entries);
    for (let i = 0; i + 1 < entries.length; i += 2) expect(new Set([entries[i].postId, entries[i + 1].postId])).toEqual(new Set(pair));
    expect(new Set(entries.map((e) => e.key)).size).toBe(entries.length);
  });

  it('reorders a five-Reel library between cycles and never repeats within one', async () => {
    const library = [...(await reels(a, 2)), ...(await reels(b, 2)), ...(await reels(c, 1))];
    const { entries } = await scroll(25, 4);
    const cycles = [1, 2, 3, 4, 5].map((n) => entries.filter((e) => e.cycle === n).map((e) => e.postId));
    for (const cycle of cycles) expect(new Set(cycle)).toEqual(new Set(library));
    for (const cycle of cycles) expect(cycle).toHaveLength(5);
    noBackToBack(entries);
    // Controlled shuffling: the cycles must not all repeat the same order.
    expect(new Set(cycles.map((cycle) => cycle.join(','))).size).toBeGreaterThan(1);
  });

  it('crosses a cycle exactly on a page boundary and with partial pages', async () => {
    const library = await reels(a, 6);
    for (const limit of [6, 4, 5, 1]) {
      const { entries } = await scroll(18, limit);
      expect(entries.slice(0, 6).every((e) => e.cycle === 1)).toBe(true);
      expect(new Set(entries.slice(0, 6).map((e) => e.postId))).toEqual(new Set(library));
      expect(entries.slice(6, 12).every((e) => e.cycle === 2)).toBe(true);
      expect(new Set(entries.slice(6, 12).map((e) => e.postId))).toEqual(new Set(library));
      expect(entries[12].cycle).toBe(3);
      noBackToBack(entries);
    }
  });

  it('starts a new session in the rediscovery cycle once everything was watched, keeping history', async () => {
    const library = await reels(a, 3);
    await db.query(`INSERT INTO reel_watch_history(user_id,post_id,watched_ms,duration_ms,meaningful_at,completion_count)
      SELECT $1,id,9000,10000,now(),1 FROM unnest($2::uuid[]) id`, [viewer.id, library]);
    const p = await get();
    expect(p.entries.slice(0, 3).every((e) => e.cycle === 2)).toBe(true);
    expect(new Set(p.entries.slice(0, 3).map((e) => e.postId))).toEqual(new Set(library));
    expect(p.hasMore).toBe(true);
    expect((await db.query('SELECT count(*)::int n FROM reel_watch_history WHERE user_id=$1', [viewer.id]))[0].n).toBe(3);
  });

  it('keeps blocks, privacy and moderation enforced in later cycles', async () => {
    const own = await reels(a, 2), blocked = await reels(b, 2), hidden = await reels(c, 2);
    let p = await get('?limit=6');
    expect(new Set(p.entries.map((e) => e.postId))).toEqual(new Set([...own, ...blocked, ...hidden]));
    await api.post(`/users/${b.id}/block`, undefined, viewer).expect(200);
    await db.query(`UPDATE posts SET moderation_status='REMOVED' WHERE id=$1`, [hidden[0]]);
    await api.patch('/users/me', { isPrivate: true }, c).expect(200);
    const served: Entry[] = [];
    for (let i = 0; i < 4 && p.hasMore; i++) {
      p = await get(`?cursor=${encodeURIComponent(p.nextCursor!)}&limit=6`);
      served.push(...p.entries);
    }
    expect(served.length).toBeGreaterThan(0);
    expect(served.every((e) => own.includes(e.postId))).toBe(true);
    noBackToBack(served);
  });

  it('records watch events on the newest entry of a Reel that returned in a later cycle', async () => {
    const pair = [...(await reels(a)), ...(await reels(b))];
    const p = await get('?limit=4');
    const repeated = p.entries.find((e) => e.cycle === 2)!.postId;
    expect(pair).toContain(repeated);
    await api.post('/feed/reels/expose',{sessionId:p.sessionId,postId:repeated,position:p.entries.find((e)=>e.cycle===2&&e.postId===repeated)!.position,prepare:true},viewer).expect(200);
    await api.post('/feed/reels/watch', { sessionId: p.sessionId, events: [{ postId: repeated, sequence: 1, type: 'VIDEO_START', watchedMs: 0, positionMs: 0, durationMs: 10000 }] }, viewer).expect(204);
    // Only entries already returned to the client count; a look-ahead entry of a later cycle is not credited.
    const rows = await db.query(`SELECT cycle, started_at IS NOT NULL AS started FROM reel_recommendation_impressions WHERE session_id=$1 AND post_id=$2 ORDER BY cycle`, [p.sessionId, repeated]);
    expect(rows.filter((r: { started: boolean }) => r.started)).toEqual([{ cycle: 2, started: true }]);
    expect(rows[0]).toEqual({ cycle: 1, started: false });
  });

  it('has a reversible migration that keeps users, posts and watch history', async () => {
    await reels(a, 2);
    await get('?limit=4');
    const q = db.createQueryRunner();
    await q.connect();
    await q.startTransaction();
    try {
      const count = () => q.query('SELECT (SELECT count(*) FROM users)::int users,(SELECT count(*) FROM posts)::int posts,(SELECT count(*) FROM reel_watch_history)::int history');
      const before = await count();
      const migration = new ReelDiscoveryCycles1760191000000();
      await migration.down(q);
      expect(await count()).toEqual(before);
      await migration.up(q);
      expect((await q.query(`SELECT column_name FROM information_schema.columns WHERE table_name='reel_recommendation_impressions' AND column_name='cycle'`)).length).toBe(1);
    } finally {
      await q.rollbackTransaction();
      await q.release();
    }
  });
});
