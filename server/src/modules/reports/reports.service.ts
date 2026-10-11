import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AccountGovernanceService } from '../platform/account-governance.service.js';
import { AuditService, type RequestContext } from '../platform/audit.service.js';
import { ContentModerationService } from '../platform/content-moderation.service.js';
import { PlatformSettingsService } from '../platform/platform-settings.service.js';
import type { Page } from '../../common/dto/common.dto.js';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { decodeCursor, iso, toPage } from '../../common/utils/cursor.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import { CommentsService } from '../comments/comments.service.js';
import { PostsQueryService } from '../posts/posts-query.service.js';
import { UserRoleEnum } from '../users/dto/user.dto.js';
import { USER_AVATAR_JOIN, USER_SUMMARY_COLUMNS, UsersService } from '../users/users.service.js';
import {
  CreateReportDto,
  ModerationActionEnum,
  ModerationReportDto,
  ModerationResultDto,
  ReportDto,
  ReportStatusEnum,
  ReportTargetTypeEnum,
  ResolveReportDto,
} from './dto/report.dto.js';

const MODERATION_REPORT_SELECT = `
  SELECT r.id AS report_id, r.target_type, r.target_id, r.reason, r.details, r.status, r.created_at,
         r.resolution_note, r.resolved_by_id, r.resolved_at, ${USER_SUMMARY_COLUMNS},
         (SELECT count(*)::int FROM reports r2
           WHERE r2.target_type = r.target_type AND r2.target_id = r.target_id AND r2.status = 'OPEN') AS open_for_target
    FROM reports r
    JOIN users u ON u.id = r.reporter_id
    ${USER_AVATAR_JOIN}`;

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly posts: PostsQueryService,
    private readonly comments: CommentsService,
    private readonly users: UsersService,
    private readonly settings: PlatformSettingsService,
    private readonly moderation: ContentModerationService,
    private readonly governance: AccountGovernanceService,
    private readonly audit: AuditService,
  ) {}

  private toDto(r: Record<string, any>): ReportDto {
    return {
      id: r.id,
      targetType: r.target_type,
      targetId: r.target_id,
      reason: r.reason,
      details: r.details,
      status: r.status,
      createdAt: iso(r.created_at)!,
    };
  }

  async create(reporterId: string, dto: CreateReportDto): Promise<ReportDto> {
    await this.settings.assertFeature('reporting');
    const { moderation } = await this.settings.get();
    if (!moderation.allowedReportReasons.includes(dto.reason))
      throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Validation failed', [
        { field: 'reason', message: 'This report reason is not currently accepted' },
      ]);
    let ownerId: string;
    if (dto.targetType === ReportTargetTypeEnum.POST) {
      ownerId = (await this.posts.getVisible(dto.targetId, reporterId)).author_id;
    } else if (dto.targetType === ReportTargetTypeEnum.COMMENT) {
      const comment = await this.comments.get(dto.targetId, reporterId);
      if (!comment.author) throw AppException.notFound(ErrorCode.COMMENT_NOT_FOUND, 'Comment not found');
      ownerId = comment.author.id;
    } else {
      ownerId = (await this.users.getActiveTarget(dto.targetId)).id;
    }
    if (ownerId === reporterId) throw AppException.badRequest(ErrorCode.CANNOT_REPORT_SELF, 'You cannot report your own content');

    try {
      const row = await sqlOne(
        this.db,
        `INSERT INTO reports (reporter_id, target_type, target_id, reason, details)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [reporterId, dto.targetType, dto.targetId, dto.reason, dto.details ?? null],
      );
      this.logger.log({ message: 'Report filed', reportId: row!.id, targetType: dto.targetType, targetId: dto.targetId });
      return this.toDto(row!);
    } catch (error) {
      if ((error as { driverError?: { code?: string } }).driverError?.code === '23505') {
        throw AppException.conflict(ErrorCode.ALREADY_REPORTED, 'You already have an open report for this target');
      }
      throw error;
    }
  }

  async listForModeration(
    filter: { status?: ReportStatusEnum; targetType?: ReportTargetTypeEnum },
    cursorStr: string | undefined,
    limit: number,
  ): Promise<Page<ModerationReportDto>> {
    const cursor = decodeCursor(cursorStr, ['date', 'uuid']);
    const params: unknown[] = [filter.status ?? ReportStatusEnum.OPEN, filter.targetType ?? null, limit + 1];
    if (cursor) params.push(...cursor);
    const rows = await sqlRows(
      this.db,
      `${MODERATION_REPORT_SELECT}
        WHERE r.status = $1 AND ($2::report_target_type IS NULL OR r.target_type = $2::report_target_type)
          ${cursor ? 'AND (r.created_at, r.id) < ($4::timestamptz, $5::uuid)' : ''}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT $3`,
      params,
    );
    return toPage(rows, limit, (r) => this.toModerationDto(r), (r) => [iso(r.created_at)!, r.report_id]);
  }

  private toModerationDto(r: Record<string, any>): ModerationReportDto {
    return {
      ...this.toDto({ ...r, id: r.report_id }),
      reporter: this.users.toSummary(r as never),
      openReportsForTarget: r.open_for_target,
      resolutionNote: r.resolution_note,
      resolvedById: r.resolved_by_id,
      resolvedAt: iso(r.resolved_at),
    };
  }

  async resolve(ctx: RequestContext, reportId: string, dto: ResolveReportDto): Promise<ModerationReportDto> {
    const action = dto.action ?? ModerationActionEnum.NONE;
    const report = await sqlOne<{ target_type: ReportTargetTypeEnum; target_id: string }>(
      this.db,
      `SELECT target_type, target_id FROM reports WHERE id = $1`,
      [reportId],
    );
    if (!report) throw AppException.notFound(ErrorCode.REPORT_NOT_FOUND, 'Report not found');
    const reason = dto.note ?? `Resolved report ${reportId}`;
    // Actions go through the shared governance services (permission, rank and audit rules).
    if (action === ModerationActionEnum.REMOVE_CONTENT) {
      if (report.target_type === ReportTargetTypeEnum.USER)
        throw AppException.badRequest(ErrorCode.BAD_REQUEST, 'REMOVE_CONTENT applies to posts and comments');
      await this.moderation.setStatus(ctx, report.target_type === 'POST' ? 'post' : 'comment', report.target_id, 'REMOVED', {
        reason,
        reportId,
      });
    } else if (action === ModerationActionEnum.SUSPEND_USER) {
      const userId = await this.ownerOf(this.db, report.target_type, report.target_id);
      await this.governance.suspend(ctx, userId, { reason, reportId });
    }
    await this.db.transaction(async (m) => {
      await sqlRows(
        m,
        `UPDATE reports SET status = $2, resolution_note = $3, resolved_by_id = $4, resolved_at = now(), updated_at = now()
          WHERE ${action === ModerationActionEnum.NONE ? 'id = $1' : `(status IN ('OPEN', 'IN_REVIEW') AND target_type = $5 AND target_id = $6) OR id = $1`}`,
        action === ModerationActionEnum.NONE
          ? [reportId, dto.status, dto.note ?? null, ctx.actor.id]
          : [reportId, dto.status, dto.note ?? null, ctx.actor.id, report.target_type, report.target_id],
      );
      await this.audit.record(m, ctx, {
        action: dto.status === 'RESOLVED' ? 'report.resolved' : 'report.dismissed',
        targetType: 'REPORT',
        targetId: reportId,
        metadata: { note: dto.note ?? null, action, via: 'moderation-endpoint' },
      });
    });
    this.logger.log({ message: 'Report resolved', reportId, moderatorId: ctx.actor.id, status: dto.status, action });
    return this.getModerationReport(reportId);
  }

  private async getModerationReport(reportId: string): Promise<ModerationReportDto> {
    const r = await sqlOne(this.db, `${MODERATION_REPORT_SELECT} WHERE r.id = $1`, [reportId]);
    if (!r) throw AppException.notFound(ErrorCode.REPORT_NOT_FOUND, 'Report not found');
    return this.toModerationDto(r);
  }

  private async ownerOf(m: EntityManager | DataSource, type: ReportTargetTypeEnum, id: string): Promise<string> {
    if (type === ReportTargetTypeEnum.USER) return id;
    const row = await sqlOne<{ author_id: string }>(
      m,
      `SELECT author_id FROM ${type === ReportTargetTypeEnum.POST ? 'posts' : 'comments'} WHERE id = $1`,
      [id],
    );
    if (!row) throw AppException.notFound(ErrorCode.NOT_FOUND, 'Reported content no longer exists');
    return row.author_id;
  }

  async moderateContent(
    ctx: RequestContext,
    table: 'posts' | 'comments',
    id: string,
    status: 'ACTIVE' | 'REMOVED',
  ): Promise<ModerationResultDto> {
    const result = await this.moderation.setStatus(ctx, table === 'posts' ? 'post' : 'comment', id, status, {
      reason: status === 'REMOVED' ? 'Removed via moderation endpoint' : 'Restored via moderation endpoint',
    });
    return { id, status: result.status };
  }

  async changeUserStatus(ctx: RequestContext, userId: string, status: 'ACTIVE' | 'SUSPENDED'): Promise<ModerationResultDto> {
    const result =
      status === 'SUSPENDED'
        ? await this.governance.suspend(ctx, userId, { reason: 'Suspended via moderation endpoint' })
        : await this.governance.reinstate(ctx, userId, 'Reinstated via moderation endpoint');
    return { id: userId, status: result.status };
  }

  /** Legacy role endpoint: same rules as the admin API (rank checks, step-up, audit). */
  async setRole(ctx: RequestContext, userId: string, role: UserRoleEnum): Promise<ModerationResultDto> {
    const result = await this.governance.setRole(ctx, userId, role);
    return { id: userId, status: result.role };
  }
}
