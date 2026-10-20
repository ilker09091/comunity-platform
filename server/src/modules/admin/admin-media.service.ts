import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { appConfig } from '../../config/app.config.js';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import { MediaService, type MediaRow } from '../media/media.service.js';
import { AuditService, type RequestContext } from '../platform/audit.service.js';
import { StepUpService } from '../platform/step-up.service.js';
import { AdminReadService, Params, userRefCols } from './admin-read.service.js';
import type {
  AdminMediaQueryDto,
  AdminMediaRowDto,
  AdminPage,
  CleanupPreviewDto,
  CleanupResultDto,
  MediaHealthDto,
  MediaScanResultDto,
} from './dto/admin.dto.js';
import { MediaUsageEnum } from './dto/admin.dto.js';

const STAT_TIMEOUT_MS = 3000;

const MEDIA_ROW_SQL = `
  SELECT m.*, ${userRefCols('o', 'oav', 'o')},
         CASE
           WHEN pm.post_id IS NOT NULL THEN 'POST'
           WHEN EXISTS (SELECT 1 FROM direct_messages dm WHERE dm.media_id = m.id) THEN 'MESSAGE'
           WHEN EXISTS (SELECT 1 FROM group_messages gm WHERE gm.media_id = m.id) THEN 'MESSAGE'
           WHEN EXISTS (SELECT 1 FROM chat_groups cg WHERE cg.avatar_media_id = m.id) THEN 'AVATAR'
           WHEN EXISTS (SELECT 1 FROM stories st WHERE st.media_id = m.id) THEN 'STORY'
           WHEN EXISTS (SELECT 1 FROM stickers sk WHERE sk.media_id = m.id) THEN 'STICKER'
           WHEN EXISTS (SELECT 1 FROM circle_posts cp WHERE cp.media_id = m.id) THEN 'CIRCLE'
           WHEN EXISTS (SELECT 1 FROM users ua WHERE ua.avatar_media_id = m.id) THEN 'AVATAR'
           WHEN EXISTS (SELECT 1 FROM users uc WHERE uc.cover_media_id = m.id) THEN 'COVER'
           ELSE 'UNATTACHED'
         END AS usage_kind,
         pm.post_id AS usage_post_id
    FROM media m
    JOIN users o ON o.id = m.owner_id
    LEFT JOIN media oav ON oav.id = o.avatar_media_id
    LEFT JOIN post_media pm ON pm.media_id = m.id`;

/** Unattached uploads older than the orphan TTL (the same rule as the hourly cleanup job). */
const ORPHAN_WHERE = `m.created_at < now() - make_interval(hours => $1)
  AND NOT EXISTS (SELECT 1 FROM post_media x WHERE x.media_id = m.id)
  AND NOT EXISTS (SELECT 1 FROM direct_messages dm WHERE dm.media_id = m.id)
  AND NOT EXISTS (SELECT 1 FROM group_messages gm WHERE gm.media_id = m.id)
          AND NOT EXISTS (SELECT 1 FROM chat_groups cg WHERE cg.avatar_media_id = m.id)
  AND NOT EXISTS (SELECT 1 FROM stories st WHERE st.media_id = m.id)
  AND NOT EXISTS (SELECT 1 FROM stickers sk WHERE sk.media_id = m.id)
  AND NOT EXISTS (SELECT 1 FROM circle_posts cp WHERE cp.media_id = m.id)
  AND NOT EXISTS (SELECT 1 FROM users x WHERE x.avatar_media_id = m.id OR x.cover_media_id = m.id)`;

@Injectable()
export class AdminMediaService {
  private readonly logger = new Logger(AdminMediaService.name);

  constructor(
    private readonly read: AdminReadService,
    private readonly media: MediaService,
    private readonly audit: AuditService,
    private readonly stepUp: StepUpService,
    @Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>,
  ) {}

  private row(r: Record<string, any>): AdminMediaRowDto {
    return {
      ...this.media.toDto(r as MediaRow),
      storageKey: r.storage_key,
      owner: this.read.ref(r, 'o')!,
      usage: { kind: r.usage_kind as MediaUsageEnum, postId: r.usage_post_id ?? null },
    };
  }

  async list(q: AdminMediaQueryDto): Promise<AdminPage<AdminMediaRowDto>> {
    const p = new Params();
    const where: string[] = [];
    if (q.type) where.push(`x.type = ${p.add(q.type)}`);
    if (q.status) where.push(`x.status = ${p.add(q.status)}`);
    if (q.usage) where.push(`x.usage_kind = ${p.add(q.usage)}`);
    if (q.ownerId) where.push(`x.owner_id = ${p.add(q.ownerId)}`);
    if (q.minSize !== undefined) where.push(`x.size_bytes >= ${p.add(q.minSize)}`);
    if (q.maxSize !== undefined) where.push(`x.size_bytes <= ${p.add(q.maxSize)}`);
    if (q.from) where.push(`x.created_at >= ${p.add(q.from)}::timestamptz`);
    if (q.to) where.push(`x.created_at < ${p.add(q.to)}::timestamptz`);
    const page = q.page ?? 1;
    const size = q.pageSize ?? 25;
    const order = q.order === 'asc' ? 'ASC' : 'DESC';
    const sort = q.sort === 'size' ? 'x.size_bytes' : 'x.created_at';
    const rows = await sqlRows(
      this.read.db,
      `SELECT x.*, count(*) OVER()::int AS total_count FROM (${MEDIA_ROW_SQL}) x
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY ${sort} ${order}, x.id ${order}
        LIMIT ${p.add(size)} OFFSET ${p.add((page - 1) * size)}`,
      p.values,
    );
    return { items: rows.map((r) => this.row(r)), page, pageSize: size, total: rows[0]?.total_count ?? 0 };
  }

