import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { fileTypeFromFile } from 'file-type';
import sharp from 'sharp';
import { DataSource, EntityManager } from 'typeorm';
import { appConfig } from '../../config/app.config.js';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { iso } from '../../common/utils/cursor.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import { MediaDto, MediaStatusEnum, MediaTypeEnum } from './dto/media.dto.js';
import { PlatformSettingsService } from '../platform/platform-settings.service.js';
import { JobRegistryService } from '../platform/job-registry.service.js';
import { MediaUrlService } from './media-url.service.js';
import { ContentDeletionService } from './content-deletion.service.js';
import { STORAGE_DRIVER } from './storage/storage.driver.js';
import type { StorageDriver } from './storage/storage.driver.js';
import { VIDEO_PROCESSOR } from './video.processor.js';
import type { VideoProcessor } from './video.processor.js';
import { VideoTranscodeQueue } from './video-transcode.queue.js';

export interface MediaRow {
  id: string;
  owner_id: string;
  type: MediaTypeEnum;
  status: MediaStatusEnum;
  storage_key: string;
  mime_type: string;
  size_bytes: string | number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  created_at: Date;
}

const IMAGE_TYPES: Record<string, { ext: string; format: 'jpeg' | 'png' | 'webp' | 'gif' }> = {
  'image/jpeg': { ext: 'jpg', format: 'jpeg' },
  'image/png': { ext: 'png', format: 'png' },
  'image/webp': { ext: 'webp', format: 'webp' },
  'image/gif': { ext: 'gif', format: 'gif' },
};

