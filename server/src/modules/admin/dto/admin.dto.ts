import { Type as NestType } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { sanitizeText } from '../../../common/utils/sanitize.js';
import { MediaDto, MediaStatusEnum, MediaTypeEnum } from '../../media/dto/media.dto.js';
import { PostKindEnum, PostVisibilityEnum } from '../../posts/dto/post.dto.js';
import { ReportReasonEnum, ReportStatusEnum, ReportTargetTypeEnum } from '../../reports/dto/report.dto.js';
import { UserRoleEnum, UserStatusEnum } from '../../users/dto/user.dto.js';

const text = (multiline = false) =>
  Transform(({ value }) => (typeof value === 'string' ? sanitizeText(value, { multiline }) : value));
const bool = () => Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value));

export enum ContentModerationStatusEnum {
  ACTIVE = 'ACTIVE',
  HIDDEN = 'HIDDEN',
  REMOVED = 'REMOVED',
}
export enum ContentFilterStatusEnum {
  ACTIVE = 'ACTIVE',
  HIDDEN = 'HIDDEN',
  REMOVED = 'REMOVED',
  DELETED = 'DELETED',
}
export enum SortOrderEnum {
  ASC = 'asc',
  DESC = 'desc',
}

// ---------------------------------------------------------------- pagination
export class AdminPageQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 25;

  @ApiPropertyOptional({ enum: SortOrderEnum, enumName: 'SortOrder', default: SortOrderEnum.DESC })
  @IsOptional()
  @IsEnum(SortOrderEnum)
  order?: SortOrderEnum;
}

export class DateRangeQueryDto extends AdminPageQueryDto {
  @ApiPropertyOptional({ format: 'date-time', description: 'Inclusive lower bound (created at)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time', description: 'Exclusive upper bound (created at)' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export interface AdminPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
const pageCache = new Map<NestType<unknown>, NestType<AdminPage<unknown>>>();
/** Named OpenAPI schema `AdminPage<Item>`: offset pagination with an exact total for admin tables. */
export function AdminPageOf<T>(item: NestType<T>): NestType<AdminPage<T>> {
  const cached = pageCache.get(item);
  if (cached) return cached as NestType<AdminPage<T>>;
  class PageDto implements AdminPage<T> {
    @ApiProperty({ type: item, isArray: true }) items: T[];
    @ApiProperty({ example: 1 }) page: number;
    @ApiProperty({ example: 25 }) pageSize: number;
    @ApiProperty({ example: 120 }) total: number;
  }
  Object.defineProperty(PageDto, 'name', { value: `AdminPage${item.name.replace(/Dto$/, '')}` });
  pageCache.set(item, PageDto as NestType<AdminPage<unknown>>);
  return PageDto;
}

// ---------------------------------------------------------------- shared refs
export class AdminUserRefDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'jane_doe' }) username: string;
  @ApiProperty({ example: 'Jane Doe' }) displayName: string;
  @ApiProperty({ type: String, nullable: true }) avatarUrl: string | null;
  @ApiProperty({ enum: UserRoleEnum, enumName: 'UserRole' }) role: UserRoleEnum;
  @ApiProperty({ enum: UserStatusEnum, enumName: 'UserStatus' }) status: UserStatusEnum;
}

export class AuditLogDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'post.hidden' }) action: string;
  @ApiProperty({ type: AdminUserRefDto, nullable: true, description: 'null for system actions' }) actor: AdminUserRefDto | null;
  @ApiProperty({ type: String, nullable: true, example: 'MODERATOR' }) actorRole: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'POST' }) targetType: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) targetId: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Human label for the target when resolvable' }) targetLabel: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true, example: { reason: 'Spam', previousStatus: 'ACTIVE', newStatus: 'HIDDEN' } })
  metadata: Record<string, unknown>;
  @ApiProperty({ type: String, nullable: true }) requestId: string | null;
  @ApiProperty({ type: String, nullable: true }) ipAddress: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

// ---------------------------------------------------------------- me / step-up
export class AdminMeDto {
  @ApiProperty({ type: AdminUserRefDto }) user: AdminUserRefDto;
  @ApiProperty({ enum: UserRoleEnum, enumName: 'UserRole' }) role: UserRoleEnum;
  @ApiProperty({ example: 3 }) rank: number;
  @ApiProperty({ type: [String], example: ['users.read', 'posts.moderate'] }) permissions: string[];
  @ApiProperty({ enum: UserRoleEnum, enumName: 'UserRole', isArray: true, description: 'Roles this admin may grant' })
  assignableRoles: UserRoleEnum[];
}

export class StepUpRequestDto {
  @ApiProperty({ description: 'Current account password' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}

export class StepUpResponseDto {
  @ApiProperty({ description: 'Send as `X-Step-Up-Token` on sensitive requests' }) token: string;
  @ApiProperty({ format: 'date-time' }) expiresAt: string;
}

// ---------------------------------------------------------------- users
export class AdminUsersQueryDto extends AdminPageQueryDto {
  @ApiPropertyOptional({ description: 'Username / display name (and email for roles allowed to see emails)' })
  @IsOptional()
  @text()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: UserStatusEnum, enumName: 'UserStatus' })
  @IsOptional()
  @IsEnum(UserStatusEnum)
  status?: UserStatusEnum;

