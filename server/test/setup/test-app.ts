import './test-env.js';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/setup-app.js';
import { PlatformSettingsService } from '../../src/modules/platform/platform-settings.service.js';
import { SYSTEM_STICKERS } from '../../src/database/migrations/1760191400000-StoryEngagementRequestsStickers.js';
import { testVideo, type TestVideo } from './videos.js';

export const API = '/api';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  configureApp(app);
  await app.init();
  return app;
}

/** Wipes all social data (every table references users) — test database only. */
export async function resetDatabase(app: INestApplication) {
  const ds = app.get(DataSource);
  if (!ds.options.database?.toString().endsWith('_test')) throw new Error('Not a test database');
  await ds.query('TRUNCATE TABLE users, admin_audit_logs, media_file_deletions, circles CASCADE');
  // The cascade also empties stickers; restore the built-in pack the migration seeds.
  for (const [i, [emoji, name]] of SYSTEM_STICKERS.entries())
    await ds.query('INSERT INTO stickers(emoji, name, position) VALUES ($1, $2, $3)', [emoji, name, i]);
  app.get(PlatformSettingsService).invalidate();
}

export interface TestUser {
  id: string;
  username: string;
  token: string;
  refreshToken: string;
  auth: { Authorization: string };
}

let seq = 0;

export class Api {
  constructor(readonly app: INestApplication) {}

  get http() {
    return request(this.app.getHttpServer());
  }

  get(path: string, user?: TestUser) {
    const r = this.http.get(API + path);
    return user ? r.set(user.auth) : r;
  }
  post(path: string, body?: object, user?: TestUser) {
    const r = this.http.post(API + path);
    if (user) r.set(user.auth);
    return body ? r.send(body) : r;
  }
  patch(path: string, body: object, user?: TestUser) {
    const r = this.http.patch(API + path);
    if (user) r.set(user.auth);
    return r.send(body);
  }
  put(path: string, body: object, user?: TestUser) {
    const r = this.http.put(API + path);
    if (user) r.set(user.auth);
    return r.send(body);
  }
  delete(path: string, user?: TestUser) {
    const r = this.http.delete(API + path);
    return user ? r.set(user.auth) : r;
  }

  async register(prefix = 'user', extra: Record<string, unknown> = {}): Promise<TestUser> {
    seq += 1;
    const username = `${prefix}_${seq}_${Math.random().toString(36).slice(2, 7)}`.slice(0, 30);
    const res = await this.post('/auth/register', {
      email: `${username}@example.com`,
      username,
      password: 'password123',
      ...extra,
    }).expect(201);
    return this.asUser(res.body);
  }

  asUser(body: { accessToken: string; refreshToken: string; user: { id: string; username: string } }): TestUser {
    return {
      id: body.user.id,
      username: body.user.username,
      token: body.accessToken,
      refreshToken: body.refreshToken,
      auth: { Authorization: `Bearer ${body.accessToken}` },
    };
  }

  /** Uploads a real video and waits until background compression has finished. */
  async uploadVideo(user: TestUser, video: TestVideo = testVideo()) {
    const res = await this.http
      .post(API + '/media')
      .set(user.auth)
      .attach('file', video.buffer, { filename: video.filename, contentType: video.contentType })
      .expect(201);
    return this.waitForMedia(user, res.body.id as string);
  }

  async waitForMedia(user: TestUser, id: string, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const media = (await this.get(`/media/${id}`, user).expect(200)).body;
      if (media.status !== 'PROCESSING') return media as { id: string; status: string; url: string; [k: string]: any };
      if (Date.now() > deadline) throw new Error(`Media ${id} still PROCESSING after ${timeoutMs} ms`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async createPost(user: TestUser, body: Record<string, unknown> = { content: 'hello world' }) {
    const res = await this.post('/posts', body, user).expect(201);
    return res.body as { id: string; [k: string]: any };
  }

  async setRole(user: TestUser, role: 'USER' | 'SUPPORT' | 'MODERATOR' | 'ADMIN' | 'SUPER_ADMIN') {
    await this.app.get(DataSource).query('UPDATE users SET role = $2 WHERE id = $1', [user.id, role]);
  }
}
