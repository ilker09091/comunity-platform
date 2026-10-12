import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Api, createTestApp, resetDatabase, TestUser } from './setup/test-app.js';

/** Administrator curation: blue verification badges and posts pinned to the top of the home feed. */
describe('Verified badges and pinned posts (e2e)', () => {
  let app: INestApplication;
  let api: Api;
  let db: DataSource;
  let member: TestUser;
  let mod: TestUser;
  let admin: TestUser;

  const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((p) => p.id);

  beforeAll(async () => {
    app = await createTestApp();
    api = new Api(app);
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    member = await api.register('member');
    mod = await api.register('mod');
    admin = await api.register('admin_u');
    await api.setRole(mod, 'MODERATOR');
    await api.setRole(admin, 'ADMIN');
  });
  afterAll(() => app.close());

  it('lets administrators grant and remove the blue badge, shown wherever the user appears', async () => {
    const post = await api.createPost(member, { content: 'hello' });
    expect((await api.get(`/users/${member.username}`).expect(200)).body.isVerified).toBe(false);

    await api.patch(`/admin/users/${member.id}/verified`, { verified: true }, mod).expect(403);
    await api.patch(`/admin/users/${member.id}/verified`, { verified: true }, member).expect(403);
    expect((await api.patch(`/admin/users/${member.id}/verified`, { verified: true }, admin).expect(200)).body).toEqual({
      id: member.id,
      isVerified: true,
    });

    expect((await api.get(`/users/${member.username}`).expect(200)).body.isVerified).toBe(true);
    expect((await api.get(`/posts/${post.id}`).expect(200)).body.author.isVerified).toBe(true);
    expect((await api.get('/users/me', member).expect(200)).body.isVerified).toBe(true);
    const row = (await api.get(`/admin/users?q=${member.username}`, admin).expect(200)).body.items[0];
    expect(row.isVerified).toBe(true);
    const audit = await db.query(`SELECT action FROM admin_audit_logs WHERE target_id = $1 ORDER BY created_at`, [member.id]);
    expect(audit.map((a: { action: string }) => a.action)).toContain('user.verified');

    await api.patch(`/admin/users/${member.id}/verified`, { verified: false }, admin).expect(200);
    expect((await api.get(`/posts/${post.id}`).expect(200)).body.author.isVerified).toBe(false);
  });

  it('puts pinned posts at the top of the first home-feed page without repeating them', async () => {
    const old = await api.createPost(member, { content: 'older post' });
    const newer = await api.createPost(member, { content: 'newer post' });

    await api.post(`/admin/posts/${old.id}/pin`, { pinned: true }, mod).expect(403);
    expect((await api.post(`/admin/posts/${old.id}/pin`, { pinned: true }, admin).expect(200)).body).toEqual({ id: old.id, isPinned: true });

    const feed = await api.get('/feed/global').expect(200);
    expect(ids(feed)).toEqual([old.id, newer.id]);
    expect(feed.body.items[0].isPinned).toBe(true);
    expect(feed.body.items[1].isPinned).toBe(false);
    expect(ids(await api.get('/feed/following', member).expect(200))[0]).toBe(old.id);
    expect(ids(await api.get('/feed/explore').expect(200))[0]).toBe(old.id);

    // Later pages never repeat the pinned post.
    const first = await api.get('/feed/global?limit=1').expect(200);
    expect(ids(first)).toEqual([old.id, newer.id]);

    await api.post(`/admin/posts/${old.id}/pin`, { pinned: false }, admin).expect(200);
    expect(ids(await api.get('/feed/global').expect(200))).toEqual([newer.id, old.id]);
    const audit = await db.query(`SELECT action FROM admin_audit_logs WHERE target_id = $1 ORDER BY created_at`, [old.id]);
    expect(audit.map((a: { action: string }) => a.action)).toEqual(['post.pinned', 'post.unpinned']);
  });

  it('only pins public original posts and shows at most three, newest pin first', async () => {
    const followersOnly = await api.createPost(member, { content: 'friends only', visibility: 'FOLLOWERS' });
    expect((await api.post(`/admin/posts/${followersOnly.id}/pin`, { pinned: true }, admin).expect(400)).body.code).toBe('VALIDATION_ERROR');

    const posts = [];
    for (let i = 0; i < 4; i++) posts.push(await api.createPost(member, { content: `post ${i}` }));
    for (const p of posts) await api.post(`/admin/posts/${p.id}/pin`, { pinned: true }, admin).expect(200);
    const top = ids(await api.get('/feed/global').expect(200)).slice(0, 3);
    expect(top).toEqual([posts[3].id, posts[2].id, posts[1].id]);
  });
});
