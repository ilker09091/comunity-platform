import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { iso } from '../../common/utils/cursor.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import { MediaUrlService } from '../media/media-url.service.js';
import { MediaService } from '../media/media.service.js';
import { ContentDeletionService } from '../media/content-deletion.service.js';
import {
  MeDto,
  RESERVED_USERNAMES,
  UpdateProfileDto,
  UserListItemDto,
  UserProfileDto,
  UserRoleEnum,
  UserStatusEnum,
  UserSummaryDto,
} from './dto/user.dto.js';

/** Columns needed for `UserSummaryDto`; expects `users u` and `LEFT JOIN media av`. */
export const USER_SUMMARY_COLUMNS = `u.id, u.username::text AS username, u.display_name, u.is_private, av.storage_key AS avatar_key`;
export const USER_AVATAR_JOIN = `LEFT JOIN media av ON av.id = u.avatar_media_id`;

export interface UserSummaryRow {
  id: string;
  username: string;
  display_name: string;
  is_private: boolean;
  avatar_key: string | null;
}

export interface UserListRow extends UserSummaryRow {
  bio: string | null;
  follower_count: number;
  is_following: boolean;
  follows_you: boolean;
}

export interface TargetUser {
  id: string;
  is_private: boolean;
  status: string;
}

export interface Relationship {
  isFollowing: boolean;
  followsYou: boolean;
  isFollowRequested: boolean;
  isBlocking: boolean;
  isBlockedBy: boolean;
}

