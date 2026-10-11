import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { iso } from '../../common/utils/cursor.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import { AuditService, type RequestContext } from '../platform/audit.service.js';
import { StepUpService } from '../platform/step-up.service.js';
import { AdminReadService, userRefCols } from './admin-read.service.js';
import type { AdminPage, AnnouncementDto, AnnouncementsQueryDto, SaveAnnouncementDto } from './dto/admin.dto.js';

const ANNOUNCEMENT_SQL = `
  SELECT a.*, ${userRefCols('cb', 'cbav', 'cb')}, ${userRefCols('pb', 'pbav', 'pb')},
         (SELECT count(*)::int FROM announcement_reads ar WHERE ar.announcement_id = a.id) AS read_count,
         (SELECT count(*)::int FROM announcement_recipients rc WHERE rc.announcement_id = a.id) AS selected_count,
         ARRAY(SELECT u.username::text FROM announcement_recipients rc JOIN users u ON u.id = rc.user_id
                WHERE rc.announcement_id = a.id ORDER BY u.username LIMIT 50) AS selected_usernames
    FROM announcements a
    LEFT JOIN users cb ON cb.id = a.created_by_id
    LEFT JOIN media cbav ON cbav.id = cb.avatar_media_id
    LEFT JOIN users pb ON pb.id = a.published_by_id
    LEFT JOIN media pbav ON pbav.id = pb.avatar_media_id`;

/**
 * Platform announcements delivered to users' in-app inbox. Drafts are editable; publishing
 * is a one-time, step-up-protected transition guarded by a row lock (idempotent: a second
 * publish of the same announcement is rejected, never duplicated).
 */
@Injectable()
export class AdminAnnouncementsService {
  constructor(
    private readonly read: AdminReadService,
    private readonly audit: AuditService,
    private readonly stepUp: StepUpService,
  ) {}

  private map(r: Record<string, any>): AnnouncementDto {
    return {
      id: r.id,
      title: r.title,
      body: r.body,
      audience: r.audience,
      status: r.status,
      recipientCount: r.recipient_count,
      readCount: r.read_count,
      selectedUsernames: r.selected_usernames ?? [],
      selectedCount: r.selected_count,
      createdBy: this.read.ref(r, 'cb'),
      publishedBy: this.read.ref(r, 'pb'),
      createdAt: iso(r.created_at)!,
      updatedAt: iso(r.updated_at)!,
      publishedAt: iso(r.published_at),
      archivedAt: iso(r.archived_at),
    };
  }

  async get(id: string): Promise<AnnouncementDto> {
    const row = await sqlOne(this.read.db, `${ANNOUNCEMENT_SQL} WHERE a.id = $1`, [id]);
    if (!row) throw AppException.notFound(ErrorCode.NOT_FOUND, 'Announcement not found');
    return this.map(row);
  }

  async list(q: AnnouncementsQueryDto): Promise<AdminPage<AnnouncementDto>> {
    const page = q.page ?? 1;
    const size = q.pageSize ?? 25;
    const rows = await sqlRows(
      this.read.db,
      `SELECT x.*, count(*) OVER()::int AS total_count FROM (${ANNOUNCEMENT_SQL} ${q.status ? 'WHERE a.status = $3' : ''}) x
        ORDER BY x.created_at DESC, x.id DESC LIMIT $1 OFFSET $2`,
      q.status ? [size, (page - 1) * size, q.status] : [size, (page - 1) * size],
    );
    return { items: rows.map((r) => this.map(r)), page, pageSize: size, total: rows[0]?.total_count ?? 0 };
  }

