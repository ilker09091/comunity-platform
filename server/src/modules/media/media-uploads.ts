import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Injectable, Logger, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { ApiConsumes, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsInt, IsString, MaxLength, Min } from 'class-validator';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { CurrentUser } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { UuidPipe } from '../../common/errors/validation.js';
import { ApiAuth, ApiErrors } from '../../common/swagger/api-docs.decorators.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import { PlatformSettingsService } from '../platform/platform-settings.service.js';
import { MediaDto } from './dto/media.dto.js';
import { MediaService } from './media.service.js';
import { VideoTranscodeQueue } from './video-transcode.queue.js';
import { VIDEO_PROCESSOR, type VideoProcessor } from './video.processor.js';
import { SOUNDTRACK_MAX_MS } from './soundtrack.service.js';

/** Suggested piece size. Clients halve it when a proxy rejects a piece (413). */
export const CHUNK_SIZE = 8 * 1024 * 1024;
/** Hard ceiling for one piece, so a single request never gets large. */
const MAX_CHUNK = 16 * 1024 * 1024;

export class StartUploadDto {
  @ApiProperty({ description: 'Total file size in bytes', example: 734003200 })
  @IsInt()
  @Min(1)
  size: number;

  @ApiProperty({ example: 'IMG_2041.MOV' })
  @IsString()
  @MaxLength(255)
  fileName: string;
}

export class UploadSessionDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ description: 'Bytes received so far — send the next piece from this offset' }) received: number;
  @ApiProperty() size: number;
  @ApiProperty({ description: 'Suggested piece size in bytes (max 16 MB)', example: CHUNK_SIZE }) chunkSize: number;
}

export class AudioUploadDto {
  @ApiProperty({ format: 'uuid', description: 'Pass to POST /media/{id}/soundtrack' }) id: string;
  @ApiProperty() durationMs: number;
}

interface SessionRow {
  id: string;
  file_name: string;
  size: string;
  received: string;
}

@Injectable()
export class MediaUploadSessionsService {
  private readonly logger = new Logger(MediaUploadSessionsService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly media: MediaService,
    private readonly settings: PlatformSettingsService,
    private readonly queue: VideoTranscodeQueue,
    @Inject(VIDEO_PROCESSOR) private readonly processor: VideoProcessor,
  ) {}

  private get dir() {
    return join(this.queue.incomingDir, 'uploads');
  }
  private partPath(id: string) {
    return join(this.dir, `${id}.part`);
  }
  private dto(row: SessionRow): UploadSessionDto {
    return { id: row.id, received: Number(row.received), size: Number(row.size), chunkSize: CHUNK_SIZE };
  }
  private async owned(ownerId: string, id: string) {
    const row = await sqlOne<SessionRow>(this.db, `SELECT id, file_name, size, received FROM media_upload_sessions WHERE id = $1 AND owner_id = $2`, [id, ownerId]);
    if (!row) throw AppException.notFound(ErrorCode.NOT_FOUND, 'Upload not found or expired');
    return row;
  }

  async start(ownerId: string, dto: StartUploadDto): Promise<UploadSessionDto> {
    const limits = await this.settings.uploadLimits();
    const max = Math.max(limits.maxImageBytes, limits.maxVideoBytes);
    if (dto.size > max)
      throw new AppException(HttpStatus.PAYLOAD_TOO_LARGE, ErrorCode.FILE_TOO_LARGE, `File exceeds the ${Math.floor(max / 1048576)} MB upload limit`);
    await mkdir(this.dir, { recursive: true });
    const row = await sqlOne<SessionRow>(
      this.db,
      `INSERT INTO media_upload_sessions (owner_id, file_name, size) VALUES ($1, $2, $3) RETURNING id, file_name, size, received`,
      [ownerId, dto.fileName, dto.size],
    );
    return this.dto(row!);
  }

  async status(ownerId: string, id: string): Promise<UploadSessionDto> {
    return this.dto(await this.owned(ownerId, id));
  }

