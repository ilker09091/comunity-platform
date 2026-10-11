import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import type { Page } from '../../common/dto/common.dto.js';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { CursorShape, decodeCursor, iso, toPage } from '../../common/utils/cursor.js';
import { notBlockedSql, sqlOne, sqlRows } from '../../common/utils/sql.js';
import { NotificationTypeEnum } from '../notifications/dto/notification.dto.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ContentDeletionService } from '../media/content-deletion.service.js';
import { PlatformSettingsService } from '../platform/platform-settings.service.js';
import { PostsQueryService } from '../posts/posts-query.service.js';
import { UsersService } from '../users/users.service.js';
import { CommentDto, CommentSortEnum, CommentStatusEnum } from './dto/comment.dto.js';

export interface InteractableComment {
  id: string;
  post_id: string;
  author_id: string;
  parent_id: string | null;
  depth: number;
}

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly posts: PostsQueryService,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
    private readonly settings: PlatformSettingsService,
    private readonly deletion: ContentDeletionService,
  ) {}

  private async maxDepth() {
    return (await this.settings.get()).comments.maxDepth;
  }

  private selectSql(where: string, order: string) {
    // $1 = viewer (nullable). Tombstones (deleted/removed) are only listed when they have
    // children, so threads never break while empty deleted comments disappear.
    return `
      SELECT c.*, u.username::text AS username, u.display_name, u.is_private, av.storage_key AS avatar_key,
             EXISTS (SELECT 1 FROM comments ch WHERE ch.parent_id = c.id) AS has_replies,
             ($1::uuid IS NOT NULL AND EXISTS (
               SELECT 1 FROM comment_likes cl WHERE cl.comment_id = c.id AND cl.user_id = $1::uuid)) AS is_liked
        FROM comments c
        JOIN users u ON u.id = c.author_id AND u.status = 'ACTIVE'
        LEFT JOIN media av ON av.id = u.avatar_media_id
       WHERE ${where}
         AND ${notBlockedSql('c.author_id', '$1')}
         AND ((c.deleted_at IS NULL AND c.moderation_status = 'ACTIVE')
              OR EXISTS (SELECT 1 FROM comments ch2 WHERE ch2.parent_id = c.id))
       ${order}`;
  }

  private toDto(r: Record<string, any>, maxDepth: number): CommentDto {
    const status = r.deleted_at
      ? CommentStatusEnum.DELETED
      : r.moderation_status !== 'ACTIVE'
        ? CommentStatusEnum.REMOVED
        : CommentStatusEnum.ACTIVE;
    const live = status === CommentStatusEnum.ACTIVE;
    return {
      id: r.id,
      postId: r.post_id,
      parentId: r.parent_id,
      depth: r.depth,
      status,
      author: live
        ? this.users.toSummary({
            id: r.author_id,
            username: r.username,
            display_name: r.display_name,
            is_private: r.is_private,
            avatar_key: r.avatar_key,
          })
        : null,
      content: live ? r.content : null,
      likeCount: r.like_count,
      replyCount: r.reply_count,
      hasReplies: r.has_replies,
      isLiked: live ? r.is_liked : false,
      canReply: live && r.depth + 1 < maxDepth,
      createdAt: iso(r.created_at)!,
      updatedAt: iso(r.updated_at)!,
      editedAt: iso(r.edited_at),
    };
  }

  private async loadOne(commentId: string, viewerId: string | null): Promise<CommentDto> {
    const row = await sqlOne(this.db, this.selectSql('c.id = $2', ''), [viewerId, commentId]);
    if (!row) throw AppException.notFound(ErrorCode.COMMENT_NOT_FOUND, 'Comment not found');
    return this.toDto(row, await this.maxDepth());
  }

  /** Comment the viewer may read: its post must be visible to the viewer. */
  async get(commentId: string, viewerId: string | null): Promise<CommentDto> {
    const base = await sqlOne<{ post_id: string }>(this.db, `SELECT post_id FROM comments WHERE id = $1`, [commentId]);
    if (!base) throw AppException.notFound(ErrorCode.COMMENT_NOT_FOUND, 'Comment not found');
    await this.posts.getVisible(base.post_id, viewerId);
    return this.loadOne(commentId, viewerId);
  }

  /**
   * Live comment the viewer may interact with (reply, like): visible post, active comment,
   * active author and no block in either direction.
   */
  async getInteractable(commentId: string, viewerId: string, m: DataSource | EntityManager = this.db, lock = false): Promise<InteractableComment> {
    const row = await sqlOne<InteractableComment>(
      m,
      `SELECT c.id, c.post_id, c.author_id, c.parent_id, c.depth
         FROM comments c JOIN users u ON u.id = c.author_id AND u.status = 'ACTIVE'
        WHERE c.id = $1 AND c.deleted_at IS NULL AND c.moderation_status = 'ACTIVE'
          AND ${notBlockedSql('c.author_id', '$2')}
        ${lock ? 'FOR UPDATE OF c' : ''}`,
      [commentId, viewerId],
    );
    if (!row) throw AppException.notFound(ErrorCode.COMMENT_NOT_FOUND, 'Comment not found');
    await this.posts.getVisible(row.post_id, viewerId, m);
    return row;
  }

  private async assertLength(content: string) {
    const max = (await this.settings.get()).comments.maxLength;
    if (content.length > max) {
      throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Validation failed', [
        { field: 'content', message: `content must be at most ${max} characters` },
      ]);
    }
  }

  async create(viewerId: string, postId: string, content: string, parentId: string | null): Promise<CommentDto> {
    await this.settings.assertFeature('comments');
    await this.assertLength(content);
    const maxDepth = await this.maxDepth();
    const id = await this.db.transaction(async (m) => {
      let targetPostId: string;
      let postAuthorId: string;
      let parent: InteractableComment | null = null;

      if (parentId) {
        parent = await this.getInteractable(parentId, viewerId, m, true);
        if (parent.depth + 1 >= maxDepth) {
          throw AppException.unprocessable(ErrorCode.MAX_DEPTH_EXCEEDED, 'Maximum reply depth reached');
        }
        const post = await this.posts.getVisible(parent.post_id, viewerId, m);
        targetPostId = post.id;
        postAuthorId = post.author_id;
      } else {
        const post = await this.posts.getInteractionTarget(postId, viewerId, m);
        targetPostId = post.id;
        postAuthorId = post.author_id;
      }

      const row = await sqlOne<{ id: string }>(
        m,
        `INSERT INTO comments (post_id, author_id, parent_id, depth, content)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [targetPostId, viewerId, parent?.id ?? null, parent ? parent.depth + 1 : 0, content],
      );
      await sqlRows(m, `UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1`, [targetPostId]);
      if (parent) {
        await sqlRows(m, `UPDATE comments SET reply_count = reply_count + 1 WHERE id = $1`, [parent.id]);
        await this.notifications.notify(m, {
          type: NotificationTypeEnum.COMMENT_REPLY,
          recipientId: parent.author_id,
          actorId: viewerId,
          postId: targetPostId,
          commentId: row!.id,
        });
      }
      if (!parent || parent.author_id !== postAuthorId) {
        await this.notifications.notify(m, {
          type: NotificationTypeEnum.COMMENT,
          recipientId: postAuthorId,
          actorId: viewerId,
          postId: targetPostId,
          commentId: row!.id,
        });
      }
      return row!.id;
    });
    this.logger.log({ message: 'Comment created', commentId: id, parentId, authorId: viewerId });
    return this.loadOne(id, viewerId);
  }

  async update(viewerId: string, commentId: string, content: string): Promise<CommentDto> {
    await this.assertLength(content);
    await this.db.transaction(async (m) => {
      const row = await sqlOne<{ author_id: string; content: string }>(
        m,
        `SELECT author_id, content FROM comments
          WHERE id = $1 AND deleted_at IS NULL AND moderation_status = 'ACTIVE' FOR UPDATE`,
        [commentId],
      );
      if (!row) throw AppException.notFound(ErrorCode.COMMENT_NOT_FOUND, 'Comment not found');
      if (row.author_id !== viewerId) throw AppException.forbidden(ErrorCode.FORBIDDEN, 'You can only edit your own comments');
      if (row.content === content) return;
      await sqlRows(m, `UPDATE comments SET content = $2, edited_at = now(), updated_at = now() WHERE id = $1`, [commentId, content]);
    });
    return this.loadOne(commentId, viewerId);
  }

  /**
   * Permanent delete by the comment author or the post author. If others replied, an empty
   * placeholder (no text) keeps the thread intact.
   */
  async remove(viewerId: string, commentId: string): Promise<void> {
    await this.db.transaction(async (m) => {
      const row = await sqlOne<{ author_id: string; post_id: string; parent_id: string | null; post_author_id: string }>(
        m,
        `SELECT c.author_id, c.post_id, c.parent_id, p.author_id AS post_author_id
           FROM comments c JOIN posts p ON p.id = c.post_id
          WHERE c.id = $1 AND c.deleted_at IS NULL FOR UPDATE OF c`,
        [commentId],
      );
      if (!row) throw AppException.notFound(ErrorCode.COMMENT_NOT_FOUND, 'Comment not found');
      if (row.author_id !== viewerId && row.post_author_id !== viewerId) {
        throw AppException.forbidden(ErrorCode.FORBIDDEN, 'You cannot delete this comment');
      }
      await this.deletion.deleteComments(m, [commentId]);
    });
  }

  async listForPost(
    postId: string,
    viewerId: string | null,
    cursorStr: string | undefined,
    limit: number,
    sort: CommentSortEnum = CommentSortEnum.NEWEST,
  ): Promise<Page<CommentDto>> {
    const post = await this.posts.getVisible(postId, viewerId);
    const targetId = post.kind === 'REPOST' && post.referenced_post_id
      ? (await this.posts.getVisible(post.referenced_post_id, viewerId)).id
      : post.id;
    const shape: CursorShape = sort === CommentSortEnum.TOP ? ['number', 'date', 'uuid'] : ['date', 'uuid'];
    const cursor = decodeCursor(cursorStr, shape);
    const params: unknown[] = [viewerId, targetId, limit + 1];
    let keyset = '';
    let order: string;
    if (sort === CommentSortEnum.TOP) {
      order = 'ORDER BY c.like_count DESC, c.created_at DESC, c.id DESC';
      if (cursor) {
        params.push(...cursor);
        keyset = `AND (c.like_count, c.created_at, c.id) < ($4::int, $5::timestamptz, $6::uuid)`;
      }
    } else {
      const dir = sort === CommentSortEnum.OLDEST ? 'ASC' : 'DESC';
      const op = sort === CommentSortEnum.OLDEST ? '>' : '<';
      order = `ORDER BY c.created_at ${dir}, c.id ${dir}`;
      if (cursor) {
        params.push(...cursor);
        keyset = `AND (c.created_at, c.id) ${op} ($4::timestamptz, $5::uuid)`;
      }
    }
    const rows = await sqlRows(
      this.db,
      this.selectSql(`c.post_id = $2 AND c.parent_id IS NULL ${keyset}`, `${order} LIMIT $3`),
      params,
    );
    const depth = await this.maxDepth();
    return toPage(rows, limit, (r) => this.toDto(r, depth), (r) =>
      sort === CommentSortEnum.TOP ? [r.like_count, iso(r.created_at)!, r.id] : [iso(r.created_at)!, r.id],
    );
  }

  /** Direct replies of a comment, oldest first (conversation order). */
  async listReplies(commentId: string, viewerId: string | null, cursorStr: string | undefined, limit: number): Promise<Page<CommentDto>> {
    const parent = await sqlOne<{ post_id: string }>(this.db, `SELECT post_id FROM comments WHERE id = $1`, [commentId]);
    if (!parent) throw AppException.notFound(ErrorCode.COMMENT_NOT_FOUND, 'Comment not found');
    await this.posts.getVisible(parent.post_id, viewerId);
    const cursor = decodeCursor(cursorStr, ['date', 'uuid']);
    const rows = await sqlRows(
      this.db,
      this.selectSql(
        `c.parent_id = $2 ${cursor ? 'AND (c.created_at, c.id) > ($4::timestamptz, $5::uuid)' : ''}`,
        'ORDER BY c.created_at ASC, c.id ASC LIMIT $3',
      ),
      cursor ? [viewerId, commentId, limit + 1, ...cursor] : [viewerId, commentId, limit + 1],
    );
    const depth = await this.maxDepth();
    return toPage(rows, limit, (r) => this.toDto(r, depth), (r) => [iso(r.created_at)!, r.id]);
  }
}
