import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigType } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { appConfig } from '../../config/app.config.js';

/** Uploads are streamed to a private temp directory, validated, then moved to storage. */
export const UploadsMulterModule = MulterModule.registerAsync({
  inject: [appConfig.KEY],
  useFactory: (config: ConfigType<typeof appConfig>) => {
    const dest = join(tmpdir(), 'community-platform-uploads');
    mkdirSync(dest, { recursive: true });
    return {
      dest,
      limits: {
        files: 1,
        fields: 5,
        fileSize: Math.max(config.media.maxImageBytes, config.media.maxVideoBytes),
      },
    };
  },
});