  /** Appends one piece at `offset`. Pieces must arrive in order; a mismatch returns 409 with the expected offset. */
  async append(ownerId: string, id: string, offset: number, req: Request): Promise<UploadSessionDto> {
    const row = await this.owned(ownerId, id);
    const received = Number(row.received);
    const size = Number(row.size);
    if (offset !== received) {
      req.resume();
      throw AppException.conflict(ErrorCode.CONFLICT, `Expected the piece at offset ${received}`);
    }
    let bytes = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        bytes += chunk.length;
        if (bytes > MAX_CHUNK || received + bytes > size) done(new Error('TOO_LARGE'));
        else done(null, chunk);
      },
    });
    try {
      await pipeline(req, counter, createWriteStream(this.partPath(id), { flags: received === 0 ? 'w' : 'r+', start: received }));
    } catch (error) {
      if ((error as Error).message === 'TOO_LARGE')
        throw new AppException(HttpStatus.PAYLOAD_TOO_LARGE, ErrorCode.FILE_TOO_LARGE, `A piece may be at most ${MAX_CHUNK / 1048576} MB and must not go past the declared size`);
      throw AppException.badRequest(ErrorCode.BAD_REQUEST, 'The upload piece was interrupted');
    }
    const updated = await sqlOne<SessionRow>(
      this.db,
      `UPDATE media_upload_sessions SET received = received + $3, updated_at = now()
        WHERE id = $1 AND received = $2 RETURNING id, file_name, size, received`,
      [id, received, bytes],
    );
    if (!updated) throw AppException.conflict(ErrorCode.CONFLICT, 'The upload changed while this piece was being written');
    return this.dto(updated);
  }

  /** Hands the assembled file to the normal upload pipeline (type detection, image processing, video compression). */
  async complete(ownerId: string, id: string): Promise<MediaDto> {
    const row = await this.owned(ownerId, id);
    if (Number(row.received) !== Number(row.size))
      throw AppException.conflict(ErrorCode.CONFLICT, `Upload incomplete: ${row.received} of ${row.size} bytes received`);
    const deleted = await sqlRows(this.db, `DELETE FROM media_upload_sessions WHERE id = $1 AND owner_id = $2 RETURNING id`, [id, ownerId]);
    if (!deleted.length) throw AppException.notFound(ErrorCode.NOT_FOUND, 'Upload not found or expired');
    const file = { path: this.partPath(id), size: Number(row.size), originalname: row.file_name } as Express.Multer.File;
    return this.media.upload(ownerId, file);
  }

  /**
   * Finishes a resumable upload of a sound clip (Reels music). Sound files never become media:
   * they are kept briefly, only to be put on a video.
   */
  async completeAudio(ownerId: string, id: string): Promise<AudioUploadDto> {
    const row = await this.owned(ownerId, id);
    if (Number(row.received) !== Number(row.size))
      throw AppException.conflict(ErrorCode.CONFLICT, `Upload incomplete: ${row.received} of ${row.size} bytes received`);
    const deleted = await sqlRows(this.db, `DELETE FROM media_upload_sessions WHERE id = $1 AND owner_id = $2 RETURNING id`, [id, ownerId]);
    if (!deleted.length) throw AppException.notFound(ErrorCode.NOT_FOUND, 'Upload not found or expired');
    const part = this.partPath(id);
    const probe = await this.processor.probeAudio(part);
    if (!probe || probe.durationMs > SOUNDTRACK_MAX_MS + 5_000) {
      await rm(part, { force: true }).catch(() => undefined);
      throw AppException.badRequest(
        probe ? ErrorCode.VALIDATION_ERROR : ErrorCode.UNSUPPORTED_MEDIA_TYPE,
        probe ? 'Choose up to 90 seconds of music' : 'Choose a song or another audio file',
      );
    }
    const path = join(this.dir, `audio-${id}`);
    await rename(part, path);
    const audio = await sqlOne<{ id: string }>(
      this.db,
      'INSERT INTO audio_uploads(owner_id, path, duration_ms) VALUES ($1, $2, $3) RETURNING id',
      [ownerId, path, probe.durationMs],
    );
    return { id: audio!.id, durationMs: probe.durationMs };
  }

  /** Drops uploads abandoned for more than a day. */
  @Cron(CronExpression.EVERY_HOUR, { name: 'media-upload-sessions-cleanup' })
  async cleanupStale(): Promise<number> {
    const rows = await sqlRows<{ id: string }>(this.db, `DELETE FROM media_upload_sessions WHERE updated_at < now() - interval '24 hours' RETURNING id`);
    for (const r of rows) await rm(this.partPath(r.id), { force: true }).catch(() => undefined);
    if (rows.length) this.logger.log({ message: 'Removed abandoned uploads', count: rows.length });
    return rows.length;
  }
}

@ApiTags('Media')
@Controller('media/uploads')
export class MediaUploadsController {
  constructor(private readonly uploads: MediaUploadSessionsService) {}

  @Post()
  @ApiAuth()
  @ApiOperation({
    summary: 'Start a resumable upload (for large files such as phone videos)',
    description:
      'Send the file in pieces with `POST /media/uploads/{id}/chunks?offset=` (raw bytes, ≤16 MB each; halve the size if a proxy answers 413), ' +
      'then `POST /media/uploads/{id}/complete`. If a piece fails, `GET /media/uploads/{id}` tells you where to continue.',
  })
  @ApiCreatedResponse({ type: UploadSessionDto })
  @ApiErrors(400, 413)
  start(@CurrentUser() user: AuthUser, @Body() dto: StartUploadDto): Promise<UploadSessionDto> {
    return this.uploads.start(user.id, dto);
  }

  @Get(':id')
  @ApiAuth()
  @ApiOperation({ summary: 'Progress of a resumable upload' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: UploadSessionDto })
  @ApiErrors(400, 404)
  status(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string): Promise<UploadSessionDto> {
    return this.uploads.status(user.id, id);
  }

  @Post(':id/chunks')
  @HttpCode(HttpStatus.OK)
  @ApiAuth()
  @Throttle({ default: { limit: 3000, ttl: 60_000 } })
  @ApiOperation({ summary: 'Append the next piece (raw bytes, application/octet-stream)' })
  @ApiConsumes('application/octet-stream')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiQuery({ name: 'offset', type: Number, description: 'Byte offset of this piece (must equal `received`)' })
  @ApiOkResponse({ type: UploadSessionDto })
  @ApiErrors(400, 404, 409, 413)
  chunk(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Query('offset', ParseIntPipe) offset: number,
    @Req() req: Request,
  ): Promise<UploadSessionDto> {
    return this.uploads.append(user.id, id, offset, req);
  }

  @Post(':id/audio')
  @ApiAuth()
  @ApiOperation({
    operationId: 'mediaUploadsCompleteAudio',
    summary: 'Finish a resumable upload of a sound clip (for POST /media/{id}/soundtrack)',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiCreatedResponse({ type: AudioUploadDto })
  @ApiErrors(400, 404, 409, 415)
  completeAudio(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string): Promise<AudioUploadDto> {
    return this.uploads.completeAudio(user.id, id);
  }

  @Post(':id/complete')
  @ApiAuth()
  @ApiOperation({ summary: 'Finish a resumable upload; returns the media like `POST /media`' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiCreatedResponse({ type: MediaDto })
  @ApiErrors(400, 404, 409, 413, 415)
  complete(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string): Promise<MediaDto> {
    return this.uploads.complete(user.id, id);
  }
}
