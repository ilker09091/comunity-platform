import { Controller, Get, Inject, Injectable, Logger, Module, Param, Res } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { ApiOkResponse, ApiOperation, ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createHash } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators/auth.decorators.js';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { UuidPipe } from '../../common/errors/validation.js';
import { sqlOne } from '../../common/utils/sql.js';
import { ApiErrors } from '../../common/swagger/api-docs.decorators.js';
import { appConfig } from '../../config/app.config.js';
import { MediaModule } from '../media/media.module.js';
import { STORAGE_DRIVER, type StorageDriver } from '../media/storage/storage.driver.js';
import { VIDEO_PROCESSOR, type VideoProcessor } from '../media/video.processor.js';
import { PostsModule } from '../posts/posts.module.js';
import { PostsQueryService } from '../posts/posts-query.service.js';

const MAX_AGE_DAYS = 7;

/**
 * JPEG stills for link previews (WhatsApp, Telegram, X…): the first photo of a public post or a
 * frame of its video, and profile photos. Uploads are stored as WebP, which several link
 * preview crawlers do not render. Visibility is checked on every request — exactly what an
 * anonymous visitor may see — and the converted files are cached on disk.
 */
@Injectable()
export class PreviewsService {
  private readonly logger = new Logger(PreviewsService.name);
  private readonly dir: string;
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(appConfig.KEY) config: ConfigType<typeof appConfig>,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    @Inject(VIDEO_PROCESSOR) private readonly video: VideoProcessor,
    private readonly posts: PostsQueryService,
  ) {
    this.dir = join(dirname(resolve(config.media.localDir)), 'previews');
  }

  private async render(storageKey: string, kind: 'IMAGE' | 'VIDEO', square: boolean, durationMs: number | null) {
    const target = join(this.dir, `${createHash('sha256').update(`${storageKey}:${square}`).digest('hex').slice(0, 40)}.jpg`);
    if (await stat(target).then(() => true, () => false)) return target;
    const source = await this.storage.resolve(storageKey);
    if (!source || source.kind !== 'file') return null;
    await mkdir(this.dir, { recursive: true });
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    try {
      let input = source.path;
      if (kind === 'VIDEO') {
        input = `${temporary}.frame.jpg`;
        await this.video.frame(source.path, input, Math.min(1000, Math.max(0, (durationMs ?? 0) / 2)));
      }
      const image = sharp(input).rotate();
      await (square ? image.resize(512, 512, { fit: 'cover' }) : image.resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }))
        .flatten({ background: '#ffffff' }).jpeg({ quality: 82, mozjpeg: true }).toFile(temporary);
      await rename(temporary, target);
      return target;
    } catch (error) {
      this.logger.warn({ message: 'Preview render failed', storageKey, error: (error as Error).message });
      return null;
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
      if (kind === 'VIDEO') await rm(`${temporary}.frame.jpg`, { force: true }).catch(() => undefined);
    }
  }

  async post(id: string) {
    // Throws 403/404 exactly as for an anonymous visitor (private, deleted, hidden, blocked…).
    const post = await this.posts.getOne(id, null);
    const source = post.kind === 'REPOST' && post.referencedPost ? post.referencedPost : post;
    const media = source.media.find(m => m.status === 'READY');
    if (!media) throw AppException.notFound(ErrorCode.MEDIA_NOT_FOUND, 'This post has no photo or video');
    const row = await sqlOne<{ storage_key: string; duration_ms: number | null }>(this.db,
      'SELECT storage_key, duration_ms FROM media WHERE id = $1', [media.id]);
    return row ? this.render(row.storage_key, media.type as 'IMAGE' | 'VIDEO', false, row.duration_ms) : null;
  }
  async avatar(username: string) {
    const row = await sqlOne<{ storage_key: string }>(this.db,
      `SELECT m.storage_key FROM users u JOIN media m ON m.id = u.avatar_media_id
        WHERE u.username = $1 AND u.status = 'ACTIVE' AND m.status = 'READY'`, [username]);
    return row ? this.render(row.storage_key, 'IMAGE', true, null) : null;
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cleanup() {
    const files = await readdir(this.dir).catch(() => [] as string[]);
    const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
    for (const file of files) {
      const path = join(this.dir, file);
      const info = await stat(path).catch(() => null);
      if (info && info.mtimeMs < cutoff) await rm(path, { force: true }).catch(() => undefined);
    }
  }
}

function send(res: Response, path: string | null) {
  if (!path) throw AppException.notFound(ErrorCode.MEDIA_NOT_FOUND, 'No preview available');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.type('image/jpeg').sendFile(path);
}

@ApiTags('Previews')
@Controller()
export class PreviewsController {
  constructor(private readonly previews: PreviewsService) {}

  @Public()
  @Get('posts/:id/preview.jpg')
  @ApiOperation({ operationId: 'previewsPost', summary: 'JPEG still of a public post for link previews (first photo, or a video frame)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiProduces('image/jpeg')
  @ApiOkResponse({ description: 'JPEG image' })
  @ApiErrors(403, 404)
  async post(@Param('id', UuidPipe) id: string, @Res() res: Response) {
    send(res, await this.previews.post(id));
  }

  @Public()
  @Get('users/:username/avatar.jpg')
  @ApiOperation({ operationId: 'previewsAvatar', summary: 'JPEG profile photo for link previews' })
  @ApiProduces('image/jpeg')
  @ApiOkResponse({ description: 'JPEG image' })
  @ApiErrors(404)
  async avatar(@Param('username') username: string, @Res() res: Response) {
    if (!/^[A-Za-z0-9_]{3,30}$/.test(username)) throw AppException.notFound(ErrorCode.USER_NOT_FOUND, 'User not found');
    send(res, await this.previews.avatar(username));
  }
}

@Module({
  imports: [MediaModule, PostsModule],
  controllers: [PreviewsController],
  providers: [PreviewsService],
})
export class PreviewsModule {}