  async detail(id: string): Promise<AdminMediaRowDto> {
    const row = await sqlOne(this.read.db, `${MEDIA_ROW_SQL} WHERE m.id = $1`, [id]);
    if (!row) throw AppException.notFound(ErrorCode.MEDIA_NOT_FOUND, 'Media not found');
    return this.row(row);
  }

  /** Checks the object in storage (with a timeout) against the database record. */
  private async check(m: { id: string; storage_key: string; size_bytes: string | number }): Promise<MediaHealthDto> {
    const recorded = Number(m.size_bytes);
    const base = { id: m.id, storageKey: m.storage_key, recordedBytes: recorded, checkedAt: new Date().toISOString() };
    try {
      const stat = await Promise.race([
        this.media.statObject(m.storage_key),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Storage check timed out')), STAT_TIMEOUT_MS)),
      ]);
      if (!stat.exists) return { ...base, state: 'MISSING', storedBytes: null, detail: 'Object not found in storage' };
      if (stat.size !== null && stat.size !== recorded)
        return { ...base, state: 'SIZE_MISMATCH', storedBytes: stat.size, detail: 'Stored size differs from the database record' };
      return { ...base, state: 'OK', storedBytes: stat.size, detail: null };
    } catch (error) {
      return { ...base, state: 'ERROR', storedBytes: null, detail: (error as Error).message.slice(0, 200) };
    }
  }

  async health(id: string): Promise<MediaHealthDto> {
    const row = await sqlOne<{ id: string; storage_key: string; size_bytes: string }>(
      this.read.db,
      `SELECT id, storage_key, size_bytes FROM media WHERE id = $1`,
      [id],
    );
    if (!row) throw AppException.notFound(ErrorCode.MEDIA_NOT_FOUND, 'Media not found');
    return this.check(row);
  }

  /** Scans a bounded page of media records for missing or inconsistent objects (read-only). */
  async scan(limit: number, afterId?: string): Promise<MediaScanResultDto> {
    const rows = await sqlRows<{ id: string; storage_key: string; size_bytes: string; status: string }>(
      this.read.db,
      `SELECT id, storage_key, size_bytes, status FROM media ${afterId ? 'WHERE id > $2' : ''} ORDER BY id LIMIT $1`,
      afterId ? [limit, afterId] : [limit],
    );
    const problems: MediaHealthDto[] = [];
    // Sequential checks keep load on the storage backend bounded.
    for (const row of rows) {
      const result = await this.check(row);
      if (result.state !== 'OK') problems.push(result);
      else if (row.status === 'FAILED')
        problems.push({ ...result, state: 'ERROR', detail: 'Media processing failed (status FAILED)' });
    }
    return { checked: rows.length, problems, nextAfterId: rows.length === limit ? rows[rows.length - 1].id : null };
  }

  async cleanupPreview(): Promise<CleanupPreviewDto> {
    const ttl = this.config.media.orphanTtlHours;
    const stats = await sqlOne<{ n: number; bytes: string }>(
      this.read.db,
      `SELECT count(*)::int AS n, coalesce(sum(m.size_bytes), 0)::text AS bytes FROM media m WHERE ${ORPHAN_WHERE}`,
      [ttl],
    );
    const rows = await sqlRows(this.read.db, `${MEDIA_ROW_SQL} WHERE ${ORPHAN_WHERE} ORDER BY m.created_at LIMIT 100`, [ttl]);
    return { ttlHours: ttl, count: stats!.n, totalBytes: Number(stats!.bytes), items: rows.map((r) => this.row(r)) };
  }

  /**
   * Deletes reviewed orphan candidates. Each id is re-checked (still unattached and older than
   * the TTL) under a row lock, so referenced media can never be deleted by this path.
   */
  async cleanupExecute(ctx: RequestContext, ids: string[]): Promise<CleanupResultDto> {
    await this.stepUp.assert(ctx);
    if (!ids.length) return { deleted: 0, skipped: 0, freedBytes: 0 };
    const deleted = await this.read.db.transaction(async (m) => {
      const rows = await sqlRows<{ id: string; storage_key: string; size_bytes: string }>(
        m,
        `WITH doomed AS (
           SELECT m.id FROM media m WHERE m.id = ANY($2::uuid[]) AND ${ORPHAN_WHERE} FOR UPDATE SKIP LOCKED)
         DELETE FROM media WHERE id IN (SELECT id FROM doomed) RETURNING id, storage_key, size_bytes`,
        [this.config.media.orphanTtlHours, ids],
      );
      const freed = rows.reduce((sum, r) => sum + Number(r.size_bytes), 0);
      await this.audit.record(m, ctx, {
        action: 'media.cleanup',
        targetType: 'MEDIA',
        metadata: { requested: ids.length, deleted: rows.length, freedBytes: freed, mediaIds: rows.map((r) => r.id).slice(0, 100) },
      });
      return rows;
    });
    for (const row of deleted) {
      await this.media.deleteObject(row.storage_key).catch((e) =>
        this.logger.warn({ message: 'Failed to delete stored object', key: row.storage_key, error: String(e) }),
      );
    }
    return {
      deleted: deleted.length,
      skipped: ids.length - deleted.length,
      freedBytes: deleted.reduce((sum, r) => sum + Number(r.size_bytes), 0),
    };
  }
}
