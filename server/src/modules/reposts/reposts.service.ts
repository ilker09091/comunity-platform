import { Injectable, Logger } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import type { Page } from '../../common/dto/common.dto.js';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { decodeCursor, iso, toPage } from '../../common/utils/cursor.js';
import { notBlockedSql, postVisibleSql, sqlOne, sqlRows } from '../../common/utils/sql.js';
import { NotificationTypeEnum } from '../notifications/dto/notification.dto.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PlatformSettingsService } from '../platform/platform-settings.service.js';
import { CreatePostDto, PostDto, PostKindEnum, PostVisibilityEnum } from '../posts/dto/post.dto.js';
import { PostsQueryService, VisiblePost } from '../posts/posts-query.service.js';
import { PostsService } from '../posts/posts.service.js';
import { UserListItemDto } from '../users/dto/user.dto.js';
import { USER_AVATAR_JOIN, USER_SUMMARY_COLUMNS, userListFlagsSql, UsersService } from '../users/users.service.js';

export class RepostResultDto {
  @ApiProperty({ format: 'uuid', description: 'Original post id (reposting a repost targets its original)' })
  postId: string;

  @ApiProperty({ example: true })
  reposted: boolean;

  @ApiProperty({ example: 5 })
  repostCount: number;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: "Id of the viewer's repost row (null after undo)" })
  repostId: string | null;
}

@Injectable()
export class RepostsService {
  private readonly logger = new Logger(RepostsService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly query: PostsQueryService,
    private readonly posts: PostsService,
    private readonly notifications: NotificationsService,
    private readonly users: UsersService,
    private readonly settings: PlatformSettingsService,
  ) {}

  /**
   * Only public posts of public accounts can be reposted/quoted, so a repost never widens
   * an original's audience. Reposts always point at an original (never at another repost),
   * which prevents recursive chains.
   */
  private assertRepostable(post: VisiblePost) {
    if (post.kind === PostKindEnum.REPOST) {
      throw AppException.unprocessable(ErrorCode.POST_NOT_REPOSTABLE, 'This post cannot be reposted');
    }
    if (post.visibility !== 'PUBLIC' || post.author_is_private) {
      throw AppException.unprocessable(ErrorCode.POST_NOT_REPOSTABLE, 'Only public posts can be reposted');
    }
  }

  async repost(viewerId: string, postId: string): Promise<RepostResultDto> {
    await this.settings.assertFeature('reposts');
    return this.db.transaction(async (m) => {
      const original = await this.query.getInteractionTarget(postId, viewerId, m);
      this.assertRepostable(original);
      const inserted = await sqlRows<{ id: string }>(
        m,
        `INSERT INTO posts (author_id, kind, referenced_post_id, visibility)
         VALUES ($1, 'REPOST', $2, 'PUBLIC')
         ON CONFLICT (author_id, referenced_post_id) WHERE kind = 'REPOST' AND deleted_at IS NULL DO NOTHING
         RETURNING id`,
        [viewerId, original.id],
      );
      if (inserted.length) {
        await sqlRows(m, `UPDATE posts SET repost_count = repost_count + 1 WHERE id = $1`, [original.id]);
        // A plain repost is not one of the user's own posts (quotes are, and are counted on creation).
        await this.notifications.notify(m, {
          type: NotificationTypeEnum.REPOST,
          recipientId: original.author_id,
          actorId: viewerId,
          postId: original.id,
        });
      }
      return this.result(m, viewerId, original.id, true);
    });
  }

  async undoRepost(viewerId: string, postId: string): Promise<RepostResultDto> {
    return this.db.transaction(async (m) => {
      const row = await sqlOne<{ id: string; kind: PostKindEnum; referenced_post_id: string | null }>(
        m,
        `SELECT id, kind, referenced_post_id FROM posts WHERE id = $1`,
        [postId],
      );
      if (!row) throw AppException.notFound(ErrorCode.POST_NOT_FOUND, 'Post not found');
      const originalId = row.kind === PostKindEnum.REPOST && row.referenced_post_id ? row.referenced_post_id : row.id;
      const repost = await sqlOne<{ id: string }>(
        m,
        `SELECT id FROM posts WHERE author_id = $1 AND referenced_post_id = $2 AND kind = 'REPOST'
            AND deleted_at IS NULL FOR UPDATE`,
        [viewerId, originalId],
      );
      if (repost) {
        await this.posts.deleteWithin(m, repost.id);
      }
      return this.result(m, viewerId, originalId, false);
    });
  }

