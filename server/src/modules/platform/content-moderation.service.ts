import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { recountPostEngagement, recountReplies, recountUserPosts } from '../../common/utils/counters.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import { AuditService, type RequestContext } from './audit.service.js';
import { assertOutranks, assertPermission } from './permissions.js';
import type { UserRole } from '../../common/decorators/auth.decorators.js';

export type ContentStatus = 'ACTIVE' | 'HIDDEN' | 'REMOVED';
export type ContentKind = 'post' | 'comment';
export type BulkScope = 'posts' | 'comments' | 'all';

const VIDEO_SQL = `EXISTS (SELECT 1 FROM post_media pm JOIN media md ON md.id = pm.media_id WHERE pm.post_id = x.id AND md.type = 'VIDEO')`;

const ACTIONS: Record<ContentStatus, string> = { ACTIVE: 'restored', HIDDEN: 'hidden', REMOVED: 'removed' };

/**
 * Reversible content moderation. HIDDEN (pending review) and REMOVED (policy violation) are
 * both invisible to users; nothing is deleted. Comment tombstones keep threads intact.
 */
@Injectable()
export class ContentModerationService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly audit: AuditService,
  ) {}

  async setStatus(
    ctx: RequestContext,
    kind: ContentKind,
    id: string,
    status: ContentStatus,
    options: { reason: string; resolveReports?: boolean; reportId?: string | null },
    manager?: EntityManager,
  ): Promise<{ id: string; status: ContentStatus; previousStatus: ContentStatus; resolvedReports: number }> {
    const run = async (m: EntityManager) => {
      const table = kind === 'post' ? 'posts' : 'comments';
      const row = await sqlOne<{ moderation_status: ContentStatus; author_id: string; has_video: boolean; parent_ref: string | null; post_ref: string | null }>(
        m,
        `SELECT t.moderation_status, t.author_id,
                ${kind === 'post' ? 't.referenced_post_id' : 't.parent_id'} AS parent_ref,
                ${kind === 'post' ? 'NULL::uuid' : 't.post_id'} AS post_ref,
                ${kind === 'post' ? `EXISTS (SELECT 1 FROM post_media pm JOIN media md ON md.id = pm.media_id WHERE pm.post_id = t.id AND md.type = 'VIDEO')` : 'false'} AS has_video
           FROM ${table} t WHERE t.id = $1 FOR UPDATE OF t`,
        [id],
      );
      if (!row) throw AppException.notFound(kind === 'post' ? ErrorCode.POST_NOT_FOUND : ErrorCode.COMMENT_NOT_FOUND, 'Content not found');
      assertPermission(ctx.actor.role, kind === 'comment' ? 'comments.moderate' : row.has_video ? 'reels.moderate' : 'posts.moderate');
      if (row.author_id === ctx.actor.id) throw AppException.forbidden(ErrorCode.FORBIDDEN, 'You cannot moderate your own content');

      let resolved = 0;
      if (row.moderation_status !== status) {
        await sqlRows(m, `UPDATE ${table} SET moderation_status = $2, updated_at = now() WHERE id = $1`, [id, status]);
        // Hidden/removed content stops counting towards profile and post counters.
        if (kind === 'post') {
          await recountUserPosts(m, [row.author_id]);
          if (row.parent_ref) await recountPostEngagement(m, [row.parent_ref]);
        } else {
          await recountPostEngagement(m, [row.post_ref!]);
          if (row.parent_ref) await recountReplies(m, [row.parent_ref]);
        }
      }
      if (options.resolveReports && status !== 'ACTIVE') {
        const rows = await sqlRows(
          m,
          `UPDATE reports SET status = 'RESOLVED', resolution_note = $3, resolved_by_id = $4, resolved_at = now(), updated_at = now()
            WHERE target_type = $1 AND target_id = $2 AND status IN ('OPEN', 'IN_REVIEW') RETURNING id`,
          [kind === 'post' ? 'POST' : 'COMMENT', id, options.reason, ctx.actor.id],
        );
        resolved = rows.length;
      }
      await this.audit.record(m, ctx, {
        action: `${kind}.${ACTIONS[status]}`,
        targetType: kind === 'post' ? 'POST' : 'COMMENT',
        targetId: id,
        metadata: {
          reason: options.reason,
          previousStatus: row.moderation_status,
          newStatus: status,
          resolvedReports: resolved,
          reportId: options.reportId ?? null,
          isReel: row.has_video,
        },
      });
      return { id, status, previousStatus: row.moderation_status, resolvedReports: resolved };
    };
    return manager ? run(manager) : this.db.transaction(run);
  }

  /**
   * Moderates every post/Reel and/or comment by one author in a single transaction (e.g. a spam
   * account). Restoring (`ACTIVE`) brings back everything currently hidden or removed in the scope.
   * Each item gets its own audit entry (shared `batchId`) plus one summary entry on the user.
   */
  async bulkForAuthor(
    ctx: RequestContext,
    authorId: string,
    options: { scope: BulkScope; status: ContentStatus; reason: string; resolveReports?: boolean },
  ): Promise<{ batchId: string; posts: number; comments: number; resolvedReports: number }> {
    const { scope, status, reason } = options;
    if (scope !== 'comments') assertPermission(ctx.actor.role, 'posts.moderate', 'reels.moderate');
    if (scope !== 'posts') assertPermission(ctx.actor.role, 'comments.moderate');
    return this.db.transaction(async (m) => {
      const target = await sqlOne<{ id: string; role: UserRole; username: string }>(
        m,
        `SELECT id, role, username FROM users WHERE id = $1 FOR UPDATE`,
        [authorId],
      );
      if (!target) throw AppException.notFound(ErrorCode.USER_NOT_FOUND, 'User not found');
      assertOutranks(ctx.actor, target);

      const from: ContentStatus[] = status === 'ACTIVE' ? ['HIDDEN', 'REMOVED'] : (['ACTIVE', 'HIDDEN', 'REMOVED'] as ContentStatus[]).filter((s) => s !== status);
      const batchId = randomUUID();
      const changed: Record<'posts' | 'comments', { id: string; prev: ContentStatus; is_reel: boolean }[]> = { posts: [], comments: [] };
      for (const table of ['posts', 'comments'] as const) {
        if (scope !== 'all' && scope !== table) continue;
        changed[table] = await sqlRows(
          m,
          `WITH target AS (
             SELECT x.id, x.moderation_status AS prev, ${table === 'posts' ? VIDEO_SQL : 'false'} AS is_reel
               FROM ${table} x
              WHERE x.author_id = $1 AND x.deleted_at IS NULL AND x.moderation_status = ANY($2::moderation_status[])
              FOR UPDATE OF x)
           UPDATE ${table} t SET moderation_status = $3, updated_at = now()
             FROM target WHERE t.id = target.id
           RETURNING t.id, target.prev, target.is_reel`,
          [authorId, from, status],
        );
        // One audit row per item so each post/comment keeps an accurate moderation history.
        if (changed[table].length)
          await sqlRows(
            m,
            `INSERT INTO admin_audit_logs (actor_id, actor_role, action, target_type, target_id, metadata, request_id, ip_address)
             SELECT $1, $2, $3, $4, c.id,
                    jsonb_build_object('reason', $5::text, 'previousStatus', c.prev, 'newStatus', $6::text, 'isReel', c.is_reel,
                                       'bulk', true, 'batchId', $7::text, 'authorId', $8::text),
                    $9, $10
               FROM jsonb_to_recordset($11::jsonb) AS c(id uuid, prev text, is_reel boolean)`,
            [
              ctx.actor.id,
              ctx.actor.role,
              `${table === 'posts' ? 'post' : 'comment'}.${ACTIONS[status]}`,
              table === 'posts' ? 'POST' : 'COMMENT',
              reason,
              status,
              batchId,
              authorId,
              ctx.requestId?.slice(0, 128) ?? null,
              ctx.ip?.slice(0, 64) ?? null,
              JSON.stringify(changed[table]),
            ],
          );
      }

      await recountUserPosts(m, [authorId]);
      const affectedPosts = await sqlRows<{ id: string }>(
        m,
        `SELECT referenced_post_id AS id FROM posts WHERE author_id = $1 AND referenced_post_id IS NOT NULL
         UNION SELECT post_id FROM comments WHERE author_id = $1`,
        [authorId],
      );
      await recountPostEngagement(m, affectedPosts.map((r) => r.id));
      const parents = await sqlRows<{ id: string }>(m, `SELECT DISTINCT parent_id AS id FROM comments WHERE author_id = $1 AND parent_id IS NOT NULL`, [authorId]);
      await recountReplies(m, parents.map((r) => r.id));

      let resolvedReports = 0;
      if (options.resolveReports && status !== 'ACTIVE') {
        const ids = [...changed.posts, ...changed.comments].map((c) => c.id);
        if (ids.length)
          resolvedReports = (
            await sqlRows(
              m,
              `UPDATE reports SET status = 'RESOLVED', resolution_note = $2, resolved_by_id = $3, resolved_at = now(), updated_at = now()
                WHERE target_type IN ('POST', 'COMMENT') AND target_id = ANY($1::uuid[]) AND status IN ('OPEN', 'IN_REVIEW') RETURNING id`,
              [ids, reason, ctx.actor.id],
            )
          ).length;
      }
      const result = { batchId, posts: changed.posts.length, comments: changed.comments.length, resolvedReports };
      await this.audit.record(m, ctx, {
        action: `user.content_${ACTIONS[status]}`,
        targetType: 'USER',
        targetId: authorId,
        metadata: { reason, scope, newStatus: status, ...result },
      });
      return result;
    });
  }
}
