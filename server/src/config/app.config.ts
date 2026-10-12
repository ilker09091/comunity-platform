import { createHash } from 'node:crypto';
import { registerAs } from '@nestjs/config';

/**
 * Parses durations such as "15m", "1d", "3600" (seconds) into seconds.
 * Uses the same notation as the existing JWT_EXPIRES_IN values in .env.
 */
export function parseDurationSeconds(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const match = /^(\d+)\s*(ms|s|m|h|d|w)?$/i.exec(value.trim());
  if (!match) throw new Error(`Invalid duration: "${value}"`);
  const amount = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();
  const factors: Record<string, number> = { ms: 0.001, s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
  return Math.max(1, Math.floor(amount * factors[unit]));
}

function int(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) throw new Error(`Expected an integer, got "${value}"`);
  return parsed;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function required(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env) {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const port = int(env.PORT, 3000);
  const jwtSecret = required('JWT_SECRET', env);
  const jwtRefreshSecret = required('JWT_REFRESH_SECRET', env);
  if (jwtSecret === jwtRefreshSecret) {
    throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be different');
  }

  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    port,
    apiPrefix: (env.API_PREFIX ?? 'api').replace(/^\/+|\/+$/g, ''),
    swaggerPath: (env.SWAGGER_PATH ?? 'docs').replace(/^\/+|\/+$/g, ''),
    swaggerEnabled: bool(env.SWAGGER_ENABLED, true),
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? `http://localhost:${port}`).replace(/\/+$/, ''),
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    trustProxy: int(env.TRUST_PROXY, 0),
    logFormat: (env.LOG_FORMAT ?? (nodeEnv === 'production' ? 'json' : 'pretty')) as 'json' | 'pretty',

    db: {
      host: env.DB_HOST ?? 'localhost',
      port: int(env.DB_PORT, 5432),
      username: required('DB_USERNAME', env),
      password: env.DB_PASSWORD ?? '',
      database: required('DB_NAME', env),
      ssl: bool(env.DB_SSL, false),
      poolSize: int(env.DB_POOL_SIZE, 10),
      // Schema changes go exclusively through migrations. DB_SYNCHRONIZE is read only
      // so that a warning can be logged when it is set; it is never honoured.
      synchronizeRequested: bool(env.DB_SYNCHRONIZE, false),
    },

    auth: {
      jwtSecret,
      jwtRefreshSecret,
      accessTtlSeconds: parseDurationSeconds(env.JWT_EXPIRES_IN, 15 * 60),
      refreshTtlSeconds: parseDurationSeconds(env.JWT_REFRESH_EXPIRES_IN, 7 * 86400),
      throttleLimit: int(env.AUTH_THROTTLE_LIMIT, 10),
      throttleTtlSeconds: int(env.AUTH_THROTTLE_TTL_SECONDS, 60),
    },

    throttle: {
      enabled: bool(env.THROTTLE_ENABLED, true),
      limit: int(env.THROTTLE_LIMIT, 300),
      ttlSeconds: int(env.THROTTLE_TTL_SECONDS, 60),
    },

    media: {
      driver: (env.MEDIA_STORAGE_DRIVER ?? 'local') as 'local',
      localDir: env.MEDIA_LOCAL_DIR ?? './storage/media',
      // Falls back to a key derived from JWT_SECRET so development works out of the box.
      // Set a dedicated MEDIA_URL_SECRET in production.
      urlSecret:
        env.MEDIA_URL_SECRET ??
        createHash('sha256').update(`media-url:${jwtSecret}`).digest('hex'),
      urlTtlSeconds: parseDurationSeconds(env.MEDIA_URL_TTL, 24 * 3600),
      maxImageBytes: int(env.MEDIA_MAX_IMAGE_BYTES, 10 * 1024 * 1024),
      // Raw video upload limit. Every video is compressed to MP4 afterwards, so the original's size
      // and format no longer matter. (The old MEDIA_MAX_VIDEO_BYTES capped stored originals and is ignored.)
      maxVideoBytes: int(env.MEDIA_MAX_VIDEO_UPLOAD_BYTES, 2 * 1024 * 1024 * 1024),
      maxImageDimension: int(env.MEDIA_MAX_IMAGE_DIMENSION, 2048),
      video: {
        // Binaries: env path → bundled dev binaries (ffmpeg-static/ffprobe-static) → `ffmpeg`/`ffprobe` on PATH.
        ffmpegPath: env.FFMPEG_PATH || null,
        ffprobePath: env.FFPROBE_PATH || null,
        /** Output fits inside 1920×1080 (landscape) or 1080×1920 (portrait); never upscaled. */
        maxShortSide: int(env.MEDIA_VIDEO_MAX_SHORT_SIDE, 1080),
        maxLongSide: int(env.MEDIA_VIDEO_MAX_LONG_SIDE, 1920),
        /** x264 quality (lower = better/larger). 26 is visually clean for phone screens. */
        crf: int(env.MEDIA_VIDEO_CRF, 26),
        preset: env.MEDIA_VIDEO_PRESET ?? 'veryfast',
        maxBitrateKbps: int(env.MEDIA_VIDEO_MAX_BITRATE_KBPS, 4500),
        audioBitrateKbps: int(env.MEDIA_VIDEO_AUDIO_BITRATE_KBPS, 128),
        maxFps: int(env.MEDIA_VIDEO_MAX_FPS, 60),
        /** 0 = unlimited. Long videos cost CPU time to compress. */
        maxDurationSeconds: int(env.MEDIA_VIDEO_MAX_DURATION_SECONDS, 900),
        /** Videos compressed at the same time (each uses several CPU cores). */
        concurrency: Math.max(1, int(env.MEDIA_TRANSCODE_CONCURRENCY, 1)),
      },
      orphanTtlHours: int(env.MEDIA_ORPHAN_TTL_HOURS, 24),
      cleanupEnabled: bool(env.MEDIA_CLEANUP_ENABLED, true),
    },

    content: {
      postMaxLength: int(env.POST_MAX_LENGTH, 5000),
      postMaxMedia: int(env.POST_MAX_MEDIA, 4),
      commentMaxLength: int(env.COMMENT_MAX_LENGTH, 2000),
      commentMaxDepth: int(env.COMMENT_MAX_DEPTH, 6),
      exploreWindowHours: int(env.EXPLORE_WINDOW_HOURS, 72),
    },
  };
}

export type AppConfig = ReturnType<typeof loadAppConfig>;

export const appConfig = registerAs('app', () => loadAppConfig());
