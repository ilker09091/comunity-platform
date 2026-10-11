import { Injectable } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import type { Page } from '../../common/dto/common.dto.js';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { decodeCursor, iso, toPage } from '../../common/utils/cursor.js';
import { notBlockedSql, sqlOne, sqlRows } from '../../common/utils/sql.js';
import { CommentsService } from '../comments/comments.service.js';
import { NotificationTypeEnum } from '../notifications/dto/notification.dto.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PostsQueryService } from '../posts/posts-query.service.js';
import { UserListItemDto } from '../users/dto/user.dto.js';
import { USER_AVATAR_JOIN, USER_SUMMARY_COLUMNS, userListFlagsSql, UsersService } from '../users/users.service.js';

export class LikeResultDto {
  @ApiProperty({ format: 'uuid', description: 'Id of the liked post/comment (a simple repost resolves to its original)' })
  id: string;

  @ApiProperty({ example: true })
  liked: boolean;

  @ApiProperty({ example: 11 })
  likeCount: number;
}

/**
 * Likes are idempotent and concurrency-safe: the composite primary key rejects duplicates and
 * counters change only when INSERT … ON CONFLICT DO NOTHING / DELETE … RETURNING touched a row.
 */
@Injectable()
export class LikesService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly posts: PostsQueryService,
    private readonly comments: CommentsService,
    private readonly notifications: NotificationsService,
    private readonly users: UsersService,
  ) {}

  async likePost(viewerId: string, postId: string): Promise<LikeResultDto> {
    return this.db.transaction(async (m) => {
      const post = await this.posts.getInteractionTarget(postId, viewerId, m);
      const inserted = await sqlRows(
        m,
        `INSERT INTO post_likes (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1`,
        [viewerId, post.id],
      );
      if (inserted.length) {
        await sqlRows(m, `UPDATE posts SET like_count = like_count + 1 WHERE id = $1`, [post.id]);
        await this.notifications.notify(m, {
          type: NotificationTypeEnum.POST_LIKE,
          recipientId: post.author_id,
          actorId: viewerId,
          postId: post.id,
        });
      }
      return { id: post.id, liked: true, likeCount: await this.count(m, 'posts', post.id) };
    });
  }

  async unlikePost(viewerId: string, postId: string): Promise<LikeResultDto> {
    return this.db.transaction(async (m) => {
      const targetId = await this.resolvePostId(m, postId);
      const deleted = await sqlRows(m, `DELETE FROM post_likes WHERE user_id = $1 AND post_id = $2 RETURNING 1`, [viewerId, targetId]);
      if (deleted.length) {
        await sqlRows(m, `UPDATE posts SET like_count = GREATEST(like_count - 1, 0) WHERE id = $1`, [targetId]);
      }
      return { id: targetId, liked: false, likeCount: await this.count(m, 'posts', targetId) };
    });
  }

  async likeComment(viewerId: string, commentId: string): Promise<LikeResultDto> {
    return this.db.transaction(async (m) => {
      const comment = await this.comments.getInteractable(commentId, viewerId, m);
      const inserted = await sqlRows(
        m,
        `INSERT INTO comment_likes (user_id, comment_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1`,
        [viewerId, comment.id],
      );
      if (inserted.length) {
        await sqlRows(m, `UPDATE comments SET like_count = like_count + 1 WHERE id = $1`, [comment.id]);
        await this.notifications.notify(m, {
          type: NotificationTypeEnum.COMMENT_LIKE,
          recipientId: comment.author_id,
          actorId: viewerId,
          postId: comment.post_id,
          commentId: comment.id,
        });
      }
      return { id: comment.id, liked: true, likeCount: await this.count(m, 'comments', comment.id) };
    });
  }

  async unlikeComment(viewerId: string, commentId: string): Promise<LikeResultDto> {
    return this.db.transaction(async (m) => {
      const exists = await sqlOne(m, `SELECT 1 FROM comments WHERE id = $1`, [commentId]);
      if (!exists) throw AppException.notFound(ErrorCode.COMMENT_NOT_FOUND, 'Comment not found');
      const deleted = await sqlRows(m, `DELETE FROM comment_likes WHERE user_id = $1 AND comment_id = $2 RETURNING 1`, [viewerId, commentId]);
      if (deleted.length) {
        await sqlRows(m, `UPDATE comments SET like_count = GREATEST(like_count - 1, 0) WHERE id = $1`, [commentId]);
      }
      return { id: commentId, liked: false, likeCount: await this.count(m, 'comments', commentId) };
    });
  }

  /** Users who liked a post, most recent first. */
  async listPostLikers(postId: string, viewerId: string | null, cursorStr: string | undefined, limit: number): Promise<Page<UserListItemDto>> {
    const post = await this.posts.getVisible(postId, viewerId);
    const targetId = post.kind === 'REPOST' && post.referenced_post_id ? post.referenced_post_id : post.id;
    const cursor = decodeCursor(cursorStr, ['date', 'uuid']);
    const rows = await sqlRows(
      this.db,
      `SELECT ${USER_SUMMARY_COLUMNS}, ${userListFlagsSql('$3')}, l.created_at AS liked_at
         FROM post_likes l
         JOIN users u ON u.id = l.user_id AND u.status = 'ACTIVE'
         ${USER_AVATAR_JOIN}
        WHERE l.post_id = $1 AND ${notBlockedSql('u.id', '$3')}
          ${cursor ? 'AND (l.created_at, l.user_id) < ($4::timestamptz, $5::uuid)' : ''}
        ORDER BY l.created_at DESC, l.user_id DESC
        LIMIT $2`,
      cursor ? [targetId, limit + 1, viewerId, ...cursor] : [targetId, limit + 1, viewerId],
    );
    return toPage(rows, limit, (r) => this.users.toListItem(r as never), (r) => [iso(r.liked_at)!, r.id]);
  }

  private async resolvePostId(m: EntityManager, postId: string): Promise<string> {
    const row = await sqlOne<{ id: string; kind: string; referenced_post_id: string | null }>(
      m,
      `SELECT id, kind, referenced_post_id FROM posts WHERE id = $1`,
      [postId],
    );
    if (!row) throw AppException.notFound(ErrorCode.POST_NOT_FOUND, 'Post not found');
    return row.kind === 'REPOST' && row.referenced_post_id ? row.referenced_post_id : row.id;
  }

  private async count(m: EntityManager, table: 'posts' | 'comments', id: string): Promise<number> {
    return (await sqlOne<{ c: number }>(m, `SELECT like_count AS c FROM ${table} WHERE id = $1`, [id]))!.c;
  }
}
