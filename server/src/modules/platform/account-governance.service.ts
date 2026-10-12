import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import type { UserRole } from '../../common/decorators/auth.decorators.js';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import { AuditService, type RequestContext } from './audit.service.js';
import { JobRegistryService } from './job-registry.service.js';
import { assertOutranks, assertPermission, assignableRoles, ROLE_RANK } from './permissions.js';
import { StepUpService } from './step-up.service.js';

interface Target {
  id: string;
  username: string;
  role: UserRole;
  status: 'ACTIVE' | 'SUSPENDED' | 'BANNED' | 'DEACTIVATED';
}

/**
 * Account restrictions (suspensions, bans), policy warnings and role changes. Every state
 * change is permission- and rank-checked, runs in a transaction together with its audit
 * record, and revokes sessions where access is removed.
 */
@Injectable()
export class AccountGovernanceService implements OnModuleInit {
  private readonly logger = new Logger(AccountGovernanceService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly audit: AuditService,
    private readonly stepUp: StepUpService,
    private readonly jobs: JobRegistryService,
  ) {}

  onModuleInit() {
    this.jobs.register('suspension-expiry', 'every minute', 'Lifts temporary suspensions whose end date has passed');
  }

  private async lockTarget(m: EntityManager, userId: string): Promise<Target> {
    const target = await sqlOne<Target>(
      m,
      `SELECT id, username::text AS username, role, status FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    if (!target) throw AppException.notFound(ErrorCode.USER_NOT_FOUND, 'User not found');
    return target;
  }

  private async revokeSessions(m: EntityManager, userId: string, reason: string) {
    await sqlRows(
      m,
      `UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId, reason],
    );
  }

  async suspend(ctx: RequestContext, userId: string, input: { reason: string; expiresAt?: string | null; reportId?: string | null }) {
    assertPermission(ctx.actor.role, 'users.suspend');
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now() + 60_000)
      throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Validation failed', [
        { field: 'expiresAt', message: 'expiresAt must be at least one minute in the future' },
      ]);
    return this.db.transaction(async (m) => {
      const target = await this.lockTarget(m, userId);
      assertOutranks(ctx.actor, target);
      if (target.status !== 'ACTIVE')
        throw AppException.conflict(ErrorCode.INVALID_STATE, `Account is already ${target.status.toLowerCase()}`);
      const restriction = await sqlOne<{ id: string }>(
        m,
        `INSERT INTO account_restrictions (user_id, type, reason, expires_at, created_by_id)
         VALUES ($1, 'SUSPENSION', $2, $3, $4) RETURNING id`,
        [userId, input.reason, expiresAt, ctx.actor.id],
      );
      await sqlRows(m, `UPDATE users SET status = 'SUSPENDED', updated_at = now() WHERE id = $1`, [userId]);
      await this.revokeSessions(m, userId, 'suspended');
      await this.audit.record(m, ctx, {
        action: 'user.suspended',
        targetType: 'USER',
        targetId: userId,
        metadata: { reason: input.reason, expiresAt: expiresAt?.toISOString() ?? null, previousStatus: target.status, restrictionId: restriction!.id, reportId: input.reportId ?? null },
      });
      return { status: 'SUSPENDED' as const };
    });
  }

  async reinstate(ctx: RequestContext, userId: string, reason: string) {
    assertPermission(ctx.actor.role, 'users.suspend');
    return this.db.transaction(async (m) => {
      const target = await this.lockTarget(m, userId);
      assertOutranks(ctx.actor, target);
      if (target.status !== 'SUSPENDED') throw AppException.conflict(ErrorCode.INVALID_STATE, 'Account is not suspended');
      await sqlRows(
        m,
        `UPDATE account_restrictions SET lifted_at = now(), lifted_by_id = $2, lift_reason = $3
          WHERE user_id = $1 AND type = 'SUSPENSION' AND lifted_at IS NULL`,
        [userId, ctx.actor.id, reason],
      );
      await sqlRows(m, `UPDATE users SET status = 'ACTIVE', updated_at = now() WHERE id = $1`, [userId]);
      await this.audit.record(m, ctx, {
        action: 'user.reinstated',
        targetType: 'USER',
        targetId: userId,
        metadata: { reason, previousStatus: target.status },
      });
      return { status: 'ACTIVE' as const };
    });
  }

  async ban(ctx: RequestContext, userId: string, input: { reason: string; confirmUsername: string; reportId?: string | null }) {
    assertPermission(ctx.actor.role, 'users.ban');
    await this.stepUp.assert(ctx);
    return this.db.transaction(async (m) => {
      const target = await this.lockTarget(m, userId);
      assertOutranks(ctx.actor, target);
      if (input.confirmUsername.toLowerCase() !== target.username.toLowerCase())
        throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Validation failed', [
          { field: 'confirmUsername', message: 'Type the exact username to confirm the ban' },
        ]);
      if (target.status === 'BANNED') throw AppException.conflict(ErrorCode.INVALID_STATE, 'Account is already banned');
      // A ban supersedes any active suspension.
      await sqlRows(
        m,
        `UPDATE account_restrictions SET lifted_at = now(), lifted_by_id = $2, lift_reason = 'Superseded by ban'
          WHERE user_id = $1 AND type = 'SUSPENSION' AND lifted_at IS NULL`,
        [userId, ctx.actor.id],
      );
      const restriction = await sqlOne<{ id: string }>(
        m,
        `INSERT INTO account_restrictions (user_id, type, reason, created_by_id) VALUES ($1, 'BAN', $2, $3) RETURNING id`,
        [userId, input.reason, ctx.actor.id],
      );
      await sqlRows(m, `UPDATE users SET status = 'BANNED', updated_at = now() WHERE id = $1`, [userId]);
      await this.revokeSessions(m, userId, 'banned');
      await this.audit.record(m, ctx, {
        action: 'user.banned',
        targetType: 'USER',
        targetId: userId,
        metadata: { reason: input.reason, previousStatus: target.status, restrictionId: restriction!.id, reportId: input.reportId ?? null },
      });
      return { status: 'BANNED' as const };
    });
  }

  async unban(ctx: RequestContext, userId: string, reason: string) {
    assertPermission(ctx.actor.role, 'users.ban');
    await this.stepUp.assert(ctx);
    return this.db.transaction(async (m) => {
      const target = await this.lockTarget(m, userId);
      assertOutranks(ctx.actor, target);
      if (target.status !== 'BANNED') throw AppException.conflict(ErrorCode.INVALID_STATE, 'Account is not banned');
      await sqlRows(
        m,
        `UPDATE account_restrictions SET lifted_at = now(), lifted_by_id = $2, lift_reason = $3
          WHERE user_id = $1 AND type = 'BAN' AND lifted_at IS NULL`,
        [userId, ctx.actor.id, reason],
      );
      await sqlRows(m, `UPDATE users SET status = 'ACTIVE', updated_at = now() WHERE id = $1`, [userId]);
      await this.audit.record(m, ctx, { action: 'user.unbanned', targetType: 'USER', targetId: userId, metadata: { reason } });
      return { status: 'ACTIVE' as const };
    });
  }

  async warn(
    ctx: RequestContext,
    userId: string,
    input: { reason: string; message: string; reportId?: string | null },
  ): Promise<{ id: string; createdAt: string }> {
    assertPermission(ctx.actor.role, 'users.warn');
    return this.db.transaction(async (m) => {
      const target = await this.lockTarget(m, userId);
      assertOutranks(ctx.actor, target);
      const row = await sqlOne<{ id: string; created_at: Date }>(
        m,
        `INSERT INTO user_warnings (user_id, reason, message, report_id, created_by_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
        [userId, input.reason, input.message, input.reportId ?? null, ctx.actor.id],
      );
      await this.audit.record(m, ctx, {
        action: 'user.warned',
        targetType: 'USER',
        targetId: userId,
        metadata: { reason: input.reason, warningId: row!.id, reportId: input.reportId ?? null, delivery: 'IN_APP_INBOX' },
      });
      return { id: row!.id, createdAt: row!.created_at.toISOString() };
    });
  }

  /**
   * Role changes. The actor must outrank the target, may only grant roles in
   * `assignableRoles`, needs `admins.manage` for anything touching ADMIN/SUPER_ADMIN, and the
   * last active SUPER_ADMIN can never be demoted.
   */
  async setRole(ctx: RequestContext, userId: string, role: UserRole) {
    assertPermission(ctx.actor.role, 'users.roles.manage');
    await this.stepUp.assert(ctx);
    return this.db.transaction(async (m) => {
      // Serialise concurrent super-admin changes so two demotions can't race past the last-admin check.
      await sqlRows(m, `SELECT id FROM users WHERE role = 'SUPER_ADMIN' ORDER BY id FOR UPDATE`);
      const target = await this.lockTarget(m, userId);
      if (ctx.actor.id === userId) throw AppException.forbidden(ErrorCode.FORBIDDEN, 'You cannot change your own role');
      const touchesAdmins = ROLE_RANK[target.role] >= ROLE_RANK.ADMIN || ROLE_RANK[role] >= ROLE_RANK.ADMIN;
      if (touchesAdmins) assertPermission(ctx.actor.role, 'admins.manage');
      if (ctx.actor.role !== 'SUPER_ADMIN') assertOutranks(ctx.actor, target);
      if (!assignableRoles(ctx.actor.role).includes(role))
        throw AppException.forbidden(ErrorCode.INSUFFICIENT_RANK, `You cannot grant the ${role} role`);
      if (target.role === role) return { id: userId, role };
      if (target.role === 'SUPER_ADMIN') {
        const others = await sqlOne<{ n: number }>(
          m,
          `SELECT count(*)::int AS n FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' AND id <> $1`,
          [userId],
        );
        if (!others!.n) throw AppException.conflict(ErrorCode.LAST_SUPER_ADMIN, 'The last active super administrator cannot be demoted');
      }
      await sqlRows(m, `UPDATE users SET role = $2, updated_at = now() WHERE id = $1`, [userId, role]);
      await this.audit.record(m, ctx, {
        action: 'user.role_changed',
        targetType: 'USER',
        targetId: userId,
        metadata: { from: target.role, to: role },
      });
      return { id: userId, role };
    });
  }

  /** Grants or removes the blue verification badge. Audited; no-op when unchanged. */
  async setVerified(ctx: RequestContext, userId: string, verified: boolean) {
    assertPermission(ctx.actor.role, 'users.update');
    return this.db.transaction(async (m) => {
      await this.lockTarget(m, userId);
      const row = await sqlOne<{ is_verified: boolean }>(m, `SELECT is_verified FROM users WHERE id = $1`, [userId]);
      if (row!.is_verified === verified) return { id: userId, isVerified: verified };
      await sqlRows(m, `UPDATE users SET is_verified = $2, updated_at = now() WHERE id = $1`, [userId, verified]);
      await this.audit.record(m, ctx, {
        action: verified ? 'user.verified' : 'user.unverified',
        targetType: 'USER',
        targetId: userId,
        metadata: {},
      });
      return { id: userId, isVerified: verified };
    });
  }

  /** Lifts expired temporary suspensions (scheduled, and lazily at sign-in). */
  async liftExpired(userId?: string): Promise<number> {
    const lifted = await this.db.transaction(async (m) => {
      const rows = await sqlRows<{ id: string; user_id: string }>(
        m,
        `UPDATE account_restrictions SET lifted_at = now(), lift_reason = 'Expired'
          WHERE id IN (
            SELECT id FROM account_restrictions
             WHERE type = 'SUSPENSION' AND lifted_at IS NULL AND expires_at <= now()
               ${userId ? 'AND user_id = $1' : ''}
             ORDER BY expires_at LIMIT 500 FOR UPDATE SKIP LOCKED)
          RETURNING id, user_id`,
        userId ? [userId] : [],
      );
      for (const row of rows) {
        const reactivated = await sqlRows(
          m,
          `UPDATE users SET status = 'ACTIVE', updated_at = now()
            WHERE id = $1 AND status = 'SUSPENDED'
              AND NOT EXISTS (SELECT 1 FROM account_restrictions WHERE user_id = $1 AND lifted_at IS NULL)
            RETURNING id`,
          [row.user_id],
        );
        if (reactivated.length)
          await this.audit.system(m, {
            source: 'suspension-expiry',
            action: 'user.suspension_expired',
            targetType: 'USER',
            targetId: row.user_id,
            metadata: { restrictionId: row.id },
          });
      }
      return rows.length;
    });
    return lifted;
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'suspension-expiry' })
  async expireSuspensions() {
    try {
      const n = await this.liftExpired();
      this.jobs.record('suspension-expiry', 'OK', `${n} suspension(s) lifted`);
      if (n) this.logger.log({ message: 'Expired suspensions lifted', count: n });
    } catch (error) {
      this.jobs.record('suspension-expiry', 'FAILED', (error as Error).message);
      this.logger.error({ message: 'Suspension expiry failed', error: (error as Error).message });
    }
  }
}