  @ApiPropertyOptional({ enum: UserRoleEnum, enumName: 'UserRole' })
  @IsOptional()
  @IsEnum(UserRoleEnum)
  role?: UserRoleEnum;

  @ApiPropertyOptional({ description: 'Only staff accounts (any role above USER)' })
  @IsOptional()
  @bool()
  @IsBoolean()
  staff?: boolean;

  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() createdFrom?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() createdTo?: string;

  @ApiPropertyOptional({ enum: ['created', 'lastActive', 'followers', 'posts', 'reports'], default: 'created' })
  @IsOptional()
  @IsIn(['created', 'lastActive', 'followers', 'posts', 'reports'])
  sort?: 'created' | 'lastActive' | 'followers' | 'posts' | 'reports';
}

export class AdminUserRowDto extends AdminUserRefDto {
  @ApiProperty({ type: String, nullable: true, description: 'null unless the viewer has users.email.read' }) email: string | null;
  @ApiProperty({ description: 'Blue verification badge' }) isVerified: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Tracked since the admin release' }) lastActiveAt: string | null;
  @ApiProperty() postCount: number;
  @ApiProperty() followerCount: number;
  @ApiProperty() followingCount: number;
  @ApiProperty({ description: 'Reports against the account or its content (all time)' }) reportCount: number;
  @ApiProperty({ description: 'Of which still open or in review' }) openReportCount: number;
}

export class AdminRestrictionDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['SUSPENSION', 'BAN'] }) type: 'SUSPENSION' | 'BAN';
  @ApiProperty() reason: string;
  @ApiProperty({ format: 'date-time' }) startsAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) expiresAt: string | null;
  @ApiProperty({ type: AdminUserRefDto, nullable: true }) createdBy: AdminUserRefDto | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) liftedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) liftReason: string | null;
  @ApiProperty() active: boolean;
}

export class AdminWarningDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ReportReasonEnum, enumName: 'ReportReason' }) reason: ReportReasonEnum;
  @ApiProperty() message: string;
  @ApiProperty({ type: AdminUserRefDto, nullable: true }) createdBy: AdminUserRefDto | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'When the user opened it in their inbox' })
  readAt: string | null;
}

export class AdminUserContentCountsDto {
  @ApiProperty() posts: number;
  @ApiProperty() reels: number;
  @ApiProperty() comments: number;
  @ApiProperty() reposts: number;
  @ApiProperty({ description: 'Posts currently hidden or removed by moderators' }) moderatedPosts: number;
  @ApiProperty({ description: 'Comments currently hidden or removed by moderators' }) moderatedComments: number;
}

export class AdminUserRelationshipsDto {
  @ApiProperty() followers: number;
  @ApiProperty() following: number;
  @ApiProperty({ description: 'Accounts this user blocks' }) blocking: number;
  @ApiProperty({ description: 'Accounts blocking this user' }) blockedBy: number;
  @ApiProperty() pendingFollowRequests: number;
}

export class AdminUserDetailDto {
  @ApiProperty({ type: AdminUserRowDto }) user: AdminUserRowDto;
  @ApiProperty({ type: String, nullable: true }) bio: string | null;
  @ApiProperty({ type: String, nullable: true }) location: string | null;
  @ApiProperty({ type: String, nullable: true }) website: string | null;
  @ApiProperty({ type: String, nullable: true }) coverUrl: string | null;
  @ApiProperty() isPrivate: boolean;
  @ApiProperty({ description: 'Unrevoked, unexpired sessions' }) activeSessions: number;
  @ApiProperty({ type: AdminUserContentCountsDto }) content: AdminUserContentCountsDto;
  @ApiProperty({ type: AdminUserRelationshipsDto }) relationships: AdminUserRelationshipsDto;
  @ApiProperty({ type: [AdminRestrictionDto] }) restrictions: AdminRestrictionDto[];
  @ApiProperty({ type: [AdminWarningDto] }) warnings: AdminWarningDto[];
  @ApiProperty({ type: () => [AdminReportRowDto], description: 'Most recent 20 reports about the user or their content' })
  reports: AdminReportRowDto[];
  @ApiProperty({ type: [AuditLogDto], description: 'Most recent 30 administrative events for this account' })
  history: AuditLogDto[];
}

export class ReasonDto {
  @ApiProperty({ minLength: 3, maxLength: 1000, example: 'Repeated spam after warnings' })
  @text(true)
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason: string;
}

export class SuspendUserDto extends ReasonDto {
  @ApiPropertyOptional({ format: 'date-time', description: 'Omit for an indefinite suspension' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class BanUserDto extends ReasonDto {
  @ApiProperty({ description: 'Type the exact username to confirm' })
  @IsString()
  @MaxLength(30)
  confirmUsername: string;
}

export class WarnUserDto {
  @ApiProperty({ enum: ReportReasonEnum, enumName: 'ReportReason' })
  @IsEnum(ReportReasonEnum)
  reason: ReportReasonEnum;

  @ApiProperty({ minLength: 10, maxLength: 1000, description: 'Shown to the user in their inbox' })
  @text(true)
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  message: string;
}

export class WarningCreatedDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ enum: ['IN_APP_INBOX'], description: 'Only in-app delivery exists (no email provider configured)' })
  delivery: 'IN_APP_INBOX';
}

