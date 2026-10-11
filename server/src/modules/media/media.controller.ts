import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, Public } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { UuidPipe } from '../../common/errors/validation.js';
import { ApiAuth, ApiErrors } from '../../common/swagger/api-docs.decorators.js';
import { MediaDto, UploadMediaDto } from './dto/media.dto.js';
import { MediaUrlService, STORAGE_KEY_RE } from './media-url.service.js';
import { MediaService } from './media.service.js';

@ApiTags('Media')
@Controller('media')
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly urls: MediaUrlService,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @ApiAuth()
  @ApiOperation({
    summary: 'Upload an image or video',
    description:
      'Uploads a file to be attached to a post (`mediaIds`). Unattached uploads are deleted after ' +
      'MEDIA_ORPHAN_TTL_HOURS (default 24h). Images are re-encoded with metadata stripped and bounded ' +
      'to 2048px. Limits: images 10 MB, videos 100 MB (configurable).',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadMediaDto })
  @ApiCreatedResponse({ type: MediaDto })
  @ApiErrors(400, 413, 415)
  upload(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File): Promise<MediaDto> {
    return this.media.upload(user.id, file);
  }

  @Public()
  @Get('files/:key')
  @ApiOperation({
    summary: 'Download a media file (signed URL)',
    description: 'Target of the signed `url` fields in responses. Clients should use those URLs verbatim.',
  })
  @ApiParam({ name: 'key', example: '9f2c4e0d1a7b4c3e8f6a5b2d1c0e9f8a.webp' })
  @ApiQuery({ name: 'exp', type: Number, required: true })
  @ApiQuery({ name: 'sig', type: String, required: true })
  @ApiProduces('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime')
  @ApiOkResponse({ description: 'File contents (supports HTTP Range requests)' })
  @ApiErrors(403, 404)
  async file(
    @Param('key') key: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!STORAGE_KEY_RE.test(key)) throw AppException.notFound(ErrorCode.MEDIA_NOT_FOUND, 'Media not found');
    if (!sig || !this.urls.verify(key, Number(exp), sig)) {
      throw AppException.forbidden(ErrorCode.FORBIDDEN, 'Media URL is invalid or expired');
    }
    const object = await this.media.resolveFile(key);
    if (!object) throw AppException.notFound(ErrorCode.MEDIA_NOT_FOUND, 'Media not found');
    if (object.kind === 'redirect') return res.redirect(302, object.url);

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, no-store');
    await new Promise<void>((resolve, reject) =>
      res.sendFile(object.path, { dotfiles: 'deny', lastModified: false }, (err) => (err ? reject(err) : resolve())),
    ).catch((err: { status?: number }) => {
      if (!res.headersSent) throw AppException.notFound(ErrorCode.MEDIA_NOT_FOUND, 'Media not found');
      if (err.status && err.status !== 416) throw err;
    });
  }

  @Get(':id')
  @ApiAuth()
  @ApiOperation({ summary: 'Get one of your own uploads' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: MediaDto })
  @ApiErrors(400, 404)
  get(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string): Promise<MediaDto> {
    return this.media.getOwned(user.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiAuth()
  @ApiOperation({ summary: 'Delete an unattached upload', description: 'Media attached to a post or profile cannot be deleted (409 MEDIA_IN_USE).' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiErrors(400, 404, 409)
  async remove(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string): Promise<void> {
    await this.media.deleteOwned(user.id, id);
  }
}
