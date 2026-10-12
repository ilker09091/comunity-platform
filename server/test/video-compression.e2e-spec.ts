import { readdir, writeFile } from 'node:fs/promises';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { appConfig } from '../src/config/app.config.js';
import { STORAGE_DRIVER, type StorageDriver } from '../src/modules/media/storage/storage.driver.js';
import { VideoTranscodeQueue } from '../src/modules/media/video-transcode.queue.js';
import { VIDEO_PROCESSOR, type VideoProcessor } from '../src/modules/media/video.processor.js';
import { JobRegistryService } from '../src/modules/platform/job-registry.service.js';
import { Api, createTestApp, resetDatabase, type TestUser } from './setup/test-app.js';
import { testVideo } from './setup/videos.js';

describe('Video upload and compression (e2e)', () => {
  let app: INestApplication;
  let api: Api;
  let alice: TestUser;
  let storage: StorageDriver;
  let processor: VideoProcessor;
  let queue: VideoTranscodeQueue;

  /** Probes the stored (compressed) file behind a media URL. */
  const stored = async (url: string) => {
    const key = new URL(url).pathname.split('/').at(-1)!;
    const object = await storage.resolve(key);
    if (object?.kind !== 'file') throw new Error('expected a local file');
    return { key, probe: (await processor.probe(object.path))! };
  };

  beforeAll(async () => {
    app = await createTestApp();
    api = new Api(app);
    storage = app.get(STORAGE_DRIVER);
    processor = app.get(VIDEO_PROCESSOR);
    queue = app.get(VideoTranscodeQueue);
  }, 120_000);
  beforeEach(async () => {
    await resetDatabase(app);
    alice = await api.register('alice');
  });
  afterAll(() => app?.close());

  it.each([
    ['WebM (VP9 + Opus)', testVideo({ ext: 'webm', codec: ['-c:v', 'libvpx-vp9', '-b:v', '200k', '-c:a', 'libopus'] })],
    ['MKV (MPEG-4 + MP3)', testVideo({ ext: 'mkv', codec: ['-c:v', 'mpeg4', '-c:a', 'libmp3lame'] })],
    ['AVI (MPEG-4 + MP3)', testVideo({ ext: 'avi', codec: ['-c:v', 'mpeg4', '-c:a', 'libmp3lame'] })],
    ['MOV (H.264 + AAC)', testVideo({ ext: 'mov' })],
  ])('accepts %s and stores it as H.264/AAC MP4', async (_label, video) => {
    const res = await api.http.post('/api/media').set(alice.auth).attach('file', video.buffer, { filename: video.filename, contentType: video.contentType }).expect(201);
    expect(res.body).toMatchObject({ type: 'VIDEO', status: 'PROCESSING', processingProgress: 0 });
    const media = await api.waitForMedia(alice, res.body.id);
    expect(media).toMatchObject({ status: 'READY', mimeType: 'video/mp4', width: 64, height: 64 });
    expect(media.durationMs).toBeGreaterThan(800);
    const { key, probe } = await stored(media.url);
    expect(key.endsWith('.mp4')).toBe(true);
    expect(probe).toMatchObject({ videoCodec: 'h264', audioCodec: 'aac', pixelFormat: 'yuv420p' });
    // The uploaded original is gone once the compressed copy is stored.
    expect(await readdir(queue.incomingDir)).toEqual([]);
  });

  it('scales large videos down to fit 1080p, keeping orientation, and never upscales', async () => {
    const landscape = await api.uploadVideo(alice, testVideo({ width: 2560, height: 1440, fps: 5 }));
    expect(landscape).toMatchObject({ status: 'READY', width: 1920, height: 1080 });
    const portrait = await api.uploadVideo(alice, testVideo({ width: 1440, height: 2560, fps: 5 }));
    expect(portrait).toMatchObject({ status: 'READY', width: 1080, height: 1920 });
    const small = await api.uploadVideo(alice, testVideo({ width: 320, height: 568 }));
    expect(small).toMatchObject({ width: 320, height: 568 });
  }, 120_000);

  it('only repackages a video that is already efficient H.264/AAC MP4', async () => {
    await api.uploadVideo(alice, testVideo({ width: 64, height: 64 }));
    const job = app.get(JobRegistryService).list().find((j) => j.name === 'video-compression');
    expect(job).toMatchObject({ lastStatus: 'OK' });
    expect(job!.lastDetail).toMatch(/^remuxed/);
    await api.uploadVideo(alice, testVideo({ ext: 'webm', codec: ['-c:v', 'libvpx-vp9', '-b:v', '200k', '-c:a', 'libopus'] }));
    expect(app.get(JobRegistryService).list().find((j) => j.name === 'video-compression')!.lastDetail).toMatch(/^transcoded/);
  });

  it('rejects files without a playable video', async () => {
    const text = await api.http.post('/api/media').set(alice.auth).attach('file', Buffer.from('definitely not a video'), { filename: 'clip.mp4', contentType: 'video/mp4' }).expect(415);
    expect(text.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    const audio = testVideo({ ext: 'mp4', codec: ['-vn', '-c:a', 'aac'] });
    await api.http.post('/api/media').set(alice.auth).attach('file', audio.buffer, { filename: 'song.m4a', contentType: 'audio/mp4' }).expect(415);
  });

  it('enforces the configured maximum duration', async () => {
    const config = app.get(appConfig.KEY);
    const previous = config.media.video.maxDurationSeconds;
    config.media.video.maxDurationSeconds = 1;
    try {
      const long = testVideo({ seconds: 3 });
      const res = await api.http.post('/api/media').set(alice.auth).attach('file', long.buffer, { filename: long.filename, contentType: long.contentType }).expect(400);
      expect(res.body.message).toMatch(/at most 1 seconds/);
    } finally {
      config.media.video.maxDurationSeconds = previous;
    }
  });

  it('lets the uploader discard a video while it is still being compressed', async () => {
    const video = testVideo({ width: 1280, height: 720, seconds: 2, fps: 10 });
    const res = await api.http.post('/api/media').set(alice.auth).attach('file', video.buffer, { filename: video.filename, contentType: video.contentType }).expect(201);
    await api.delete(`/media/${res.body.id}`, alice).expect(204);
    await api.get(`/media/${res.body.id}`, alice).expect(404);
    // Whether compression was still running or had just finished, nothing is left behind.
    const deadline = Date.now() + 30_000;
    while ((queue.stats.active || queue.stats.waiting) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    expect(await readdir(queue.incomingDir)).toEqual([]);
    expect((await storage.stat(new URL(res.body.url).pathname.split("/").at(-1)!)).exists).toBe(false);
  });

  it('cannot be attached to a post until compression has finished', async () => {
    const db = app.get(DataSource);
    const [row] = await db.query(
      `INSERT INTO media (owner_id, type, status, storage_key, mime_type, size_bytes) VALUES ($1, 'VIDEO', 'PROCESSING', 'pending-test.mp4', 'video/mp4', 10) RETURNING id`,
      [alice.id],
    );
    const res = await api.post('/posts', { content: 'too early', mediaIds: [row.id] }, alice).expect(400);
    expect(res.body.code).toBe('INVALID_MEDIA');
  });

  it('resumes interrupted compression after a restart and fails cleanly when the original is lost', async () => {
    const db = app.get(DataSource);
    const insert = async (key: string) =>
      (
        await db.query(
          `INSERT INTO media (owner_id, type, status, storage_key, mime_type, size_bytes) VALUES ($1, 'VIDEO', 'PROCESSING', $2, 'video/mp4', 10) RETURNING id`,
          [alice.id, key],
        )
      )[0].id as string;
    const resumable = await insert('resume-test.mp4');
    const lost = await insert('lost-test.mp4');
    const video = testVideo({ ext: 'mkv', codec: ['-c:v', 'mpeg4', '-c:a', 'libmp3lame'] });
    await writeFile(queue.sourcePath('resume-test.mp4'), video.buffer);
    await queue.onApplicationBootstrap();
    expect(await api.waitForMedia(alice, resumable)).toMatchObject({ status: 'READY', mimeType: 'video/mp4' });
    expect((await api.get(`/media/${lost}`, alice).expect(200)).body.status).toBe('FAILED');
  });
});