export class ChangeRoleDto {
  @ApiProperty({ enum: UserRoleEnum, enumName: 'UserRole' })
  @IsEnum(UserRoleEnum)
  role: UserRoleEnum;
}

export class AccountStatusResultDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: UserStatusEnum, enumName: 'UserStatus' }) status: UserStatusEnum;
}

export class SetPinnedDto {
  @ApiProperty({ example: true, description: 'true pins the post to the top of the home feed, false unpins it' })
  @IsBoolean()
  pinned: boolean;
}

export class PinnedResultDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() isPinned: boolean;
}

export class SetVerifiedDto {
  @ApiProperty({ example: true, description: 'true grants the blue badge, false removes it' })
  @IsBoolean()
  verified: boolean;
}

export class VerifiedResultDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() isVerified: boolean;
}

export class RoleResultDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: UserRoleEnum, enumName: 'UserRole' }) role: UserRoleEnum;
}

// ---------------------------------------------------------------- content
export class AdminContentQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({ description: 'Text contained in the content' })
  @IsOptional()
  @text()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: ContentFilterStatusEnum, enumName: 'ContentFilterStatus' })
  @IsOptional()
  @IsEnum(ContentFilterStatusEnum)
  status?: ContentFilterStatusEnum;

  @ApiPropertyOptional({ description: 'Only content with reports (any status)' })
  @IsOptional()
  @bool()
  @IsBoolean()
  reported?: boolean;

  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID('all') authorId?: string;

  @ApiPropertyOptional({ enum: ['created', 'likes', 'comments', 'reposts', 'reports'], default: 'created' })
  @IsOptional()
  @IsIn(['created', 'likes', 'comments', 'reposts', 'reports'])
  sort?: 'created' | 'likes' | 'comments' | 'reposts' | 'reports';
}

export class AdminPostsQueryDto extends AdminContentQueryDto {
  @ApiPropertyOptional({ enum: ['TEXT', 'IMAGE', 'VIDEO'], description: 'TEXT = no attachments' })
  @IsOptional()
  @IsIn(['TEXT', 'IMAGE', 'VIDEO'])
  type?: 'TEXT' | 'IMAGE' | 'VIDEO';

  @ApiPropertyOptional({ enum: PostKindEnum, enumName: 'PostKind' })
  @IsOptional()
  @IsEnum(PostKindEnum)
  kind?: PostKindEnum;
}

export class AdminCommentsQueryDto extends AdminContentQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID('all') postId?: string;
}

export class MediaSummaryDto {
  @ApiProperty() images: number;
  @ApiProperty() videos: number;
}

export class AdminPostRowDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: PostKindEnum, enumName: 'PostKind' }) kind: PostKindEnum;
  @ApiProperty({ type: String, nullable: true, description: 'First 200 characters' }) contentPreview: string | null;
  @ApiProperty({ type: AdminUserRefDto }) author: AdminUserRefDto;
  @ApiProperty({ type: MediaSummaryDto }) media: MediaSummaryDto;
  @ApiProperty({ type: String, nullable: true, description: 'Signed URL of the first image' }) thumbnailUrl: string | null;
  @ApiProperty({ enum: PostVisibilityEnum, enumName: 'PostVisibility' }) visibility: PostVisibilityEnum;
  @ApiProperty({ enum: ContentModerationStatusEnum, enumName: 'ContentModerationStatus' }) moderationStatus: ContentModerationStatusEnum;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Deleted by the author' }) deletedAt: string | null;
  @ApiProperty() likeCount: number;
  @ApiProperty() commentCount: number;
  @ApiProperty() repostCount: number;
  @ApiProperty() quoteCount: number;
  @ApiProperty() reportCount: number;
  @ApiProperty() openReportCount: number;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

export class AdminVideoInfoDto {
  @ApiProperty({ format: 'uuid' }) mediaId: string;
  @ApiProperty() url: string;
  @ApiProperty({ example: 'video/mp4' }) mimeType: string;
  @ApiProperty() sizeBytes: number;
  @ApiProperty({ type: Number, nullable: true, description: 'null: no server-side probing (no transcoder)' }) width: number | null;
  @ApiProperty({ type: Number, nullable: true }) height: number | null;
  @ApiProperty({ type: Number, nullable: true }) durationMs: number | null;
  @ApiProperty({ enum: MediaStatusEnum, enumName: 'MediaStatus' }) status: MediaStatusEnum;
}

export class AdminReelRowDto extends AdminPostRowDto {
  @ApiProperty({ type: AdminVideoInfoDto }) video: AdminVideoInfoDto;
}

export class AdminPostDetailDto {
  @ApiProperty({ type: AdminPostRowDto }) post: AdminPostRowDto;
  @ApiProperty({ type: String, nullable: true, description: 'Full text (moderators always see the exact content)' }) content: string | null;
  @ApiProperty({ type: [MediaDto] }) media: MediaDto[];
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) referencedPostId: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) editedAt: string | null;
  @ApiProperty() bookmarkCount: number;
  @ApiProperty({ type: () => [AdminReportRowDto] }) reports: AdminReportRowDto[];
  @ApiProperty({ type: [AuditLogDto] }) history: AuditLogDto[];
}

