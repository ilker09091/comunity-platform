import { Logger, Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { appConfig } from '../../config/app.config.js';
import { MediaUrlService } from './media-url.service.js';
import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';
import { ContentDeletionService } from './content-deletion.service.js';
import { UploadsMulterModule } from './multer.options.js';
import { SoundtrackService } from './soundtrack.service.js';
import { LocalStorageDriver, STORAGE_DRIVER } from './storage/storage.driver.js';
import { FfmpegVideoProcessor, VIDEO_PROCESSOR } from './video.processor.js';
import { VideoTranscodeQueue } from './video-transcode.queue.js';
import { MediaUploadSessionsService, MediaUploadsController } from './media-uploads.js';

@Module({
  imports: [UploadsMulterModule],
  controllers: [MediaUploadsController, MediaController],
  providers: [
    MediaService,
    SoundtrackService,
    ContentDeletionService,
    MediaUrlService,
    {
      provide: STORAGE_DRIVER,
      inject: [appConfig.KEY],
      useFactory: (config: ConfigType<typeof appConfig>) => {
        if (config.media.driver !== 'local') {
          throw new Error(`Unsupported MEDIA_STORAGE_DRIVER "${String(config.media.driver)}"`);
        }
        if (config.isProduction) {
          new Logger('MediaModule').warn(
            'Using the local filesystem media driver in production. Configure object storage for multi-instance deployments.',
          );
        }
        return new LocalStorageDriver(config.media.localDir);
      },
    },
    { provide: VIDEO_PROCESSOR, useClass: FfmpegVideoProcessor },
    VideoTranscodeQueue,
    MediaUploadSessionsService,
  ],
  exports: [MediaService, MediaUrlService, ContentDeletionService, STORAGE_DRIVER, VIDEO_PROCESSOR],
})
export class MediaModule {}
