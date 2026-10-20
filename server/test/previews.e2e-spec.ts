import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import sharp from 'sharp';
import { Api, createTestApp, resetDatabase, type TestUser } from './setup/test-app.js';

describe('Link preview images (e2e)', () => {
  let app: INestApplication, api: Api, db: DataSource, alice: TestUser, bob: TestUser;
  beforeAll(async () => { app = await createTestApp(); api = new Api(app); db = app.get(DataSource); });
  beforeEach(async () => { await resetDatabase(app); alice = await api.register('alice'); bob = await api.register('bob'); });
  afterAll(() => app?.close());
  const jpeg = async (path: string) => {
    const res = await api.http.get(`/api${path}`).buffer(true).parse((r, done) => { const chunks: Buffer[] = []; r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => done(null, Buffer.concat(chunks))); });
    return res;
  };
  const photo = async (user: TestUser) => {
    const png = await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#2b6fbf' } }).png().toBuffer();
    return (await api.http.post('/api/media').set(user.auth).attach('file', png, { filename: 'p.png', contentType: 'image/png' }).expect(201)).body;
  };

  it('serves a JPEG of a public photo post to anyone, and nothing for followers-only or private content', async () => {
    const post = await api.createPost(alice, { content: 'Pier at sunset', mediaIds: [(await photo(alice)).id] });
    const res = await jpeg(`/posts/${post.id}/preview.jpg`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/jpeg');
    const meta = await sharp(res.body as Buffer).metadata();
    expect(meta).toMatchObject({ format: 'jpeg', width: 1200 });
    expect((await jpeg(`/posts/${post.id}/preview.jpg`)).status).toBe(200);
    const followers = await api.createPost(alice, { content: 'Friends only', visibility: 'FOLLOWERS', mediaIds: [(await photo(alice)).id] });
    expect([403, 404]).toContain((await jpeg(`/posts/${followers.id}/preview.jpg`)).status);
    const text = await api.createPost(alice, { content: 'Just words' });
    expect((await jpeg(`/posts/${text.id}/preview.jpg`)).status).toBe(404);
    await db.query('UPDATE users SET is_private = true WHERE id = $1', [alice.id]);
    expect([403, 404]).toContain((await jpeg(`/posts/${post.id}/preview.jpg`)).status);
  });

  it('takes a frame from a video post', async () => {
    const video = await api.uploadVideo(bob);
    const post = await api.createPost(bob, { content: 'Reel', mediaIds: [video.id] });
    const res = await jpeg(`/posts/${post.id}/preview.jpg`);
    expect(res.status).toBe(200);
    expect((await sharp(res.body as Buffer).metadata()).format).toBe('jpeg');
  });

  it('serves profile photos as square JPEGs', async () => {
    expect((await jpeg(`/users/${alice.username}/avatar.jpg`)).status).toBe(404);
    const png = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#e64980' } }).png().toBuffer();
    await api.http.post('/api/users/me/avatar').set(alice.auth).attach('file', png, { filename: 'a.png', contentType: 'image/png' }).expect(200);
    const res = await jpeg(`/users/${alice.username}/avatar.jpg`);
    expect(res.status).toBe(200);
    expect(await sharp(res.body as Buffer).metadata()).toMatchObject({ format: 'jpeg', width: 512, height: 512 });
    expect((await jpeg('/users/bad..name/avatar.jpg')).status).toBe(404);
  });
});