export class AdminCommentRowDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ description: 'Exact content (also for removed/deleted comments)' }) content: string;
  @ApiProperty({ type: AdminUserRefDto }) author: AdminUserRefDto;
  @ApiProperty({ format: 'uuid' }) postId: string;
  @ApiProperty({ type: String, nullable: true }) postPreview: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) parentId: string | null;
  @ApiProperty() depth: number;
  @ApiProperty() likeCount: number;
  @ApiProperty() replyCount: number;
  @ApiProperty({ enum: ContentModerationStatusEnum, enumName: 'ContentModerationStatus' }) moderationStatus: ContentModerationStatusEnum;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) deletedAt: string | null;
  @ApiProperty() reportCount: number;
  @ApiProperty() openReportCount: number;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

export class AdminCommentDetailDto {
  @ApiProperty({ type: AdminCommentRowDto }) comment: AdminCommentRowDto;
  @ApiProperty({ type: [AdminCommentRowDto], description: 'Ancestors from the top-level comment down to the parent' })
  thread: AdminCommentRowDto[];
  @ApiProperty({ type: [AdminCommentRowDto], description: 'First 20 direct replies' }) replies: AdminCommentRowDto[];
  @ApiProperty({ type: AdminPostRowDto }) post: AdminPostRowDto;
  @ApiProperty({ type: () => [AdminReportRowDto] }) reports: AdminReportRowDto[];
  @ApiProperty({ type: [AuditLogDto] }) history: AuditLogDto[];
}

export class ModerateContentDto extends ReasonDto {
  @ApiProperty({ enum: ContentModerationStatusEnum, enumName: 'ContentModerationStatus' })
  @IsEnum(ContentModerationStatusEnum)
  status: ContentModerationStatusEnum;

  @ApiPropertyOptional({ default: false, description: 'Also resolve open reports about this content (hide/remove only)' })
  @IsOptional()
  @IsBoolean()
  resolveReports?: boolean;
}

export class ModerationOutcomeDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ContentModerationStatusEnum, enumName: 'ContentModerationStatus' }) status: ContentModerationStatusEnum;
  @ApiProperty({ enum: ContentModerationStatusEnum, enumName: 'ContentModerationStatus' }) previousStatus: ContentModerationStatusEnum;
  @ApiProperty() resolvedReports: number;
}

export class BulkModerateUserContentDto extends ModerateContentDto {
  @ApiProperty({
    enum: ['posts', 'comments', 'all'],
    description: '`posts` = posts, quotes, reposts and Reels; `comments`; or `all`',
  })
  @IsIn(['posts', 'comments', 'all'])
  scope: 'posts' | 'comments' | 'all';

  @ApiProperty({ description: 'Must equal the account’s username (typed confirmation)' })
  @IsString()
  @MaxLength(30)
  confirmUsername: string;
}

export class BulkModerationResultDto {
  @ApiProperty({ format: 'uuid', description: 'Shared by the audit entries of every affected item' }) batchId: string;
  @ApiProperty({ description: 'Posts/Reels whose status changed' }) posts: number;
  @ApiProperty({ description: 'Comments whose status changed' }) comments: number;
  @ApiProperty() resolvedReports: number;
}

export class DeleteAccountDto extends ReasonDto {
  @ApiProperty({description:'Exact username confirmation'}) @IsString() @MaxLength(32) confirmUsername: string;
}

export class DeleteUserContentDto extends ReasonDto {
  @ApiProperty({ enum: ['posts', 'comments', 'all'] })
  @IsIn(['posts', 'comments', 'all']) scope: 'posts' | 'comments' | 'all';
  @ApiProperty({ description: 'Must equal the target username' })
  @IsString() @MaxLength(30) confirmUsername: string;
}

export class DeletionResultDto {
  @ApiProperty() posts: number;
  @ApiProperty() comments: number;
  @ApiProperty({ description: 'Storage files scheduled for immediate deletion; failures retry automatically' }) files: number;
  @ApiProperty() freedBytes: number;
  @ApiProperty() resolvedReports: number;
}

// ---------------------------------------------------------------- media
export enum MediaUsageEnum {
  MESSAGE = 'MESSAGE',
  STORY = 'STORY',
  STICKER = 'STICKER',
  CIRCLE = 'CIRCLE',
  POST = 'POST',
  AVATAR = 'AVATAR',
  COVER = 'COVER',
  UNATTACHED = 'UNATTACHED',
}

export class AdminMediaQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({ enum: MediaTypeEnum, enumName: 'MediaType' }) @IsOptional() @IsEnum(MediaTypeEnum) type?: MediaTypeEnum;
  @ApiPropertyOptional({ enum: MediaUsageEnum, enumName: 'MediaUsage' }) @IsOptional() @IsEnum(MediaUsageEnum) usage?: MediaUsageEnum;
  @ApiPropertyOptional({ enum: MediaStatusEnum, enumName: 'MediaStatus' }) @IsOptional() @IsEnum(MediaStatusEnum) status?: MediaStatusEnum;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID('all') ownerId?: string;
  @ApiPropertyOptional({ description: 'Minimum size in bytes' }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) minSize?: number;
  @ApiPropertyOptional({ description: 'Maximum size in bytes' }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) maxSize?: number;
  @ApiPropertyOptional({ enum: ['created', 'size'], default: 'created' }) @IsOptional() @IsIn(['created', 'size']) sort?: 'created' | 'size';
}

