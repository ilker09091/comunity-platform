import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { sanitizeText } from '../../../common/utils/sanitize.js';
import { MediaDto } from '../../media/dto/media.dto.js';
import { UserSummaryDto } from '../../users/dto/user.dto.js';

export enum PostKindEnum {
  POST = 'POST',
  REPOST = 'REPOST',
  QUOTE = 'QUOTE',
}

export enum PostVisibilityEnum {
  PUBLIC = 'PUBLIC',
  FOLLOWERS = 'FOLLOWERS',
}

const multilineText = () =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const clean = sanitizeText(value, { multiline: true });
    return clean === '' ? null : clean;
  });

/** A post without its nested reference (used for the embedded original of reposts/quotes). */
export class ReferencedPostDto {
  @ApiProperty({ format: 'uuid', example: '9b2f3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d' })
  id: string;

  @ApiProperty({
    enum: PostKindEnum,
    enumName: 'PostKind',
    example: PostKindEnum.POST,
    description: 'POST = original, REPOST = simple repost (no content), QUOTE = quote repost',
  })
  kind: PostKindEnum;

  @ApiProperty({ type: UserSummaryDto })
  author: UserSummaryDto;

  @ApiProperty({ type: String, nullable: true, example: 'Hello world 👋' })
  content: string | null;

  @ApiProperty({ type: MediaDto, isArray: true, description: 'Ordered attachments' })
  media: MediaDto[];

  @ApiProperty({ enum: PostVisibilityEnum, enumName: 'PostVisibility', example: PostVisibilityEnum.PUBLIC })
  visibility: PostVisibilityEnum;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null, description: 'Id of the reposted/quoted post' })
  referencedPostId: string | null;

  @ApiProperty({ example: 10 })
  likeCount: number;
  @ApiProperty({ example: 2 })
  commentCount: number;
  @ApiProperty({ example: 1, description: 'Simple reposts' })
  repostCount: number;
  @ApiProperty({ example: 0, description: 'Quote reposts' })
  quoteCount: number;
  @ApiProperty({ example: 3 })
  bookmarkCount: number;

  @ApiProperty({ example: false, description: 'Viewer liked this post (false when anonymous)' })
  isLiked: boolean;
  @ApiProperty({ example: false, description: 'Viewer bookmarked this post' })
  isBookmarked: boolean;
  @ApiProperty({ example: false, description: 'Viewer has a simple repost of this post' })
  isReposted: boolean;
  @ApiProperty({ example: false, description: 'Viewer follows the author (false for own posts)' })
  isFollowingAuthor: boolean;

  @ApiProperty({ format: 'date-time', example: '2026-10-11T12:00:00.000Z' })
  createdAt: string;
  @ApiProperty({ format: 'date-time', example: '2026-10-11T12:00:00.000Z' })
  updatedAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  editedAt: string | null;

  @ApiProperty({ example: false, description: 'Pinned by an administrator to the top of the home feed' })
  isPinned: boolean;
}

/**
 * Feed/post item. For `kind = REPOST` render `referencedPost` attributed to `author` as the
 * reposter (engagement flags/counters of interest live on `referencedPost`).
 * For `kind = QUOTE` render `content` + embedded `referencedPost`.
 */
export class PostDto extends ReferencedPostDto {
  @ApiProperty({
    type: ReferencedPostDto,
    nullable: true,
    description: 'Embedded original for REPOST/QUOTE (one level deep). null for POST or when unavailable.',
  })
  referencedPost: ReferencedPostDto | null;

  @ApiProperty({
    example: false,
    description: 'true when this is a REPOST/QUOTE whose original was deleted, removed or is not visible to the viewer',
  })
  referencedPostUnavailable: boolean;
}

export class CreatePostDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'Hello world 👋',
    maxLength: 5000,
    description: 'Plain text (render as text, never HTML). Required unless mediaIds is non-empty. Max POST_MAX_LENGTH (default 5000).',
  })
  @IsOptional()
  @multilineText()
  @IsString()
  @MaxLength(10000)
  content?: string | null;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    example: ['0b6f3c9e-2c1f-4f43-9d0e-6f1d5b2f8a11'],
    description: 'Uploaded media ids (POST /media) in display order. Max POST_MAX_MEDIA (default 4).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  mediaIds?: string[];

  @ApiPropertyOptional({ enum: PostVisibilityEnum, enumName: 'PostVisibility', default: PostVisibilityEnum.PUBLIC })
  @IsOptional()
  @IsEnum(PostVisibilityEnum)
  visibility?: PostVisibilityEnum;
}

export class UpdatePostDto {
  @ApiPropertyOptional({ type: String, nullable: true, example: 'Edited text', description: 'Omit to keep; null/"" to clear (only if media remains)' })
  @IsOptional()
  @multilineText()
  @IsString()
  @MaxLength(10000)
  content?: string | null;

  @ApiPropertyOptional({ type: [String], format: 'uuid', description: 'Full replacement of attachments, in order. Omit to keep.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  mediaIds?: string[];

  @ApiPropertyOptional({ enum: PostVisibilityEnum, enumName: 'PostVisibility' })
  @IsOptional()
  @IsEnum(PostVisibilityEnum)
  visibility?: PostVisibilityEnum;
}

export class EngagementSummaryDto {
  @ApiProperty({ format: 'uuid' })
  postId: string;
  @ApiProperty({ example: 10 })
  likeCount: number;
  @ApiProperty({ example: 2 })
  commentCount: number;
  @ApiProperty({ example: 1 })
  repostCount: number;
  @ApiProperty({ example: 0 })
  quoteCount: number;
  @ApiProperty({ example: 3 })
  bookmarkCount: number;
  @ApiProperty({ example: false })
  isLiked: boolean;
  @ApiProperty({ example: false })
  isBookmarked: boolean;
  @ApiProperty({ example: false })
  isReposted: boolean;
}
