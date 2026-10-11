import { Injectable } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CursorQueryDto } from '../../common/dto/common.dto.js';
import type { Page } from '../../common/dto/common.dto.js';
import { decodeCursor, toPage } from '../../common/utils/cursor.js';
import { sanitizeText } from '../../common/utils/sanitize.js';
import { escapeLike, notBlockedSql, postVisibleSql, sqlRows } from '../../common/utils/sql.js';
import { PostDto } from '../posts/dto/post.dto.js';
import { PostsService } from '../posts/posts.service.js';
import { PlatformSettingsService } from '../platform/platform-settings.service.js';
import { UserListItemDto } from '../users/dto/user.dto.js';
import { USER_AVATAR_JOIN, USER_SUMMARY_COLUMNS, userListFlagsSql, UsersService } from '../users/users.service.js';

export class SearchQueryDto extends CursorQueryDto {
  @ApiProperty({ example: 'jane', minLength: 1, maxLength: 100, description: 'Search text' })
  @Transform(({ value }) => (typeof value === 'string' ? sanitizeText(value, { multiline: false }) : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  q: string;
}

/**
 * PostgreSQL-native search:
 *  - users: trigram similarity + prefix matching on username/display name (GIN pg_trgm indexes)
 *  - posts: full-text search on a generated tsvector column (GIN index), `websearch_to_tsquery`
 *    syntax ("quoted phrases", -exclusions, OR), newest first.
 * All user input is passed as bound parameters.
 */
@Injectable()
export class SearchService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly users: UsersService,
    private readonly posts: PostsService,
    private readonly settings: PlatformSettingsService,
  ) {}

  async searchUsers(q: string, viewerId: string | null, cursorStr: string | undefined, limit: number): Promise<Page<UserListItemDto>> {
    await this.settings.assertFeature('search');
    const term = q.toLowerCase().replace(/^@/, '');
    const cursor = decodeCursor(cursorStr, ['decimal', 'uuid']);
    const params: unknown[] = [viewerId, term, `${escapeLike(term)}%`, `%${escapeLike(term)}%`, limit + 1];
    if (cursor) params.push(...cursor);
    const rows = await sqlRows(
      this.db,
      `SELECT * FROM (
         SELECT ${USER_SUMMARY_COLUMNS}, ${userListFlagsSql('$1')},
                round((
                  CASE WHEN lower(u.username::text) = $2 THEN 3
                       WHEN lower(u.username::text) LIKE $3 THEN 2
                       WHEN lower(u.display_name) LIKE $3 THEN 1
                       ELSE 0 END
                  + greatest(similarity(lower(u.username::text), $2), similarity(lower(u.display_name), $2))
                )::numeric, 6) AS rank
           FROM users u ${USER_AVATAR_JOIN}
          WHERE u.status = 'ACTIVE'
            AND (lower(u.username::text) LIKE $3
                 OR lower(u.display_name) LIKE $4
                 OR lower(u.username::text) % $2
                 OR lower(u.display_name) % $2)
            AND ${notBlockedSql('u.id', '$1')}
       ) s
       ${cursor ? 'WHERE (s.rank, s.id) < ($6::numeric, $7::uuid)' : ''}
       ORDER BY s.rank DESC, s.id DESC
       LIMIT $5`,
      params,
    );
    return toPage(rows, limit, (r) => this.users.toListItem(r as never), (r) => [String(r.rank), r.id]);
  }

  async searchPosts(q: string, viewerId: string | null, cursorStr: string | undefined, limit: number): Promise<Page<PostDto>> {
    await this.settings.assertFeature('search');
    const cursor = decodeCursor(cursorStr, ['date', 'uuid']);
    const rows = await sqlRows<{ id: string; created_at: Date }>(
      this.db,
      `SELECT p.id, p.created_at FROM posts p JOIN users a ON a.id = p.author_id
        WHERE p.kind <> 'REPOST'
          AND p.search_vector @@ websearch_to_tsquery('simple', $2)
          AND ${postVisibleSql('p', 'a', '$1')}
          ${cursor ? 'AND (p.created_at, p.id) < ($4::timestamptz, $5::uuid)' : ''}
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT $3`,
      cursor ? [viewerId, q, limit + 1, ...cursor] : [viewerId, q, limit + 1],
    );
    return this.posts.pageOf(rows, limit, viewerId);
  }
}