export class MediaUsageDto {
  @ApiProperty({ enum: MediaUsageEnum, enumName: 'MediaUsage' }) kind: MediaUsageEnum;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) postId: string | null;
}

export class AdminMediaRowDto extends MediaDto {
  @ApiProperty({ description: 'Object identifier in the storage driver (not a credential)' }) storageKey: string;
  @ApiProperty({ type: AdminUserRefDto }) owner: AdminUserRefDto;
  @ApiProperty({ type: MediaUsageDto }) usage: MediaUsageDto;
}

export class MediaHealthDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() storageKey: string;
  @ApiProperty({ enum: ['OK', 'MISSING', 'SIZE_MISMATCH', 'ERROR'] }) state: 'OK' | 'MISSING' | 'SIZE_MISMATCH' | 'ERROR';
  @ApiProperty({ type: Number, nullable: true }) storedBytes: number | null;
  @ApiProperty() recordedBytes: number;
  @ApiProperty({ type: String, nullable: true }) detail: string | null;
  @ApiProperty({ format: 'date-time' }) checkedAt: string;
}

export class MediaScanQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @ApiPropertyOptional({ format: 'uuid', description: 'Continue after this media id (from `nextAfterId`)' })
  @IsOptional()
  @IsUUID('all')
  afterId?: string;
}

export class MediaScanResultDto {
  @ApiProperty() checked: number;
  @ApiProperty({ type: [MediaHealthDto], description: 'Only problems are listed' }) problems: MediaHealthDto[];
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) nextAfterId: string | null;
}

export class CleanupPreviewDto {
  @ApiProperty({ description: 'Unattached uploads older than this are eligible' }) ttlHours: number;
  @ApiProperty() count: number;
  @ApiProperty() totalBytes: number;
  @ApiProperty({ type: [AdminMediaRowDto], description: 'Up to 100 oldest candidates' }) items: AdminMediaRowDto[];
}

export class CleanupExecuteDto {
  @ApiProperty({ type: [String], format: 'uuid', description: 'Ids from the preview; re-checked server-side' })
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  mediaIds: string[];
}

export class CleanupResultDto {
  @ApiProperty() deleted: number;
  @ApiProperty({ description: 'Ids that were no longer orphaned or already gone' }) skipped: number;
  @ApiProperty() freedBytes: number;
}

// ---------------------------------------------------------------- reports
export enum AdminReportTargetFilterEnum {
  POST = 'POST',
  REEL = 'REEL',
  COMMENT = 'COMMENT',
  USER = 'USER',
}

export class AdminReportsQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({
    enum: ['PENDING', ...Object.values(ReportStatusEnum)],
    default: 'PENDING',
    description: 'PENDING = OPEN or IN_REVIEW',
  })
  @IsOptional()
  @IsIn(['PENDING', ...Object.values(ReportStatusEnum)])
  status?: 'PENDING' | ReportStatusEnum;

  @ApiPropertyOptional({ enum: AdminReportTargetFilterEnum, enumName: 'AdminReportTargetFilter' })
  @IsOptional()
  @IsEnum(AdminReportTargetFilterEnum)
  targetType?: AdminReportTargetFilterEnum;

  @ApiPropertyOptional({ enum: ReportReasonEnum, enumName: 'ReportReason' })
  @IsOptional()
  @IsEnum(ReportReasonEnum)
  reason?: ReportReasonEnum;

  @ApiPropertyOptional({ enum: ['any', 'me', 'unassigned'], default: 'any' })
  @IsOptional()
  @IsIn(['any', 'me', 'unassigned'])
  assigned?: 'any' | 'me' | 'unassigned';

  @ApiPropertyOptional({ format: 'uuid', description: 'Reports about this target only' })
  @IsOptional()
  @IsUUID('all')
  targetId?: string;
}

export class ReportTargetSummaryDto {
  @ApiProperty({ description: 'Whether the target still exists' }) exists: boolean;
  @ApiProperty({ type: String, nullable: true }) preview: string | null;
  @ApiProperty({ type: AdminUserRefDto, nullable: true, description: 'Owner of the content (or the reported user)' })
  owner: AdminUserRefDto | null;
  @ApiProperty({ type: String, nullable: true, description: 'Content moderation status, or account status for USER' })
  status: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) deletedAt: string | null;
}

export class AdminReportRowDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ReportTargetTypeEnum, enumName: 'ReportTargetType' }) targetType: ReportTargetTypeEnum;
  @ApiProperty({ description: 'POST target that contains a video (Reel)' }) isReel: boolean;
  @ApiProperty({ format: 'uuid' }) targetId: string;
  @ApiProperty({ enum: ReportReasonEnum, enumName: 'ReportReason' }) reason: ReportReasonEnum;
  @ApiProperty({ type: String, nullable: true }) details: string | null;
  @ApiProperty({ enum: ReportStatusEnum, enumName: 'ReportStatus' }) status: ReportStatusEnum;
  @ApiProperty({ type: AdminUserRefDto }) reporter: AdminUserRefDto;
  @ApiProperty({ type: AdminUserRefDto, nullable: true }) assignee: AdminUserRefDto | null;
  @ApiProperty({ type: ReportTargetSummaryDto }) target: ReportTargetSummaryDto;
  @ApiProperty({ description: 'Pending reports about the same target (all reporters)' }) samePendingCount: number;
  @ApiProperty({ type: String, nullable: true }) resolutionNote: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) resolvedAt: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

