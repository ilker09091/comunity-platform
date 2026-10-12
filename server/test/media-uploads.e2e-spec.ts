import type { INestApplication } from '@nestjs/common';
import { Api, API, createTestApp, resetDatabase, type TestUser } from './setup/test-app.js';
import { testVideo } from './setup/videos.js';

describe('Resumable chunked uploads (e2e)', () => {
  let app: INestApplication;
  let api: Api;
  let alice: TestUser;
  let bob: TestUser;

  const put = (user: TestUser, id: string, offset: number, bytes: Buffer) =>
    api.http.post(`${API}/media/uploads/${id}/chunks?offset=${offset}`).set(user.auth).set('Content-Type', 'application/octet-stream').send(bytes);

  beforeAll(async () => {
    app = await createTestApp();
    api = new Api(app);
  }, 120_000);
  beforeEach(async () => {
    await resetDatabase(app);
    alice = await api.register('alice');
    bob = await api.register('bob');
  });
  afterAll(() => app?.close());

  it('assembles a video sent in pieces and compresses it like a normal upload', async () => {
    const video = testVideo({ ext: 'mkv', width: 320, height: 568, seconds: 2, codec: ['-c:v', 'mpeg4', '-q:v', '2', '-c:a', 'libmp3lame'] });
    const session = (await api.post('/media/uploads', { size: video.buffer.length, fileName: 'VID_2041.mkv' }, alice).expect(201)).body;
    expect(session).toMatchObject({ received: 0, size: video.buffer.length, chunkSize: 8 * 1024 * 1024 });
    const piece = Math.ceil(video.buffer.length / 3);
    let offset = 0;
    while (offset < video.buffer.length) {
      const res = await put(alice, session.id, offset, video.buffer.subarray(offset, offset + piece)).expect(200);
      offset = res.body.received;
    }
    const media = (await api.post(`/media/uploads/${session.id}/complete`, undefined, alice).expect(201)).body;
    expect(media).toMatchObject({ type: 'VIDEO', status: 'PROCESSING' });
    expect(await api.waitForMedia(alice, media.id)).toMatchObject({ status: 'READY', mimeType: 'video/mp4', width: 320, height: 568 });
    // The session is gone once completed.
    await api.get(`/media/uploads/${session.id}`, alice).expect(404);
  });

  it('resumes from the server offset, rejects out-of-order and oversized pieces', async () => {
    const data = Buffer.alloc(1000, 7);
    const { id } = (await api.post('/media/uploads', { size: 1000, fileName: 'x.bin' }, alice).expect(201)).body;
    await put(alice, id, 0, data.subarray(0, 400)).expect(200);
    expect((await put(alice, id, 100, data.subarray(100, 200)).expect(409)).body.message).toMatch(/offset 400/);
    expect((await api.get(`/media/uploads/${id}`, alice).expect(200)).body.received).toBe(400);
    await put(alice, id, 400, Buffer.alloc(700)).expect(413); // past the declared size
    expect((await api.get(`/media/uploads/${id}`, alice).expect(200)).body.received).toBe(400);
    await api.post(`/media/uploads/${id}/complete`, undefined, alice).expect(409); // incomplete
    await put(alice, id, 400, data.subarray(400)).expect(200);
    // Not a video or image: rejected by the normal pipeline after assembly.
    await api.post(`/media/uploads/${id}/complete`, undefined, alice).expect(415);
  });

  it('keeps sessions private and enforces the size limit up front', async () => {
    const { id } = (await api.post('/media/uploads', { size: 10, fileName: 'a.mp4' }, alice).expect(201)).body;
    await api.get(`/media/uploads/${id}`, bob).expect(404);
    await put(bob, id, 0, Buffer.alloc(10)).expect(404);
    await api.post('/media/uploads', { size: 50 * 1024 * 1024 * 1024, fileName: 'huge.mov' }, alice).expect(413);
    await api.post('/media/uploads', { size: 10, fileName: 'a.mp4' }).expect(401);
  });
});
