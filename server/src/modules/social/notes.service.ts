import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { iso } from '../../common/utils/cursor.js';
import { notBlockedSql, sqlOne, sqlRows } from '../../common/utils/sql.js';
import { ContentDeletionService } from '../media/content-deletion.service.js';
import { MediaUrlService } from '../media/media-url.service.js';
import { STORAGE_DRIVER, type StorageDriver } from '../media/storage/storage.driver.js';
import { VIDEO_PROCESSOR, type VideoProcessor } from '../media/video.processor.js';
import { PlatformSettingsService } from '../platform/platform-settings.service.js';
import {
  USER_AVATAR_JOIN,
  USER_SUMMARY_COLUMNS,
  UsersService,
} from '../users/users.service.js';
import { CreateNoteDto, NoteAudioDto, NoteDto } from './social.dto.js';

/** Instagram-style: a note's song is a short clip the author picks. */
export const NOTE_CLIP_MS = 15_000;

/**
 * Notes: one short text (and optional song clip) per user, shown above the inbox to the author and
 * their followers for 24 hours. Song clips are cut server-side to 15 s of AAC.
 */
@Injectable()
export class NotesService {
  private readonly logger = new Logger(NotesService.name);
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    @Inject(VIDEO_PROCESSOR) private readonly processor: VideoProcessor,
    private readonly urls: MediaUrlService,
    private readonly users: UsersService,
    private readonly deletion: ContentDeletionService,
    private readonly settings: PlatformSettingsService,
  ) {}

  async list(viewerId: string): Promise<NoteDto[]> {
    const rows = await sqlRows(
      this.db,
      `SELECT n.*, ${USER_SUMMARY_COLUMNS} FROM notes n JOIN users u ON u.id = n.author_id ${USER_AVATAR_JOIN}
      WHERE n.expires_at > now() AND u.status = 'ACTIVE' AND ${notBlockedSql('u.id', '$1')}
        AND (u.id = $1 OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.following_id = u.id))
      ORDER BY (u.id = $1) DESC, n.created_at DESC LIMIT 100`,
      [viewerId],
    );
    return rows.map((r) => this.dto(r, viewerId));
  }

  private dto(r: Record<string, any>, viewerId: string): NoteDto {
    return {
      id: r.id,
      author: this.users.toSummary({ ...r, id: r.author_id } as any),
      text: r.text,
      songTitle: r.song_title ?? null,
      audioUrl: this.urls.url(r.audio_key ?? null),
      audioDurationMs: r.audio_duration_ms ?? null,
      createdAt: iso(r.created_at)!,
      expiresAt: iso(r.expires_at)!,
      isOwn: r.author_id === viewerId,
    };
  }

  /** Cuts a 15 s clip from an uploaded song, starting where the author chose. */
  async uploadAudio(ownerId: string, file: Express.Multer.File | undefined, startMs: number): Promise<NoteAudioDto> {
    if (!file?.path)
      throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Validation failed', [
        { field: 'file', message: 'file is required (multipart/form-data)' },
      ]);
    const output = join(tmpdir(), `note-${randomBytes(8).toString('hex')}.m4a`);
    try {
      const probe = await this.processor.probeAudio(file.path);
      if (!probe)
        throw AppException.badRequest(ErrorCode.UNSUPPORTED_MEDIA_TYPE, 'Choose a song or another audio file');
      if (startMs >= probe.durationMs)
        throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'The clip must start before the song ends');
      const durationMs = Math.min(NOTE_CLIP_MS, probe.durationMs - startMs);
      try {
        await this.processor.clipAudio(file.path, output, startMs, durationMs);
      } catch (error) {
        this.logger.warn({ message: 'Note audio clip failed', error: (error as Error).message });
        throw AppException.badRequest(ErrorCode.INVALID_MEDIA, 'This audio file could not be processed');
      }
      const key = `${randomBytes(16).toString('hex')}.m4a`;
      await this.storage.put(key, { filePath: output }, 'audio/mp4');
      const row = await sqlOne<{ id: string }>(
        this.db,
        'INSERT INTO note_audio(owner_id, storage_key, duration_ms) VALUES ($1, $2, $3) RETURNING id',
        [ownerId, key, durationMs],
      );
      return { id: row!.id, url: this.urls.url(key), durationMs };
    } finally {
      await rm(file.path, { force: true }).catch(() => undefined);
      await rm(output, { force: true }).catch(() => undefined);
    }
  }

  /** Shares (or replaces) the viewer's note. */
  async create(authorId: string, dto: CreateNoteDto): Promise<NoteDto> {
    await this.settings.assertFeature('postCreation');
    const text = dto.text?.trim() ?? '';
    if (!text && !dto.audioId)
      throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Write a note or add a song');
    const files = await this.db.transaction(async (m) => {
      let audio: { storage_key: string; duration_ms: number } | null = null;
      if (dto.audioId) {
        audio = await sqlOne(
          m,
          'DELETE FROM note_audio WHERE id = $1 AND owner_id = $2 RETURNING storage_key, duration_ms',
          [dto.audioId, authorId],
        );
        if (!audio) throw AppException.notFound(ErrorCode.NOT_FOUND, 'Song clip not found');
      }
      const previous = await sqlOne<{ audio_key: string | null }>(
        m,
        'DELETE FROM notes WHERE author_id = $1 RETURNING audio_key',
        [authorId],
      );
      await sqlRows(
        m,
        `INSERT INTO notes(author_id, text, audio_key, audio_duration_ms, song_title)
        VALUES ($1, $2, $3, $4, $5)`,
        [authorId, text, audio?.storage_key ?? null, audio?.duration_ms ?? null, audio ? dto.songTitle?.trim() || null : null],
      );
      return this.deletion.queueFiles(m, previous?.audio_key ? [previous.audio_key] : []);
    });
    await this.deletion.removeFiles(files);
    return (await this.list(authorId)).find((n) => n.isOwn)!;
  }

  async remove(authorId: string) {
    const files = await this.db.transaction(async (m) => {
      const row = await sqlOne<{ audio_key: string | null }>(
        m,
        'DELETE FROM notes WHERE author_id = $1 RETURNING audio_key',
        [authorId],
      );
      if (!row) throw AppException.notFound();
      return this.deletion.queueFiles(m, row.audio_key ? [row.audio_key] : []);
    });
    await this.deletion.removeFiles(files);
  }

  /** Expired notes and clips never attached to a note within 6 hours are removed with their files. */
  @Cron(CronExpression.EVERY_30_MINUTES, { name: 'note-cleanup' })
  async cleanup() {
    try {
      const files = await this.db.transaction(async (m) => {
        const notes = await sqlRows<{ audio_key: string | null }>(
          m,
          'DELETE FROM notes WHERE expires_at <= now() RETURNING audio_key',
        );
        const staged = await sqlRows<{ storage_key: string }>(
          m,
          "DELETE FROM note_audio WHERE created_at < now() - interval '6 hours' RETURNING storage_key",
        );
        return this.deletion.queueFiles(m, [
          ...notes.map((n) => n.audio_key).filter((k): k is string => !!k),
          ...staged.map((s) => s.storage_key),
        ]);
      });
      await this.deletion.removeFiles(files);
    } catch (error) {
      this.logger.warn({ message: 'Note cleanup failed', error: (error as Error).message });
    }
  }
}