export class ReportNoteDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ type: AdminUserRefDto, nullable: true }) author: AdminUserRefDto | null;
  @ApiProperty() body: string;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

export class AdminReportDetailDto {
  @ApiProperty({ type: AdminReportRowDto }) report: AdminReportRowDto;
  @ApiProperty({ type: AdminPostDetailDto, nullable: true }) post: AdminPostDetailDto | null;
  @ApiProperty({ type: AdminCommentDetailDto, nullable: true }) comment: AdminCommentDetailDto | null;
  @ApiProperty({ type: AdminUserRowDto, nullable: true }) user: AdminUserRowDto | null;
  @ApiProperty({ type: [AdminReportRowDto], description: 'Other reports about the same target' }) related: AdminReportRowDto[];
  @ApiProperty({ type: [ReportNoteDto], description: 'Internal notes — never shown to users' }) notes: ReportNoteDto[];
  @ApiProperty({ type: [AuditLogDto] }) history: AuditLogDto[];
}

export class AssignReportDto {
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Staff member with reports.resolve, or null to unassign' })
  @ValidateIf((_, v) => v !== null)
  @IsUUID('all')
  assigneeId: string | null;
}

export class ReportStatusChangeDto {
  @ApiProperty({ enum: ReportStatusEnum, enumName: 'ReportStatus' })
  @IsEnum(ReportStatusEnum)
  status: ReportStatusEnum;

  @ApiPropertyOptional({ maxLength: 1000, description: 'Resolution note (stored with the report)' })
  @IsOptional()
  @text(true)
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class CreateReportNoteDto {
  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @text(true)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body: string;
}

export enum ReportActionEnum {
  HIDE_CONTENT = 'HIDE_CONTENT',
  REMOVE_CONTENT = 'REMOVE_CONTENT',
  RESTORE_CONTENT = 'RESTORE_CONTENT',
  WARN_USER = 'WARN_USER',
  SUSPEND_USER = 'SUSPEND_USER',
  BAN_USER = 'BAN_USER',
}

export class ReportActionDto extends ReasonDto {
  @ApiProperty({ enum: ReportActionEnum, enumName: 'ReportAction' })
  @IsEnum(ReportActionEnum)
  action: ReportActionEnum;

  @ApiPropertyOptional({ default: true, description: 'Resolve this report (and other pending reports on the target) afterwards' })
  @IsOptional()
  @IsBoolean()
  resolve?: boolean;

  @ApiPropertyOptional({ format: 'date-time', description: 'SUSPEND_USER: optional end of the suspension' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({ maxLength: 1000, description: 'WARN_USER: message shown to the user (defaults to the reason)' })
  @IsOptional()
  @text(true)
  @IsString()
  @MaxLength(1000)
  warningMessage?: string;

  @ApiPropertyOptional({ description: 'BAN_USER: exact username of the content owner' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  confirmUsername?: string;
}

// ---------------------------------------------------------------- announcements
export enum AnnouncementAudienceEnum {
  ALL = 'ALL',
  SELECTED = 'SELECTED',
}
export enum AnnouncementStatusEnum {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  ARCHIVED = 'ARCHIVED',
}

export class AnnouncementDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty() body: string;
  @ApiProperty({ enum: AnnouncementAudienceEnum, enumName: 'AnnouncementAudience' }) audience: AnnouncementAudienceEnum;
  @ApiProperty({ enum: AnnouncementStatusEnum, enumName: 'AnnouncementStatus' }) status: AnnouncementStatusEnum;
  @ApiProperty({ type: Number, nullable: true, description: 'Audience size at publish time' }) recipientCount: number | null;
  @ApiProperty({ description: 'Recipients who opened it (in-app read receipts)' }) readCount: number;
  @ApiProperty({ type: [String], description: 'Usernames for SELECTED audiences (max 50 listed)' }) selectedUsernames: string[];
  @ApiProperty({ description: 'Total selected recipients' }) selectedCount: number;
  @ApiProperty({ type: AdminUserRefDto, nullable: true }) createdBy: AdminUserRefDto | null;
  @ApiProperty({ type: AdminUserRefDto, nullable: true }) publishedBy: AdminUserRefDto | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ format: 'date-time' }) updatedAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) publishedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) archivedAt: string | null;
}

export class AnnouncementsQueryDto extends AdminPageQueryDto {
  @ApiPropertyOptional({ enum: AnnouncementStatusEnum, enumName: 'AnnouncementStatus' })
  @IsOptional()
  @IsEnum(AnnouncementStatusEnum)
  status?: AnnouncementStatusEnum;
}

export class SaveAnnouncementDto {
  @ApiProperty({ minLength: 3, maxLength: 120 })
  @text()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title: string;

