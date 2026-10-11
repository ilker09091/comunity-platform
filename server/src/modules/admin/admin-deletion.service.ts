import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import type { UserRole } from '../../common/decorators/auth.decorators.js';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import { recountUserPosts } from '../../common/utils/counters.js';
import { ContentDeletionService, type PendingFiles } from '../media/content-deletion.service.js';
import { AuditService, type RequestContext } from '../platform/audit.service.js';
import { assertOutranks, assertPermission } from '../platform/permissions.js';
import { StepUpService } from '../platform/step-up.service.js';
import type { DeletionResultDto } from './dto/admin.dto.js';

const VIDEO_SQL = `EXISTS (SELECT 1 FROM post_media pm JOIN media md ON md.id = pm.media_id WHERE pm.post_id = p.id AND md.type = 'VIDEO')`;

/**
 * Irreversible deletion from the admin panel: rows and media files are removed for good.
 * Always requires step-up; the actor must outrank the author and may not delete their own content.
 * Open reports about the deleted content are closed; every deleted item is audited (without its text).
 */
@Injectable()
export class AdminDeletionService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly deletion: ContentDeletionService,
    private readonly audit: AuditService,
    private readonly stepUp: StepUpService,
  ) {}

  async deletePost(ctx: RequestContext, id: string, reason: string): Promise<DeletionResultDto> {
    await this.stepUp.assert(ctx);
    return this.run(async (m) => {
      const post = await sqlOne<{ author_id: string; author_role: UserRole; is_reel: boolean }>(
        m,
        `SELECT p.author_id, u.role AS author_role, ${VIDEO_SQL} AS is_reel
           FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = $1 FOR UPDATE OF p`,
        [id],
      );
      if (!post) throw AppException.notFound(ErrorCode.POST_NOT_FOUND, 'Post not found');
      assertPermission(ctx.actor.role, post.is_reel ? 'reels.moderate' : 'posts.moderate');
      assertOutranks(ctx.actor, { id: post.author_id, role: post.author_role });
      const resolved = await this.closeReports(m, ctx, [id], reason);
      const res = await this.deletion.deletePosts(m, [id]);
      await this.audit.record(m, ctx, {
        action: 'post.deleted',
        targetType: 'POST',
        targetId: id,
        metadata: { reason, isReel: post.is_reel, authorId: post.author_id, comments: res.comments, files: res.files, freedBytes: res.freedBytes, resolvedReports: resolved },
      });
      return { result: { posts: res.posts, comments: res.comments, files: res.files, freedBytes: res.freedBytes, resolvedReports: resolved }, files: res.pending };
    });
  }

  async deleteComment(ctx: RequestContext, id: string, reason: string): Promise<DeletionResultDto> {
    await this.stepUp.assert(ctx);
    assertPermission(ctx.actor.role, 'comments.moderate');
    return this.run(async (m) => {
      const row = await sqlOne<{ author_id: string; author_role: UserRole }>(
        m,
        `SELECT c.author_id, u.role AS author_role FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = $1 FOR UPDATE OF c`,
        [id],
      );
      if (!row) throw AppException.notFound(ErrorCode.COMMENT_NOT_FOUND, 'Comment not found');
      assertOutranks(ctx.actor, { id: row.author_id, role: row.author_role });
      const resolved = await this.closeReports(m, ctx, [id], reason);
      await this.deletion.deleteComments(m, [id]);
      await this.audit.record(m, ctx, {
        action: 'comment.deleted',
        targetType: 'COMMENT',
        targetId: id,
        metadata: { reason, authorId: row.author_id, resolvedReports: resolved },
      });
      return { result: { posts: 0, comments: 1, files: 0, freedBytes: 0, resolvedReports: resolved }, files: { keys: [], bytes: 0 } };
    });
  }

  /** Deletes everything an account posted (posts/Reels/reposts and/or comments). */
  async deleteUserContent(
    ctx: RequestContext,
    userId: string,
    scope: 'posts' | 'comments' | 'all',
    reason: string,
    confirmUsername: string,
  ): Promise<DeletionResultDto> {
    await this.stepUp.assert(ctx);
    if (scope !== 'comments') assertPermission(ctx.actor.role, 'posts.moderate', 'reels.moderate');
    if (scope !== 'posts') assertPermission(ctx.actor.role, 'comments.moderate');
    return this.run(async (m) => {
      const user = await sqlOne<{ id: string; role: UserRole; username: string }>(m, `SELECT id, role, username FROM users WHERE id = $1 FOR UPDATE`, [userId]);
      if (!user) throw AppException.notFound(ErrorCode.USER_NOT_FOUND, 'User not found');
      if (confirmUsername !== user.username)
        throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Validation failed', [{ field: 'confirmUsername', message: 'Type the account’s username to confirm' }]);
      assertOutranks(ctx.actor, user);

      const posts = scope === 'comments' ? [] : (await sqlRows<{ id: string }>(m, `SELECT id FROM posts WHERE author_id = $1`, [userId])).map((r) => r.id);
      const comments =
        scope === 'posts'
          ? []
          : (await sqlRows<{ id: string }>(m, `SELECT id FROM comments WHERE author_id = $1 AND NOT (post_id = ANY($2::uuid[]))`, [userId, posts])).map((r) => r.id);
      const resolved = await this.closeReports(m, ctx, [...posts, ...comments], reason);
      // Per-item audit entries (ids only — the content itself is gone).
      for (const [type, ids] of [['POST', posts], ['COMMENT', comments]] as const)
        if (ids.length)
          await sqlRows(
            m,
            `INSERT INTO admin_audit_logs (actor_id, actor_role, action, target_type, target_id, metadata, request_id, ip_address)
             SELECT $1, $2, $3, $4, t.id, jsonb_build_object('reason', $5::text, 'bulk', true, 'authorId', $6::text), $7, $8
               FROM unnest($9::uuid[]) AS t(id)`,
            [ctx.actor.id, ctx.actor.role, type === 'POST' ? 'post.deleted' : 'comment.deleted', type, reason, userId, ctx.requestId?.slice(0, 128) ?? null, ctx.ip?.slice(0, 64) ?? null, ids],
          );
      const p = await this.deletion.deletePosts(m, posts);
      await recountUserPosts(m, [userId]);
      const c = await this.deletion.deleteComments(m, comments);
      const result = { posts: p.posts, comments: c + p.comments, files: p.files, freedBytes: p.freedBytes, resolvedReports: resolved };
      await this.audit.record(m, ctx, { action: 'user.content_deleted', targetType: 'USER', targetId: userId, metadata: { reason, scope, ...result } });
      return { result, files: p.pending };
    });
  }

  private async run(fn: (m: EntityManager) => Promise<{ result: DeletionResultDto; files: PendingFiles }>): Promise<DeletionResultDto> {
    const { result, files } = await this.db.transaction(fn);
    await this.deletion.removeFiles(files); // only after commit
    return result;
  }

  /** Closes open reports about the items (and comments under deleted posts). */
  private async closeReports(m: EntityManager, ctx: RequestContext, ids: string[], reason: string): Promise<number> {
    if (!ids.length) return 0;
    const rows = await sqlRows(
      m,
      `UPDATE reports SET status = 'RESOLVED', resolution_note = $2, resolved_by_id = $3, resolved_at = now(), updated_at = now()
        WHERE status IN ('OPEN', 'IN_REVIEW')
          AND (target_id = ANY($1::uuid[]) OR (target_type = 'COMMENT' AND target_id IN (SELECT id FROM comments WHERE post_id = ANY($1::uuid[]))))
        RETURNING id`,
      [ids, `Content deleted: ${reason}`.slice(0, 1000), ctx.actor.id],
    );
    return rows.length;
  }
}