@Injectable()
export class MediaService implements OnModuleInit {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    @Inject(VIDEO_PROCESSOR) private readonly video: VideoProcessor,
    private readonly urls: MediaUrlService,
    @Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>,
    private readonly settings: PlatformSettingsService,
    private readonly jobs: JobRegistryService,
    private readonly deletion: ContentDeletionService,
    private readonly transcoder: VideoTranscodeQueue,
  ) {}

  toDto(row: MediaRow): MediaDto {
    return {
      id: row.id,
      type: row.type,
      status: row.status,
      url: this.urls.url(row.storage_key),
      mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes),
      width: row.width,
      height: row.height,
      durationMs: row.duration_ms,
      createdAt: iso(row.created_at)!,
      processingProgress: row.status === MediaStatusEnum.PROCESSING ? this.transcoder.progressOf(row.id) : null,
    };
  }

  /**
   * Validates an uploaded temp file by its contents (never the client-declared MIME type).
   * Images are re-encoded (EXIF/GPS stripped, orientation applied, dimensions bounded) and stored.
   * Anything ffprobe recognises as a video — any container or codec — is accepted, stored as
   * PROCESSING and compressed to MP4 in the background (see VideoTranscodeQueue).
   */
  async upload(ownerId: string, file: Express.Multer.File | undefined): Promise<MediaDto> {
    if (!file?.path) {
      throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Validation failed', [
        { field: 'file', message: 'file is required (multipart/form-data)' },
      ]);
    }
    try {
      const detected = await fileTypeFromFile(file.path);
      const mime = detected?.mime ?? '';
      const image = IMAGE_TYPES[mime];
      // Not one of our image formats: accept it if it contains a playable video, whatever the format.
      const probe = image ? null : await this.video.probe(file.path);
      if (!image && !probe) {
        throw new AppException(
          HttpStatus.UNSUPPORTED_MEDIA_TYPE,
          ErrorCode.UNSUPPORTED_MEDIA_TYPE,
          'This file is not a supported image (JPEG, PNG, WebP, GIF) or a playable video',
        );
      }
      // Administrator-controlled flags, formats and limits (never above the env hard limits).
      const platform = await this.settings.get();
      await this.settings.assertFeature(image ? 'imageUploads' : 'videoUploads');
      if (image && !platform.media.allowedImageTypes.includes(mime)) {
        const allowed = platform.media.allowedImageTypes;
        throw new AppException(
          HttpStatus.UNSUPPORTED_MEDIA_TYPE,
          ErrorCode.UNSUPPORTED_MEDIA_TYPE,
          `This file type is not accepted. Allowed: ${allowed.map((t) => t.split('/')[1].toUpperCase()).join(', ')}`,
        );
      }
      const limits = await this.settings.uploadLimits();
      const limit = image ? limits.maxImageBytes : limits.maxVideoBytes;
      if (file.size > limit) {
        throw new AppException(
          HttpStatus.PAYLOAD_TOO_LARGE,
          ErrorCode.FILE_TOO_LARGE,
          `File exceeds the ${Math.floor(limit / 1024 / 1024)} MB limit for this media type`,
        );
      }

      const id = randomBytes(16).toString('hex');
      if (image) {
        // Every new photo is stored as WebP (much smaller than JPEG/PNG, so feeds open faster).
        const processed = await this.processImage(file.path, image.format);
        const key = `${id}.webp`;
        await this.storage.put(key, processed.data, 'image/webp');
        return this.insert(ownerId, {
          type: MediaTypeEnum.IMAGE,
          key,
          mime: 'image/webp',
          size: processed.data.length,
          width: processed.width,
          height: processed.height,
          durationMs: null,
        });
      }

      const maxSeconds = this.config.media.video.maxDurationSeconds;
      if (maxSeconds && probe!.durationMs && probe!.durationMs > maxSeconds * 1000) {
        throw AppException.badRequest(
          ErrorCode.INVALID_MEDIA,
          `Videos can be at most ${maxSeconds >= 60 ? `${Math.floor(maxSeconds / 60)} minutes` : `${maxSeconds} seconds`} long`,
        );
      }
      // Keep the original only until the compressed MP4 is ready; nothing is served before that.
      const key = `${id}.mp4`;
      await this.transcoder.stage(file.path, key);
      const media = await this.insert(
        ownerId,
        { type: MediaTypeEnum.VIDEO, key, mime: 'video/mp4', size: file.size, width: probe!.width, height: probe!.height, durationMs: probe!.durationMs },
        MediaStatusEnum.PROCESSING,
      );
      this.transcoder.enqueue(media.id);
      return { ...media, processingProgress: 0 };
    } finally {
      await rm(file.path, { force: true }).catch(() => undefined);
    }
  }

  private async processImage(path: string, format: 'jpeg' | 'png' | 'webp' | 'gif') {
    const max = this.config.media.maxImageDimension;
    try {
      let pipeline = sharp(path, { animated: format === 'gif' || format === 'webp', limitInputPixels: 100_000_000 })
        .rotate()
        .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true });
      // Output is always WebP: transparency is kept and animated GIF/WebP stay animated.
      pipeline = pipeline.webp({ quality: 80, alphaQuality: 90, effort: 4, smartSubsample: true });
      const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
      return { data, width: info.width, height: info.pageHeight ?? info.height };
    } catch (error) {
      this.logger.warn({ message: 'Image processing failed', error: (error as Error).message });
      throw AppException.badRequest(ErrorCode.INVALID_MEDIA, 'The image could not be processed');
    }
  }

  private async insert(
    ownerId: string,
    m: { type: MediaTypeEnum; key: string; mime: string; size: number; width: number | null; height: number | null; durationMs: number | null },
    status: MediaStatusEnum = MediaStatusEnum.READY,
  ): Promise<MediaDto> {
    const row = await sqlOne<MediaRow>(
      this.db,
      `INSERT INTO media (owner_id, type, status, storage_key, mime_type, size_bytes, width, height, duration_ms)
       VALUES ($1, $2, $9, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [ownerId, m.type, m.key, m.mime, m.size, m.width, m.height, m.durationMs, status],
    );
    this.logger.log({ message: 'Media uploaded', mediaId: row!.id, ownerId, type: m.type, sizeBytes: m.size });
    return this.toDto(row!);
  }

  async getOwned(ownerId: string, id: string): Promise<MediaDto> {
    const row = await sqlOne<MediaRow>(this.db, `SELECT * FROM media WHERE id = $1 AND owner_id = $2`, [id, ownerId]);
    if (!row) throw AppException.notFound(ErrorCode.MEDIA_NOT_FOUND, 'Media not found');
    return this.toDto(row);
  }

  /**
   * Locks and validates media the caller wants to attach (post attachments, avatar, cover).
   * Ensures ownership, READY status and that the media is not already in use.
   * Must be called inside a transaction.
   */
  async lockAttachable(
    manager: EntityManager,
    ownerId: string,
    ids: string[],
    options: { imagesOnly?: boolean; ignorePostId?: string } = {},
  ): Promise<MediaRow[]> {
    if (!ids.length) return [];
    if (new Set(ids).size !== ids.length) {
      throw AppException.badRequest(ErrorCode.INVALID_MEDIA, 'The same media cannot be attached twice');
    }
    // Acquire locks before evaluating references so competing attachments see the committed winner.
    await sqlRows(manager, 'SELECT id FROM media WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [ids]);
    const rows = await sqlRows<MediaRow & { in_use: boolean }>(
      manager,
      `SELECT m.*,
              (EXISTS (SELECT 1 FROM post_media pm WHERE pm.media_id = m.id AND pm.post_id IS DISTINCT FROM $3::uuid)
               OR EXISTS (SELECT 1 FROM users u WHERE u.avatar_media_id = m.id OR u.cover_media_id = m.id)
               OR EXISTS (SELECT 1 FROM direct_messages dm WHERE dm.media_id = m.id)
               OR EXISTS (SELECT 1 FROM stories st WHERE st.media_id = m.id)) AS in_use
         FROM media m
        WHERE m.id = ANY($1::uuid[]) AND m.owner_id = $2
        ORDER BY m.id
        FOR UPDATE OF m`,
      [ids, ownerId, options.ignorePostId ?? null],
    );
    if (rows.length !== ids.length) {
      throw AppException.notFound(ErrorCode.MEDIA_NOT_FOUND, 'One or more media items were not found');
    }
    for (const row of rows) {
      if (row.in_use) throw AppException.conflict(ErrorCode.MEDIA_IN_USE, 'Media is already attached elsewhere');
      // A video may be published while it is still being compressed: the post stays hidden until it is ready.
      const pendingVideo = row.status === 'PROCESSING' && row.type === 'VIDEO' && !options.imagesOnly;
      if (row.status !== 'READY' && !pendingVideo) throw AppException.badRequest(ErrorCode.INVALID_MEDIA, 'Media is not ready');
      if (options.imagesOnly && row.type !== 'IMAGE') {
        throw AppException.badRequest(ErrorCode.INVALID_MEDIA, 'Only images are allowed here');
      }
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)!);
  }

  /** Deletes an unattached upload owned by the caller. */
  async deleteOwned(ownerId: string, id: string): Promise<void> {
    // A video that is still being compressed (or failed to) can be discarded too, original included.
    const pending = await sqlOne<MediaRow>(
      this.db,
      `SELECT * FROM media WHERE id = $1 AND owner_id = $2 AND status <> 'READY'
          AND NOT EXISTS (SELECT 1 FROM post_media pm WHERE pm.media_id = media.id)
          AND NOT EXISTS (SELECT 1 FROM direct_messages dm WHERE dm.media_id = media.id)
          AND NOT EXISTS (SELECT 1 FROM stories st WHERE st.media_id = media.id)`,
      [id, ownerId],
    );
    if (pending) {
      const files = await this.db.transaction((m) => this.deletion.deleteMedia(m, [pending.id]));
      await this.deletion.removeFiles(files);
      await rm(this.transcoder.sourcePath(pending.storage_key), { force: true }).catch(() => undefined);
      return;
    }
    const files = await this.db.transaction(async (m) => {
      const [row] = await this.lockAttachable(m, ownerId, [id]).catch((e) => {
        if (e instanceof AppException && e.code === ErrorCode.INVALID_MEDIA) return [] as MediaRow[];
        throw e;
      });
      if (!row) throw AppException.notFound(ErrorCode.MEDIA_NOT_FOUND, 'Media not found');
      return this.deletion.deleteMedia(m, [row.id]);
    });
    await this.deletion.removeFiles(files);
  }

  async resolveFile(storageKey: string) {
    // Old signed URLs must stop working immediately, even during a storage outage.
    const row = await sqlOne(this.db, `SELECT 1 FROM media m WHERE storage_key = $1 AND NOT EXISTS (SELECT 1 FROM stories s WHERE s.media_id = m.id AND s.expires_at <= now())`, [storageKey]);
    if (!row) return null;
    return this.storage.resolve(storageKey);
  }

  /** Storage driver access for admin health checks (never exposes credentials). */
  get storageDriverName() {
    return this.storage.name;
  }
  statObject(storageKey: string) {
    return this.storage.stat(storageKey);
  }
  storageHealth() {
    return this.storage.health();
  }
  async deleteObject(storageKey: string) {
    await this.deletion.removeFiles({ keys: [storageKey], bytes: 0 });
  }

  /** Removes uploads that were never attached to a post/profile within the TTL. */
  @Cron(CronExpression.EVERY_HOUR, { name: 'media-orphan-cleanup' })
  async scheduledCleanup(): Promise<void> {
    try {
      const n = await this.cleanupOrphans();
      this.jobs.record('media-orphan-cleanup', 'OK', `${n} orphaned upload(s) removed`);
    } catch (error) {
      this.jobs.record('media-orphan-cleanup', 'FAILED', (error as Error).message);
      this.logger.error({ message: 'Orphan cleanup failed', error: (error as Error).message });
    }
  }

  onModuleInit() {
    this.jobs.register(
      'media-orphan-cleanup',
      'hourly',
      `Deletes uploads never attached to a post or profile after ${this.config.media.orphanTtlHours}h`,
    );
  }

  async cleanupOrphans(): Promise<number> {
    if (!this.config.media.cleanupEnabled) return 0;
    let total = 0;
    for (;;) {
      const rows = await sqlRows<{ storage_key: string }>(
        this.db,
        `WITH doomed AS (
           SELECT m.id FROM media m
            WHERE m.created_at < now() - make_interval(hours => $1)
              AND NOT EXISTS (SELECT 1 FROM post_media pm WHERE pm.media_id = m.id)
              AND NOT EXISTS (SELECT 1 FROM users u WHERE u.avatar_media_id = m.id OR u.cover_media_id = m.id)
              AND NOT EXISTS (SELECT 1 FROM direct_messages dm WHERE dm.media_id = m.id)
              AND NOT EXISTS (SELECT 1 FROM stories st WHERE st.media_id = m.id)
            ORDER BY m.created_at
            LIMIT 200
            FOR UPDATE SKIP LOCKED)
         DELETE FROM media WHERE id IN (SELECT id FROM doomed) RETURNING storage_key`,
        [this.config.media.orphanTtlHours],
      );
      await this.deletion.removeFiles({ keys: rows.map((r) => r.storage_key), bytes: 0 });
      total += rows.length;
      if (rows.length < 200) break;
    }
    if (total) this.logger.log({ message: 'Orphaned media cleaned up', count: total });
    return total;
  }
}
