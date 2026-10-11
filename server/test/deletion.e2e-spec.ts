import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ContentDeletionService } from '../src/modules/media/content-deletion.service.js';
import { STORAGE_DRIVER, type StorageDriver } from '../src/modules/media/storage/storage.driver.js';
import { Api, createTestApp, resetDatabase, type TestUser } from './setup/test-app.js';

describe('Permanent deletion (database and storage)', () => {
  let app: INestApplication;
  let api: Api;
  let db: DataSource;
  let storage: StorageDriver;
  let alice: TestUser;
  let bob: TestUser;
  // Minimal ISO BMFF signature: file-type recognizes this as MP4. No external video needed.
  const video = Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex');
  const path = (url: string) => new URL(url).pathname + new URL(url).search;
  const key = (url: string) => new URL(url).pathname.split('/').at(-1)!;
  const upload = async () => (await api.http.post('/api/media').set(alice.auth)
    .attach('file', video, { filename: 'video.mp4', contentType: 'video/mp4' }).expect(201)).body;

  beforeAll(async () => {
    app = await createTestApp();
    api = new Api(app);
    db = app.get(DataSource);
    storage = app.get(STORAGE_DRIVER);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    alice = await api.register('alice');
    bob = await api.register('bob');
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => app?.close());

  it('removes video, engagement and simple reposts, preserves another author’s quote and repairs stale counts', async () => {
    const media = await upload();
    const post = await api.createPost(alice, { mediaIds: [media.id] });
    await api.post(`/posts/${post.id}/like`, undefined, bob).expect(200);
    await api.post(`/posts/${post.id}/bookmark`, undefined, bob).expect(200);
    await api.post(`/posts/${post.id}/comments`, { content: 'reply' }, bob).expect(201);
    const repost = (await api.post(`/posts/${post.id}/repost`, undefined, bob).expect(200)).body;
    const quote = (await api.post(`/posts/${post.id}/quote`, { content: 'keep my text' }, bob).expect(201)).body;
    await db.query(`UPDATE users SET post_count = 8 WHERE id = $1`, [alice.id]);
    expect((await api.get(`/users/${alice.username}`)).body.postCount).toBe(1);
    expect((await api.get('/users/me', alice)).body.postCount).toBe(1);
    await api.delete(`/posts/${post.id}`, alice).expect(204);
    expect(await db.query(`SELECT id FROM posts WHERE id = ANY($1::uuid[])`, [[post.id, repost.repostId]])).toEqual([]);
    expect(await db.query(`SELECT id FROM media WHERE id = $1`, [media.id])).toEqual([]);
    expect(await storage.resolve(key(media.url))).toBeNull();
    await api.http.get(path(media.url)).expect(404);
    expect((await api.get(`/posts/${quote.id}`)).body).toMatchObject({ content: 'keep my text', referencedPost: null });
    expect((await api.get('/users/me', alice)).body.postCount).toBe(0);
    expect((await api.get('/users/me', bob)).body.postCount).toBe(1);
    expect((await db.query(`SELECT post_count FROM users WHERE id = $1`, [alice.id]))[0].post_count).toBe(0);
    expect(await db.query(`SELECT * FROM media_file_deletions`)).toEqual([]);
  });

  it('deletes media removed during editing immediately, while keeping retained attachments', async () => {
    const a = await upload();
    const b = await upload();
    const post = await api.createPost(alice, { mediaIds: [a.id, b.id] });
    await api.patch(`/posts/${post.id}`, { mediaIds: [b.id] }, alice).expect(200);
    expect(await storage.resolve(key(a.url))).toBeNull();
    expect(await storage.resolve(key(b.url))).not.toBeNull();
    await api.http.get(path(a.url)).expect(404);
    await api.http.get(path(b.url)).expect(200);
  });

  it('persists failed file deletions, revokes old URLs and finishes them on retry', async () => {
    const media = await upload();
    const post = await api.createPost(alice, { mediaIds: [media.id] });
    vi.spyOn(storage, 'delete').mockRejectedValueOnce(new Error('simulated storage outage'));
    await api.delete(`/posts/${post.id}`, alice).expect(204);
    expect(await storage.resolve(key(media.url))).not.toBeNull();
    await api.http.get(path(media.url)).expect(404);
    expect((await db.query(`SELECT attempts FROM media_file_deletions WHERE storage_key = $1`, [key(media.url)]))[0].attempts).toBe(1);
    await db.query(`UPDATE media_file_deletions SET next_attempt_at = now()`);
    await app.get(ContentDeletionService).retryFiles();
    expect(await storage.resolve(key(media.url))).toBeNull();
    expect(await db.query(`SELECT * FROM media_file_deletions`)).toEqual([]);
  });

  it('does not delete files or leave queued work from a rolled-back transaction', async () => {
    const media = await upload();
    await expect(db.transaction(async (m) => {
      await app.get(ContentDeletionService).deleteMedia(m, [media.id]);
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await storage.resolve(key(media.url))).not.toBeNull();
    expect(await db.query(`SELECT * FROM media_file_deletions`)).toEqual([]);
    await api.delete(`/media/${media.id}`, alice).expect(204);
    expect(await storage.resolve(key(media.url))).toBeNull();
  });

  it('keeps the stored counter correct when several posts are deleted concurrently', async () => {
    const posts = await Promise.all(Array.from({ length: 8 }, () => api.createPost(alice)));
    await Promise.all(posts.map((post) => api.delete(`/posts/${post.id}`, alice).expect(204)));
    expect((await db.query(`SELECT post_count FROM users WHERE id = $1`, [alice.id]))[0].post_count).toBe(0);
    expect((await api.get(`/users/${alice.username}`)).body.postCount).toBe(0);
  });

  it('purges previously soft-deleted posts with their files', async () => {
    const media = await upload();
    const post = await api.createPost(alice, { mediaIds: [media.id] });
    await db.query(`UPDATE posts SET deleted_at = now() WHERE id = $1`, [post.id]);
    await app.get(ContentDeletionService).purgeLegacyDeleted();
    expect(await db.query(`SELECT id FROM posts WHERE id = $1`, [post.id])).toEqual([]);
    expect(await storage.resolve(key(media.url))).toBeNull();
    expect((await api.get('/users/me', alice)).body.postCount).toBe(0);
  });

  it('secures admin bulk deletion, deletes files and cannot restore deleted posts', async () => {
    const media = await upload();
    const post = await api.createPost(alice, { mediaIds: [media.id] });
    await api.setRole(bob, 'ADMIN');
    const url = `/admin/users/${alice.id}/content/delete`;
    const body = { scope: 'posts', reason: 'Requested permanent deletion', confirmUsername: alice.username };
    await api.post(url, body, alice).expect(403);
    await api.post(url, body, bob).expect(403);
    const token = (await api.post('/admin/step-up', { password: 'password123' }, bob).expect(200)).body.token;
    await api.post(url, { ...body, confirmUsername: 'wrong' }, bob).set('X-Step-Up-Token', token).expect(400);
    const result = await api.post(url, body, bob).set('X-Step-Up-Token', token).expect(200);
    expect(result.body).toMatchObject({ posts: 1, files: 1 });
    expect(await storage.resolve(key(media.url))).toBeNull();
    await api.post(`/admin/posts/${post.id}/moderation`, { status: 'ACTIVE', reason: 'Try restoring deleted post' }, bob).expect(404);
    expect((await api.get(`/users/${alice.username}`)).body.postCount).toBe(0);
  });

  it('admin comment deletion erases text while preserving another author’s reply, then removes empty placeholders', async () => {
    const post = await api.createPost(alice);
    const top = (await api.post(`/posts/${post.id}/comments`, { content: 'erase this' }, alice).expect(201)).body;
    const reply = (await api.post(`/comments/${top.id}/replies`, { content: 'preserve my reply' }, bob).expect(201)).body;
    await api.setRole(bob, 'ADMIN');
    const token = (await api.post('/admin/step-up', { password: 'password123' }, bob).expect(200)).body.token;
    await api.post(`/admin/comments/${top.id}/delete`, { reason: 'Permanent removal requested' }, bob).set('X-Step-Up-Token', token).expect(200);
    expect((await db.query(`SELECT content FROM comments WHERE id = $1`, [top.id]))[0].content).toBe('');
    expect((await api.get(`/comments/${top.id}/replies`)).body.items[0].content).toBe('preserve my reply');
    await api.delete(`/comments/${reply.id}`, bob).expect(204);
    expect(await db.query(`SELECT id FROM comments WHERE id = ANY($1::uuid[])`, [[top.id, reply.id]])).toEqual([]);
  });
});