/** SQL for viewer flags in user lists (`$v` = viewer id, nullable). */
export const userListFlagsSql = (v: string) => `
  u.bio, u.follower_count,
  (${v}::uuid IS NOT NULL AND EXISTS (SELECT 1 FROM follows f1 WHERE f1.follower_id = ${v}::uuid AND f1.following_id = u.id)) AS is_following,
  (${v}::uuid IS NOT NULL AND EXISTS (SELECT 1 FROM follows f2 WHERE f2.follower_id = u.id AND f2.following_id = ${v}::uuid)) AS follows_you`;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly urls: MediaUrlService,
    private readonly media: MediaService,
    private readonly deletion: ContentDeletionService,
  ) {}

  toSummary(row: UserSummaryRow): UserSummaryDto {
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: this.urls.url(row.avatar_key),
      isPrivate: row.is_private,
    };
  }

  toListItem(row: UserListRow): UserListItemDto {
    return {
      ...this.toSummary(row),
      bio: row.bio,
      followerCount: row.follower_count,
      isFollowing: row.is_following,
      followsYou: row.follows_you,
    };
  }

  /** Active, existing user by id (404 otherwise). */
  async getActiveTarget(id: string, db: DataSource | EntityManager = this.db): Promise<TargetUser> {
    const row = await sqlOne<TargetUser>(
      db,
      `SELECT id, is_private, status FROM users WHERE id = $1 AND status = 'ACTIVE'`,
      [id],
    );
    if (!row) throw AppException.notFound(ErrorCode.USER_NOT_FOUND, 'User not found');
    return row;
  }

  async relationship(viewerId: string | null, targetId: string): Promise<Relationship> {
    if (!viewerId || viewerId === targetId) {
      return { isFollowing: false, followsYou: false, isFollowRequested: false, isBlocking: false, isBlockedBy: false };
    }
    const row = await sqlOne<Record<string, boolean>>(
      this.db,
      `SELECT
         EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2) AS is_following,
         EXISTS (SELECT 1 FROM follows WHERE follower_id = $2 AND following_id = $1) AS follows_you,
         EXISTS (SELECT 1 FROM follow_requests WHERE requester_id = $1 AND target_id = $2) AS is_requested,
         EXISTS (SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2) AS is_blocking,
         EXISTS (SELECT 1 FROM blocks WHERE blocker_id = $2 AND blocked_id = $1) AS is_blocked_by`,
      [viewerId, targetId],
    );
    return {
      isFollowing: row!.is_following,
      followsYou: row!.follows_you,
      isFollowRequested: row!.is_requested,
      isBlocking: row!.is_blocking,
      isBlockedBy: row!.is_blocked_by,
    };
  }

  /**
   * Throws unless the viewer may see the target's content (posts, follower lists).
   * Blocked-by → 404 (the account is hidden), private & not following → 403.
   */
  async assertCanViewContent(viewerId: string | null, target: TargetUser): Promise<void> {
    if (viewerId === target.id) return;
    const rel = await this.relationship(viewerId, target.id);
    if (rel.isBlockedBy) throw AppException.notFound(ErrorCode.USER_NOT_FOUND, 'User not found');
    if (rel.isBlocking) throw AppException.forbidden(ErrorCode.BLOCKED, 'You have blocked this user');
    if (target.is_private && !rel.isFollowing) {
      throw AppException.forbidden(ErrorCode.PRIVATE_ACCOUNT, 'This account is private');
    }
  }

  async getMe(userId: string): Promise<MeDto> {
    const row = await sqlOne(
      this.db,
      `SELECT u.*, u.username::text AS username, u.email::text AS email,
              av.storage_key AS avatar_key, cv.storage_key AS cover_key,
              (SELECT count(*)::int FROM follow_requests fr WHERE fr.target_id = u.id) AS pending_requests,
              (SELECT count(*)::int FROM posts p WHERE p.author_id = u.id
                AND p.deleted_at IS NULL AND p.moderation_status = 'ACTIVE') AS actual_post_count
         FROM users u
         LEFT JOIN media av ON av.id = u.avatar_media_id
         LEFT JOIN media cv ON cv.id = u.cover_media_id
        WHERE u.id = $1`,
      [userId],
    );
    if (!row) throw AppException.notFound(ErrorCode.USER_NOT_FOUND, 'User not found');
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      displayName: row.display_name,
      avatarUrl: this.urls.url(row.avatar_key),
      coverUrl: this.urls.url(row.cover_key),
      bio: row.bio,
      location: row.location,
      website: row.website,
      isPrivate: row.is_private,
      role: row.role as UserRoleEnum,
      status: row.status as UserStatusEnum,
      followerCount: row.follower_count,
      followingCount: row.following_count,
      postCount: row.actual_post_count,
      pendingFollowRequestCount: row.pending_requests,
      createdAt: iso(row.created_at)!,
      updatedAt: iso(row.updated_at)!,
    };
  }

  async getProfile(username: string, viewerId: string | null): Promise<UserProfileDto> {
    const row = await sqlOne(
      this.db,
      `SELECT u.*, u.username::text AS username, av.storage_key AS avatar_key, cv.storage_key AS cover_key,
              (SELECT count(*)::int FROM posts p WHERE p.author_id = u.id
                AND p.deleted_at IS NULL AND p.moderation_status = 'ACTIVE') AS actual_post_count
         FROM users u
         LEFT JOIN media av ON av.id = u.avatar_media_id
         LEFT JOIN media cv ON cv.id = u.cover_media_id
        WHERE u.username = $1 AND u.status = 'ACTIVE'`,
      [username],
    );
    if (!row) throw AppException.notFound(ErrorCode.USER_NOT_FOUND, 'User not found');
    const rel = await this.relationship(viewerId, row.id);
    // Users who blocked the viewer are indistinguishable from non-existent accounts.
    if (rel.isBlockedBy) throw AppException.notFound(ErrorCode.USER_NOT_FOUND, 'User not found');
    const isSelf = viewerId === row.id;
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: this.urls.url(row.avatar_key),
      coverUrl: this.urls.url(row.cover_key),
      isPrivate: row.is_private,
      bio: row.bio,
      location: row.location,
      website: row.website,
      followerCount: row.follower_count,
      followingCount: row.following_count,
      postCount: row.actual_post_count,
      createdAt: iso(row.created_at)!,
      isSelf,
      isFollowing: rel.isFollowing,
      followsYou: rel.followsYou,
      isFollowRequested: rel.isFollowRequested,
      isBlocking: rel.isBlocking,
      canViewContent: isSelf || (!rel.isBlocking && (!row.is_private || rel.isFollowing)),
    };
  }

  async updateMe(userId: string, dto: UpdateProfileDto): Promise<MeDto> {
    if (dto.username !== undefined && RESERVED_USERNAMES.has(dto.username.toLowerCase())) {
      throw AppException.conflict(ErrorCode.USERNAME_TAKEN, 'Username is not available');
    }
    await this.db.transaction(async (m) => {
      const sets: string[] = [];
      const params: unknown[] = [userId];
      const set = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.username !== undefined) set('username', dto.username);
      if (dto.displayName !== undefined) set('display_name', dto.displayName);
      if (dto.bio !== undefined) set('bio', dto.bio);
      if (dto.location !== undefined) set('location', dto.location);
      if (dto.website !== undefined) set('website', dto.website);
      if (dto.isPrivate !== undefined) set('is_private', dto.isPrivate);
      if (!sets.length) return;

      try {
        await sqlRows(m, `UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
      } catch (error) {
        if ((error as { driverError?: { constraint?: string } }).driverError?.constraint === 'uq_users_username') {
          throw AppException.conflict(ErrorCode.USERNAME_TAKEN, 'Username is not available');
        }
        throw error;
      }

      if (dto.isPrivate === false) await this.approveAllRequests(m, userId);
    });
    return this.getMe(userId);
  }

  /** Converting to a public account approves every pending follow request atomically. */
  private async approveAllRequests(m: EntityManager, userId: string) {
    const accepted = await sqlRows<{ follower_id: string }>(
      m,
      `WITH moved AS (DELETE FROM follow_requests WHERE target_id = $1 RETURNING requester_id)
       INSERT INTO follows (follower_id, following_id)
       SELECT requester_id, $1 FROM moved
       ON CONFLICT DO NOTHING
       RETURNING follower_id`,
      [userId],
    );
    if (!accepted.length) return;
    await sqlRows(m, `UPDATE users SET follower_count = follower_count + $2 WHERE id = $1`, [userId, accepted.length]);
    await sqlRows(
      m,
      `UPDATE users SET following_count = following_count + 1 WHERE id = ANY($1::uuid[])`,
      [accepted.map((a) => a.follower_id)],
    );
  }

  async setProfileImage(userId: string, kind: 'avatar' | 'cover', file: Express.Multer.File): Promise<MeDto> {
    const uploaded = await this.media.upload(userId, file);
    const files = await this.db.transaction(async (m) => {
      await this.media.lockAttachable(m, userId, [uploaded.id], { imagesOnly: true });
      const column = kind === 'avatar' ? 'avatar_media_id' : 'cover_media_id';
      const previous = await sqlOne<{ id: string | null }>(m, `SELECT ${column} AS id FROM users WHERE id = $1 FOR UPDATE`, [userId]);
      await sqlRows(m, `UPDATE users SET ${column} = $2, updated_at = now() WHERE id = $1`, [userId, uploaded.id]);
      // The previous image is deleted right away (file included) unless something else still uses it.
      return this.deletion.deleteMedia(m, previous?.id ? [previous.id] : []);
    });
    await this.deletion.removeFiles(files);
    this.logger.log({ message: `Profile ${kind} updated`, userId, mediaId: uploaded.id });
    return this.getMe(userId);
  }

  async removeProfileImage(userId: string, kind: 'avatar' | 'cover'): Promise<MeDto> {
    const column = kind === 'avatar' ? 'avatar_media_id' : 'cover_media_id';
    const files = await this.db.transaction(async (m) => {
      const previous = await sqlOne<{ id: string | null }>(m, `SELECT ${column} AS id FROM users WHERE id = $1 FOR UPDATE`, [userId]);
      await sqlRows(m, `UPDATE users SET ${column} = NULL, updated_at = now() WHERE id = $1`, [userId]);
      return this.deletion.deleteMedia(m, previous?.id ? [previous.id] : []);
    });
    await this.deletion.removeFiles(files);
    return this.getMe(userId);
  }
}
