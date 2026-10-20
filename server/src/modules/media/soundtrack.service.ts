import { randomBytes } from 'node:crypto';
import { rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import { ContentDeletionService } from './content-deletion.service.js';
import { STORAGE_DRIVER, type StorageDriver } from './storage/storage.driver.js';
import { VIDEO_PROCESSOR, type VideoProcessor } from './video.processor.js';

/** Music longer than this is not needed: the clip loops for longer videos. */
export const SOUNDTRACK_MAX_MS = 90_000;

/**
 * Reels "Add sound": puts a song (uploaded in pieces via /media/uploads/{id}/audio) on one of the
 * user's videos. A processed, unpublished video gets it at once; a video that is still being
 * compressed keeps the request and gets the music as soon as compression finishes — even if the
 * Reel was already published meanwhile.
 */
@Injectable()
export class SoundtrackService {
  private readonly logger = new Logger(SoundtrackService.name);
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    @Inject(VIDEO_PROCESSOR) private readonly processor: VideoProcessor,
    private readonly deletion: ContentDeletionService,
  ) {}

  private notShared = `NOT EXISTS (SELECT 1 FROM direct_messages dm WHERE dm.media_id = m.id)
    AND NOT EXISTS (SELECT 1 FROM stories st WHERE st.media_id = m.id)
    AND NOT EXISTS (SELECT 1 FROM circle_posts cp WHERE cp.media_id = m.id)`;

  async add(ownerId: string, mediaId: string, audioId: string, mix: boolean): Promise<void> {
    const audio = await sqlOne<{ path: string }>(
      this.db,
      'SELECT path FROM audio_uploads WHERE id = $1 AND owner_id = $2',
      [audioId, ownerId],
    );
    if (!audio) throw AppException.notFound(ErrorCode.NOT_FOUND, 'Sound not found. Upload it again.');
    const media = await sqlOne<{ status: string; published: boolean }>(
      this.db,
      `SELECT m.status, EXISTS (SELECT 1 FROM post_media pm WHERE pm.media_id = m.id) AS published
      FROM media m WHERE m.id = $1 AND m.owner_id = $2 AND m.type = 'VIDEO' AND m.status IN ('READY', 'PROCESSING')
        AND ${this.notShared}`,
      [mediaId, ownerId],
    );
    if (!media || (media.status === 'READY' && media.published))
      throw AppException.notFound(ErrorCode.MEDIA_NOT_FOUND, 'Choose a video that is not published yet');
    // One request per video: a newer choice replaces the previous one.
    const replaced = await this.db.transaction(async (m) => {
      const old = await sqlOne<{ path: string; id: string }>(
        m,
        `DELETE FROM audio_uploads a USING media_soundtracks s
        WHERE s.media_id = $1 AND a.id = s.audio_id AND a.id <> $2 RETURNING a.id, a.path`,
        [mediaId, audioId],
      );
      await sqlRows(
        m,
        `INSERT INTO media_soundtracks(media_id, audio_id, mix) VALUES ($1, $2, $3)
        ON CONFLICT (media_id) DO UPDATE SET audio_id = EXCLUDED.audio_id, mix = EXCLUDED.mix, created_at = now()`,
        [mediaId, audioId, mix],
      );
      return old?.path ?? null;
    });
    if (replaced) await rm(replaced, { force: true }).catch(() => undefined);
    // Ready now (or compression finished just now): apply straight away.
    const now = await sqlOne<{ status: string }>(this.db, 'SELECT status FROM media WHERE id = $1', [mediaId]);
    if (now?.status === 'READY') {
      const applied = await this.applyPending(mediaId);
      if (!applied) throw AppException.badRequest(ErrorCode.INVALID_MEDIA, 'This song could not be added to the video');
    }
  }

  /**
   * Puts the requested music on a READY video and forgets the request. Called right after a
   * request for a ready video and by the compression queue when a video becomes ready.
   * Returns false when nothing was applied.
   */
  async applyPending(mediaId: string): Promise<boolean> {
    const job = await sqlOne<{ audio_id: string; path: string; mix: boolean; storage_key: string; duration_ms: number | null }>(
      this.db,
      `SELECT s.audio_id, a.path, s.mix, m.storage_key, m.duration_ms
      FROM media_soundtracks s JOIN audio_uploads a ON a.id = s.audio_id JOIN media m ON m.id = s.media_id
      WHERE s.media_id = $1 AND m.status = 'READY'`,
      [mediaId],
    );
    if (!job) return false;
    const output = join(tmpdir(), `soundtrack-${randomBytes(8).toString('hex')}.mp4`);
    let newKey: string | null = null;
    try {
      const source = await this.storage.resolve(job.storage_key);
      if (!source || source.kind !== 'file') throw new Error('Video file not found');
      const probe = await this.processor.probe(source.path);
      const audio = await this.processor.probeAudio(job.path);
      if (!audio) throw new Error('The sound file has no audio');
      await this.processor.addSoundtrack(source.path, job.path, output, {
        mix: job.mix && !!probe?.audioCodec,
        durationMs: job.duration_ms ?? probe?.durationMs ?? audio.durationMs,
      });
      newKey = `${randomBytes(16).toString('hex')}.mp4`;
      const size = (await stat(output)).size;
      await this.storage.put(newKey, { filePath: output }, 'video/mp4');
      const key = newKey;
      const files = await this.db.transaction(async (m) => {
        const current = await sqlOne<{ storage_key: string }>(
          m,
          'SELECT storage_key FROM media WHERE id = $1 FOR UPDATE',
          [mediaId],
        );
        // Deleted or changed meanwhile: keep it untouched and drop the new file.
        if (!current || current.storage_key !== job.storage_key) return this.deletion.queueFiles(m, [key]);
        await m.query('UPDATE media SET storage_key = $2, size_bytes = $3 WHERE id = $1', [mediaId, key, size]);
        await m.query('DELETE FROM audio_uploads WHERE id = $1', [job.audio_id]);
        return this.deletion.queueFiles(m, [job.storage_key]);
      });
      await this.deletion.removeFiles(files);
      await rm(job.path, { force: true }).catch(() => undefined);
      const applied = !files.keys.includes(key);
      if (applied) this.logger.log({ message: 'Soundtrack added', mediaId, mix: job.mix });
      return applied;
    } catch (error) {
      this.logger.warn({ message: 'Adding soundtrack failed', mediaId, error: (error as Error).message });
      // The video stays as it is; drop the request so it is not retried forever.
      await sqlRows(this.db, 'DELETE FROM audio_uploads WHERE id = $1', [job.audio_id]).catch(() => undefined);
      await rm(job.path, { force: true }).catch(() => undefined);
      return false;
    } finally {
      await rm(output, { force: true }).catch(() => undefined);
    }
  }

  /** Sound clips that were never used. */
  @Cron(CronExpression.EVERY_HOUR, { name: 'audio-upload-cleanup' })
  async cleanup() {
    const rows = await sqlRows<{ path: string }>(
      this.db,
      `DELETE FROM audio_uploads a WHERE a.created_at < now() - interval '6 hours'
        AND NOT EXISTS (SELECT 1 FROM media_soundtracks s JOIN media m ON m.id = s.media_id
                        WHERE s.audio_id = a.id AND m.status = 'PROCESSING')
      RETURNING a.path`,
    );
    for (const r of rows) await rm(r.path, { force: true }).catch(() => undefined);
  }
}
