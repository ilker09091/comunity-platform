import { readFileSync } from 'node:fs';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { appConfig } from '../../config/app.config.js';
import { recentServerErrors } from '../../common/errors/recent-errors.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import { migrations } from '../../database/migrations/index.js';
import { MediaService } from '../media/media.service.js';
import type { RequestContext } from '../platform/audit.service.js';
import { JobRegistryService } from '../platform/job-registry.service.js';
import { assignableRoles, hasPermission, PERMISSIONS, ROLE_PERMISSIONS, ROLE_RANK } from '../platform/permissions.js';
import { PlatformSettingsService } from '../platform/platform-settings.service.js';
import { UserRoleEnum } from '../users/dto/user.dto.js';
import { AdminReadService, Params, USER_ROW_SQL } from './admin-read.service.js';
import { API_VERSION } from '../../setup-app.js';
import type { AdminPage, AuditLogDto, AuditQueryDto, RolesOverviewDto, SystemStatusDto } from './dto/admin.dto.js';

const STARTED_AT = new Date();
const APP_VERSION = (() => {
  try {
    return (JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string }).version;
  } catch {
    return 'unknown';
  }
})();

@Injectable()
export class AdminOpsService {
  constructor(
    private readonly read: AdminReadService,
    private readonly media: MediaService,
    private readonly jobs: JobRegistryService,
    private readonly settings: PlatformSettingsService,
    @Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>,
  ) {}

  async roles(ctx: RequestContext): Promise<RolesOverviewDto> {
    const counts = await sqlRows<{ role: UserRoleEnum; n: number }>(this.read.db, `SELECT role, count(*)::int AS n FROM users GROUP BY role`);
    const assignable = hasPermission(ctx.actor.role, 'users.roles.manage') ? assignableRoles(ctx.actor.role) : [];
    const staff = await sqlRows(
      this.read.db,
      `${USER_ROW_SQL(hasPermission(ctx.actor.role, 'users.email.read'))} WHERE u.role <> 'USER' ORDER BY u.role DESC, u.username LIMIT 500`,
    );
    const changes = await sqlRows(
      this.read.db,
      `${this.read.sql.audit} WHERE l.action = 'user.role_changed' ORDER BY l.created_at DESC LIMIT 20`,
    );
    return {
      roles: (Object.keys(ROLE_RANK) as UserRoleEnum[])
        .sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a])
        .map((role) => ({
          role,
          rank: ROLE_RANK[role],
          permissions: [...ROLE_PERMISSIONS[role]],
          memberCount: counts.find((c) => c.role === role)?.n ?? 0,
          assignable:
            assignable.includes(role) && (ROLE_RANK[role] < ROLE_RANK.ADMIN || hasPermission(ctx.actor.role, 'admins.manage')),
        })),
      allPermissions: [...PERMISSIONS],
      staff: staff.map((r) => this.read.userRow(r)),
      recentChanges: changes.map((r) => this.read.auditRow(r)),
    };
  }

  async audit(q: AuditQueryDto): Promise<AdminPage<AuditLogDto>> {
    const p = new Params();
    const where: string[] = [];
    if (q.actorId) where.push(`l.actor_id = ${p.add(q.actorId)}`);
    if (q.action) where.push(q.action.endsWith('.') ? `l.action LIKE ${p.add(`${q.action}%`)}` : `l.action = ${p.add(q.action)}`);
    if (q.targetType) where.push(`l.target_type = ${p.add(q.targetType)}`);
    if (q.targetId) where.push(`l.target_id = ${p.add(q.targetId)}`);
    if (q.from) where.push(`l.created_at >= ${p.add(q.from)}::timestamptz`);
    if (q.to) where.push(`l.created_at < ${p.add(q.to)}::timestamptz`);
    const page = q.page ?? 1;
    const size = q.pageSize ?? 25;
    const order = q.order === 'asc' ? 'ASC' : 'DESC';
    const rows = await sqlRows(
      this.read.db,
      `SELECT x.*, count(*) OVER()::int AS total_count FROM (${this.read.sql.audit} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}) x
        ORDER BY x.created_at ${order}, x.id ${order}
        LIMIT ${p.add(size)} OFFSET ${p.add((page - 1) * size)}`,
      p.values,
    );
    return { items: rows.map((r) => this.read.auditRow(r)), page, pageSize: size, total: rows[0]?.total_count ?? 0 };
  }

  async actions(): Promise<string[]> {
    const rows = await sqlRows<{ action: string }>(this.read.db, `SELECT DISTINCT action FROM admin_audit_logs ORDER BY action LIMIT 200`);
    return rows.map((r) => r.action);
  }

  async system(): Promise<SystemStatusDto> {
    const dbStart = performance.now();
    let database: SystemStatusDto['database'];
    try {
      const info = await sqlOne<{ version: string }>(this.read.db, `SELECT split_part(version(), ' on ', 1) AS version`);
      const latency = Math.round((performance.now() - dbStart) * 10) / 10;
      const applied = await sqlRows<{ name: string }>(this.read.db, `SELECT name FROM typeorm_migrations`);
      const appliedNames = new Set(applied.map((a) => a.name));
      database = {
        status: latency > 500 ? 'DEGRADED' : 'OK',
        latencyMs: latency,
        detail: null,
        version: info?.version ?? null,
        appliedMigrations: applied.length,
        pendingMigrations: migrations.map((m) => m.name).filter((name) => !appliedNames.has(name)),
      };
    } catch (error) {
      database = { status: 'DOWN', latencyMs: null, detail: (error as Error).message.slice(0, 200), version: null, appliedMigrations: 0, pendingMigrations: [] };
    }

    const storageStart = performance.now();
    const storage = await this.media.storageHealth();
    const storageLatency = Math.round((performance.now() - storageStart) * 10) / 10;
    const lowSpace = storage.freeBytes !== null && storage.totalBytes ? storage.freeBytes / storage.totalBytes < 0.05 : false;

    const settings = await this.settings.lastUpdated();
    return {
      checkedAt: new Date().toISOString(),
      api: {
        appVersion: APP_VERSION,
        apiVersion: API_VERSION,
        environment: this.config.nodeEnv,
        nodeVersion: process.version,
        uptimeSeconds: Math.round(process.uptime()),
        startedAt: STARTED_AT.toISOString(),
      },
      database,
      storage: {
        driver: this.media.storageDriverName,
        status: !storage.writable ? 'DOWN' : lowSpace ? 'DEGRADED' : 'OK',
        latencyMs: storageLatency,
        detail: storage.detail ?? (lowSpace ? 'Less than 5% free space on the media volume' : null),
        freeBytes: storage.freeBytes,
        totalBytes: storage.totalBytes,
      },
      jobs: this.jobs.list(),
      recentErrors: recentServerErrors(),
      settingsUpdatedAt: settings?.updated_at ? new Date(settings.updated_at).toISOString() : null,
    };
  }
}