  private async result(m: EntityManager, viewerId: string, originalId: string, reposted: boolean): Promise<RepostResultDto> {
    const row = await sqlOne<{ c: number; repost_id: string | null }>(
      m,
      `SELECT repost_count AS c,
              (SELECT r.id FROM posts r WHERE r.author_id = $2 AND r.referenced_post_id = p.id
                  AND r.kind = 'REPOST' AND r.deleted_at IS NULL) AS repost_id
         FROM posts p WHERE p.id = $1`,
      [originalId, viewerId],
    );
    return { postId: originalId, reposted, repostCount: row!.c, repostId: reposted ? row!.repost_id : null };
  }

  async quote(viewerId: string, postId: string, dto: CreatePostDto): Promise<PostDto> {
    const content = dto.content ?? null;
    const mediaIds = dto.mediaIds ?? [];
    await this.settings.assertFeature('reposts');
    await this.settings.assertFeature('postCreation');
    await this.posts.validateBody(content, mediaIds);
    const visibility = dto.visibility ?? (await this.settings.get()).posts.defaultVisibility;
    const id = await this.db.transaction(async (m) => {
      const original = await this.query.getInteractionTarget(postId, viewerId, m);
      this.assertRepostable(original);
      const quoteId = await this.posts.insertPost(m, viewerId, {
        kind: PostKindEnum.QUOTE,
        content,
        mediaIds,
        visibility,
        referencedPostId: original.id,
      });
      await sqlRows(m, `UPDATE posts SET quote_count = quote_count + 1 WHERE id = $1`, [original.id]);
      // Only notify when the original author is guaranteed to be able to see the quote.
      const quoter = await sqlOne<{ is_private: boolean }>(m, `SELECT is_private FROM users WHERE id = $1`, [viewerId]);
      if (visibility === PostVisibilityEnum.PUBLIC && !quoter!.is_private) {
        await this.notifications.notify(m, {
          type: NotificationTypeEnum.QUOTE_REPOST,
          recipientId: original.author_id,
          actorId: viewerId,
          postId: quoteId,
        });
      }
      return quoteId;
    });
    this.logger.log({ message: 'Quote created', postId: id, quotedPostId: postId, authorId: viewerId });
    return this.query.getOne(id, viewerId);
  }

  async listReposters(postId: string, viewerId: string | null, cursorStr: string | undefined, limit: number): Promise<Page<UserListItemDto>> {
    const original = await this.resolveOriginal(postId, viewerId);
    const cursor = decodeCursor(cursorStr, ['date', 'uuid']);
    const rows = await sqlRows(
      this.db,
      `SELECT ${USER_SUMMARY_COLUMNS}, ${userListFlagsSql('$3')}, r.created_at AS reposted_at, r.id AS repost_id
         FROM posts r
         JOIN users u ON u.id = r.author_id AND u.status = 'ACTIVE'
         ${USER_AVATAR_JOIN}
        WHERE r.referenced_post_id = $1 AND r.kind = 'REPOST' AND r.deleted_at IS NULL
          AND r.moderation_status = 'ACTIVE' AND ${notBlockedSql('u.id', '$3')}
          ${cursor ? 'AND (r.created_at, r.id) < ($4::timestamptz, $5::uuid)' : ''}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT $2`,
      cursor ? [original, limit + 1, viewerId, ...cursor] : [original, limit + 1, viewerId],
    );
    return toPage(rows, limit, (r) => this.users.toListItem(r as never), (r) => [iso(r.reposted_at)!, r.repost_id]);
  }

  async listQuotes(postId: string, viewerId: string | null, cursorStr: string | undefined, limit: number): Promise<Page<PostDto>> {
    const original = await this.resolveOriginal(postId, viewerId);
    const cursor = decodeCursor(cursorStr, ['date', 'uuid']);
    const rows = await sqlRows<{ id: string; created_at: Date }>(
      this.db,
      `SELECT p.id, p.created_at FROM posts p JOIN users a ON a.id = p.author_id
        WHERE p.referenced_post_id = $1 AND p.kind = 'QUOTE' AND ${postVisibleSql('p', 'a', '$3')}
          ${cursor ? 'AND (p.created_at, p.id) < ($4::timestamptz, $5::uuid)' : ''}
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT $2`,
      cursor ? [original, limit + 1, viewerId, ...cursor] : [original, limit + 1, viewerId],
    );
    return this.posts.pageOf(rows, limit, viewerId);
  }

  private async resolveOriginal(postId: string, viewerId: string | null): Promise<string> {
    const post = await this.query.getVisible(postId, viewerId);
    if (post.kind === PostKindEnum.REPOST && post.referenced_post_id) {
      return (await this.query.getVisible(post.referenced_post_id, viewerId)).id;
    }
    return post.id;
  }
}
