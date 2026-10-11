import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { appConfig } from '../../config/app.config.js';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import { PostVisibilityEnum } from '../posts/dto/post.dto.js';
import { ReportReasonEnum } from '../reports/dto/report.dto.js';
import { AuditService, type RequestContext } from './audit.service.js';
import {
  type AdminSettingsResponseDto,
  type PlatformSettingsDto,
  type PublicPlatformConfigDto,
  SUPPORTED_IMAGE_TYPES,
  SUPPORTED_VIDEO_TYPES,
  type UpdatePlatformSettingsDto,
} from './dto/settings.dto.js';

export type PlatformSettings = PlatformSettingsDto;
export type FeatureFlag = keyof PlatformSettings['features'];
const SECTIONS = ['general', 'features', 'posts', 'media', 'comments', 'moderation'] as const;
type Section = (typeof SECTIONS)[number];
const CACHE_TTL_MS = 15_000;
const MB = 1024 * 1024;

const FEATURE_MESSAGES: Record<FeatureFlag, string> = {
  registration: 'Registration is currently closed.',
  postCreation: 'Posting is temporarily disabled.',
  imageUploads: 'Image uploads are temporarily disabled.',
  videoUploads: 'Video uploads are temporarily disabled.',
  reels: 'Reels are currently unavailable.',
  comments: 'Comments are temporarily disabled.',
  reposts: 'Reposts are temporarily disabled.',
  search: 'Search is temporarily unavailable.',
  reporting: 'Reporting is temporarily unavailable.',
};

/**
 * Typed runtime platform settings. Values are stored per section in `platform_settings`,
 * merged over environment-derived defaults, cached in-process for up to 15 s and audited on
 * every change. Secrets are never part of this store.
 */
