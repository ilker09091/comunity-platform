import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PostVisibilityEnum } from '../../posts/dto/post.dto.js';
import { ReportReasonEnum } from '../../reports/dto/report.dto.js';

export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export const SUPPORTED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;

export class GeneralSettingsDto {
  @ApiProperty({ example: 'Circle', minLength: 1, maxLength: 60 })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  platformName: string;

  @ApiProperty({ example: 'A little more connection.', maxLength: 300 })
  @IsString()
  @MaxLength(300)
  description: string;

  @ApiProperty({ example: 'support@example.com', description: 'Public contact address ("" for none)' })
  @IsString()
  @MaxLength(200)
  @ValidateIf((_, v) => v !== '')
  @IsEmail({}, { message: 'supportEmail must be a valid email address or empty' })
  supportEmail: string;

  @ApiProperty({ example: '', maxLength: 300, description: 'Banner shown to everyone while not empty' })
  @IsString()
  @MaxLength(300)
  maintenanceMessage: string;

  @ApiProperty({
    example: false,
    description: 'Read-only mode: ordinary users cannot create or change content. Staff and sign-in are never blocked.',
  })
  @IsBoolean()
  readOnlyMode: boolean;
}

export class FeatureFlagsDto {
  @ApiProperty({ description: 'New account registration' }) @IsBoolean() registration: boolean;
  @ApiProperty({ description: 'Creating posts and quote posts' }) @IsBoolean() postCreation: boolean;
  @ApiProperty({ description: 'Image uploads (post attachments, avatars, covers)' }) @IsBoolean() imageUploads: boolean;
  @ApiProperty({ description: 'Video uploads' }) @IsBoolean() videoUploads: boolean;
  @ApiProperty({ description: 'Reels feed and page' }) @IsBoolean() reels: boolean;
  @ApiProperty({ description: 'Writing comments and replies' }) @IsBoolean() comments: boolean;
  @ApiProperty({ description: 'Simple reposts and quote posts' }) @IsBoolean() reposts: boolean;
  @ApiProperty({ description: 'User and post search' }) @IsBoolean() search: boolean;
  @ApiProperty({ description: 'Submitting reports' }) @IsBoolean() reporting: boolean;
}

export class PostSettingsDto {
  @ApiProperty({ example: 5000, minimum: 1, maximum: 10000 })
  @IsInt()
  @Min(1)
  @Max(10000)
  maxLength: number;

  @ApiProperty({ example: 4, minimum: 1, maximum: 10 })
  @IsInt()
  @Min(1)
  @Max(10)
  maxMedia: number;

  @ApiProperty({ enum: PostVisibilityEnum, enumName: 'PostVisibility', description: 'Used when a client omits visibility' })
  @IsEnum(PostVisibilityEnum)
  defaultVisibility: PostVisibilityEnum;
}

export class MediaSettingsDto {
  @ApiProperty({ example: 10, minimum: 1, description: 'MB; cannot exceed the server hard limit (MEDIA_MAX_IMAGE_BYTES)' })
  @IsInt()
  @Min(1)
  maxImageMb: number;

  @ApiProperty({ example: 100, minimum: 1, description: 'MB; cannot exceed the server hard limit (MEDIA_MAX_VIDEO_BYTES)' })
  @IsInt()
  @Min(1)
  maxVideoMb: number;

