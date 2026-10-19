import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
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
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Quote a message from this conversation',
  })
  @IsOptional()
  @IsUUID('all')
  replyToId?: string;
  @ApiPropertyOptional({
    description: 'The attached photo/video can be opened once by the recipient',
  })
  @IsOptional()
  @IsBoolean()
  viewOnce?: boolean;
}
export class MessageReplyRefDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) senderId: string;
  @ApiProperty({
    enum: ['TEXT', 'PHOTO', 'VIDEO', 'POST', 'STORY', 'VIEW_ONCE', 'UNAVAILABLE'],
  })
  kind: 'TEXT' | 'PHOTO' | 'VIDEO' | 'POST' | 'STORY' | 'VIEW_ONCE' | 'UNAVAILABLE';
  @ApiProperty({ type: String, nullable: true, description: 'Up to 140 characters' })
  preview: string | null;
}
export class StoryReplyRefDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'null once the story is gone',
  })
  storyId: string | null;
  @ApiProperty({
    type: MediaDto,
    nullable: true,
    description: 'Story preview while it is still live',
  })
  media: MediaDto | null;
}
export class NoteReplyRefDto {
  @ApiProperty({ description: 'The note text when the reply was sent' }) text: string;
  @ApiProperty({ type: String, nullable: true }) songTitle: string | null;
}
export class DirectMessageDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) senderId: string;
  @ApiProperty({ format: 'uuid' }) recipientId: string;
  @ApiProperty({ type: String, nullable: true }) content: string | null;
  @ApiProperty({
    type: MediaDto,
    nullable: true,
    description: 'Never set for view-once messages; the recipient opens them once',
  })
  media: MediaDto | null;
  @ApiProperty({ type: PostDto, nullable: true }) post: PostDto | null;
  @ApiProperty({ type: MessageReplyRefDto, nullable: true })
  replyTo: MessageReplyRefDto | null;
  @ApiProperty() viewOnce: boolean;
  @ApiProperty({
    type: String,
    nullable: true,
    enum: ['IMAGE', 'VIDEO'],
    description: 'Kind of a view-once attachment while it can still be opened',
  })
  viewOnceType: 'IMAGE' | 'VIDEO' | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  openedAt: string | null;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: "Reached the recipient's device (second tick)",
  })
  deliveredAt: string | null;
  @ApiProperty({
    type: StoryReplyRefDto,
    nullable: true,
    description: 'Set when this message replies to a story',
  })
  storyReply: StoryReplyRefDto | null;
  @ApiProperty({
    type: NoteReplyRefDto,
    nullable: true,
    description: 'Set when this message replies to a note',
  })
  noteReply: NoteReplyRefDto | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) readAt:
    string | null;
}
export class MessageStatusDto {
  @ApiProperty({
    description: 'They sent you a message request you have not accepted',
  })
  isRequest: boolean;
  @ApiProperty({
    description:
      'You sent them a message request; you can write again once they accept',
  })
  awaitingAcceptance: boolean;
  @ApiProperty({ description: 'You can send a message right now' })
  canSend: boolean;
  @ApiProperty({ description: 'They are typing to you right now' })
  peerTyping: boolean;
  @ApiProperty({ description: 'They have the app open right now' })
  peerOnline: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  peerLastActiveAt: string | null;
}
export class ConversationDto {
  @ApiProperty({description:'Visible streak badge from three mutual days; zero if inactive'}) streakDays: number;
  @ApiProperty() streakFading: boolean;
  @ApiProperty({ type: UserSummaryDto }) user: UserSummaryDto;
  @ApiProperty({ type: DirectMessageDto }) lastMessage: DirectMessageDto;
  @ApiProperty() unreadCount: number;
  @ApiProperty({
    description:
      'Message request: you do not follow this user and have never replied',
  })
  isRequest: boolean;
  @ApiProperty({ description: 'They have the app open right now' }) online: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastActiveAt: string | null;
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
  @ApiProperty() isLiked: boolean;
  @ApiProperty({ description: 'Only populated for the author' })
  viewCount: number;
  @ApiProperty({ description: 'Only populated for the author' })
  likeCount: number;
}
export class StoryViewerDto {
  @ApiProperty({ type: UserSummaryDto }) user: UserSummaryDto;
  @ApiProperty({ format: 'date-time' }) viewedAt: string;
  @ApiProperty() liked: boolean;
}
export class StoryReplyDto {
  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @IsString()
  @SanitizedText({ multiline: true })
  @MinLength(1)
  @MaxLength(2000)
  content: string;
}
export class StickerDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Built-in emoji sticker',
  })
  emoji: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Signed image URL of a custom sticker',
  })
  url: string | null;
  @ApiProperty({ description: 'Created by the viewer (can be deleted)' })
  isOwn: boolean;
}
export class CreateStickerDto {
  @ApiProperty({ format: 'uuid', description: 'An uploaded photo' })
  @IsUUID('all')
  mediaId: string;
  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @IsString()
  @SanitizedText()
  @MaxLength(40)
  name?: string;
}

export class NoteDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ type: UserSummaryDto }) author: UserSummaryDto;
  @ApiProperty({ description: 'Up to 60 characters; may be empty when a song is shared' })
  text: string;
  @ApiProperty({ type: String, nullable: true }) songTitle: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Signed URL of the 15 s song clip' })
  audioUrl: string | null;
  @ApiProperty({ type: Number, nullable: true }) audioDurationMs: number | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ format: 'date-time' }) expiresAt: string;
  @ApiProperty() isOwn: boolean;
}
export class CreateNoteDto {
  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @IsString()
  @SanitizedText()
  @MaxLength(60)
  text?: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'From POST /notes/audio' })
  @IsOptional()
  @IsUUID('all')
  audioId?: string;
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @SanitizedText()
  @MaxLength(80)
  songTitle?: string;
}
/** Multipart fields of POST /notes/audio (validated). */
export class NoteAudioFieldsDto {
  @ApiProperty({ minimum: 0, description: 'Where the 15 second clip starts, in milliseconds' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(36_000_000)
  startMs: number;
}
/** OpenAPI shape of POST /notes/audio: the file plus the validated fields. */
export class NoteAudioUploadDto extends NoteAudioFieldsDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'An audio file (MP3, M4A, WAV, OGG...)' })
  file: unknown;
}
export class NoteAudioDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ description: 'Signed URL of the clip, for previewing' }) url: string;
  @ApiProperty() durationMs: number;
}

export class PushSubscriptionDto {
  @ApiProperty({ description: 'PushSubscription.endpoint (https)' })
  @IsString()
  @MaxLength(2048)
  endpoint: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(512) p256dh?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(512) auth?: string;
}
export class PushUnsubscribeDto {
  @ApiProperty() @IsString() @MaxLength(2048) endpoint: string;
}
export class PushKeyDto {
  @ApiProperty({ description: 'VAPID public key (applicationServerKey), base64url' }) publicKey: string;
}
export class PushTestDto {
  @ApiProperty({ description: 'Devices that accepted the test notification' }) delivered: number;
}
