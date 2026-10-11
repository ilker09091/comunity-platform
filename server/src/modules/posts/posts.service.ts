import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import type { Page } from '../../common/dto/common.dto.js';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { decodeCursor, iso, toPage } from '../../common/utils/cursor.js';
import { postVisibleSql, sqlOne, sqlRows } from '../../common/utils/sql.js';
import { MediaService } from '../media/media.service.js';
import { ContentDeletionService } from '../media/content-deletion.service.js';
import { PlatformSettingsService } from '../platform/platform-settings.service.js';
import { UsersService } from '../users/users.service.js';
import {
  CreatePostDto,
  EngagementSummaryDto,
  PostDto,
  PostKindEnum,
  PostVisibilityEnum,
  UpdatePostDto,
} from './dto/post.dto.js';
import { PostsQueryService, repostTargetVisibleSql } from './posts-query.service.js';
import { contentSql, type ContentFilter } from '../../common/utils/content.js';

export interface InsertPostInput {
  kind: PostKindEnum;
  content: string | null;
  mediaIds: string[];
  visibility: PostVisibilityEnum;
  referencedPostId: string | null;
}

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly query: PostsQueryService,
    private readonly media: MediaService,
    private readonly deletion: ContentDeletionService,
    private readonly users: UsersService,
    private readonly settings: PlatformSettingsService,
  ) {}

  /** Enforces the administrator-configured content limits (server-side, never trusting the client). */
  async validateBody(content: string | null, mediaIds: string[], { allowEmpty = false } = {}) {
    const { posts } = await this.settings.get();
    const postMaxLength = posts.maxLength;
    const postMaxMedia = posts.maxMedia;
    const details = [];
    if (content && content.length > postMaxLength) {
      details.push({ field: 'content', message: `content must be at most ${postMaxLength} characters` });
    }
    if (mediaIds.length > postMaxMedia) {
      details.push({ field: 'mediaIds', message: `at most ${postMaxMedia} attachments are allowed` });
    }
    if (!allowEmpty && !content && !mediaIds.length) {
      details.push({ field: 'content', message: 'a post needs text or at least one attachment' });
    }
    if (details.length) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Validation failed', details);
  }

  /**
   * Inserts a post (any kind) with attachments and bumps the author's post counter.
   * Must run inside a transaction.
   */
  async insertPost(m: EntityManager, authorId: string, input: InsertPostInput): Promise<string> {
    const media = await this.media.lockAttachable(m, authorId, input.mediaIds);
    const post = await sqlOne<{ id: string }>(
      m,
      `INSERT INTO posts (author_id, kind, content, visibility, referenced_post_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [authorId, input.kind, input.content, input.visibility, input.referencedPostId],
    );
    await this.attachMedia(m, post!.id, media.map((x) => x.id));
    await sqlRows(m, `UPDATE users SET post_count = post_count + 1 WHERE id = $1`, [authorId]);
    return post!.id;
  }

  private async attachMedia(m: EntityManager, postId: string, mediaIds: string[]) {
    if (!mediaIds.length) return;
    await sqlRows(
      m,
      `INSERT INTO post_media (post_id, media_id, position)
       SELECT $1, media_id, (ord - 1)::smallint FROM unnest($2::uuid[]) WITH ORDINALITY AS t(media_id, ord)`,
      [postId, mediaIds],
    );
  }

  async create(authorId: string, dto: CreatePostDto): Promise<PostDto> {
    const content = dto.content ?? null;
    const mediaIds = dto.mediaIds ?? [];
    await this.settings.assertFeature('postCreation');
    await this.validateBody(content, mediaIds);
    const { posts } = await this.settings.get();
    const id = await this.db.transaction((m) =>
      this.insertPost(m, authorId, {
        kind: PostKindEnum.POST,
        content,
        mediaIds,
        visibility: dto.visibility ?? posts.defaultVisibility,
        referencedPostId: null,
      }),
    );
    this.logger.log({ message: 'Post created', postId: id, authorId, mediaCount: mediaIds.length });
    return this.query.getOne(id, authorId);
  }

  async update(authorId: string, postId: string, dto: UpdatePostDto): Promise<PostDto> {
    const files = await this.db.transaction(async (m) => {
      const post = await sqlOne<{ author_id: string; kind: PostKindEnum; content: string | null }>(
        m,
        `SELECT author_id, kind, content FROM posts
          WHERE id = $1 AND deleted_at IS NULL AND moderation_status = 'ACTIVE' FOR UPDATE`,
        [postId],
      );
      if (!post) throw AppException.notFound(ErrorCode.POST_NOT_FOUND, 'Post not found');
      if (post.author_id !== authorId) throw AppException.forbidden(ErrorCode.FORBIDDEN, 'You can only edit your own posts');
      if (post.kind === PostKindEnum.REPOST) {
        throw AppException.unprocessable(ErrorCode.POST_NOT_EDITABLE, 'Simple reposts cannot be edited');
      }

      const currentMedia = await sqlRows<{ media_id: string }>(
        m,
        `SELECT media_id FROM post_media WHERE post_id = $1 ORDER BY position`,
        [postId],
      );
      const content = dto.content !== undefined ? dto.content : post.content;
      const mediaIds = dto.mediaIds ?? currentMedia.map((r) => r.media_id);
      await this.validateBody(content, mediaIds, { allowEmpty: post.kind === PostKindEnum.QUOTE });

      const sets = ['updated_at = now()'];
      const params: unknown[] = [postId];
      const contentChanged = dto.content !== undefined && dto.content !== post.content;
      const mediaChanged =
        dto.mediaIds !== undefined && dto.mediaIds.join(',') !== currentMedia.map((r) => r.media_id).join(',');
      if (contentChanged) {
        params.push(content);
        sets.push(`content = $${params.length}`);
      }
      if (dto.visibility) {
        params.push(dto.visibility);
        sets.push(`visibility = $${params.length}`);
      }
      if (contentChanged || mediaChanged) sets.push('edited_at = now()');

      if (mediaChanged) {
        await this.media.lockAttachable(m, authorId, mediaIds, { ignorePostId: postId });
        await sqlRows(m, `DELETE FROM post_media WHERE post_id = $1`, [postId]);
        await this.attachMedia(m, postId, mediaIds);
      }
      await sqlRows(m, `UPDATE posts SET ${sets.join(', ')} WHERE id = $1`, params);
      return this.deletion.deleteMedia(m, currentMedia.map((r) => r.media_id).filter((id) => !mediaIds.includes(id)));
    });
    await this.deletion.removeFiles(files);
    return this.query.getOne(postId, authorId);
  }

  /** Permanently deletes an own post, its engagement and its media files. Counters are recomputed. */
  async remove(authorId: string, postId: string): Promise<void> {
    const files = await this.db.transaction(async (m) => {
      const post = await sqlOne<{ author_id: string; kind: PostKindEnum; referenced_post_id: string | null }>(
        m,
        `SELECT author_id, kind, referenced_post_id FROM posts WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [postId],
      );
      if (!post) throw AppException.notFound(ErrorCode.POST_NOT_FOUND, 'Post not found');
      if (post.author_id !== authorId) throw AppException.forbidden(ErrorCode.FORBIDDEN, 'You can only delete your own posts');
      return (await this.deletion.deletePosts(m, [postId])).pending;
    });
    await this.deletion.removeFiles(files);
    this.logger.log({ message: 'Post deleted', postId, authorId });
  }

  /** Permanently deletes a post inside the caller's transaction (used for undoing reposts, which have no media). */
  async deleteWithin(m: EntityManager, postId: string) {
    return (await this.deletion.deletePosts(m, [postId])).pending;
  }

  async engagement(postId: string, viewerId: string | null): Promise<EngagementSummaryDto> {
    const post = await this.query.getOne(postId, viewerId);
    return {
      postId: post.id,
      likeCount: post.likeCount,
      commentCount: post.commentCount,
      repostCount: post.repostCount,
      quoteCount: post.quoteCount,
      bookmarkCount: post.bookmarkCount,
      isLiked: post.isLiked,
      isBookmarked: post.isBookmarked,
      isReposted: post.isReposted,
    };
  }

  /** A user's timeline: their posts, quotes and reposts, newest first. */
  async listByUser(
    userId: string,
    viewerId: string | null,
    cursorStr: string | undefined,
    limit: number,
    kinds: PostKindEnum[] | undefined,
    content: ContentFilter = 'all',
  ): Promise<Page<PostDto>> {
    const target = await this.users.getActiveTarget(userId);
    await this.users.assertCanViewContent(viewerId, target);
    const cursor = decodeCursor(cursorStr, ['date', 'uuid']);
    const params: unknown[] = [userId, viewerId, limit + 1, kinds?.length ? kinds : null];
    if (cursor) params.push(...cursor);
    const rows = await sqlRows<{ id: string; created_at: Date }>(
      this.db,
      `SELECT p.id, p.created_at FROM posts p JOIN users a ON a.id = p.author_id
        WHERE p.author_id = $1
          AND ($4::post_kind[] IS NULL OR p.kind = ANY($4::post_kind[]))
          AND ${postVisibleSql('p', 'a', '$2')}
          AND ${repostTargetVisibleSql('p', '$2')}
          AND ${contentSql('p',content)}
          ${cursor ? 'AND (p.created_at, p.id) < ($5::timestamptz, $6::uuid)' : ''}
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT $3`,
      params,
    );
    return this.pageOf(rows, limit, viewerId);
  }

  /** Hydrates a `limit + 1` row window ordered by (created_at, id) into a page. */
  async pageOf(rows: { id: string; created_at: Date }[], limit: number, viewerId: string | null): Promise<Page<PostDto>> {
    const page = toPage(rows, limit, (r) => r.id, (r) => [iso(r.created_at)!, r.id]);
    return { ...page, items: await this.query.hydrate(page.items, viewerId) };
  }
}
