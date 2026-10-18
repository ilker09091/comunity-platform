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
import { MessagesService } from '../src/modules/social/messages.service.js';

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
    await api.post(`/users/${alice.id}/follow`, {}, bob).expect(200);
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
    await api.post(`/users/${alice.id}/follow`, {}, bob).expect(200);
    const photo = await image();
    await api
      .post(`/messages/${bob.id}`, { mediaId: photo.id }, outsider)
      .expect(404);
    // Photos can be sent in direct messages too.
    await api
      .post(`/messages/${bob.id}`, { mediaId: photo.id }, alice)
      .expect(201);
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

  it('holds a stranger to one request message until it is accepted, and can delete requests', async () => {
    await api.post(`/messages/${alice.id}`, { content: 'hi' }, bob).expect(201);
    await api
      .post(`/messages/${alice.id}`, { content: 'again?' }, bob)
      .expect(403);
    expect((await api.get(`/messages/${alice.id}/status`, bob)).body).toMatchObject({
      isRequest: false,
      awaitingAcceptance: true,
      canSend: false,
    });
    expect((await api.get(`/messages/${bob.id}/status`, alice)).body).toMatchObject({
      isRequest: true,
      awaitingAcceptance: false,
      canSend: true,
    });
    await api.delete(`/messages/${bob.id}/request`, alice).expect(204);
    expect((await api.get('/messages', alice)).body.items).toHaveLength(0);
    await api.post(`/messages/${alice.id}`, { content: 'sorry' }, bob).expect(201);
    await api.post(`/messages/${outsider.id}/accept`, {}, alice).expect(404);
    await api.post(`/messages/${bob.id}/accept`, {}, alice).expect(204);
    await api.post(`/messages/${bob.id}/accept`, {}, alice).expect(204);
    expect((await api.get('/messages?folder=primary', alice)).body.items).toHaveLength(1);
    await api.post(`/messages/${alice.id}`, { content: 'thanks!' }, bob).expect(201);
    await api.post(`/messages/${alice.id}`, { content: 'more' }, bob).expect(201);
    await api.delete(`/messages/${bob.id}/request`, alice).expect(409);
    expect((await api.get(`/messages/${alice.id}/status`, bob)).body.canSend).toBe(true);
  });

  it('records views, likes and replies on stories and lists viewers only to the author', async () => {
    const created = (await story()).body;
    await api.post(`/users/${alice.id}/follow`, {}, bob).expect(200);
    await api.post(`/stories/${created.id}/like`, {}, outsider).expect(404);
    await api.post(`/stories/${created.id}/like`, {}, alice).expect(400);
    await api.post(`/stories/${created.id}/like`, {}, bob).expect(204);
    await api.post(`/stories/${created.id}/like`, {}, bob).expect(204);
    const mine = (await api.get('/stories', alice)).body.items[0];
    expect(mine).toMatchObject({ viewCount: 1, likeCount: 1 });
    expect((await api.get('/stories', bob)).body.items[0]).toMatchObject({
      isLiked: true,
      isViewed: true,
      likeCount: 0,
      viewCount: 0,
    });
    const viewers = (await api.get(`/stories/${created.id}/viewers`, alice)).body;
    expect(viewers.items).toHaveLength(1);
    expect(viewers.items[0]).toMatchObject({ user: { id: bob.id }, liked: true });
    await api.get(`/stories/${created.id}/viewers`, bob).expect(404);
    await api.delete(`/stories/${created.id}/like`, bob).expect(204);
    expect((await api.get(`/stories/${created.id}/viewers`, alice)).body.items[0].liked).toBe(false);
    const reply = (
      await api.post(`/stories/${created.id}/reply`, { content: 'Love this' }, bob).expect(201)
    ).body;
    expect(reply.storyReply.storyId).toBe(created.id);
    const received = (await api.get(`/messages/${bob.id}`, alice)).body.items[0];
    expect(received.storyReply.media.type).toBe('IMAGE');
    await api.post(`/stories/${created.id}/reply`, { content: '' }, bob).expect(400);
    await db.query("UPDATE stories SET expires_at = now() - interval '1 second' WHERE id = $1", [created.id]);
    expect((await api.get(`/messages/${bob.id}`, alice)).body.items[0].storyReply).toEqual({
      storyId: created.id,
      media: null,
    });
    await api.post(`/stories/${created.id}/reply`, { content: 'late' }, bob).expect(404);
  });

  it('sends built-in and custom stickers in comments and keeps used stickers after deletion', async () => {
    const stickers = (await api.get('/stickers', alice)).body;
    expect(stickers.length).toBeGreaterThanOrEqual(20);
    const builtIn = stickers[0];
    expect(builtIn).toMatchObject({ isOwn: false, url: null });
    expect(builtIn.emoji).toBeTruthy();
    const post = await api.createPost(bob, { content: 'sticker me' });
    await api.post(`/posts/${post.id}/comments`, {}, alice).expect(400);
    const plain = (
      await api.post(`/posts/${post.id}/comments`, { stickerId: builtIn.id }, alice).expect(201)
    ).body;
    expect(plain).toMatchObject({ content: '', sticker: { id: builtIn.id }, stickerUnavailable: false });
    const custom = (
      await api.post('/stickers', { mediaId: (await image()).id, name: 'Me' }, alice).expect(201)
    ).body;
    expect(custom).toMatchObject({ name: 'Me', isOwn: true, emoji: null });
    expect(custom.url).toContain('/media/files/');
    expect((await api.get('/stickers', alice)).body.at(-1).id).toBe(custom.id);
    expect((await api.get('/stickers', bob)).body.some((s: any) => s.id === custom.id)).toBe(false);
    await api.post(`/posts/${post.id}/comments`, { stickerId: custom.id }, bob).expect(404);
    const used = (
      await api.post(`/posts/${post.id}/comments`, { stickerId: custom.id, content: 'look' }, alice).expect(201)
    ).body;
    expect(used.sticker.url).toBeTruthy();
    await api.delete(`/stickers/${custom.id}`, bob).expect(404);
    await api.delete(`/stickers/${custom.id}`, alice).expect(204);
    expect((await api.get('/stickers', alice)).body.some((s: any) => s.id === custom.id)).toBe(false);
    const listed = (await api.get(`/posts/${post.id}/comments`, bob)).body.items;
    expect(listed.find((c: any) => c.id === used.id).sticker.id).toBe(custom.id);
    await api.post(`/posts/${post.id}/comments`, { stickerId: custom.id }, alice).expect(404);
    const unused = (
      await api.post('/stickers', { mediaId: (await image()).id }, alice).expect(201)
    ).body;
    const media = (await db.query('SELECT media_id FROM stickers WHERE id = $1', [unused.id]))[0].media_id;
    await api.post('/stickers', { mediaId: media }, alice).expect(409);
    await api.delete(`/stickers/${unused.id}`, alice).expect(204);
    expect((await db.query('SELECT 1 FROM media WHERE id = $1', [media])).length).toBe(0);
    await api.post('/stickers', { mediaId: (await api.uploadVideo(alice)).id }, alice).expect(400);
  });

  /** A mono 8 kHz WAV tone, long enough to clip 15 s from. */
  const wav = (seconds: number) => {
    const rate = 8000;
    const samples = rate * seconds;
    const buffer = Buffer.alloc(44 + samples * 2);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + samples * 2, 4);
    buffer.write('WAVEfmt ', 8);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(rate, 24);
    buffer.writeUInt32LE(rate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(samples * 2, 40);
    for (let i = 0; i < samples; i++)
      buffer.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 8000), 44 + i * 2);
    return buffer;
  };

  it('tracks delivery, presence, typing and quoted replies', async () => {
    await api.post(`/users/${alice.id}/follow`, {}, bob).expect(200);
    const hi = (await send('hi')).body;
    expect(hi).toMatchObject({ deliveredAt: null, readAt: null, replyTo: null, viewOnce: false });
    await api.get('/messages/unread-count', bob).expect(200);
    const delivered = (await api.get(`/messages/${bob.id}`, alice)).body.items[0];
    expect(delivered.deliveredAt).not.toBeNull();
    expect(delivered.readAt).toBeNull();
    const status = (await api.get(`/messages/${bob.id}/status`, alice)).body;
    expect(status).toMatchObject({ peerOnline: true, peerTyping: false });
    expect(status.peerLastActiveAt).not.toBeNull();
    expect((await api.get('/messages', alice)).body.items[0]).toMatchObject({ online: true });
    await api.post(`/messages/${alice.id}/typing`, {}, bob).expect(204);
    expect((await api.get(`/messages/${bob.id}/status`, alice)).body.peerTyping).toBe(true);
    expect((await api.get(`/messages/${alice.id}/status`, bob)).body.peerTyping).toBe(false);
    await api.delete(`/messages/${alice.id}/typing`, bob).expect(204);
    expect((await api.get(`/messages/${bob.id}/status`, alice)).body.peerTyping).toBe(false);
    await db.query("UPDATE users SET last_active_at = now() - interval '5 minutes' WHERE id = $1", [bob.id]);
    expect((await api.get(`/messages/${bob.id}/status`, alice)).body.peerOnline).toBe(false);
    const reply = (
      await api.post(`/messages/${alice.id}`, { content: 'yo', replyToId: hi.id }, bob).expect(201)
    ).body;
    expect(reply.replyTo).toEqual({ id: hi.id, senderId: alice.id, kind: 'TEXT', preview: 'hi' });
    await api.post(`/users/${outsider.id}/follow`, {}, bob).expect(200);
    await api.post(`/messages/${bob.id}`, { content: 'other' }, outsider).expect(201);
    const other = (await api.get(`/messages/${outsider.id}`, bob)).body.items[0];
    await api
      .post(`/messages/${alice.id}`, { content: 'x', replyToId: other.id }, bob)
      .expect(404);
  });

  it('lets the recipient open a view-once photo exactly once, then deletes it', async () => {
    await api.post(`/users/${alice.id}/follow`, {}, bob).expect(200);
    await api.post(`/messages/${bob.id}`, { content: 'x', viewOnce: true }, alice).expect(400);
    const photo = await image();
    const sent = (
      await api.post(`/messages/${bob.id}`, { mediaId: photo.id, viewOnce: true }, alice).expect(201)
    ).body;
    expect(sent).toMatchObject({ media: null, viewOnce: true, viewOnceType: 'IMAGE', openedAt: null });
    const listed = (await api.get(`/messages/${alice.id}`, bob)).body.items[0];
    expect(listed).toMatchObject({ media: null, viewOnceType: 'IMAGE' });
    await api.post(`/messages/${sent.id}/open`, {}, alice).expect(404);
    const opened = (await api.post(`/messages/${sent.id}/open`, {}, bob).expect(201)).body;
    expect(opened.type).toBe('IMAGE');
    const path = new URL(opened.url).pathname + new URL(opened.url).search;
    await api.http.get(path).expect(200);
    await api.post(`/messages/${sent.id}/open`, {}, bob).expect(409);
    const after = (await api.get(`/messages/${alice.id}`, bob)).body.items[0];
    expect(after.openedAt).not.toBeNull();
    expect(after.viewOnceType).toBeNull();
    await db.query("UPDATE direct_messages SET opened_at = now() - interval '3 minutes' WHERE id = $1", [sent.id]);
    await api.http.get(path).expect(404);
    await app.get(MessagesService).purgeOpenedViewOnce();
    expect((await db.query('SELECT 1 FROM media WHERE id = $1', [photo.id])).length).toBe(0);
    expect((await api.get(`/messages/${bob.id}`, alice)).body.items[0]).toMatchObject({
      viewOnce: true,
      openedAt: expect.any(String),
    });
    const normal = (
      await api.post(`/messages/${bob.id}`, { mediaId: (await image()).id }, alice).expect(201)
    ).body;
    expect(normal.media.type).toBe('IMAGE');
  });

  it('shares notes with a 15 second song clip to followers and replaces them', async () => {
    const upload = (buffer: Buffer, startMs: number, user = alice, name = 'song.wav') =>
      api.http
        .post('/api/notes/audio')
        .set(user.auth)
        .field('startMs', String(startMs))
        .attach('file', buffer, { filename: name, contentType: 'audio/wav' });
    await upload(wav(20), 30_000).expect(400);
    await upload(png, 0, alice, 'not-audio.png').expect(400);
    const res = await upload(wav(20), 3_000);
    expect(res.body).toMatchObject({ durationMs: 15_000 });
    const clip = res.body;
    expect(clip.durationMs).toBe(15_000);
    const clipPath = new URL(clip.url).pathname + new URL(clip.url).search;
    await api.http.get(clipPath).expect(200);
    await api.post('/notes', {}, alice).expect(400);
    await api.post('/notes', { text: 'x'.repeat(61) }, alice).expect(400);
    await api.post('/notes', { audioId: clip.id }, bob).expect(404);
    const note = (
      await api.post('/notes', { text: 'Listening now', audioId: clip.id, songTitle: 'Tone' }, alice).expect(201)
    ).body;
    expect(note).toMatchObject({ text: 'Listening now', songTitle: 'Tone', audioDurationMs: 15_000, isOwn: true });
    expect(note.audioUrl).toContain('.m4a');
    expect((await api.get('/notes', bob)).body).toHaveLength(0);
    await api.post(`/users/${alice.id}/follow`, {}, bob).expect(200);
    expect((await api.get('/notes', bob)).body[0]).toMatchObject({ id: note.id, isOwn: false });
    expect((await api.get('/notes', outsider)).body).toHaveLength(0);
    const replaced = (await api.post('/notes', { text: 'Just text' }, alice).expect(201)).body;
    expect(replaced).toMatchObject({ text: 'Just text', audioUrl: null });
    await api.http.get(new URL(note.audioUrl).pathname + new URL(note.audioUrl).search).expect(404);
    expect((await api.get('/notes', alice)).body).toHaveLength(1);
    await api.delete('/notes/me', alice).expect(204);
    await api.delete('/notes/me', alice).expect(404);
    expect((await api.get('/notes', bob)).body).toHaveLength(0);
  });

  it('replies to a note with a DM that keeps a snapshot of the note', async () => {
    const note = (await api.post('/notes', { text: 'Who is up?' }, alice).expect(201)).body;
    await api.post(`/notes/${note.id}/reply`, { content: 'me!' }, bob).expect(404);
    await api.post(`/users/${alice.id}/follow`, {}, bob).expect(200);
    await api.post(`/notes/${note.id}/reply`, { content: 'me!' }, alice).expect(400);
    const reply = (await api.post(`/notes/${note.id}/reply`, { content: 'me!' }, bob).expect(201)).body;
    expect(reply).toMatchObject({ content: 'me!', noteReply: { text: 'Who is up?', songTitle: null } });
    await api.delete('/notes/me', alice).expect(204);
    expect((await api.get(`/messages/${bob.id}`, alice)).body.items[0].noteReply).toEqual({
      text: 'Who is up?',
      songTitle: null,
    });
    await api.post(`/notes/${note.id}/reply`, { content: 'late' }, bob).expect(404);
  });

  it('unsends own messages and deletes whole conversations from the database', async () => {
    await api.post(`/users/${alice.id}/follow`, {}, bob).expect(200);
    const first = (await send('first')).body;
    const photo = await image();
    const withPhoto = (await api.post(`/messages/${bob.id}`, { mediaId: photo.id }, alice).expect(201)).body;
    const answer = (await api.post(`/messages/${alice.id}`, { content: 'answer', replyToId: first.id }, bob).expect(201)).body;
    await api.delete(`/messages/${first.id}`, bob).expect(404);
    await api.delete(`/messages/${first.id}`, alice).expect(204);
    expect((await db.query('SELECT 1 FROM direct_messages WHERE id = $1', [first.id])).length).toBe(0);
    expect((await api.get(`/messages/${alice.id}`, bob)).body.items.find((m: any) => m.id === answer.id).replyTo).toBeNull();
    await api.delete(`/messages/${withPhoto.id}`, alice).expect(204);
    expect((await db.query('SELECT 1 FROM media WHERE id = $1', [photo.id])).length).toBe(0);
    await send('again');
    await api.delete(`/messages/${outsider.id}/conversation`, alice).expect(404);
    await api.delete(`/messages/${alice.id}/conversation`, bob).expect(204);
    expect(
      (await db.query('SELECT 1 FROM direct_messages WHERE (sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1)', [alice.id, bob.id])).length,
    ).toBe(0);
    expect((await api.get('/messages', alice)).body.items).toHaveLength(0);
  });

  it('adds music to an unpublished video and replaces its file', async () => {
    const video = await api.uploadVideo(alice);
    const before = (await db.query('SELECT storage_key FROM media WHERE id = $1', [video.id]))[0].storage_key;
    const add = (id: string, user = alice, buffer = wav(12), mix = 'false') =>
      api.http
        .post(`/api/media/${id}/soundtrack`)
        .set(user.auth)
        .field('mix', mix)
        .attach('file', buffer, { filename: 'song.wav', contentType: 'audio/wav' });
    await add(video.id, bob).expect(404);
    await add(video.id, alice, png).expect(400);
    const updated = (await add(video.id).expect(201)).body;
    expect(updated).toMatchObject({ id: video.id, type: 'VIDEO', status: 'READY' });
    const after = (await db.query('SELECT storage_key FROM media WHERE id = $1', [video.id]))[0].storage_key;
    expect(after).not.toBe(before);
    const path = new URL(updated.url).pathname + new URL(updated.url).search;
    await api.http.get(path).expect(200);
    expect((await db.query('SELECT 1 FROM media_file_deletions WHERE storage_key = $1', [before])).length).toBe(0);
    await add(video.id, alice, wav(12), 'true').expect(201);
    await api.post('/posts', { mediaIds: [video.id] }, alice).expect(201);
    await add(video.id).expect(404);
  });
});
