import { mkdirSync } from 'node:fs';
import { copyFile, rename, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { appConfig } from '../../config/app.config.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import { JobRegistryService } from '../platform/job-registry.service.js';
import { ContentDeletionService } from './content-deletion.service.js';
import { STORAGE_DRIVER, type StorageDriver } from './storage/storage.driver.js';
import { VIDEO_PROCESSOR, type VideoProbe, type VideoProcessor } from './video.processor.js';

/**
 * In-process queue that compresses uploaded videos in the background.
 *
 * Originals wait in `<MEDIA_LOCAL_DIR>/.incoming/` (on the persistent media volume, never served),
 * so work survives restarts: on boot, PROCESSING rows are re-queued, or marked FAILED when their
 * original is gone. The original is deleted once the compressed MP4 is stored.
 */
@Injectable()
export class VideoTranscodeQueue implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(VideoTranscodeQueue.name);
  readonly incomingDir: string;
  private readonly waiting: string[] = [];
  private readonly active = new Set<string>();
  private readonly progress = new Map<string, number>();

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    @Inject(VIDEO_PROCESSOR) private readonly video: VideoProcessor,
    @Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>,
    private readonly jobs: JobRegistryService,
    private readonly deletion: ContentDeletionService,
  ) {
    this.incomingDir = join(resolve(config.media.localDir), '.incoming');
  }

  onModuleInit() {
    mkdirSync(this.incomingDir, { recursive: true });
    this.jobs.register('video-compression', 'on upload', `Compresses every uploaded video to MP4 (${this.config.media.video.concurrency} at a time)`);
  }

  /** Resume interrupted work after a restart. */
  async onApplicationBootstrap() {
    const rows = await sqlRows<{ id: string; storage_key: string }>(
      this.db,
      `SELECT id, storage_key FROM media WHERE type = 'VIDEO' AND status = 'PROCESSING' ORDER BY created_at`,
    );
    for (const row of rows) {
      if (await this.exists(this.sourcePath(row.storage_key))) this.enqueue(row.id);
      else await this.fail(row.id, 'Original upload was lost before it could be compressed');
    }
    if (rows.length) this.logger.log({ message: 'Resumed video compression', count: rows.length });
  }

  sourcePath(storageKey: string) {
    return join(this.incomingDir, `${storageKey}.source`);
  }

  /** Moves the uploaded temp file into the persistent incoming area (works across volumes). */
  async stage(tempPath: string, storageKey: string) {
    const target = this.sourcePath(storageKey);
    try {
      await rename(tempPath, target);
    } catch {
      await copyFile(tempPath, target);
      await rm(tempPath, { force: true });
    }
  }

  enqueue(mediaId: string) {
    if (this.active.has(mediaId) || this.waiting.includes(mediaId)) return;
    this.waiting.push(mediaId);
    this.progress.set(mediaId, 0);
    this.pump();
  }

  /** 0–100 while compressing, null when unknown (not queued in this process). */
  progressOf(mediaId: string): number | null {
    return this.progress.get(mediaId) ?? null;
  }

  get stats() {
    return { waiting: this.waiting.length, active: this.active.size };
  }

  private pump() {
    while (this.active.size < this.config.media.video.concurrency && this.waiting.length) {
      const id = this.waiting.shift()!;
      this.active.add(id);
      void this.process(id).finally(() => {
        this.active.delete(id);
        this.progress.delete(id);
        this.pump();
      });
    }
  }

  private async process(mediaId: string) {
    const row = await sqlOne<{ storage_key: string; status: string; size_bytes: string }>(
      this.db,
      `SELECT storage_key, status, size_bytes FROM media WHERE id = $1`,
      [mediaId],
    );
    if (!row || row.status !== 'PROCESSING') return; // deleted or already handled
    const source = this.sourcePath(row.storage_key);
    const output = join(this.incomingDir, `${row.storage_key}.out.mp4`);
    const started = Date.now();
    try {
      const probe = await this.video.probe(source);
      if (!probe) throw new Error('The file does not contain a playable video');
      const mode = await this.video.compress(source, output, probe, (p) => this.progress.set(mediaId, p));
      const result: VideoProbe | null = await this.video.probe(output);
      if (!result) throw new Error('Compressed output could not be read');
      const size = (await stat(output)).size;
      await this.storage.put(row.storage_key, { filePath: output }, 'video/mp4');
      const updated = await sqlRows(
        this.db,
        `UPDATE media SET status = 'READY', mime_type = 'video/mp4', size_bytes = $2, width = $3, height = $4, duration_ms = $5
          WHERE id = $1 AND status = 'PROCESSING' RETURNING id`,
        [mediaId, size, result.width, result.height, result.durationMs ?? probe.durationMs],
      );
      // Upload deleted while we were working: drop the stored file again.
      if (!updated.length) await this.storage.delete(row.storage_key);
      const detail = `${mode} ${Math.round(Number(row.size_bytes) / 1048576)} MB → ${Math.round(size / 1048576)} MB in ${Math.round((Date.now() - started) / 1000)}s`;
      this.logger.log({ message: 'Video compressed', mediaId, mode, originalBytes: Number(row.size_bytes), storedBytes: size, ms: Date.now() - started });
      this.jobs.record('video-compression', 'OK', detail);
    } catch (error) {
      const message = (error as Error).message;
      this.logger.warn({ message: 'Video compression failed', mediaId, error: message });
      this.jobs.record('video-compression', 'FAILED', message.slice(0, 200));
      await this.fail(mediaId, message);
    } finally {
      await rm(source, { force: true }).catch(() => undefined);
      await rm(output, { force: true }).catch(() => undefined);
    }
  }

  private async fail(mediaId: string, reason: string) {
    const files = await this.db.transaction(async (m) => {
      await sqlRows(m, `UPDATE media SET status = 'FAILED' WHERE id = $1 AND status = 'PROCESSING'`, [mediaId]);
      // A post published while this video was compressing would stay invisible forever: remove it.
      const posts = await sqlRows<{ post_id: string }>(m, `SELECT post_id FROM post_media WHERE media_id = $1`, [mediaId]);
      return (await this.deletion.deletePosts(m, posts.map((p) => p.post_id))).pending;
    });
    await this.deletion.removeFiles(files);
    this.logger.warn({ message: 'Video marked FAILED', mediaId, reason: reason.slice(0, 200) });
  }

  private async exists(path: string) {
    return stat(path).then(
      () => true,
      () => false,
    );
  }
}