  @ApiProperty({ minLength: 3, maxLength: 2000 })
  @text(true)
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  body: string;

  @ApiProperty({ enum: AnnouncementAudienceEnum, enumName: 'AnnouncementAudience' })
  @IsEnum(AnnouncementAudienceEnum)
  audience: AnnouncementAudienceEnum;

  @ApiPropertyOptional({ type: [String], description: 'SELECTED audience: up to 1000 usernames' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @Matches(/^[A-Za-z0-9_]{3,30}$/, { each: true })
  recipientUsernames?: string[];
}

// ---------------------------------------------------------------- analytics
export class OverviewDto {
  @ApiProperty() totalUsers: number;
  @ApiProperty({ type: Number, nullable: true, description: 'null until activity has been tracked for 24h' }) activeUsers24h: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'null until activity has been tracked for 7 days' }) activeUsers7d: number | null;
  @ApiProperty() newUsersToday: number;
  @ApiProperty() newUsers7d: number;
  @ApiProperty({ description: 'Original posts and quotes (excludes simple reposts and author-deleted posts)' }) totalPosts: number;
  @ApiProperty() postsToday: number;
  @ApiProperty({ description: 'Posts with a ready video' }) totalReels: number;
  @ApiProperty() totalComments: number;
  @ApiProperty() totalLikes: number;
  @ApiProperty() totalReposts: number;
  @ApiProperty() totalBookmarks: number;
  @ApiProperty({ description: 'OPEN + IN_REVIEW' }) pendingReports: number;
  @ApiProperty() suspendedAccounts: number;
  @ApiProperty() bannedAccounts: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Start of activity tracking' })
  activityTrackedSince: string | null;
  @ApiProperty({ format: 'date-time' }) generatedAt: string;
}

export class AlertDto {
  @ApiProperty({ enum: ['info', 'warning', 'critical'] }) level: 'info' | 'warning' | 'critical';
  @ApiProperty() title: string;
  @ApiProperty() detail: string;
  @ApiProperty({ type: String, nullable: true, description: 'Admin route to act on it' }) href: string | null;
}

export class DashboardDto {
  @ApiProperty({ type: OverviewDto }) overview: OverviewDto;
  @ApiProperty({ type: [AdminUserRowDto] }) recentUsers: AdminUserRowDto[];
  @ApiProperty({ type: [AdminPostRowDto] }) latestPosts: AdminPostRowDto[];
  @ApiProperty({ type: [AdminReelRowDto] }) latestReels: AdminReelRowDto[];
  @ApiProperty({ type: [AdminReportRowDto] }) recentReports: AdminReportRowDto[];
  @ApiProperty({ type: [AuditLogDto] }) recentActions: AuditLogDto[];
  @ApiProperty({ type: [AlertDto] }) alerts: AlertDto[];
}

export const METRICS = [
  'registrations',
  'active_users',
  'posts',
  'reels',
  'comments',
  'likes',
  'reposts',
  'bookmarks',
  'reports_created',
  'reports_resolved',
] as const;
export type Metric = (typeof METRICS)[number];

export class TimeseriesQueryDto {
  @ApiProperty({ description: `Comma-separated: ${METRICS.join(', ')}`, example: 'registrations,posts' })
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').map((v: string) => v.trim()).filter(Boolean) : value))
  @IsArray()
  @ArrayMaxSize(10)
  @IsIn([...METRICS], { each: true })
  metrics: Metric[];

  @ApiProperty({ format: 'date-time' }) @IsDateString() from: string;
  @ApiProperty({ format: 'date-time' }) @IsDateString() to: string;

  @ApiPropertyOptional({ enum: ['day', 'week', 'month'], default: 'day' })
  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  interval?: 'day' | 'week' | 'month';
}

export class TimePointDto {
  @ApiProperty({ format: 'date-time', description: 'Bucket start (UTC)' }) t: string;
  @ApiProperty() value: number;
}

export class TimeSeriesDto {
  @ApiProperty({ enum: METRICS }) metric: Metric;
  @ApiProperty() total: number;
  @ApiProperty({ type: [TimePointDto] }) points: TimePointDto[];
  @ApiProperty({ type: String, nullable: true, description: 'Caveat, e.g. tracking start for active users' }) note: string | null;
}

export class TimeseriesResponseDto {
  @ApiProperty({ enum: ['day', 'week', 'month'] }) interval: 'day' | 'week' | 'month';
  @ApiProperty({ format: 'date-time' }) from: string;
  @ApiProperty({ format: 'date-time' }) to: string;
  @ApiProperty({ type: [TimeSeriesDto] }) series: TimeSeriesDto[];
}

export class TopContentQueryDto {
  @ApiPropertyOptional({ enum: ['likes', 'comments', 'reposts', 'engagement'], default: 'engagement' })
  @IsOptional()
  @IsIn(['likes', 'comments', 'reposts', 'engagement'])
  by?: 'likes' | 'comments' | 'reposts' | 'engagement';

  @ApiPropertyOptional({ enum: ['posts', 'reels'], default: 'posts' })
  @IsOptional()
  @IsIn(['posts', 'reels'])
  kind?: 'posts' | 'reels';