  @ApiProperty({ isArray: true, enum: SUPPORTED_IMAGE_TYPES, example: [...SUPPORTED_IMAGE_TYPES] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn([...SUPPORTED_IMAGE_TYPES], { each: true })
  allowedImageTypes: string[];

  @ApiProperty({ isArray: true, enum: SUPPORTED_VIDEO_TYPES, example: [...SUPPORTED_VIDEO_TYPES] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn([...SUPPORTED_VIDEO_TYPES], { each: true })
  allowedVideoTypes: string[];
}

export class CommentSettingsDto {
  @ApiProperty({ example: 2000, minimum: 1, maximum: 10000 })
  @IsInt()
  @Min(1)
  @Max(10000)
  maxLength: number;

  @ApiProperty({ example: 6, minimum: 1, maximum: 20, description: 'Maximum thread depth (1 = no replies)' })
  @IsInt()
  @Min(1)
  @Max(20)
  maxDepth: number;
}

export class ModerationSettingsDto {
  @ApiProperty({ enum: ReportReasonEnum, enumName: 'ReportReason', isArray: true, description: 'Reasons users may choose' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(ReportReasonEnum, { each: true })
  allowedReportReasons: ReportReasonEnum[];
}

export class PlatformSettingsDto {
  @ApiProperty({ type: GeneralSettingsDto }) general: GeneralSettingsDto;
  @ApiProperty({ type: FeatureFlagsDto }) features: FeatureFlagsDto;
  @ApiProperty({ type: PostSettingsDto }) posts: PostSettingsDto;
  @ApiProperty({ type: MediaSettingsDto }) media: MediaSettingsDto;
  @ApiProperty({ type: CommentSettingsDto }) comments: CommentSettingsDto;
  @ApiProperty({ type: ModerationSettingsDto }) moderation: ModerationSettingsDto;
}

/** Full-section replacement; omitted sections are left unchanged. */
export class UpdatePlatformSettingsDto {
  @ApiPropertyOptional({ type: GeneralSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => GeneralSettingsDto)
  general?: GeneralSettingsDto;

  @ApiPropertyOptional({ type: FeatureFlagsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => FeatureFlagsDto)
  features?: FeatureFlagsDto;

  @ApiPropertyOptional({ type: PostSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PostSettingsDto)
  posts?: PostSettingsDto;

  @ApiPropertyOptional({ type: MediaSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => MediaSettingsDto)
  media?: MediaSettingsDto;

  @ApiPropertyOptional({ type: CommentSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CommentSettingsDto)
  comments?: CommentSettingsDto;

  @ApiPropertyOptional({ type: ModerationSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ModerationSettingsDto)
  moderation?: ModerationSettingsDto;
}

export class SettingsLimitsDto {
  @ApiProperty({ example: 10, description: 'Server hard limit for images (MB), from environment' }) maxImageMb: number;
  @ApiProperty({ example: 100, description: 'Server hard limit for videos (MB), from environment' }) maxVideoMb: number;
}

export class AdminSettingsResponseDto {
  @ApiProperty({ type: PlatformSettingsDto }) settings: PlatformSettingsDto;
  @ApiProperty({ type: SettingsLimitsDto }) limits: SettingsLimitsDto;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'jane_admin' }) updatedBy: string | null;
}

/** Public, unauthenticated runtime configuration consumed by clients. */
export class PublicPlatformConfigDto {
  @ApiProperty({ example: 'Circle' }) platformName: string;
  @ApiProperty() description: string;
  @ApiProperty({ example: '' }) supportEmail: string;
  @ApiProperty({ example: '', description: 'Show as a banner when not empty' }) maintenanceMessage: string;
  @ApiProperty({ example: false }) readOnlyMode: boolean;
  @ApiProperty({ type: FeatureFlagsDto }) features: FeatureFlagsDto;
  @ApiProperty({ example: 5000 }) postMaxLength: number;
  @ApiProperty({ example: 4 }) postMaxMedia: number;
  @ApiProperty({ enum: PostVisibilityEnum, enumName: 'PostVisibility' }) defaultVisibility: PostVisibilityEnum;
  @ApiProperty({ example: 2000 }) commentMaxLength: number;
  @ApiProperty({ example: 6 }) commentMaxDepth: number;
  @ApiProperty({ example: 10485760 }) maxImageBytes: number;
  @ApiProperty({ example: 104857600 }) maxVideoBytes: number;
  @ApiProperty({ type: [String], example: [...SUPPORTED_IMAGE_TYPES] }) allowedImageTypes: string[];
  @ApiProperty({ type: [String], example: [...SUPPORTED_VIDEO_TYPES] }) allowedVideoTypes: string[];
  @ApiProperty({ enum: ReportReasonEnum, enumName: 'ReportReason', isArray: true }) allowedReportReasons: ReportReasonEnum[];
}
