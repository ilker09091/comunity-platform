import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { CursorQueryDto } from '../../common/dto/common.dto.js';
import { SanitizedText } from '../../common/utils/sanitize.js';
import { MediaDto } from '../media/dto/media.dto.js';
import { PostDto } from '../posts/dto/post.dto.js';
import { UserSummaryDto } from '../users/dto/user.dto.js';

export class SendMessageDto {
  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @SanitizedText({ multiline: true })
  content?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  mediaId?: string;
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Share an existing post or Reel',
  })
  @IsOptional()
  @IsUUID('all')
  postId?: string;
}
export class DirectMessageDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) senderId: string;
  @ApiProperty({ format: 'uuid' }) recipientId: string;
  @ApiProperty({ type: String, nullable: true }) content: string | null;
  @ApiProperty({ type: MediaDto, nullable: true }) media: MediaDto | null;
  @ApiProperty({ type: PostDto, nullable: true }) post: PostDto | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) readAt:
    string | null;
}
export class ConversationDto {
  @ApiProperty({ type: UserSummaryDto }) user: UserSummaryDto;
  @ApiProperty({ type: DirectMessageDto }) lastMessage: DirectMessageDto;
  @ApiProperty() unreadCount: number;
  @ApiProperty({
    description:
      'Message request: you do not follow this user and have never replied',
  })
  isRequest: boolean;
}
export class ConversationQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({
    enum: ['primary', 'requests'],
    description: 'Only primary conversations or only message requests',
  })
  @IsOptional()
  @IsIn(['primary', 'requests'])
  folder?: 'primary' | 'requests';
}
export class CreateStoryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Uploaded photo or video. Required unless postId is set',
  })
  @IsOptional()
  @IsUUID('all')
  mediaId?: string;
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Share an existing Reel/video post to your story',
  })
  @IsOptional()
  @IsUUID('all')
  postId?: string;
  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @SanitizedText({ multiline: true })
  caption?: string;
}
export class StoryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ type: UserSummaryDto }) author: UserSummaryDto;
  @ApiProperty({
    type: MediaDto,
    description: 'The uploaded media, or the shared post video',
  })
  media: MediaDto;
  @ApiProperty({
    type: PostDto,
    nullable: true,
    description: 'The shared Reel/video post, if any',
  })
  post: PostDto | null;
  @ApiProperty({ type: String, nullable: true }) caption: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ format: 'date-time' }) expiresAt: string;
  @ApiProperty() isViewed: boolean;
  @ApiProperty({ description: 'Only populated for the author' })
  viewCount: number;
}
