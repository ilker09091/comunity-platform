import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import sharp from 'sharp';
import {
  Api,
  createTestApp,
  resetDatabase,
  type TestUser,
} from './setup/test-app.js';
import { appConfig } from '../src/config/app.config.js';
import { MediaService } from '../src/modules/media/media.service.js';
import { ContentDeletionService } from '../src/modules/media/content-deletion.service.js';
import { StoriesService } from '../src/modules/social/stories.service.js';

describe('Direct messages and stories (e2e)', () => {
  let app: INestApplication;
  let api: Api;
  let db: DataSource;
  let alice: TestUser;
  let bob: TestUser;
  let outsider: TestUser;
  let png: Buffer;
  beforeAll(async () => {
    app = await createTestApp();
    api = new Api(app);
    db = app.get(DataSource);
    png = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#258cf4' },
    })
      .png()
      .toBuffer();
  });
  beforeEach(async () => {
    await resetDatabase(app);
    alice = await api.register('alice');
    bob = await api.register('bob');
    outsider = await api.register('outsider');
  });
  afterAll(() => app?.close());
  const image = async () =>
    (
      await api.http
        .post('/api/media')
        .set(alice.auth)
        .attach('file', png, {
          filename: 'story.png',
          contentType: 'image/png',
        })
        .expect(201)
    ).body;
  const story = async () =>
    api
      .post(
        '/stories',
        { mediaId: (await image()).id, caption: 'A moment' },
        alice,
      )
      .expect(201);
  const send = (content: string) =>
    api.post(`/messages/${bob.id}`, { content }, alice).expect(201);

  it('requires authentication and validates empty, invalid and self messages', async () => {
    await api.get('/messages').expect(401);
    await api.get('/stories').expect(401);
    await api.post(`/messages/${bob.id}`, {}, alice).expect(400);
    await api
      .post(`/messages/${bob.id}`, { content: '   ' }, alice)
      .expect(400);
    await api
      .post(`/messages/${alice.id}`, { content: 'self' }, alice)
      .expect(400);
    await api.post('/messages/not-a-uuid', { content: 'x' }, alice).expect(400);
    await api
      .post(`/messages/${bob.id}`, { content: 'x'.repeat(2001) }, alice)
      .expect(400);
  });

  it('isolates conversations and marks only received messages through the displayed message as read', async () => {
    const first = (await send('hello')).body;
    const second = (await send('newer')).body;
    expect(
      (await api.get('/messages/unread-count', bob).expect(200)).body.count,
    ).toBe(2);
    const conversations = (await api.get('/messages', bob).expect(200)).body;
    expect(conversations.items).toHaveLength(1);
    expect(conversations.items[0]).toMatchObject({
      user: { id: alice.id },
      unreadCount: 2,
      lastMessage: { id: second.id },
    });
    expect(
      (await api.get(`/messages/${alice.id}`, outsider).expect(200)).body.items,
    ).toEqual([]);
    await api.post(`/messages/${first.id}/read`, {}, outsider).expect(404);
    await api.post(`/messages/${first.id}/read`, {}, alice).expect(404);
    await api.post(`/messages/${first.id}/read`, {}, bob).expect(204);
    expect((await api.get('/messages/unread-count', bob)).body.count).toBe(1);
    const page = (
      await api.get(`/messages/${alice.id}?limit=1`, bob).expect(200)
    ).body;
    expect(page.items[0].id).toBe(second.id);
    expect(page.hasMore).toBe(true);
    const older = (
      await api
        .get(
          `/messages/${alice.id}?limit=1&cursor=${encodeURIComponent(page.nextCursor)}`,
          bob,
        )
        .expect(200)
    ).body;
    expect(older.items[0].id).toBe(first.id);
    expect(older.items[0].readAt).not.toBeNull();
  });

  it('delivers an uploaded video without exposing it to unrelated users or orphan deletion', async () => {
    const media = await api.uploadVideo(alice);
    const message = (
      await api
        .post(`/messages/${bob.id}`, { mediaId: media.id }, alice)
        .expect(201)
    ).body;
    expect(message.media.type).toBe('VIDEO');
    expect(
      (await api.get(`/messages/${alice.id}`, bob)).body.items[0].media.id,
    ).toBe(media.id);
    await api.get(`/media/${media.id}`, outsider).expect(404);
    await api.delete(`/media/${media.id}`, alice).expect(409);
    await api.post('/posts', { mediaIds: [media.id] }, alice).expect(409);
    await api
      .post(`/messages/${outsider.id}`, { mediaId: media.id }, alice)
      .expect(409);
    const files = await db.transaction((m) =>
      app.get(ContentDeletionService).deleteMedia(m, [media.id]),
    );
    expect(files.keys).toEqual([]);
    await db.query(
      "UPDATE media SET created_at = now() - interval '90 days' WHERE id = $1",
      [media.id],
    );
    const config = app.get(appConfig.KEY);
    const previous = config.media.cleanupEnabled;
    config.media.cleanupEnabled = true;
    try {
      expect(await app.get(MediaService).cleanupOrphans()).toBe(0);
    } finally {
      config.media.cleanupEnabled = previous;
    }
  });

  it('checks uploaded media ownership, readiness and attachment type', async () => {
    const photo = await image();
    await api
      .post(`/messages/${bob.id}`, { mediaId: photo.id }, outsider)
      .expect(404);
    await api
      .post(`/messages/${bob.id}`, { mediaId: photo.id }, alice)
      .expect(400);
    const video = await api.uploadVideo(alice);
    await db.query("UPDATE media SET status = 'PROCESSING' WHERE id = $1", [
      video.id,
    ]);
    await api
      .post(`/messages/${bob.id}`, { mediaId: video.id }, alice)
      .expect(400);
    await api.post('/stories', { mediaId: video.id }, alice).expect(400);
  });

  it('enforces blocks, private account approval and inactive recipients', async () => {
    await api.patch('/users/me', { isPrivate: true }, bob).expect(200);
    await api
      .post(`/messages/${bob.id}`, { content: 'private' }, alice)
      .expect(403);
    await api.post(`/users/${bob.id}/follow`, {}, alice).expect(200);
    await api
      .post(`/messages/${bob.id}`, { content: 'pending' }, alice)
      .expect(403);
    await db.query(
      'INSERT INTO follows(follower_id, following_id) VALUES ($1,$2)',
      [alice.id, bob.id],
    );
    await send('approved');
    await api.post(`/users/${alice.id}/block`, {}, bob).expect(200);
    await api.get(`/messages/${bob.id}`, alice).expect(403);
    await api
      .post(`/messages/${bob.id}`, { content: 'blocked' }, alice)
      .expect(403);
    expect((await api.get('/messages', bob)).body.items).toEqual([]);
    expect((await api.get('/messages/unread-count', bob)).body.count).toBe(0);
    await db.query("UPDATE users SET status = 'DEACTIVATED' WHERE id = $1", [
      outsider.id,
    ]);
    await api
      .post(`/messages/${outsider.id}`, { content: 'inactive' }, alice)
      .expect(404);
  });

  it('re-checks the recipient permission for shared posts and hides posts after privacy changes or deletion', async () => {
    const post = await api.createPost(alice, { content: 'public post' });
    await api
      .post(`/messages/${bob.id}`, { postId: post.id }, alice)
      .expect(201);
    expect(
      (await api.get(`/messages/${alice.id}`, bob)).body.items[0].post.id,
    ).toBe(post.id);
    await api
      .patch(`/posts/${post.id}`, { visibility: 'FOLLOWERS' }, alice)
      .expect(200);
    expect(
      (await api.get(`/messages/${alice.id}`, bob)).body.items[0].post,
    ).toBeNull();
    await api
      .post(`/messages/${bob.id}`, { postId: post.id }, alice)
      .expect(404);
    await api.delete(`/posts/${post.id}`, alice).expect(204);
    expect(
      (await api.get(`/messages/${alice.id}`, bob)).body.items[0].post,
    ).toBeNull();
  });

  it('shows stories to followers, counts views once, protects ownership, and honors blocks', async () => {
    const created = (await story()).body;
    expect(Date.parse(created.expiresAt) - Date.parse(created.createdAt)).toBe(
      86_400_000,
    );
    expect((await api.get('/stories', alice)).body.items).toHaveLength(1);
    expect((await api.get('/stories', bob)).body.items).toHaveLength(0);
    await api.post(`/stories/${created.id}/view`, {}, bob).expect(404);
    await api.post(`/users/${alice.id}/follow`, {}, bob).expect(200);
    expect((await api.get('/stories', bob)).body.items[0].media.type).toBe(
      'IMAGE',
    );
    await api.post(`/stories/${created.id}/view`, {}, bob).expect(204);
    await api.post(`/stories/${created.id}/view`, {}, bob).expect(204);
    await api.post(`/stories/${created.id}/view`, {}, alice).expect(204);
    expect((await api.get('/stories', alice)).body.items[0].viewCount).toBe(1);
    expect((await api.get('/stories', bob)).body.items[0]).toMatchObject({
      isViewed: true,
      viewCount: 0,
    });
    await api.delete(`/stories/${created.id}`, bob).expect(404);
    await api.delete(`/media/${created.media.id}`, alice).expect(409);
    await api.post(`/users/${alice.id}/block`, {}, bob).expect(200);
    expect((await api.get('/stories', bob)).body.items).toHaveLength(0);
    await api.post(`/stories/${created.id}/view`, {}, bob).expect(404);
  });

  it('expires stories at 24h including existing signed media URLs, then cleans up files', async () => {
    const created = (await story()).body;
    const url = new URL(created.media.url);
    const path = url.pathname + url.search;
    await api.http.get(path).expect(200);
    await db.query(
      "UPDATE stories SET expires_at = now() - interval '1 second' WHERE id = $1",
      [created.id],
    );
    expect((await api.get('/stories', alice)).body.items).toHaveLength(0);
    await api.http.get(path).expect(404);
    await api.post(`/stories/${created.id}/view`, {}, alice).expect(404);
    await app.get(StoriesService).cleanupExpired();
    expect(
      await db.query('SELECT id FROM media WHERE id = $1', [created.media.id]),
    ).toHaveLength(0);
    await api.http.get(path).expect(404);
  });

  it('supports video stories and rejects long videos, reused media and foreign media', async () => {
    const video = await api.uploadVideo(alice);
    await api.post('/stories', { mediaId: video.id }, bob).expect(404);
    await db.query('UPDATE media SET duration_ms = 61000 WHERE id = $1', [
      video.id,
    ]);
    await api.post('/stories', { mediaId: video.id }, alice).expect(400);
    await db.query('UPDATE media SET duration_ms = 2000 WHERE id = $1', [
      video.id,
    ]);
    const created = (
      await api.post('/stories', { mediaId: video.id }, alice).expect(201)
    ).body;
    expect(created.media.type).toBe('VIDEO');
    await api.post('/stories', { mediaId: video.id }, alice).expect(409);
    await api.post('/posts', { mediaIds: [video.id] }, alice).expect(409);
    await api.delete(`/stories/${created.id}`, alice).expect(204);
    await api.get(`/media/${video.id}`, alice).expect(404);
  });

  it('shares a Reel to a story, re-checks its visibility and keeps the Reel when the story goes', async () => {
    const video = await api.uploadVideo(outsider);
    const reel = await api.createPost(outsider, { mediaIds: [video.id] });
    const text = await api.createPost(outsider, { content: 'no video' });
    await api.post('/stories', {}, alice).expect(400);
    await api
      .post('/stories', { postId: reel.id, mediaId: video.id }, alice)
      .expect(400);
    await api.post('/stories', { postId: text.id }, alice).expect(400);
    const created = (
      await api.post('/stories', { postId: reel.id }, alice).expect(201)
    ).body;
    expect(created.post.id).toBe(reel.id);
    expect(created.media.id).toBe(video.id);
    await api.post(`/users/${alice.id}/follow`, {}, bob).expect(200);
    expect((await api.get('/stories', bob)).body.items[0].post.id).toBe(
      reel.id,
    );
    await api.post(`/stories/${created.id}/view`, {}, bob).expect(204);
    await api.post(`/users/${bob.id}/block`, {}, outsider).expect(200);
    expect((await api.get('/stories', bob)).body.items).toHaveLength(0);
    await api.delete(`/stories/${created.id}`, alice).expect(204);
    await api.get(`/posts/${reel.id}`, alice).expect(200);
    await api.get(`/media/${video.id}`, outsider).expect(200);
    const again = (
      await api.post('/stories', { postId: reel.id }, alice).expect(201)
    ).body;
    await api.delete(`/posts/${reel.id}`, outsider).expect(204);
    expect(
      (await db.query('SELECT 1 FROM stories WHERE id = $1', [again.id]))
        .length,
    ).toBe(0);
  });

  it('separates message requests from primary conversations', async () => {
    await api.post(`/messages/${alice.id}`, { content: 'hi' }, bob).expect(201);
    const folder = async (name: string) =>
      (await api.get(`/messages?folder=${name}`, alice)).body.items;
    expect((await api.get('/messages', alice)).body.items[0].isRequest).toBe(
      true,
    );
    expect(await folder('requests')).toHaveLength(1);
    expect(await folder('primary')).toHaveLength(0);
    expect((await api.get('/messages', bob)).body.items[0].isRequest).toBe(
      false,
    );
    await api.get('/messages?folder=other', alice).expect(400);
    await api.post(`/messages/${bob.id}`, { content: 'hey' }, alice).expect(201);
    expect(await folder('requests')).toHaveLength(0);
    expect((await folder('primary'))[0].user.id).toBe(bob.id);
  });
});
