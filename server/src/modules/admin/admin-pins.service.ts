import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import { AuditService, type RequestContext } from '../platform/audit.service.js';

/** Administrator-pinned posts shown at the top of the home feed. */
@Injectable()
export class AdminPinsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly audit: AuditService,
  ) {}

  async setPinned(ctx: RequestContext, postId: string, pinned: boolean): Promise<{ id: string; isPinned: boolean }> {
    return this.db.transaction(async (m) => {
      const post = await sqlOne<{ kind: string; visibility: string; deleted_at: Date | null; moderation_status: string; pinned_at: Date | null }>(
        m,
        `SELECT kind, visibility, deleted_at, moderation_status, pinned_at FROM posts WHERE id = $1 FOR UPDATE`,
        [postId],
      );
      if (!post) throw AppException.notFound(ErrorCode.POST_NOT_FOUND, 'Post not found');
      if (pinned) {
        if (post.deleted_at || post.moderation_status !== 'ACTIVE')
          throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Only active posts can be pinned');
        if (post.kind === 'REPOST' || post.visibility !== 'PUBLIC')
          throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Only public original posts and quotes can be pinned');
      }
      if (!!post.pinned_at === pinned) return { id: postId, isPinned: pinned };
      await sqlRows(m, `UPDATE posts SET pinned_at = ${pinned ? 'now()' : 'NULL'} WHERE id = $1`, [postId]);
      await this.audit.record(m, ctx, { action: pinned ? 'post.pinned' : 'post.unpinned', targetType: 'POST', targetId: postId, metadata: {} });
      return { id: postId, isPinned: pinned };
    });
  }
}
