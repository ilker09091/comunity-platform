import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { iso } from '../../common/utils/cursor.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import { AccountGovernanceService } from '../platform/account-governance.service.js';
import { AuditService, type RequestContext } from '../platform/audit.service.js';
import { ContentModerationService } from '../platform/content-moderation.service.js';
import { assertPermission, hasPermission } from '../platform/permissions.js';
import { AdminContentService } from './admin-content.service.js';
import { AdminReadService, Params, USER_ROW_SQL, userRefCols } from './admin-read.service.js';
import {
  type AdminPage,
  type AdminReportDetailDto,
  type AdminReportRowDto,
  type AdminReportsQueryDto,
  type ReportActionDto,
  ReportActionEnum,
  type ReportNoteDto,
} from './dto/admin.dto.js';

type ReportStatus = 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'DISMISSED';
const TRANSITIONS: Record<ReportStatus, ReportStatus[]> = {
  OPEN: ['IN_REVIEW', 'RESOLVED', 'DISMISSED'],
  IN_REVIEW: ['OPEN', 'RESOLVED', 'DISMISSED'],
  RESOLVED: ['OPEN'],
  DISMISSED: ['OPEN'],
};

@Injectable()
export class AdminReportsService {
  constructor(
    private readonly read: AdminReadService,
    private readonly content: AdminContentService,
    private readonly audit: AuditService,
    private readonly moderation: ContentModerationService,
    private readonly governance: AccountGovernanceService,
  ) {}

  async list(ctx: RequestContext, q: AdminReportsQueryDto): Promise<AdminPage<AdminReportRowDto>> {
    const p = new Params();
    const where: string[] = [];
    const status = q.status ?? 'PENDING';
    if (status === 'PENDING') where.push(`r.status IN ('OPEN', 'IN_REVIEW')`);
    else where.push(`r.status = ${p.add(status)}`);
    if (q.targetType === 'REEL') where.push(`r.target_type = 'POST' AND coalesce(t.is_reel, false)`);
    else if (q.targetType === 'POST') where.push(`r.target_type = 'POST' AND NOT coalesce(t.is_reel, false)`);
    else if (q.targetType) where.push(`r.target_type = ${p.add(q.targetType)}`);
    if (q.reason) where.push(`r.reason = ${p.add(q.reason)}`);
    if (q.assigned === 'me') where.push(`r.assigned_to_id = ${p.add(ctx.actor.id)}`);
    if (q.assigned === 'unassigned') where.push(`r.assigned_to_id IS NULL`);
    if (q.targetId) where.push(`r.target_id = ${p.add(q.targetId)}`);
    if (q.from) where.push(`r.created_at >= ${p.add(q.from)}::timestamptz`);
    if (q.to) where.push(`r.created_at < ${p.add(q.to)}::timestamptz`);
    const page = q.page ?? 1;
    const size = q.pageSize ?? 25;
    // Pending queues default to oldest first (first in, first out).
    const order = q.order ? (q.order === 'asc' ? 'ASC' : 'DESC') : status === 'PENDING' ? 'ASC' : 'DESC';
    const rows = await sqlRows(
      this.read.db,
      `SELECT x.*, count(*) OVER()::int AS total_count FROM (${this.read.sql.report} WHERE ${where.join(' AND ')}) x
        ORDER BY x.created_at ${order}, x.id ${order}
        LIMIT ${p.add(size)} OFFSET ${p.add((page - 1) * size)}`,
      p.values,
    );
    return { items: rows.map((r) => this.read.reportRow(r)), page, pageSize: size, total: rows[0]?.total_count ?? 0 };
  }

  private async row(id: string): Promise<AdminReportRowDto> {
    const row = await sqlOne(this.read.db, `${this.read.sql.report} WHERE r.id = $1`, [id]);
    if (!row) throw AppException.notFound(ErrorCode.REPORT_NOT_FOUND, 'Report not found');
    return this.read.reportRow(row);
  }

