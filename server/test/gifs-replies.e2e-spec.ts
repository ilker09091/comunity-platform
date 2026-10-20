import type { INestApplication } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { Api, createTestApp, resetDatabase, type TestUser } from './setup/test-app.js';

/** A stand-in for GIPHY's API with two GIFs, one of them pointing off GIPHY's media hosts. */
function fakeGiphy() {
  const gif = (id: string, host = 'media0.giphy.com') => ({
    id, title: `Funny ${id}`,
    images: {
      fixed_width: { url: `https://${host}/media/${id}/200w.gif`, webp: `https://${host}/media/${id}/200w.webp`, mp4: `https://${host}/media/${id}/200w.mp4`, width: '200', height: '150' },
      fixed_width_small: { url: `https://${host}/media/${id}/100w.gif`, webp: `https://${host}/media/${id}/100w.webp`, width: '100', height: '75' },
    },
  });
  const requests: string[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    requests.push(url.pathname + url.search);
    res.setHeader('Content-Type', 'application/json');
    if (url.searchParams.get('api_key') !== 'test-key') { res.statusCode = 401; return res.end('{}'); }
    if (url.pathname === '/gifs/trending' || url.pathname === '/gifs/search')
      return res.end(JSON.stringify({ data: [gif('abc123'), gif('evil999', 'evil.example.com')], pagination: { total_count: 2 } }));
    const id = url.pathname.split('/').pop();
    if (id === 'abc123') return res.end(JSON.stringify({ data: gif('abc123') }));
    if (id === 'evil999') return res.end(JSON.stringify({ data: gif('evil999', 'evil.example.com') }));
    res.statusCode = 404; res.end('{}');
  });
  return { server, requests };
}

describe('GIFs in messages and comments, and WhatsApp-style reply quotes (e2e)', () => {
  let app: INestApplication, api: Api, ana: TestUser, ben: TestUser, giphy: ReturnType<typeof fakeGiphy>, server: Server;
  beforeAll(async () => {
    giphy = fakeGiphy(); server = giphy.server;
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    process.env.GIPHY_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    app = await createTestApp(); api = new Api(app);
  });
  beforeEach(async () => {
    process.env.GIPHY_API_KEY = 'test-key';
    await resetDatabase(app);
    ana = await api.register('ana'); ben = await api.register('ben');
    await api.post(`/users/${ben.id}/follow`, {}, ana).expect(200);
    await api.post(`/users/${ana.id}/follow`, {}, ben).expect(200);
  });
  afterAll(async () => { delete process.env.GIPHY_API_KEY; delete process.env.GIPHY_API_URL; await app?.close(); server?.close(); });
  const wav = () => {
    const rate = 8000, samples = rate * 2, data = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(6000 * Math.sin((2 * Math.PI * 440 * i) / rate)), i * 2);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28);
    header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
    return Buffer.concat([header, data]);
  };

  it('lists rated GIFs through the server, drops non-GIPHY media and reports when disabled', async () => {
    const trending = (await api.get('/gifs', ana).expect(200)).body;
    expect(trending.enabled).toBe(true);
    expect(trending.items.map((g: { id: string }) => g.id)).toEqual(['abc123']);
    expect(trending.items[0]).toMatchObject({ url: 'https://media0.giphy.com/media/abc123/200w.webp', mp4: 'https://media0.giphy.com/media/abc123/200w.mp4', width: 200, height: 150 });
    await api.get('/gifs?q=cats', ana).expect(200);
    expect(giphy.requests.some(r => r.startsWith('/gifs/search') && r.includes('q=cats') && r.includes('rating=pg-13'))).toBe(true);
    await api.get('/gifs').expect(401);
    delete process.env.GIPHY_API_KEY;
    expect((await api.get('/gifs', ana).expect(200)).body).toEqual({ enabled: false, items: [], nextOffset: null });
    await api.post(`/messages/${ben.id}`, { gifId: 'abc123' }, ana).expect(422);
  });

  it('sends GIFs in direct messages, only from GIPHY, never with another attachment', async () => {
    const sent = (await api.post(`/messages/${ben.id}`, { gifId: 'abc123' }, ana).expect(201)).body;
    expect(sent.gif).toMatchObject({ id: 'abc123', previewUrl: 'https://media0.giphy.com/media/abc123/100w.webp' });
    expect((await api.get(`/messages/${ana.id}`, ben).expect(200)).body.items[0].gif.id).toBe('abc123');
    await api.post(`/messages/${ben.id}`, { gifId: 'evil999' }, ana).expect(404);
    await api.post(`/messages/${ben.id}`, { gifId: 'nope00' }, ana).expect(404);
    await api.post(`/messages/${ben.id}`, { gifId: '../../x' }, ana).expect(400);
    await api.post(`/messages/${ben.id}`, { gifId: 'abc123', stickerId: '00000000-0000-4000-8000-000000000000' }, ana).expect(400);
    const reply = (await api.post(`/messages/${ana.id}`, { content: 'haha', replyToId: sent.id }, ben).expect(201)).body;
    expect(reply.replyTo).toMatchObject({ kind: 'GIF', thumbnailUrl: 'https://media0.giphy.com/media/abc123/100w.webp' });
  });

  it('quotes voice messages with their length and photos with a thumbnail', async () => {
    const audio = (await api.http.post('/api/messages/audio').set(ana.auth).attach('file', wav(), { filename: 'v.wav', contentType: 'audio/wav' }).expect(201)).body;
    const voice = (await api.post(`/messages/${ben.id}`, { audioId: audio.id }, ana).expect(201)).body;
    const voiceReply = (await api.post(`/messages/${ana.id}`, { gifId: 'abc123', replyToId: voice.id }, ben).expect(201)).body;
    expect(voiceReply.replyTo).toMatchObject({ kind: 'AUDIO', thumbnailUrl: null });
    expect(voiceReply.replyTo.audioDurationMs).toBeGreaterThan(1500);
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#09f' } }).png().toBuffer();
    const media = (await api.http.post('/api/media').set(ben.auth).attach('file', png, { filename: 'p.png', contentType: 'image/png' }).expect(201)).body;
    const photo = (await api.post(`/messages/${ana.id}`, { mediaId: media.id }, ben).expect(201)).body;
    const photoReply = (await api.post(`/messages/${ben.id}`, { content: 'nice', replyToId: photo.id }, ana).expect(201)).body;
    expect(photoReply.replyTo.kind).toBe('PHOTO');
    expect(photoReply.replyTo.thumbnailUrl).toContain('/media/files/');
  });

  it('posts GIF comments and replies, but not together with a sticker', async () => {
    const post = await api.createPost(ben, { content: 'Weekend!' });
    const comment = (await api.post(`/posts/${post.id}/comments`, { gifId: 'abc123' }, ana).expect(201)).body;
    expect(comment).toMatchObject({ content: '', gif: { id: 'abc123' } });
    const reply = (await api.post(`/comments/${comment.id}/replies`, { content: 'lol', gifId: 'abc123' }, ben).expect(201)).body;
    expect(reply.gif.id).toBe('abc123');
    const stickers = (await api.get('/stickers', ana).expect(200)).body;
    await api.post(`/posts/${post.id}/comments`, { gifId: 'abc123', stickerId: stickers[0].id }, ana).expect(400);
    await api.post(`/posts/${post.id}/comments`, { gifId: 'evil999' }, ana).expect(404);
    const listed = (await api.get(`/posts/${post.id}/comments`, ben).expect(200)).body.items;
    expect(listed[0].gif.url).toBe('https://media0.giphy.com/media/abc123/200w.webp');
  });
});
