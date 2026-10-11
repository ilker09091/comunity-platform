import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import type { Page } from '../../common/dto/common.dto.js';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { decodeCursor, iso, toPage } from '../../common/utils/cursor.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import { USER_AVATAR_JOIN, USER_SUMMARY_COLUMNS, UsersService } from '../users/users.service.js';
import { NotificationDto, NotificationTypeEnum } from './dto/notification.dto.js';

export interface NotifyInput {
  type: NotificationTypeEnum;
  recipientId: string;
  actorId: string;
  postId?: string | null;
  commentId?: string | null;
}

/** Dedupe key per event: repeated identical events (like→unlike→like) never re-notify. */
function dedupeKey(n: NotifyInput): string {
  switch (n.type) {
    case NotificationTypeEnum.COMMENT:
    case NotificationTypeEnum.COMMENT_REPLY:
      return `${n.type}:${n.commentId}`;
    case NotificationTypeEnum.QUOTE_REPOST:
      return `${n.type}:${n.postId}`;
    case NotificationTypeEnum.POST_LIKE:
    case NotificationTypeEnum.REPOST:
      return `${n.type}:${n.actorId}:${n.postId}`;
    case NotificationTypeEnum.COMMENT_LIKE:
      return `${n.type}:${n.actorId}:${n.commentId}`;
    default:
      return `${n.type}:${n.actorId}`;
  }
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly users: UsersService,
  ) {}

  /**
   * Records a notification inside the caller's transaction. Skips self-notifications and
   * pairs with a block in either direction; duplicates are ignored via the unique dedupe key.
   */
  async notify(manager: EntityManager | DataSource, n: NotifyInput): Promise<void> {
    if (n.recipientId === n.actorId) return;
    await sqlRows(
      manager,
      `INSERT INTO notifications (recipient_id, actor_id, type, post_id, comment_id, dedupe_key)
       SELECT $1, $2, $3, $4, $5, $6
        WHERE NOT EXISTS (
          SELECT 1 FROM blocks
           WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1))
       ON CONFLICT (recipient_id, dedupe_key) DO NOTHING`,
      [n.recipientId, n.actorId, n.type, n.postId ?? null, n.commentId ?? null, dedupeKey(n)],
    );
  }

  /** Removes a pending FOLLOW_REQUEST notification once the request is resolved/cancelled. */
  async removeFollowRequest(manager: EntityManager, requesterId: string, targetId: string) {
    await sqlRows(
      manager,
      `DELETE FROM notifications WHERE recipient_id = $1 AND dedupe_key = $2`,
      [targetId, `${NotificationTypeEnum.FOLLOW_REQUEST}:${requesterId}`],
    );
  }

  async list(userId: string, opts: { cursor?: string; limit: number; unreadOnly?: boolean }): Promise<Page<NotificationDto>> {
    const cursor = decodeCursor(opts.cursor, ['date', 'uuid']);
    const params: unknown[] = [userId, opts.limit + 1];
    let where = '';
    if (cursor) {
      params.push(cursor[0], cursor[1]);
      where += ` AND (n.created_at, n.id) < ($3::timestamptz, $4::uuid)`;
    }
    if (opts.unreadOnly) where += ` AND n.read_at IS NULL`;

    // Notifications from actors that are no longer active or are now blocked are hidden.
    const rows = await sqlRows(
      this.db,
      `SELECT n.id AS notification_id, n.type, n.post_id, n.comment_id, n.read_at, n.created_at,
              ${USER_SUMMARY_COLUMNS},
              CASE
                WHEN n.comment_id IS NOT NULL THEN
                  (SELECT left(c.content, 140) FROM comments c WHERE c.id = n.comment_id AND c.deleted_at IS NULL AND c.moderation_status = 'ACTIVE')
                ELSE
                  (SELECT left(p.content, 140) FROM posts p WHERE p.id = n.post_id AND p.deleted_at IS NULL AND p.moderation_status = 'ACTIVE')
              END AS preview,
              CASE
                WHEN n.type <> 'FOLLOW_REQUEST' THEN NULL
                WHEN EXISTS (SELECT 1 FROM follow_requests fr
                              WHERE fr.requester_id = n.actor_id AND fr.target_id = n.recipient_id) THEN 'PENDING'
                WHEN EXISTS (SELECT 1 FROM follows fo
                              WHERE fo.follower_id = n.actor_id AND fo.following_id = n.recipient_id) THEN 'ACCEPTED'
                ELSE 'UNAVAILABLE'
              END AS follow_request_status,
              (n.post_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM posts p WHERE p.id = n.post_id AND p.deleted_at IS NULL AND p.moderation_status = 'ACTIVE')) AS post_available
         FROM notifications n
         JOIN users u ON u.id = n.actor_id AND u.status = 'ACTIVE'
         ${USER_AVATAR_JOIN}
        WHERE n.recipient_id = $1 ${where}
          AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = $1 AND b.blocked_id = n.actor_id)
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT $2`,
      params,
    );
    return toPage(
      rows,
      opts.limit,
      (r) => ({
        id: r.notification_id,
        type: r.type,
        actor: this.users.toSummary(r as never),
        postId: r.post_available ? r.post_id : null,
        commentId: r.comment_id,
        preview: r.preview,
        followRequestStatus: r.follow_request_status,
        isRead: r.read_at !== null,
        createdAt: iso(r.created_at)!,
      }),
      (r) => [iso(r.created_at)!, r.notification_id],
    );
  }

  async unreadCount(userId: string): Promise<number> {
    const row = await sqlOne<{ count: number }>(
      this.db,
      `SELECT count(*)::int AS count FROM notifications n
         JOIN users u ON u.id = n.actor_id AND u.status = 'ACTIVE'
        WHERE n.recipient_id = $1 AND n.read_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = $1 AND b.blocked_id = n.actor_id)`,
      [userId],
    );
    return row?.count ?? 0;
  }

  async markRead(userId: string, id: string): Promise<void> {
    const rows = await sqlRows(
      this.db,
      `UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND recipient_id = $2 RETURNING id`,
      [id, userId],
    );
    if (!rows.length) throw AppException.notFound(ErrorCode.NOTIFICATION_NOT_FOUND, 'Notification not found');
  }

  async markAllRead(userId: string): Promise<number> {
    const rows = await sqlRows(
      this.db,
      `UPDATE notifications SET read_at = now() WHERE recipient_id = $1 AND read_at IS NULL RETURNING id`,
      [userId],
    );
    this.logger.debug({ message: 'Notifications marked read', userId, count: rows.length });
    return rows.length;
  }
}