  private async setRecipients(m: EntityManager, id: string, dto: SaveAnnouncementDto) {
    await sqlRows(m, `DELETE FROM announcement_recipients WHERE announcement_id = $1`, [id]);
    if (dto.audience !== 'SELECTED') return;
    const usernames = [...new Set((dto.recipientUsernames ?? []).map((u) => u.toLowerCase()))];
    if (!usernames.length)
      throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Validation failed', [
        { field: 'recipientUsernames', message: 'Select at least one recipient' },
      ]);
    const found = await sqlRows<{ id: string; username: string }>(
      m,
      `SELECT id, lower(username::text) AS username FROM users WHERE lower(username::text) = ANY($1::text[]) AND status = 'ACTIVE'`,
      [usernames],
    );
    const missing = usernames.filter((u) => !found.some((f) => f.username === u));
    if (missing.length)
      throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Validation failed', [
        { field: 'recipientUsernames', message: `Unknown or inactive accounts: ${missing.slice(0, 20).join(', ')}` },
      ]);
    await sqlRows(
      m,
      `INSERT INTO announcement_recipients (announcement_id, user_id) SELECT $1, unnest($2::uuid[])`,
      [id, found.map((f) => f.id)],
    );
  }

  async create(ctx: RequestContext, dto: SaveAnnouncementDto): Promise<AnnouncementDto> {
    const id = await this.read.db.transaction(async (m) => {
      const row = await sqlOne<{ id: string }>(
        m,
        `INSERT INTO announcements (title, body, audience, created_by_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [dto.title, dto.body, dto.audience, ctx.actor.id],
      );
      await this.setRecipients(m, row!.id, dto);
      await this.audit.record(m, ctx, { action: 'announcement.created', targetType: 'ANNOUNCEMENT', targetId: row!.id, metadata: { audience: dto.audience } });
      return row!.id;
    });
    return this.get(id);
  }

  private async lockDraft(m: EntityManager, id: string) {
    const row = await sqlOne<{ status: string; audience: string; title: string }>(
      m,
      `SELECT status, audience, title FROM announcements WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!row) throw AppException.notFound(ErrorCode.NOT_FOUND, 'Announcement not found');
    return row;
  }

  async update(ctx: RequestContext, id: string, dto: SaveAnnouncementDto): Promise<AnnouncementDto> {
    await this.read.db.transaction(async (m) => {
      const row = await this.lockDraft(m, id);
      if (row.status !== 'DRAFT') throw AppException.conflict(ErrorCode.INVALID_STATE, 'Only drafts can be edited');
      await sqlRows(
        m,
        `UPDATE announcements SET title = $2, body = $3, audience = $4, updated_at = now() WHERE id = $1`,
        [id, dto.title, dto.body, dto.audience],
      );
      await this.setRecipients(m, id, dto);
      await this.audit.record(m, ctx, { action: 'announcement.updated', targetType: 'ANNOUNCEMENT', targetId: id });
    });
    return this.get(id);
  }

  async publish(ctx: RequestContext, id: string): Promise<AnnouncementDto> {
    await this.stepUp.assert(ctx);
    await this.read.db.transaction(async (m) => {
      const row = await this.lockDraft(m, id);
      if (row.status !== 'DRAFT')
        throw AppException.conflict(ErrorCode.INVALID_STATE, `This announcement is already ${row.status.toLowerCase()}`);
      const count = await sqlOne<{ n: number }>(
        m,
        row.audience === 'ALL'
          ? `SELECT count(*)::int AS n FROM users WHERE status = 'ACTIVE'`
          : `SELECT count(*)::int AS n FROM announcement_recipients WHERE announcement_id = $1`,
        row.audience === 'ALL' ? [] : [id],
      );
      await sqlRows(
        m,
        `UPDATE announcements SET status = 'PUBLISHED', published_at = now(), published_by_id = $2,
                recipient_count = $3, updated_at = now() WHERE id = $1`,
        [id, ctx.actor.id, count!.n],
      );
      await this.audit.record(m, ctx, {
        action: 'announcement.published',
        targetType: 'ANNOUNCEMENT',
        targetId: id,
        metadata: { audience: row.audience, recipientCount: count!.n, title: row.title },
      });
    });
    return this.get(id);
  }

  async archive(ctx: RequestContext, id: string): Promise<AnnouncementDto> {
    await this.read.db.transaction(async (m) => {
      const row = await this.lockDraft(m, id);
      if (row.status === 'ARCHIVED') return;
      await sqlRows(m, `UPDATE announcements SET status = 'ARCHIVED', archived_at = now(), updated_at = now() WHERE id = $1`, [id]);
      await this.audit.record(m, ctx, {
        action: 'announcement.archived',
        targetType: 'ANNOUNCEMENT',
        targetId: id,
        metadata: { previousStatus: row.status },
      });
    });
    return this.get(id);
  }
}
