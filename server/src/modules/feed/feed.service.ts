import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { appConfig } from '../../config/app.config.js';
import type { Page } from '../../common/dto/common.dto.js';
import { decodeCursor, encodeCursor, iso } from '../../common/utils/cursor.js';
import { postVisibleSql, sqlRows } from '../../common/utils/sql.js';
import { PostDto } from '../posts/dto/post.dto.js';
import { PostsQueryService, repostTargetVisibleSql } from '../posts/posts-query.service.js';
import { PostsService } from '../posts/posts.service.js';
import { contentSql, type ContentFilter } from '../../common/utils/content.js';

/**
 * Explore score (documented in the API contract):
 *   (likes + 2·comments + 3·(reposts + quotes) + bookmarks + 1) / (ageHours + 2)^1.5
 * computed relative to a fixed `asOf` instant carried in the cursor, so pagination is stable.
 */
const EXPLORE_SCORE = `round(
  ((p.like_count + 2 * p.comment_count + 3 * (p.repost_count + p.quote_count) + p.bookmark_count + 1)::numeric
   / power((extract(epoch FROM ($2::timestamptz - p.created_at)) / 3600.0 + 2)::numeric, 1.5)), 12)`;

@Injectable()
export class FeedService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly posts: PostsService,
    private readonly query: PostsQueryService,
    @Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>,
  ) {}

  /** Newest public original posts and quotes (simple reposts are excluded to avoid duplicates). */
  async global(viewerId: string | null, cursorStr: string | undefined, limit: number, content: ContentFilter = 'home'): Promise<Page<PostDto>> {
    const cursor = decodeCursor(cursorStr, ['date', 'uuid']);
    const rows = await sqlRows<{ id: string; created_at: Date }>(
      this.db,
      `SELECT p.id, p.created_at FROM posts p JOIN users a ON a.id = p.author_id
        WHERE p.kind <> 'REPOST' AND p.visibility = 'PUBLIC' AND a.is_private = false
          AND ${postVisibleSql('p', 'a', '$1')}
          AND ${contentSql('p',content)}
          ${cursor ? 'AND (p.created_at, p.id) < ($3::timestamptz, $4::uuid)' : ''}
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT $2`,
      cursor ? [viewerId, limit + 1, ...cursor] : [viewerId, limit + 1],
    );
    return this.posts.pageOf(rows, limit, viewerId);
  }

  /** Posts, quotes and reposts from followed accounts plus the viewer's own, newest first. */
  async following(viewerId: string, cursorStr: string | undefined, limit: number, content: ContentFilter = 'home'): Promise<Page<PostDto>> {
    const cursor = decodeCursor(cursorStr, ['date', 'uuid']);
    const rows = await sqlRows<{ id: string; created_at: Date }>(
      this.db,
      `SELECT p.id, p.created_at FROM posts p JOIN users a ON a.id = p.author_id
        WHERE (p.author_id = $1 OR p.author_id IN (SELECT following_id FROM follows WHERE follower_id = $1))
          AND ${postVisibleSql('p', 'a', '$1')}
          AND ${repostTargetVisibleSql('p', '$1')}
          AND ${contentSql('p',content)}
          ${cursor ? 'AND (p.created_at, p.id) < ($3::timestamptz, $4::uuid)' : ''}
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT $2`,
      cursor ? [viewerId, limit + 1, ...cursor] : [viewerId, limit + 1],
    );
    return this.posts.pageOf(rows, limit, viewerId);
  }

  /** Recent public posts ranked by engagement with time decay. */
  async explore(viewerId: string | null, cursorStr: string | undefined, limit: number, content: ContentFilter = 'home'): Promise<Page<PostDto>> {
    const cursor = decodeCursor(cursorStr, ['date', 'decimal', 'uuid']);
    const asOf = cursor ? (cursor[0] as string) : new Date().toISOString();
    const params: unknown[] = [viewerId, asOf, this.config.content.exploreWindowHours, limit + 1];
    if (cursor) params.push(cursor[1], cursor[2]);
    const rows = await sqlRows<{ id: string; score: string }>(
      this.db,
      `SELECT s.id, s.score::text AS score FROM (
         SELECT p.id, ${EXPLORE_SCORE} AS score
           FROM posts p JOIN users a ON a.id = p.author_id
          WHERE p.kind <> 'REPOST' AND p.visibility = 'PUBLIC' AND a.is_private = false
            AND p.created_at <= $2::timestamptz
            AND p.created_at > $2::timestamptz - make_interval(hours => $3)
            AND ${postVisibleSql('p', 'a', '$1')}
            AND ${contentSql('p',content)}
       ) s
       ${cursor ? 'WHERE (s.score, s.id) < ($5::numeric, $6::uuid)' : ''}
       ORDER BY s.score DESC, s.id DESC
       LIMIT $4`,
      params,
    );
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows[pageRows.length - 1];
    return {
      items: await this.query.hydrate(pageRows.map((r) => r.id), viewerId),
      nextCursor: hasMore ? encodeCursor([iso(asOf)!, last.score, last.id]) : null,
      hasMore,
    };
  }
}
