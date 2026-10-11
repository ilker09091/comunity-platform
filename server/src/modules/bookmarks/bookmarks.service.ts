import { Injectable } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Page } from '../../common/dto/common.dto.js';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { decodeCursor, iso, toPage } from '../../common/utils/cursor.js';
import { postVisibleSql, sqlOne, sqlRows } from '../../common/utils/sql.js';
import { PostDto } from '../posts/dto/post.dto.js';
import { PostsQueryService } from '../posts/posts-query.service.js';

export class BookmarkResultDto {
  @ApiProperty({ format: 'uuid', description: 'Bookmarked post id (a simple repost resolves to its original)' })
  postId: string;

  @ApiProperty({ example: true })
  bookmarked: boolean;

  @ApiProperty({ example: 4 })
  bookmarkCount: number;
}

/** Bookmarks are private: they are only ever read for the authenticated owner. */
@Injectable()
export class BookmarksService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly posts: PostsQueryService,
  ) {}

  async add(userId: string, postId: string): Promise<BookmarkResultDto> {
    return this.db.transaction(async (m) => {
      const post = await this.posts.getInteractionTarget(postId, userId, m);
      const inserted = await sqlRows(
        m,
        `INSERT INTO bookmarks (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1`,
        [userId, post.id],
      );
      if (inserted.length) await sqlRows(m, `UPDATE posts SET bookmark_count = bookmark_count + 1 WHERE id = $1`, [post.id]);
      const count = await sqlOne<{ c: number }>(m, `SELECT bookmark_count AS c FROM posts WHERE id = $1`, [post.id]);
      return { postId: post.id, bookmarked: true, bookmarkCount: count!.c };
    });
  }

  async remove(userId: string, postId: string): Promise<BookmarkResultDto> {
    return this.db.transaction(async (m) => {
      const row = await sqlOne<{ id: string; kind: string; referenced_post_id: string | null }>(
        m,
        `SELECT id, kind, referenced_post_id FROM posts WHERE id = $1`,
        [postId],
      );
      if (!row) throw AppException.notFound(ErrorCode.POST_NOT_FOUND, 'Post not found');
      const targetId = row.kind === 'REPOST' && row.referenced_post_id ? row.referenced_post_id : row.id;
      const deleted = await sqlRows(m, `DELETE FROM bookmarks WHERE user_id = $1 AND post_id = $2 RETURNING 1`, [userId, targetId]);
      if (deleted.length) {
        await sqlRows(m, `UPDATE posts SET bookmark_count = GREATEST(bookmark_count - 1, 0) WHERE id = $1`, [targetId]);
      }
      const count = await sqlOne<{ c: number }>(m, `SELECT bookmark_count AS c FROM posts WHERE id = $1`, [targetId]);
      return { postId: targetId, bookmarked: false, bookmarkCount: count!.c };
    });
  }

  /** Saved posts, most recently bookmarked first. Posts that became invisible are skipped. */
  async list(userId: string, cursorStr: string | undefined, limit: number): Promise<Page<PostDto>> {
    const cursor = decodeCursor(cursorStr, ['date', 'uuid']);
    const rows = await sqlRows<{ post_id: string; bookmarked_at: Date }>(
      this.db,
      `SELECT b.post_id, b.created_at AS bookmarked_at
         FROM bookmarks b
         JOIN posts p ON p.id = b.post_id
         JOIN users a ON a.id = p.author_id
        WHERE b.user_id = $1 AND ${postVisibleSql('p', 'a', '$1')}
          ${cursor ? 'AND (b.created_at, b.post_id) < ($3::timestamptz, $4::uuid)' : ''}
        ORDER BY b.created_at DESC, b.post_id DESC
        LIMIT $2`,
      cursor ? [userId, limit + 1, ...cursor] : [userId, limit + 1],
    );
    const page = toPage(rows, limit, (r) => r.post_id, (r) => [iso(r.bookmarked_at)!, r.post_id]);
    return { ...page, items: await this.posts.hydrate(page.items, userId) };
  }
}
