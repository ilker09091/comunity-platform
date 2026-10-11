import { createParamDecorator, ExecutionContext, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import { DataSource, EntityManager } from 'typeorm';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { sqlRows } from '../../common/utils/sql.js';

/** Who is acting, plus request correlation data, passed from controllers into services. */
export interface RequestContext {
  actor: AuthUser;
  requestId: string | null;
  ip: string | null;
  /** Value of the X-Step-Up-Token header (verified by StepUpService when required). */
  stepUpToken: string | null;
}

export const ReqContext = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestContext => {
  const req = ctx.switchToHttp().getRequest<Request & { id?: string; user: AuthUser }>();
  const header = req.headers['x-step-up-token'];
  return {
    actor: req.user,
    requestId: req.id ?? null,
    ip: req.ip ?? null,
    stepUpToken: typeof header === 'string' ? header : null,
  };
});

export interface AuditEntry {
  action: string;
  targetType?: 'USER' | 'POST' | 'COMMENT' | 'REPORT' | 'MEDIA' | 'ANNOUNCEMENT' | 'SETTINGS' | 'SYSTEM';
  targetId?: string | null;
  /** Never include secrets, tokens or passwords. */
  metadata?: Record<string, unknown>;
}

/**
 * Writes append-only audit events (the table rejects UPDATE/DELETE at the database level).
 * Call inside the same transaction as the state change so they commit or roll back together.
 */
@Injectable()
export class AuditService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async record(m: EntityManager | DataSource, ctx: RequestContext | null, entry: AuditEntry): Promise<void> {
    await sqlRows(
      m,
      `INSERT INTO admin_audit_logs (actor_id, actor_role, action, target_type, target_id, metadata, request_id, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
      [
        ctx?.actor.id ?? null,
        ctx?.actor.role ?? 'SYSTEM',
        entry.action,
        entry.targetType ?? null,
        entry.targetId ?? null,
        JSON.stringify(entry.metadata ?? {}),
        ctx?.requestId?.slice(0, 128) ?? null,
        ctx?.ip?.slice(0, 64) ?? null,
      ],
    );
  }

  /** System-initiated events (scheduled jobs, CLI). */
  async system(m: EntityManager | DataSource, entry: AuditEntry & { source: string }): Promise<void> {
    const { source, ...rest } = entry;
    await this.record(m ?? this.db, null, { ...rest, metadata: { ...rest.metadata, source } });
  }
}
