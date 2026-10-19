import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { join } from 'node:path';
import type { UserRole } from '../../common/decorators/auth.decorators.js';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import { recountUserPosts, recountPostEngagement } from '../../common/utils/counters.js';
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

  async deleteAccount(ctx: RequestContext, userId: string, reason: string, confirmUsername: string): Promise<DeletionResultDto> {
    await this.stepUp.assert(ctx);
    assertPermission(ctx.actor.role, 'users.ban', 'media.manage');
    return this.run(async m => {
      const user=await sqlOne<{id:string;role:UserRole;username:string}>(m,'SELECT id,role,username FROM users WHERE id=$1 FOR UPDATE',[userId]);
      if(!user) throw AppException.notFound(ErrorCode.USER_NOT_FOUND,'User not found');
      assertOutranks(ctx.actor,user);
      if(user.role==='SUPER_ADMIN') throw AppException.forbidden(ErrorCode.FORBIDDEN,'A super administrator cannot be deleted');
      if(confirmUsername!==user.username) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR,'Type the exact username to confirm deletion');
      const posts=(await sqlRows<{id:string}>(m,'SELECT id FROM posts WHERE author_id=$1',[userId])).map(r=>r.id);
      const comments=(await sqlRows<{id:string}>(m,'SELECT id FROM comments WHERE author_id=$1',[userId])).map(r=>r.id);
      const affected=(await sqlRows<{id:string}>(m,`SELECT post_id id FROM post_likes WHERE user_id=$1 UNION SELECT post_id FROM bookmarks WHERE user_id=$1
        UNION SELECT post_id FROM comments WHERE author_id=$1 UNION SELECT referenced_post_id FROM posts WHERE author_id=$1 AND referenced_post_id IS NOT NULL`,[userId])).map(r=>r.id);
      const neighbors=(await sqlRows<{id:string}>(m,`SELECT follower_id id FROM follows WHERE following_id=$1 UNION SELECT following_id FROM follows WHERE follower_id=$1`,[userId])).map(r=>r.id);
      const files=await sqlRows<{storage_key:string;size_bytes:string}>(m,'SELECT storage_key,size_bytes FROM media WHERE owner_id=$1',[userId]);
      const clips=await sqlRows<{storage_key:string}>(m,`SELECT storage_key FROM note_audio WHERE owner_id=$1 UNION SELECT audio_key FROM notes WHERE author_id=$1 AND audio_key IS NOT NULL`,[userId]);
      const audio=await sqlRows<{path:string}>(m,'SELECT path FROM audio_uploads WHERE owner_id=$1',[userId]);
      const uploads=await sqlRows<{id:string}>(m,'SELECT id FROM media_upload_sessions WHERE owner_id=$1',[userId]);
      await this.deletion.queuePrivateFiles(m,[...audio.map(a=>a.path),...uploads.map(u=>join('.incoming','uploads',u.id+'.part')),
        ...files.map(f=>join('.incoming',f.storage_key+'.source'))]);
      const resolved=await this.closeReports(m,ctx,[userId,...posts,...comments],reason);
      const deleted=await this.deletion.deletePosts(m,posts);
      const removedComments=await this.deletion.deleteComments(m,comments);
      // Cascades remove account data. The media DELETE trigger durably queues its files.
      await m.query('DELETE FROM users WHERE id=$1',[userId]);
      await recountPostEngagement(m,affected);
      if(affected.length) await m.query(`UPDATE posts p SET like_count=(SELECT count(*) FROM post_likes l WHERE l.post_id=p.id),
        bookmark_count=(SELECT count(*) FROM bookmarks b WHERE b.post_id=p.id) WHERE p.id=ANY($1::uuid[])`,[affected]);
      if(neighbors.length) await m.query(`UPDATE users u SET follower_count=(SELECT count(*) FROM follows f WHERE f.following_id=u.id),
        following_count=(SELECT count(*) FROM follows f WHERE f.follower_id=u.id) WHERE u.id=ANY($1::uuid[])`,[neighbors]);
      const keys=[...new Set([...files.map(f=>f.storage_key),...clips.map(f=>f.storage_key),...deleted.pending.keys])];
      const pending=await this.deletion.queueFiles(m,keys);
      const result={posts:deleted.posts,comments:removedComments+deleted.comments,files:keys.length,
        freedBytes:files.reduce((sum,f)=>sum+Number(f.size_bytes),0),resolvedReports:resolved};
      await this.audit.record(m,ctx,{action:'user.deleted',targetType:'USER',targetId:userId,metadata:{reason,...result}});
      return {result,files:pending};
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