@Injectable()
export class PlatformSettingsService {
  private readonly logger = new Logger(PlatformSettingsService.name);
  private cache: { value: PlatformSettings; expires: number; updatedAt: Date | null; updatedBy: string | null } | null =
    null;

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly audit: AuditService,
    @Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>,
  ) {}

  /** Hard limits from the environment; runtime settings can only tighten them. */
  get hardLimits() {
    return {
      maxImageMb: Math.floor(this.config.media.maxImageBytes / MB),
      maxVideoMb: Math.floor(this.config.media.maxVideoBytes / MB),
    };
  }

  defaults(): PlatformSettings {
    const { content } = this.config;
    return {
      general: { platformName: 'Circle', description: 'A little more connection.', supportEmail: '', maintenanceMessage: '', readOnlyMode: false },
      features: {
        registration: true,
        postCreation: true,
        imageUploads: true,
        videoUploads: true,
        reels: true,
        comments: true,
        reposts: true,
        search: true,
        reporting: true,
      },
      posts: { maxLength: Math.min(content.postMaxLength, 10000), maxMedia: Math.min(content.postMaxMedia, 10), defaultVisibility: PostVisibilityEnum.PUBLIC },
      media: {
        maxImageMb: this.hardLimits.maxImageMb,
        maxVideoMb: this.hardLimits.maxVideoMb,
        allowedImageTypes: [...SUPPORTED_IMAGE_TYPES],
        allowedVideoTypes: [...SUPPORTED_VIDEO_TYPES],
      },
      comments: { maxLength: Math.min(content.commentMaxLength, 10000), maxDepth: Math.min(content.commentMaxDepth, 20) },
      moderation: { allowedReportReasons: Object.values(ReportReasonEnum) },
    };
  }

  private async load() {
    const rows = await sqlRows<{ key: Section; value: Record<string, unknown>; updated_at: Date; username: string | null }>(
      this.db,
      `SELECT s.key, s.value, s.updated_at, u.username::text AS username
         FROM platform_settings s LEFT JOIN users u ON u.id = s.updated_by_id`,
    );
    const value = this.defaults();
    let updatedAt: Date | null = null;
    let updatedBy: string | null = null;
    for (const row of rows) {
      if (!SECTIONS.includes(row.key)) continue;
      // Shallow merge keeps defaults for keys added after the row was saved.
      (value as unknown as Record<string, unknown>)[row.key] = { ...value[row.key], ...row.value };
      if (!updatedAt || row.updated_at > updatedAt) {
        updatedAt = row.updated_at;
        updatedBy = row.username;
      }
    }
    this.cache = { value, expires: Date.now() + CACHE_TTL_MS, updatedAt, updatedBy };
    return this.cache;
  }

  /** Drops the in-process cache (used after out-of-band changes, e.g. test resets). */
  invalidate() {
    this.cache = null;
  }

  async get(): Promise<PlatformSettings> {
    if (this.cache && this.cache.expires > Date.now()) return this.cache.value;
    return (await this.load()).value;
  }

  async getForAdmin(): Promise<AdminSettingsResponseDto> {
    const state = await this.load();
    return {
      settings: state.value,
      limits: this.hardLimits,
      updatedAt: state.updatedAt?.toISOString() ?? null,
      updatedBy: state.updatedBy,
    };
  }

  async update(ctx: RequestContext, dto: UpdatePlatformSettingsDto): Promise<AdminSettingsResponseDto> {
    const limits = this.hardLimits;
    const details = [];
    if (dto.media && dto.media.maxImageMb > limits.maxImageMb)
      details.push({ field: 'media.maxImageMb', message: `cannot exceed the server limit of ${limits.maxImageMb} MB` });
    if (dto.media && dto.media.maxVideoMb > limits.maxVideoMb)
      details.push({ field: 'media.maxVideoMb', message: `cannot exceed the server limit of ${limits.maxVideoMb} MB` });
    if (details.length) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Validation failed', details);

    const current = (await this.load()).value;
    const changes: Record<string, Record<string, { from: unknown; to: unknown }>> = {};
    await this.db.transaction(async (m) => {
      for (const section of SECTIONS) {
        const next = dto[section];
        if (!next) continue;
        const diff: Record<string, { from: unknown; to: unknown }> = {};
        for (const [key, value] of Object.entries(next)) {
          const before = (current[section] as unknown as Record<string, unknown>)[key];
          if (JSON.stringify(before) !== JSON.stringify(value)) diff[key] = { from: before, to: value };
        }
        if (!Object.keys(diff).length) continue;
        changes[section] = diff;
        await sqlRows(
          m,
          `INSERT INTO platform_settings (key, value, updated_by_id, updated_at) VALUES ($1, $2::jsonb, $3, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by_id = EXCLUDED.updated_by_id, updated_at = now()`,
          [section, JSON.stringify({ ...current[section], ...next }), ctx.actor.id],
        );
      }
      if (Object.keys(changes).length)
        await this.audit.record(m, ctx, { action: 'settings.updated', targetType: 'SETTINGS', metadata: { changes } });
    });
    this.cache = null;
    if (Object.keys(changes).length) this.logger.log({ message: 'Platform settings updated', actorId: ctx.actor.id, sections: Object.keys(changes) });
    return this.getForAdmin();
  }

  async publicConfig(): Promise<PublicPlatformConfigDto> {
    const s = await this.get();
    const limits = await this.uploadLimits();
    return {
      platformName: s.general.platformName,
      description: s.general.description,
      supportEmail: s.general.supportEmail,
      maintenanceMessage: s.general.maintenanceMessage,
      readOnlyMode: s.general.readOnlyMode,
      features: s.features,
      postMaxLength: s.posts.maxLength,
      postMaxMedia: s.posts.maxMedia,
      defaultVisibility: s.posts.defaultVisibility,
      commentMaxLength: s.comments.maxLength,
      commentMaxDepth: s.comments.maxDepth,
      maxImageBytes: limits.maxImageBytes,
      maxVideoBytes: limits.maxVideoBytes,
      allowedImageTypes: s.media.allowedImageTypes,
      allowedVideoTypes: s.media.allowedVideoTypes,
      allowedReportReasons: s.moderation.allowedReportReasons,
    };
  }

  async uploadLimits() {
    const s = await this.get();
    return {
      maxImageBytes: Math.min(s.media.maxImageMb * MB, this.config.media.maxImageBytes),
      maxVideoBytes: Math.min(s.media.maxVideoMb * MB, this.config.media.maxVideoBytes),
    };
  }

  /** Throws 403 FEATURE_DISABLED when a feature flag is off. */
  async assertFeature(flag: FeatureFlag): Promise<void> {
    const s = await this.get();
    if (!s.features[flag]) throw new AppException(HttpStatus.FORBIDDEN, ErrorCode.FEATURE_DISABLED, FEATURE_MESSAGES[flag]);
  }

  /** Last update time, for System Status. */
  async lastUpdated() {
    return sqlOne<{ updated_at: Date }>(this.db, `SELECT max(updated_at) AS updated_at FROM platform_settings`);
  }
}
