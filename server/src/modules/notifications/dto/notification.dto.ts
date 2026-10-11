import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { CursorQueryDto } from '../../../common/dto/common.dto.js';
import { UserSummaryDto } from '../../users/dto/user.dto.js';

export enum NotificationTypeEnum {
  NEW_FOLLOWER = 'NEW_FOLLOWER',
  FOLLOW_REQUEST = 'FOLLOW_REQUEST',
  FOLLOW_ACCEPTED = 'FOLLOW_ACCEPTED',
  POST_LIKE = 'POST_LIKE',
  COMMENT = 'COMMENT',
  COMMENT_REPLY = 'COMMENT_REPLY',
  COMMENT_LIKE = 'COMMENT_LIKE',
  REPOST = 'REPOST',
  QUOTE_REPOST = 'QUOTE_REPOST',
}

export enum FollowRequestStatusEnum {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  UNAVAILABLE = 'UNAVAILABLE',
}

export class NotificationDto {
  @ApiProperty({ format: 'uuid', example: '6b1f0f1e-8d2a-4b8f-9d3c-1a2b3c4d5e6f' })
  id: string;

  @ApiProperty({ enum: NotificationTypeEnum, enumName: 'NotificationType', example: NotificationTypeEnum.POST_LIKE })
  type: NotificationTypeEnum;

  @ApiProperty({ type: UserSummaryDto })
  actor: UserSummaryDto;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Related post (the liked/commented/reposted post; for QUOTE_REPOST the quote post). null when not applicable or no longer available.',
  })
  postId: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Related comment (COMMENT, COMMENT_REPLY, COMMENT_LIKE)' })
  commentId: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Hello world', description: 'First 140 chars of the related post or comment' })
  preview: string | null;

  @ApiProperty({
    enum: FollowRequestStatusEnum,
    enumName: 'FollowRequestStatus',
    nullable: true,
    example: null,
    description:
      'Only for FOLLOW_REQUEST notifications (null otherwise). PENDING: approve/decline with ' +
      '`POST /users/me/follow-requests/{actor.id}/accept` or `DELETE /users/me/follow-requests/{actor.id}` — ' +
      'the request is identified by the requester (`actor.id`). ACCEPTED: the requester now follows you. ' +
      'UNAVAILABLE: no longer actionable (e.g. the follower was later removed). Declined or cancelled requests ' +
      'remove the notification.',
  })
  followRequestStatus: FollowRequestStatusEnum | null;

  @ApiProperty({ example: false })
  isRead: boolean;

  @ApiProperty({ format: 'date-time', example: '2026-10-11T12:00:00.000Z' })
  createdAt: string;
}

export class NotificationsQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({ example: false, description: 'Only unread notifications' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  unreadOnly?: boolean;
}

export class MarkAllReadResultDto {
  @ApiProperty({ example: 5, description: 'Number of notifications marked as read' })
  updated: number;
}
