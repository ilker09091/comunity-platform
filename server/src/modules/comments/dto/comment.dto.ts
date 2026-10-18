import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { CursorQueryDto } from '../../../common/dto/common.dto.js';
import { sanitizeText } from '../../../common/utils/sanitize.js';
import { UserSummaryDto } from '../../users/dto/user.dto.js';
import { StickerDto } from '../../social/social.dto.js';

export enum CommentStatusEnum {
  ACTIVE = 'ACTIVE',
  DELETED = 'DELETED',
  REMOVED = 'REMOVED',
}

export enum CommentSortEnum {
  NEWEST = 'NEWEST',
  OLDEST = 'OLDEST',
  TOP = 'TOP',
}

export class CommentDto {
  @ApiProperty({ format: 'uuid', example: 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  postId: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  parentId: string | null;

  @ApiProperty({ example: 0, description: '0 for top-level comments' })
  depth: number;

  @ApiProperty({
    enum: CommentStatusEnum,
    enumName: 'CommentStatus',
    example: CommentStatusEnum.ACTIVE,
    description: 'DELETED/REMOVED comments are tombstones kept only to preserve thread structure; author and content are null.',
  })
  status: CommentStatusEnum;

  @ApiProperty({ type: UserSummaryDto, nullable: true })
  author: UserSummaryDto | null;

  @ApiProperty({ type: String, nullable: true, example: 'Great point!' })
  content: string | null;

  @ApiProperty({ type: StickerDto, nullable: true, description: 'Sticker sent with (or as) this comment' })
  sticker: StickerDto | null;

  @ApiProperty({ example: false, description: 'This comment had a sticker that is no longer available' })
  stickerUnavailable: boolean;

  @ApiProperty({ example: 4 })
  likeCount: number;

  @ApiProperty({ example: 2, description: 'Live direct replies' })
  replyCount: number;

  @ApiProperty({ example: true, description: 'Has any direct replies (incl. tombstones) — fetch /comments/{id}/replies' })
  hasReplies: boolean;

  @ApiProperty({ example: false })
  isLiked: boolean;

  @ApiProperty({ example: true, description: 'Replies are allowed (depth limit not reached and comment is active)' })
  canReply: boolean;

  @ApiProperty({ format: 'date-time', example: '2026-10-11T12:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-11T12:00:00.000Z' })
  updatedAt: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  editedAt: string | null;
}

const commentText = () =>
  Transform(({ value }) => (typeof value === 'string' ? sanitizeText(value, { multiline: true }) : value));

export class CreateCommentDto {
  @ApiPropertyOptional({
    example: 'Great point!',
    maxLength: 2000,
    description: 'Plain text. Max COMMENT_MAX_LENGTH (default 2000). Required unless stickerId is set.',
  })
  @IsOptional()
  @commentText()
  @IsString()
  @MaxLength(10000)
  content?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'A built-in sticker or one of your own (GET /stickers)' })
  @IsOptional()
  @IsUUID('all')
  stickerId?: string;
}

export class UpdateCommentDto {
  @ApiProperty({ example: 'Great point!', minLength: 1, maxLength: 2000, description: 'Plain text. Max COMMENT_MAX_LENGTH (default 2000).' })
  @commentText()
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  content: string;
}

export class CommentsQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({ enum: CommentSortEnum, enumName: 'CommentSort', default: CommentSortEnum.NEWEST })
  @IsOptional()
  @IsEnum(CommentSortEnum)
  sort?: CommentSortEnum;
}
