import { INestApplication } from '@nestjs/common';
import { Api, createTestApp, resetDatabase, TestUser } from './setup/test-app.js';

describe('Reels feed (e2e)', () => {
  let app: INestApplication;
  let api: Api;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
    api = new Api(app);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    alice = await api.register('alice');
    bob = await api.register('bob');
    carol = await api.register('carol');
  });
  afterAll(() => app.close());

  const videoPost = async (user: TestUser, content: string, extra: Record<string, unknown> = {}) => {
    const media = await api.uploadVideo(user);
    expect(media).toMatchObject({ type: 'VIDEO', status: 'READY', mimeType: 'video/mp4' });
    return api.createPost(user, { content, mediaIds: [media.id], ...extra });
  };
  const reelIds = async (viewer?: TestUser, query = '') =>
    (await api.get(`/feed/reels${query}`, viewer).expect(200)).body.items.map((p: { id: string }) => p.id);

  it('returns only existing video posts, without duplicating reposts', async () => {
    const reel = await videoPost(alice, 'my first reel');
    await api.createPost(alice, { content: 'just text' });
    await api.post(`/posts/${reel.id}/repost`, undefined, bob).expect(200);
    const quote = await api.post(`/posts/${reel.id}/quote`, { content: 'look at this' }, carol).expect(201);

    const ids = await reelIds();
    expect(ids).toEqual([reel.id]); // the quote has no video of its own; the simple repost is not a new reel
    expect(ids).not.toContain(quote.body.id);
    const item = (await api.get('/feed/reels', bob).expect(200)).body.items[0];
    expect(item).toMatchObject({ kind: 'POST', author: { id: alice.id }, isReposted: true, repostCount: 1 });
    expect(item.media[0].type).toBe('VIDEO');
  });

  it('enforces privacy, FOLLOWERS visibility and blocks', async () => {
    const friendsOnly = await videoPost(alice, 'friends', { visibility: 'FOLLOWERS' });
    await api.patch('/users/me', { isPrivate: true }, bob).expect(200);
    const privateReel = await videoPost(bob, 'private account');
    const publicReel = await videoPost(carol, 'public');

    expect(await reelIds()).toEqual([publicReel.id]);
    await api.post(`/users/${alice.id}/follow`, undefined, carol).expect(200);
    expect(new Set(await reelIds(carol))).toEqual(new Set([publicReel.id, friendsOnly.id]));
    expect(new Set(await reelIds(bob))).toEqual(new Set([publicReel.id, privateReel.id])); // own content

    await api.post(`/users/${alice.id}/block`, undefined, carol).expect(200);
    expect(await reelIds(carol)).toEqual([publicReel.id]);
    expect(await reelIds(alice)).toEqual(expect.not.arrayContaining([publicReel.id]));
  });

  it('paginates with cursors', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await videoPost(alice, `reel ${i}`)).id);
    const first = await api.get('/feed/reels?limit=3').expect(200);
    const second = await api.get(`/feed/reels?limit=3&cursor=${first.body.nextCursor}`).expect(200);
    const entries = [...first.body.entries, ...second.body.entries] as { postId: string; cycle: number }[];
    // Cycle 1 serves all five once; the feed then continues with cycle 2 instead of stopping.
    expect(new Set(entries.filter((e) => e.cycle === 1).map((e) => e.postId))).toEqual(new Set(ids));
    expect(entries.filter((e) => e.cycle === 1)).toHaveLength(5);
    expect(entries[5]).toMatchObject({ cycle: 2 });
    expect(entries[5].postId).not.toBe(entries[4].postId);
    expect(second.body.hasMore).toBe(true);
    expect(second.body.items.map((p: { id: string }) => p.id)).toEqual(second.body.entries.map((e: { postId: string }) => e.postId));
  });
});