  async detail(ctx: RequestContext, id: string): Promise<AdminReportDetailDto> {
    const report = await this.row(id);
    const exists = report.target.exists;
    const emails = hasPermission(ctx.actor.role, 'users.email.read');
    const user =
      report.targetType === 'USER' && exists
        ? await sqlOne(this.read.db, `${USER_ROW_SQL(emails)} WHERE u.id = $1`, [report.targetId])
        : null;
    const notes = await sqlRows(
      this.read.db,
      `SELECT n.*, ${userRefCols('na', 'naav', 'na')}
         FROM report_notes n LEFT JOIN users na ON na.id = n.author_id LEFT JOIN media naav ON naav.id = na.avatar_media_id
        WHERE n.report_id = $1 ORDER BY n.created_at`,
      [id],
    );
    const related = (
      await this.read.reportsFor(`r.target_type = $1 AND r.target_id = $2 AND r.id <> $3`, [report.targetType, report.targetId, id], 50)
    );
    const history = [...(await this.read.history('REPORT', [id])), ...(await this.read.history(report.targetType, [report.targetId]))]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 40);
    return {
      report,
      post: report.targetType === 'POST' && exists ? await this.content.postDetail(report.targetId) : null,
      comment: report.targetType === 'COMMENT' && exists ? await this.content.commentDetail(report.targetId) : null,
      user: user ? this.read.userRow(user) : null,
      related,
      notes: notes.map((n): ReportNoteDto => ({ id: n.id, author: this.read.ref(n, 'na'), body: n.body, createdAt: iso(n.created_at)! })),
      history,
    };
  }

  private async lock(m: EntityManager, id: string) {
    const row = await sqlOne<{ status: ReportStatus; target_type: 'POST' | 'COMMENT' | 'USER'; target_id: string; assigned_to_id: string | null }>(
      m,
      `SELECT status, target_type, target_id, assigned_to_id FROM reports WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!row) throw AppException.notFound(ErrorCode.REPORT_NOT_FOUND, 'Report not found');
    return row;
  }

  async assign(ctx: RequestContext, id: string, assigneeId: string | null): Promise<AdminReportRowDto> {
    await this.read.db.transaction(async (m) => {
      const report = await this.lock(m, id);
      if (assigneeId) {
        const assignee = await sqlOne<{ role: string; status: string }>(m, `SELECT role, status FROM users WHERE id = $1`, [assigneeId]);
        if (!assignee || assignee.status !== 'ACTIVE' || !hasPermission(assignee.role as never, 'reports.resolve'))
          throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Validation failed', [
            { field: 'assigneeId', message: 'The assignee must be an active staff member who can resolve reports' },
          ]);
      }
      const nextStatus = assigneeId && report.status === 'OPEN' ? 'IN_REVIEW' : report.status;
      await sqlRows(
        m,
        `UPDATE reports SET assigned_to_id = $2, status = $3, updated_at = now() WHERE id = $1`,
        [id, assigneeId, nextStatus],
      );
      await this.audit.record(m, ctx, {
        action: assigneeId ? 'report.assigned' : 'report.unassigned',
        targetType: 'REPORT',
        targetId: id,
        metadata: { from: report.assigned_to_id, to: assigneeId, previousStatus: report.status, newStatus: nextStatus },
      });
    });
    return this.row(id);
  }

  async setStatus(ctx: RequestContext, id: string, status: ReportStatus, note?: string): Promise<AdminReportRowDto> {
    await this.read.db.transaction(async (m) => this.transition(m, ctx, id, status, note));
    return this.row(id);
  }

  private async transition(m: EntityManager, ctx: RequestContext, id: string, status: ReportStatus, note?: string, extra: Record<string, unknown> = {}) {
    const report = await this.lock(m, id);
    if (report.status === status) return;
    if (!TRANSITIONS[report.status].includes(status))
      throw AppException.conflict(ErrorCode.INVALID_STATE, `A ${report.status} report cannot become ${status}`);
    const closing = status === 'RESOLVED' || status === 'DISMISSED';
    try {
      await sqlRows(
        m,
        `UPDATE reports SET status = $2, updated_at = now(),
                resolution_note = CASE WHEN $3 THEN $4 ELSE resolution_note END,
                resolved_by_id = CASE WHEN $3 THEN $5::uuid ELSE NULL END,
                resolved_at = CASE WHEN $3 THEN now() ELSE NULL END
          WHERE id = $1`,
        [id, status, closing, note ?? null, ctx.actor.id],
      );
    } catch (error) {
      if ((error as { driverError?: { code?: string } }).driverError?.code === '23505')
        throw AppException.conflict(ErrorCode.INVALID_STATE, 'The reporter already has another open report for this target');
      throw error;
    }
    await this.audit.record(m, ctx, {
      action: status === 'OPEN' ? 'report.reopened' : `report.${status.toLowerCase()}`,
      targetType: 'REPORT',
      targetId: id,
      metadata: { previousStatus: report.status, newStatus: status, note: note ?? null, ...extra },
    });
  }

  async addNote(ctx: RequestContext, id: string, body: string): Promise<ReportNoteDto> {
    const note = await this.read.db.transaction(async (m) => {
      await this.lock(m, id);
      const row = await sqlOne<{ id: string; created_at: Date }>(
        m,
        `INSERT INTO report_notes (report_id, author_id, body) VALUES ($1, $2, $3) RETURNING id, created_at`,
        [id, ctx.actor.id, body],
      );
      await this.audit.record(m, ctx, { action: 'report.note_added', targetType: 'REPORT', targetId: id, metadata: { noteId: row!.id } });
      return row!;
    });
    const author = await sqlOne(
      this.read.db,
      `SELECT ${userRefCols('u', 'uav', 'na')} FROM users u LEFT JOIN media uav ON uav.id = u.avatar_media_id WHERE u.id = $1`,
      [ctx.actor.id],
    );
    return { id: note.id, author: this.read.ref(author!, 'na'), body, createdAt: note.created_at.toISOString() };
  }

  /**
   * Applies an action to the report target through the shared governance services (so their
   * permission, rank, step-up and audit rules apply), then optionally resolves the report and
   * all other pending reports on the same target.
   */
  async act(ctx: RequestContext, id: string, dto: ReportActionDto): Promise<AdminReportRowDto> {
    assertPermission(ctx.actor.role, 'reports.resolve');
    const report = await this.row(id);
    if (!report.target.exists) throw AppException.conflict(ErrorCode.INVALID_STATE, 'The reported target no longer exists');
    const contentKind = report.targetType === 'POST' ? 'post' : report.targetType === 'COMMENT' ? 'comment' : null;
    const ownerId = report.target.owner?.id;
    const options = { reason: dto.reason, reportId: id };

    switch (dto.action) {
      case ReportActionEnum.HIDE_CONTENT:
      case ReportActionEnum.REMOVE_CONTENT:
      case ReportActionEnum.RESTORE_CONTENT: {
        if (!contentKind) throw AppException.badRequest(ErrorCode.BAD_REQUEST, 'Content actions apply to posts and comments');
        const status = dto.action === 'HIDE_CONTENT' ? 'HIDDEN' : dto.action === 'REMOVE_CONTENT' ? 'REMOVED' : 'ACTIVE';
        await this.moderation.setStatus(ctx, contentKind, report.targetId, status, options);
        break;
      }
      case ReportActionEnum.WARN_USER:
        if (!ownerId) throw AppException.conflict(ErrorCode.INVALID_STATE, 'No account to warn');
        await this.governance.warn(ctx, ownerId, { reason: report.reason, message: dto.warningMessage || dto.reason, reportId: id });
        break;
      case ReportActionEnum.SUSPEND_USER:
        if (!ownerId) throw AppException.conflict(ErrorCode.INVALID_STATE, 'No account to suspend');
        await this.governance.suspend(ctx, ownerId, { reason: dto.reason, expiresAt: dto.expiresAt ?? null, reportId: id });
        break;
      case ReportActionEnum.BAN_USER:
        if (!ownerId) throw AppException.conflict(ErrorCode.INVALID_STATE, 'No account to ban');
        await this.governance.ban(ctx, ownerId, { reason: dto.reason, confirmUsername: dto.confirmUsername ?? '', reportId: id });
        break;
    }

    if (dto.resolve ?? true) {
      await this.read.db.transaction(async (m) => {
        const others = await sqlRows<{ id: string }>(
          m,
          `SELECT id FROM reports WHERE target_type = $1 AND target_id = $2 AND status IN ('OPEN', 'IN_REVIEW') AND id <> $3 FOR UPDATE`,
          [report.targetType, report.targetId, id],
        );
        if (report.status === 'OPEN' || report.status === 'IN_REVIEW')
          await this.transition(m, ctx, id, 'RESOLVED', dto.reason, { action: dto.action });
        for (const other of others) await this.transition(m, ctx, other.id, 'RESOLVED', dto.reason, { action: dto.action, via: id });
      });
    } else {
      await this.audit.record(this.read.db, ctx, { action: 'report.action_taken', targetType: 'REPORT', targetId: id, metadata: { action: dto.action } });
    }
    return this.row(id);
  }
}
