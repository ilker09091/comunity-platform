import { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import { Api, createTestApp, resetDatabase, TestUser } from './setup/test-app.js';

describe('Media uploads (e2e)', () => {
  let app: INestApplication;
  let api: Api;
  let alice: TestUser;
  let bob: TestUser;
  let png: Buffer;

  beforeAll(async () => {
    app = await createTestApp();
    api = new Api(app);
    png = await sharp({ create: { width: 64, height: 32, channels: 3, background: '#ff0000' } }).png().toBuffer();
  });
  beforeEach(async () => {
    await resetDatabase(app);
    alice = await api.register('alice');
    bob = await api.register('bob');
  });
  afterAll(() => app.close());

  const upload = (user: TestUser | null, data: Buffer, filename: string, contentType: string) => {
    const r = api.http.post('/api/media');
    if (user) r.set(user.auth);
    return r.attach('file', data, { filename, contentType });
  };

  it('uploads images, serves them via signed URLs and attaches them in order', async () => {
    const a = (await upload(alice, png, 'a.png', 'image/png').expect(201)).body;
    const b = (await upload(alice, png, 'b.png', 'image/png').expect(201)).body;
    expect(a).toMatchObject({ type: 'IMAGE', status: 'READY', mimeType: 'image/png', width: 64, height: 32 });

    const path = new URL(a.url).pathname + new URL(a.url).search;
    const file = await api.http.get(path).expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    await api.http.get(path.replace(/sig=[^&]+/, 'sig=forged')).expect(403);

    const post = await api.createPost(alice, { content: 'pics', mediaIds: [b.id, a.id] });
    expect(post.media.map((m: { id: string }) => m.id)).toEqual([b.id, a.id]);

    // Attached media cannot be reused or deleted.
    expect((await api.post('/posts', { mediaIds: [a.id] }, alice).expect(409)).body.code).toBe('MEDIA_IN_USE');
    await api.delete(`/media/${a.id}`, alice).expect(409);
  });

  it('verifies ownership of media', async () => {
    const a = (await upload(alice, png, 'a.png', 'image/png').expect(201)).body;
    await api.post('/posts', { mediaIds: [a.id] }, bob).expect(404);
    await api.get(`/media/${a.id}`, bob).expect(404);
    await api.delete(`/media/${a.id}`, bob).expect(404);
    await api.delete(`/media/${a.id}`, alice).expect(204);
  });

  it('validates file signatures, not declared types, and requires auth', async () => {
    await upload(null, png, 'a.png', 'image/png').expect(401);
    const spoofed = await upload(alice, Buffer.from('<?php echo "pwned"; ?>'), 'evil.png', 'image/png').expect(415);
    expect(spoofed.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    await api.http.post('/api/media').set(alice.auth).expect(400);
  });

  it('enforces the attachment limit', async () => {
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push((await upload(alice, png, `${i}.png`, 'image/png').expect(201)).body.id);
    await api.post('/posts', { mediaIds: ids }, alice).expect(400);
  });

  it('sets avatars (images only) visible on the public profile', async () => {
    const me = await api.http.post('/api/users/me/avatar').set(alice.auth).attach('file', png, { filename: 'me.png', contentType: 'image/png' }).expect(200);
    expect(me.body.avatarUrl).toMatch(/\/api\/media\/files\/[a-f0-9]{32}\.png\?exp=\d+&sig=/);
    expect((await api.get(`/users/${alice.username}`)).body.avatarUrl).toEqual(expect.any(String));
    await api.delete('/users/me/avatar', alice).expect(200);
  });
});
