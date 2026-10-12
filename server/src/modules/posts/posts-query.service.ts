import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { iso } from '../../common/utils/cursor.js';
import { postVisibleSql, sqlOne, sqlRows } from '../../common/utils/sql.js';
import { MediaRow, MediaService } from '../media/media.service.js';
import { UsersService } from '../users/users.service.js';
import { PostDto, PostKindEnum, ReferencedPostDto } from './dto/post.dto.js';

export interface VisiblePost {
  id: string;
  author_id: string;
  kind: PostKindEnum;
  referenced_post_id: string | null;
  visibility: 'PUBLIC' | 'FOLLOWERS';
  author_is_private: boolean;
}

/**
 * SQL predicate: a simple repost row `p` is only shown when its original is visible to `$v`.
 * Non-REPOST rows always pass.
 */
export const repostTargetVisibleSql = (p: string, v: string) => `(
  ${p}.kind <> 'REPOST' OR EXISTS (
    SELECT 1 FROM posts o JOIN users oa ON oa.id = o.author_id
     WHERE o.id = ${p}.referenced_post_id AND ${postVisibleSql('o', 'oa', v)}
  )
)`;

/**
 * Read-side for posts. Every list endpoint selects ids with its own keyset query and then
 * calls `hydrate`, which loads a whole page with a constant number of queries
 * (posts+authors+viewer flags, media, referenced posts) — no N+1.
 */
@Injectable()
export class PostsQueryService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly users: UsersService,
    private readonly media: MediaService,
  ) {}

  /** Returns the post if the viewer may see it, otherwise 404 (never reveals existence). */
  async getVisible(postId: string, viewerId: string | null, db: DataSource | EntityManager = this.db): Promise<VisiblePost> {
    const row = await sqlOne<VisiblePost>(
      db,
      `SELECT p.id, p.author_id, p.kind, p.referenced_post_id, p.visibility, a.is_private AS author_is_private
         FROM posts p JOIN users a ON a.id = p.author_id
        WHERE p.id = $1 AND ${postVisibleSql('p', 'a', '$2')}`,
      [postId, viewerId],
    );
    if (!row) throw AppException.notFound(ErrorCode.POST_NOT_FOUND, 'Post not found');
    return row;
  }

  /**
   * Resolves the post a viewer interacts with (like, bookmark, comment, repost).
   * Interactions with a simple repost apply to its original.
   */
  async getInteractionTarget(postId: string, viewerId: string, db: DataSource | EntityManager = this.db): Promise<VisiblePost> {
    const post = await this.getVisible(postId, viewerId, db);
    if (post.kind !== PostKindEnum.REPOST) return post;
    if (!post.referenced_post_id) throw AppException.notFound(ErrorCode.POST_NOT_FOUND, 'Post not found');
    return this.getVisible(post.referenced_post_id, viewerId, db);
  }

  async getOne(postId: string, viewerId: string | null): Promise<PostDto> {
    await this.getVisible(postId, viewerId);
    const [post] = await this.hydrate([postId], viewerId);
    return post;
  }

  async hydrate(ids: string[], viewerId: string | null): Promise<PostDto[]> {
    if (!ids.length) return [];
    const base = await this.loadCore(ids, viewerId);

    const refIds = [...new Set(base.map((p) => p.referencedPostId).filter((id): id is string => !!id))];
    const visibleRefs = refIds.length
      ? await sqlRows<{ id: string }>(
          this.db,
          `SELECT p.id FROM posts p JOIN users a ON a.id = p.author_id
            WHERE p.id = ANY($1::uuid[]) AND ${postVisibleSql('p', 'a', '$2')}`,
          [refIds, viewerId],
        )
      : [];
    const refs = new Map(
      (await this.loadCore(visibleRefs.map((r) => r.id), viewerId)).map((p) => [p.id, p]),
    );

    const byId = new Map(base.map((p) => [p.id, p]));
    return ids
      .map((id) => byId.get(id))
      .filter((p): p is ReferencedPostDto => !!p)
      .map((p) => {
        const referencedPost = p.referencedPostId ? (refs.get(p.referencedPostId) ?? null) : null;
        return {
          ...p,
          referencedPost,
          referencedPostUnavailable: p.kind !== PostKindEnum.POST && referencedPost === null,
        };
      });
  }

  private async loadCore(ids: string[], viewerId: string | null): Promise<ReferencedPostDto[]> {
    if (!ids.length) return [];
    const rows = await sqlRows(
      this.db,
      `SELECT p.id, p.kind, p.content, p.referenced_post_id, p.visibility,
              p.like_count, p.comment_count, p.repost_count, p.quote_count, p.bookmark_count,
              p.created_at, p.updated_at, p.edited_at,
              u.id AS author_id, u.username::text AS username, u.display_name, u.is_private, u.is_verified,
              av.storage_key AS avatar_key,
              ($2::uuid IS NOT NULL AND EXISTS (
                SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = $2::uuid)) AS is_liked,
              ($2::uuid IS NOT NULL AND EXISTS (
                SELECT 1 FROM bookmarks b WHERE b.post_id = p.id AND b.user_id = $2::uuid)) AS is_bookmarked,
              ($2::uuid IS NOT NULL AND EXISTS (
                SELECT 1 FROM posts r WHERE r.referenced_post_id = p.id AND r.author_id = $2::uuid
                   AND r.kind = 'REPOST' AND r.deleted_at IS NULL)) AS is_reposted,
              ($2::uuid IS NOT NULL AND u.id <> $2::uuid AND EXISTS (
                SELECT 1 FROM follows f WHERE f.follower_id = $2::uuid AND f.following_id = u.id)) AS is_following_author
         FROM posts p
         JOIN users u ON u.id = p.author_id
         LEFT JOIN media av ON av.id = u.avatar_media_id
        WHERE p.id = ANY($1::uuid[])`,
      [ids, viewerId],
    );
    const mediaRows = await sqlRows<MediaRow & { post_id: string }>(
      this.db,
      `SELECT pm.post_id, m.* FROM post_media pm JOIN media m ON m.id = pm.media_id
        WHERE pm.post_id = ANY($1::uuid[]) ORDER BY pm.post_id, pm.position`,
      [ids],
    );
    const mediaByPost = new Map<string, MediaRow[]>();
    for (const m of mediaRows) {
      const list = mediaByPost.get(m.post_id) ?? [];
      list.push(m);
      mediaByPost.set(m.post_id, list);
    }

    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      author: this.users.toSummary({
        id: r.author_id,
        username: r.username,
        display_name: r.display_name,
        is_private: r.is_private,
        is_verified: r.is_verified,
        avatar_key: r.avatar_key,
      }),
      content: r.content,
      media: (mediaByPost.get(r.id) ?? []).map((m) => this.media.toDto(m)),
      visibility: r.visibility,
      referencedPostId: r.referenced_post_id,
      likeCount: r.like_count,
      commentCount: r.comment_count,
      repostCount: r.repost_count,
      quoteCount: r.quote_count,
      bookmarkCount: r.bookmark_count,
      isLiked: r.is_liked,
      isBookmarked: r.is_bookmarked,
      isReposted: r.is_reposted,
      isFollowingAuthor: r.is_following_author,
      createdAt: iso(r.created_at)!,
      updatedAt: iso(r.updated_at)!,
      editedAt: iso(r.edited_at),
    }));
  }
}
