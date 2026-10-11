import { Injectable } from '@nestjs/common';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { iso } from '../../common/utils/cursor.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import { MediaService, type MediaRow } from '../media/media.service.js';
import { AdminReadService, likeTerm, Params } from './admin-read.service.js';
import type {
  AdminCommentDetailDto,
  AdminCommentRowDto,
  AdminCommentsQueryDto,
  AdminContentQueryDto,
  AdminPage,
  AdminPostDetailDto,
  AdminPostRowDto,
  AdminPostsQueryDto,
  AdminReelRowDto,
} from './dto/admin.dto.js';

const POST_SORTS: Record<string, string> = {
  created: 'x.created_at',
  likes: 'x.like_count',
  comments: 'x.comment_count',
  reposts: '(x.repost_count + x.quote_count)',
  reports: 'x.report_count',
};
const COMMENT_SORTS: Record<string, string> = {
  created: 'x.created_at',
  likes: 'x.like_count',
  comments: 'x.reply_count',
  reposts: 'x.created_at',
  reports: 'x.report_count',
};

/** Read models for posts, Reels and comments (moderation actions live in ContentModerationService). */
@Injectable()
export class AdminContentService {
  constructor(
    private readonly read: AdminReadService,
    private readonly media: MediaService,
  ) {}

  private contentFilters(alias: 'p' | 'c', q: AdminContentQueryDto, p: Params, where: string[]) {
    if (q.q) where.push(`${alias}.content ILIKE ${p.add(likeTerm(q.q))}`);
    if (q.status === 'DELETED') where.push(`${alias}.deleted_at IS NOT NULL`);
    else if (q.status) where.push(`${alias}.moderation_status = ${p.add(q.status)} AND ${alias}.deleted_at IS NULL`);
    if (q.reported) where.push(`rc.total > 0`);
    if (q.authorId) where.push(`${alias}.author_id = ${p.add(q.authorId)}`);
    if (q.from) where.push(`${alias}.created_at >= ${p.add(q.from)}::timestamptz`);
    if (q.to) where.push(`${alias}.created_at < ${p.add(q.to)}::timestamptz`);
  }

  private async page<T>(base: string, where: string[], p: Params, sort: string, q: AdminContentQueryDto, map: (r: Record<string, any>) => T) {
    const page = q.page ?? 1;
    const size = q.pageSize ?? 25;
    const order = q.order === 'asc' ? 'ASC' : 'DESC';
    const rows = await sqlRows(
      this.read.db,
      `SELECT x.*, count(*) OVER()::int AS total_count
         FROM (${base} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}) x
        ORDER BY ${sort} ${order}, x.id ${order}
        LIMIT ${p.add(size)} OFFSET ${p.add((page - 1) * size)}`,
      p.values,
    );
    return { items: rows.map(map), page, pageSize: size, total: rows[0]?.total_count ?? 0 } satisfies AdminPage<T>;
  }

  async listPosts(q: AdminPostsQueryDto): Promise<AdminPage<AdminPostRowDto>> {
    const p = new Params();
    const where: string[] = [];
    this.contentFilters('p', q, p, where);
    if (q.kind) where.push(`p.kind = ${p.add(q.kind)}`);
    if (q.type === 'TEXT') where.push(`coalesce(md.images, 0) + coalesce(md.videos, 0) = 0`);
    if (q.type === 'IMAGE') where.push(`md.images > 0`);
    if (q.type === 'VIDEO') where.push(`md.videos > 0`);
    return this.page(this.read.sql.post, where, p, POST_SORTS[q.sort ?? 'created'], q, (r) => this.read.postRow(r));
  }

  async listReels(q: AdminContentQueryDto): Promise<AdminPage<AdminReelRowDto>> {
    const p = new Params();
    const where: string[] = [`p.kind <> 'REPOST'`];
    this.contentFilters('p', q, p, where);
    const base = this.read.sql.post.replace('SELECT p.id,', `SELECT p.id${this.read.sql.reelCols.replace(/^,/, ',')},`).replace(
      'LEFT JOIN media aav ON aav.id = a.avatar_media_id',
      `LEFT JOIN media aav ON aav.id = a.avatar_media_id ${this.read.sql.reelJoin}`,
    );
    return this.page(base, where, p, POST_SORTS[q.sort ?? 'created'], q, (r) => this.read.reelRow(r));
  }

  async postDetail(id: string): Promise<AdminPostDetailDto> {
    const row = await sqlOne(this.read.db, `${this.read.sql.post} WHERE p.id = $1`, [id]);
    if (!row) throw AppException.notFound(ErrorCode.POST_NOT_FOUND, 'Post not found');
    const full = await sqlOne<{ content: string | null; referenced_post_id: string | null; edited_at: Date | null }>(
      this.read.db,
      `SELECT content, referenced_post_id, edited_at FROM posts WHERE id = $1`,
      [id],
    );
    const media = await sqlRows<MediaRow>(
      this.read.db,
      `SELECT m.* FROM post_media pm JOIN media m ON m.id = pm.media_id WHERE pm.post_id = $1 ORDER BY pm.position`,
      [id],
    );
    return {
      post: this.read.postRow(row),
      content: full!.content,
      media: media.map((m) => this.media.toDto(m)),
      referencedPostId: full!.referenced_post_id,
      editedAt: iso(full!.edited_at),
      bookmarkCount: row.bookmark_count,
      reports: await this.read.reportsFor(`r.target_type = 'POST' AND r.target_id = $1`, [id], 50),
      history: await this.read.history('POST', [id]),
    };
  }

  async listComments(q: AdminCommentsQueryDto): Promise<AdminPage<AdminCommentRowDto>> {
    const p = new Params();
    const where: string[] = [];
    this.contentFilters('c', q, p, where);
    if (q.postId) where.push(`c.post_id = ${p.add(q.postId)}`);
    return this.page(this.read.sql.comment, where, p, COMMENT_SORTS[q.sort ?? 'created'], q, (r) => this.read.commentRow(r));
  }

  async commentDetail(id: string): Promise<AdminCommentDetailDto> {
    const row = await sqlOne(this.read.db, `${this.read.sql.comment} WHERE c.id = $1`, [id]);
    if (!row) throw AppException.notFound(ErrorCode.COMMENT_NOT_FOUND, 'Comment not found');
    // Ancestors (root first) via the parent chain; depth is bounded by the max reply depth.
    const thread = await sqlRows(
      this.read.db,
      `WITH RECURSIVE chain AS (
         SELECT parent_id, 1 AS lvl FROM comments WHERE id = $1
         UNION ALL
         SELECT c.parent_id, chain.lvl + 1 FROM comments c JOIN chain ON c.id = chain.parent_id WHERE chain.lvl < 25)
       SELECT * FROM (${this.read.sql.comment} WHERE c.id IN (SELECT parent_id FROM chain WHERE parent_id IS NOT NULL)) x
        ORDER BY x.depth`,
      [id],
    );
    const replies = await sqlRows(
      this.read.db,
      `${this.read.sql.comment} WHERE c.parent_id = $1 ORDER BY c.created_at LIMIT 20`,
      [id],
    );
    const post = await sqlOne(this.read.db, `${this.read.sql.post} WHERE p.id = $1`, [row.post_id]);
    return {
      comment: this.read.commentRow(row),
      thread: thread.map((r) => this.read.commentRow(r)),
      replies: replies.map((r) => this.read.commentRow(r)),
      post: this.read.postRow(post!),
      reports: await this.read.reportsFor(`r.target_type = 'COMMENT' AND r.target_id = $1`, [id], 50),
      history: await this.read.history('COMMENT', [id]),
    };
  }
}
