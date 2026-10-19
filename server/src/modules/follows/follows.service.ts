import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import type { Page } from '../../common/dto/common.dto.js';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { decodeCursor, iso, toPage } from '../../common/utils/cursor.js';
import { notBlockedSql, sqlOne, sqlRows } from '../../common/utils/sql.js';
import { NotificationTypeEnum } from '../notifications/dto/notification.dto.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ContentDeletionService } from '../media/content-deletion.service.js';
import { UserListItemDto } from '../users/dto/user.dto.js';
import {
  USER_AVATAR_JOIN,
  USER_SUMMARY_COLUMNS,
  userListFlagsSql,
  UsersService,
} from '../users/users.service.js';
import { BlockedUserDto, FollowRequestDto, FollowResultDto, FollowStatusEnum, SuggestedUserDto } from './dto/follow.dto.js';

@Injectable()
export class FollowsService {
  private readonly logger = new Logger(FollowsService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
    private readonly deletion: ContentDeletionService,
  ) {}

  /** Locks both user rows in a stable order so concurrent graph changes serialise per pair. */
  private async lockPair(m: EntityManager, a: string, b: string) {
    await sqlRows(m, `SELECT id FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [[a, b]]);
  }

  private async isBlockedEitherWay(m: EntityManager, a: string, b: string) {
    const row = await sqlOne<{ blocked_by: boolean; blocking: boolean }>(
      m,
      `SELECT EXISTS (SELECT 1 FROM blocks WHERE blocker_id = $2 AND blocked_id = $1) AS blocked_by,
              EXISTS (SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2) AS blocking`,
      [a, b],
    );
    return row!;
  }

  private async followerCount(m: EntityManager, userId: string): Promise<number> {
    return (await sqlOne<{ c: number }>(m, `SELECT follower_count AS c FROM users WHERE id = $1`, [userId]))!.c;
  }

  async follow(viewerId: string, targetId: string): Promise<FollowResultDto> {
    if (viewerId === targetId) throw AppException.badRequest(ErrorCode.CANNOT_FOLLOW_SELF, 'You cannot follow yourself');
    return this.db.transaction(async (m) => {
      const target = await this.users.getActiveTarget(targetId, m);
      await this.lockPair(m, viewerId, targetId);
      const block = await this.isBlockedEitherWay(m, viewerId, targetId);
      if (block.blocked_by) throw AppException.notFound(ErrorCode.USER_NOT_FOUND, 'User not found');
      if (block.blocking) throw AppException.forbidden(ErrorCode.BLOCKED, 'Unblock this user before following');

      const existing = await sqlOne(m, `SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2`, [viewerId, targetId]);
      if (existing) return { status: FollowStatusEnum.FOLLOWING, followerCount: await this.followerCount(m, targetId) };

      if (target.is_private) {
        const inserted = await sqlRows(
          m,
          `INSERT INTO follow_requests (requester_id, target_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1`,
          [viewerId, targetId],
        );
        if (inserted.length) {
          // A fresh request replaces any earlier (e.g. previously accepted) request notification.
          await this.notifications.removeFollowRequest(m, viewerId, targetId);
          await this.notifications.notify(m, { type: NotificationTypeEnum.FOLLOW_REQUEST, recipientId: targetId, actorId: viewerId });
        }
        return { status: FollowStatusEnum.REQUESTED, followerCount: await this.followerCount(m, targetId) };
      }

      await this.insertFollow(m, viewerId, targetId);
      await this.notifications.notify(m, { type: NotificationTypeEnum.NEW_FOLLOWER, recipientId: targetId, actorId: viewerId });
      return { status: FollowStatusEnum.FOLLOWING, followerCount: await this.followerCount(m, targetId) };
    });
  }

  private async insertFollow(m: EntityManager, followerId: string, followingId: string): Promise<boolean> {
    const inserted = await sqlRows(
      m,
      `INSERT INTO follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1`,
      [followerId, followingId],
    );
    if (!inserted.length) return false;
    await sqlRows(m, `UPDATE users SET following_count = following_count + 1 WHERE id = $1`, [followerId]);
    await sqlRows(m, `UPDATE users SET follower_count = follower_count + 1 WHERE id = $1`, [followingId]);
    return true;
  }

  private async deleteFollow(m: EntityManager, followerId: string, followingId: string): Promise<boolean> {
    const deleted = await sqlRows(
      m,
      `DELETE FROM follows WHERE follower_id = $1 AND following_id = $2 RETURNING 1`,
      [followerId, followingId],
    );
    if (!deleted.length) return false;
    await sqlRows(m, `UPDATE users SET following_count = GREATEST(following_count - 1, 0) WHERE id = $1`, [followerId]);
    await sqlRows(m, `UPDATE users SET follower_count = GREATEST(follower_count - 1, 0) WHERE id = $1`, [followingId]);
    return true;
  }

  /** Unfollows or cancels a pending follow request. Idempotent. */
  async unfollow(viewerId: string, targetId: string): Promise<FollowResultDto> {
    if (viewerId === targetId) throw AppException.badRequest(ErrorCode.CANNOT_FOLLOW_SELF, 'You cannot follow yourself');
    return this.db.transaction(async (m) => {
      const exists = await sqlOne(m, `SELECT 1 FROM users WHERE id = $1`, [targetId]);
      if (!exists) throw AppException.notFound(ErrorCode.USER_NOT_FOUND, 'User not found');
      await this.lockPair(m, viewerId, targetId);
      await this.deleteFollow(m, viewerId, targetId);
      await sqlRows(m, `DELETE FROM follow_requests WHERE requester_id = $1 AND target_id = $2`, [viewerId, targetId]);
      await this.notifications.removeFollowRequest(m, viewerId, targetId);
      return { status: FollowStatusEnum.NONE, followerCount: await this.followerCount(m, targetId) };
    });
  }

  /** Removes someone from the caller's followers (useful for private accounts). Idempotent. */
  async removeFollower(userId: string, followerId: string): Promise<void> {
    await this.db.transaction(async (m) => {
      await this.lockPair(m, userId, followerId);
      await this.deleteFollow(m, followerId, userId);
    });
  }

  async acceptRequest(userId: string, requesterId: string): Promise<void> {
    await this.db.transaction(async (m) => {
      await this.lockPair(m, userId, requesterId);
      const removed = await sqlRows(
        m,
        `DELETE FROM follow_requests WHERE requester_id = $1 AND target_id = $2 RETURNING 1`,
        [requesterId, userId],
      );
      if (!removed.length) throw AppException.notFound(ErrorCode.NOT_FOUND, 'Follow request not found');
      // The FOLLOW_REQUEST notification is kept as history; its followRequestStatus becomes ACCEPTED.
      const requester = await sqlOne(m, `SELECT 1 FROM users WHERE id = $1 AND status = 'ACTIVE'`, [requesterId]);
      if (!requester) return;
      if (await this.insertFollow(m, requesterId, userId)) {
        await this.notifications.notify(m, { type: NotificationTypeEnum.FOLLOW_ACCEPTED, recipientId: requesterId, actorId: userId });
      }
    });
  }

  async rejectRequest(userId: string, requesterId: string): Promise<void> {
    await this.db.transaction(async (m) => {
      await sqlRows(m, `DELETE FROM follow_requests WHERE requester_id = $1 AND target_id = $2`, [requesterId, userId]);
      await this.notifications.removeFollowRequest(m, requesterId, userId);
    });
  }

  async listRequests(userId: string, cursorStr: string | undefined, limit: number): Promise<Page<FollowRequestDto>> {
    const cursor = decodeCursor(cursorStr, ['date', 'uuid']);
    const rows = await sqlRows(
      this.db,
      `SELECT ${USER_SUMMARY_COLUMNS}, fr.created_at AS requested_at
         FROM follow_requests fr
         JOIN users u ON u.id = fr.requester_id AND u.status = 'ACTIVE'
         ${USER_AVATAR_JOIN}
        WHERE fr.target_id = $1
          ${cursor ? 'AND (fr.created_at, fr.requester_id) < ($3::timestamptz, $4::uuid)' : ''}
        ORDER BY fr.created_at DESC, fr.requester_id DESC
        LIMIT $2`,
      cursor ? [userId, limit + 1, ...cursor] : [userId, limit + 1],
    );
    return toPage(
      rows,
      limit,
      (r) => ({ user: this.users.toSummary(r as never), requestedAt: iso(r.requested_at)! }),
      (r) => [iso(r.requested_at)!, r.id],
    );
  }

  async listFollows(
    direction: 'followers' | 'following',
    targetId: string,
    viewerId: string | null,
    cursorStr: string | undefined,
    limit: number,
  ): Promise<Page<UserListItemDto>> {
    const target = await this.users.getActiveTarget(targetId);
    await this.users.assertCanViewContent(viewerId, target);
    const cursor = decodeCursor(cursorStr, ['date', 'uuid']);
    // followers: rows where following_id = target, list follower_id; following: the reverse.
    const [anchor, listed] = direction === 'followers' ? ['following_id', 'follower_id'] : ['follower_id', 'following_id'];
    const rows = await sqlRows(
      this.db,
      `SELECT ${USER_SUMMARY_COLUMNS}, ${userListFlagsSql('$3')}, f.created_at AS followed_at
         FROM follows f
         JOIN users u ON u.id = f.${listed} AND u.status = 'ACTIVE'
         ${USER_AVATAR_JOIN}
        WHERE f.${anchor} = $1
          AND ${notBlockedSql('u.id', '$3')}
          ${cursor ? `AND (f.created_at, f.${listed}) < ($4::timestamptz, $5::uuid)` : ''}
        ORDER BY f.created_at DESC, f.${listed} DESC
        LIMIT $2`,
      cursor ? [targetId, limit + 1, viewerId, ...cursor] : [targetId, limit + 1, viewerId],
    );
    return toPage(rows, limit, (r) => this.users.toListItem(r as never), (r) => [iso(r.followed_at)!, r.id]);
  }

  /**
   * Accounts worth following: active, not the viewer, not already followed or requested, and
   * no block in either direction. Ranked by mutual connections (people the viewer follows who
   * follow them), then accounts that follow the viewer, then popularity and recency.
   */
  async suggestions(viewerId: string, limit: number): Promise<SuggestedUserDto[]> {
    const rows = await sqlRows(
      this.db,
      `SELECT ${USER_SUMMARY_COLUMNS}, ${userListFlagsSql('$1')},
              (SELECT count(*)::int FROM follows mine
                 JOIN follows theirs ON theirs.follower_id = mine.following_id
                WHERE mine.follower_id = $1 AND theirs.following_id = u.id) AS mutual_count
         FROM users u
         ${USER_AVATAR_JOIN}
        WHERE u.status = 'ACTIVE' AND u.id <> $1
          AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.following_id = u.id)
          AND NOT EXISTS (SELECT 1 FROM follow_requests r WHERE r.requester_id = $1 AND r.target_id = u.id)
          AND ${notBlockedSql('u.id', '$1')}
        ORDER BY mutual_count DESC, follows_you DESC, u.follower_count DESC, u.created_at DESC, u.id
        LIMIT $2`,
      [viewerId, limit],
    );
    return rows.map((r) => ({ ...this.users.toListItem(r as never), mutualFollowerCount: r.mutual_count }));
  }

  async block(userId: string, targetId: string): Promise<void> {
    if (userId === targetId) throw AppException.badRequest(ErrorCode.CANNOT_BLOCK_SELF, 'You cannot block yourself');
    await this.db.transaction(async (m) => {
      const exists = await sqlOne(m, `SELECT 1 FROM users WHERE id = $1`, [targetId]);
      if (!exists) throw AppException.notFound(ErrorCode.USER_NOT_FOUND, 'User not found');
      await this.lockPair(m, userId, targetId);
      await sqlRows(m, `INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userId, targetId]);
      await sqlRows(m, `UPDATE calls SET state='ended',ended_at=now(),end_reason='unavailable' WHERE state<>'ended'
        AND ((caller_id=$1 AND callee_id=$2) OR (caller_id=$2 AND callee_id=$1))`, [userId, targetId]);
      await sqlRows(m, `DELETE FROM typing_status WHERE (user_id=$1 AND peer_id=$2) OR (user_id=$2 AND peer_id=$1)`, [userId, targetId]);
      const likes = await sqlRows<{post_id:string}>(m, `DELETE FROM post_likes l USING posts p
        WHERE l.post_id=p.id AND p.author_id=$1 AND l.user_id=$2 RETURNING l.post_id`, [userId, targetId]);
      if (likes.length) await sqlRows(m, `UPDATE posts p SET like_count=(SELECT count(*) FROM post_likes l WHERE l.post_id=p.id)
        WHERE p.id=ANY($1::uuid[])`, [likes.map(l => l.post_id)]);
      const comments = await sqlRows<{id:string}>(m, `SELECT c.id FROM comments c JOIN posts p ON p.id=c.post_id
        WHERE p.author_id=$1 AND c.author_id=$2 AND c.deleted_at IS NULL`, [userId, targetId]);
      await this.deletion.deleteComments(m, comments.map(c => c.id));
      // Blocking severs the relationship in both directions.
      await this.deleteFollow(m, userId, targetId);
      await this.deleteFollow(m, targetId, userId);
      await sqlRows(
        m,
        `DELETE FROM follow_requests WHERE (requester_id = $1 AND target_id = $2) OR (requester_id = $2 AND target_id = $1)`,
        [userId, targetId],
      );
      await this.notifications.removeFollowRequest(m, userId, targetId);
      await this.notifications.removeFollowRequest(m, targetId, userId);
    });
    this.logger.log({ message: 'User blocked', userId, targetId });
  }

  async unblock(userId: string, targetId: string): Promise<void> {
    await sqlRows(this.db, `DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2`, [userId, targetId]);
  }

  async listBlocks(userId: string, cursorStr: string | undefined, limit: number): Promise<Page<BlockedUserDto>> {
    const cursor = decodeCursor(cursorStr, ['date', 'uuid']);
    const rows = await sqlRows(
      this.db,
      `SELECT ${USER_SUMMARY_COLUMNS}, b.created_at AS blocked_at
         FROM blocks b
         JOIN users u ON u.id = b.blocked_id
         ${USER_AVATAR_JOIN}
        WHERE b.blocker_id = $1
          ${cursor ? 'AND (b.created_at, b.blocked_id) < ($3::timestamptz, $4::uuid)' : ''}
        ORDER BY b.created_at DESC, b.blocked_id DESC
        LIMIT $2`,
      cursor ? [userId, limit + 1, ...cursor] : [userId, limit + 1],
    );
    return toPage(
      rows,
      limit,
      (r) => ({ user: this.users.toSummary(r as never), blockedAt: iso(r.blocked_at)! }),
      (r) => [iso(r.blocked_at)!, r.id],
    );
  }
}
