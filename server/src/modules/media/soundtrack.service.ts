import { randomBytes } from 'node:crypto';
import { rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { sqlOne } from '../../common/utils/sql.js';
import { ContentDeletionService } from './content-deletion.service.js';
import { MediaDto } from './dto/media.dto.js';
import { MediaService } from './media.service.js';
import { STORAGE_DRIVER, type StorageDriver } from './storage/storage.driver.js';
import { VIDEO_PROCESSOR, type VideoProcessor } from './video.processor.js';

/** Music longer than this is not needed: the clip loops for longer videos. */
export const SOUNDTRACK_MAX_MS = 90_000;

/**
 * Adds a song to one of the user's uploaded, not-yet-published videos (Reels "Add sound").
 * The video file is rewritten with the new audio; the old file is deleted.
 */
@Injectable()
export class SoundtrackService {
  private readonly logger = new Logger(SoundtrackService.name);
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    @Inject(VIDEO_PROCESSOR) private readonly processor: VideoProcessor,
    private readonly media: MediaService,
    private readonly deletion: ContentDeletionService,
  ) {}

  private unattached = `m.owner_id = $2 AND m.type = 'VIDEO' AND m.status = 'READY'
    AND NOT EXISTS (SELECT 1 FROM post_media pm WHERE pm.media_id = m.id)
    AND NOT EXISTS (SELECT 1 FROM direct_messages dm WHERE dm.media_id = m.id)
    AND NOT EXISTS (SELECT 1 FROM stories st WHERE st.media_id = m.id)`;

  async add(ownerId: string, mediaId: string, file: Express.Multer.File | undefined, mix: boolean): Promise<MediaDto> {
    if (!file?.path)
      throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Validation failed', [
        { field: 'file', message: 'file is required (multipart/form-data)' },
      ]);
    const output = join(tmpdir(), `soundtrack-${randomBytes(8).toString('hex')}.mp4`);
    try {
      const row = await sqlOne<{ storage_key: string; duration_ms: number | null }>(
        this.db,
        `SELECT m.storage_key, m.duration_ms FROM media m WHERE m.id = $1 AND ${this.unattached}`,
        [mediaId, ownerId],
      );
      if (!row)
        throw AppException.notFound(ErrorCode.MEDIA_NOT_FOUND, 'Choose a processed video that is not published yet');
      const audio = await this.processor.probeAudio(file.path);
      if (!audio) throw AppException.badRequest(ErrorCode.UNSUPPORTED_MEDIA_TYPE, 'Choose a song or another audio file');
      if (audio.durationMs > SOUNDTRACK_MAX_MS + 5_000)
        throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Choose up to 90 seconds of music');
      const source = await this.storage.resolve(row.storage_key);
      if (!source || source.kind !== 'file') throw AppException.notFound(ErrorCode.MEDIA_NOT_FOUND, 'Video file not found');
      const probe = await this.processor.probe(source.path);
      const durationMs = row.duration_ms ?? probe?.durationMs ?? audio.durationMs;
      try {
        await this.processor.addSoundtrack(source.path, file.path, output, { mix: mix && !!probe?.audioCodec, durationMs });
      } catch (error) {
        this.logger.warn({ message: 'Adding soundtrack failed', mediaId, error: (error as Error).message });
        throw AppException.badRequest(ErrorCode.INVALID_MEDIA, 'This song could not be added to the video');
      }
      const key = `${randomBytes(16).toString('hex')}.mp4`;
      const size = (await stat(output)).size;
      await this.storage.put(key, { filePath: output }, 'video/mp4');
      const files = await this.db.transaction(async (m) => {
        const current = await sqlOne<{ storage_key: string }>(
          m,
          `SELECT m.storage_key FROM media m WHERE m.id = $1 AND ${this.unattached} FOR UPDATE OF m`,
          [mediaId, ownerId],
        );
        // Published or changed meanwhile: keep it untouched and drop the new file.
        if (!current || current.storage_key !== row.storage_key) return this.deletion.queueFiles(m, [key]);
        await m.query('UPDATE media SET storage_key = $2, size_bytes = $3 WHERE id = $1', [mediaId, key, size]);
        return this.deletion.queueFiles(m, [row.storage_key]);
      });
      await this.deletion.removeFiles(files);
      if (files.keys.includes(key))
        throw AppException.conflict(ErrorCode.MEDIA_IN_USE, 'This video was published while the song was being added');
      return this.media.getOwned(ownerId, mediaId);
    } finally {
      await rm(file.path, { force: true }).catch(() => undefined);
      await rm(output, { force: true }).catch(() => undefined);
    }
  }
}