  @ApiProperty({ format: 'date-time', description: 'Posts created from' }) @IsDateString() from: string;
  @ApiProperty({ format: 'date-time', description: 'Posts created before' }) @IsDateString() to: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 20, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number = 10;
}

export class TopContentItemDto extends AdminPostRowDto {
  @ApiProperty({ description: 'likes + 2·comments + 3·(reposts + quotes) when by=engagement, else the chosen counter' })
  score: number;
}

export class TopContentResponseDto {
  @ApiProperty({ type: [TopContentItemDto] }) items: TopContentItemDto[];
  @ApiProperty({ description: 'Reel view counts and watch time are not tracked (see ADMIN_ARCHITECTURE.md §8)' })
  viewsTracked: boolean;
}

// ---------------------------------------------------------------- roles / audit / system
export class RoleInfoDto {
  @ApiProperty({ enum: UserRoleEnum, enumName: 'UserRole' }) role: UserRoleEnum;
  @ApiProperty() rank: number;
  @ApiProperty({ type: [String] }) permissions: string[];
  @ApiProperty() memberCount: number;
  @ApiProperty({ description: 'Whether the current admin may grant this role' }) assignable: boolean;
}

export class RolesOverviewDto {
  @ApiProperty({ type: [RoleInfoDto] }) roles: RoleInfoDto[];
  @ApiProperty({ type: [String], description: 'Every permission known to the server' }) allPermissions: string[];
  @ApiProperty({ type: [AdminUserRowDto], description: 'All staff accounts (max 500)' }) staff: AdminUserRowDto[];
  @ApiProperty({ type: [AuditLogDto], description: 'Latest 20 role changes' }) recentChanges: AuditLogDto[];
}

export class AuditQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID('all') actorId?: string;
  @ApiPropertyOptional({ description: 'Exact action or prefix ending in "." (e.g. "user.")' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z_.]{1,64}$/)
  action?: string;
  @ApiPropertyOptional({ enum: ['USER', 'POST', 'COMMENT', 'REPORT', 'MEDIA', 'ANNOUNCEMENT', 'SETTINGS', 'SYSTEM'] })
  @IsOptional()
  @IsIn(['USER', 'POST', 'COMMENT', 'REPORT', 'MEDIA', 'ANNOUNCEMENT', 'SETTINGS', 'SYSTEM'])
  targetType?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID('all') targetId?: string;
}

export class JobStatusDto {
  @ApiProperty() name: string;
  @ApiProperty() schedule: string;
  @ApiProperty() description: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastRunAt: string | null;
  @ApiProperty({ type: String, nullable: true, enum: ['OK', 'FAILED'] }) lastStatus: 'OK' | 'FAILED' | null;
  @ApiProperty({ type: String, nullable: true }) lastDetail: string | null;
}

export class RecentErrorDto {
  @ApiProperty({ format: 'date-time' }) at: string;
  @ApiProperty({ type: String, nullable: true }) requestId: string | null;
  @ApiProperty() method: string;
  @ApiProperty() path: string;
  @ApiProperty() statusCode: number;
  @ApiProperty({ description: 'Error class and truncated message (no request data)' }) error: string;
}

export class ComponentHealthDto {
  @ApiProperty({ enum: ['OK', 'DEGRADED', 'DOWN'] }) status: 'OK' | 'DEGRADED' | 'DOWN';
  @ApiProperty({ type: Number, nullable: true }) latencyMs: number | null;
  @ApiProperty({ type: String, nullable: true }) detail: string | null;
}

export class DatabaseHealthDto extends ComponentHealthDto {
  @ApiProperty({ type: String, nullable: true, example: 'PostgreSQL 18.6' }) version: string | null;
  @ApiProperty() appliedMigrations: number;
  @ApiProperty({ type: [String] }) pendingMigrations: string[];
}

export class StorageHealthDto extends ComponentHealthDto {
  @ApiProperty({ example: 'local' }) driver: string;
  @ApiProperty({ type: Number, nullable: true, description: 'Free bytes on the media volume (local driver)' }) freeBytes: number | null;
  @ApiProperty({ type: Number, nullable: true }) totalBytes: number | null;
}

export class ApiInfoDto {
  @ApiProperty({ example: '0.0.1' }) appVersion: string;
  @ApiProperty({ example: '1.3.0' }) apiVersion: string;
  @ApiProperty({ example: 'development', description: 'NODE_ENV classification only' }) environment: string;
  @ApiProperty({ example: 'v24.20.0' }) nodeVersion: string;
  @ApiProperty() uptimeSeconds: number;
  @ApiProperty({ format: 'date-time' }) startedAt: string;
}

export class SystemStatusDto {
  @ApiProperty({ format: 'date-time' }) checkedAt: string;
  @ApiProperty({ type: ApiInfoDto }) api: ApiInfoDto;
  @ApiProperty({ type: DatabaseHealthDto }) database: DatabaseHealthDto;
  @ApiProperty({ type: StorageHealthDto }) storage: StorageHealthDto;
  @ApiProperty({ type: [JobStatusDto] }) jobs: JobStatusDto[];
  @ApiProperty({ type: [RecentErrorDto], description: 'Last 50 server errors since this process started' }) recentErrors: RecentErrorDto[];
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) settingsUpdatedAt: string | null;
}
