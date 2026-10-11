import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { DataSource } from 'typeorm';
import { appConfig } from '../../config/app.config.js';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { sqlOne } from '../../common/utils/sql.js';
import { AuditService, type RequestContext } from './audit.service.js';

const STEP_UP_TTL_SECONDS = 10 * 60;

/**
 * Step-up re-authentication for high-impact admin operations. The admin confirms their
 * password and receives a short-lived token bound to the current session; sensitive
 * endpoints require it in `X-Step-Up-Token`.
 */
@Injectable()
export class StepUpService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>,
  ) {}

  async issue(ctx: RequestContext, password: string): Promise<{ token: string; expiresAt: string }> {
    const row = await sqlOne<{ password_hash: string }>(this.db, `SELECT password_hash FROM users WHERE id = $1`, [ctx.actor.id]);
    const valid = row ? await argon2.verify(row.password_hash, password).catch(() => false) : false;
    if (!valid) {
      await this.audit.record(this.db, ctx, { action: 'admin.step_up_failed', targetType: 'USER', targetId: ctx.actor.id });
      // 403, not 401: a wrong re-authentication password must not be treated as an expired session.
      throw AppException.forbidden(ErrorCode.INVALID_CREDENTIALS, 'Password is incorrect');
    }
    const token = await this.jwt.signAsync(
      { sub: ctx.actor.id, sid: ctx.actor.sessionId, typ: 'step-up' },
      { secret: this.config.auth.jwtSecret, expiresIn: STEP_UP_TTL_SECONDS, algorithm: 'HS256' },
    );
    await this.audit.record(this.db, ctx, { action: 'admin.step_up', targetType: 'USER', targetId: ctx.actor.id });
    return { token, expiresAt: new Date(Date.now() + STEP_UP_TTL_SECONDS * 1000).toISOString() };
  }

  /** Throws 403 STEP_UP_REQUIRED unless the request carries a valid token for this session. */
  async assert(ctx: RequestContext): Promise<void> {
    const fail = () =>
      new AppException(HttpStatus.FORBIDDEN, ErrorCode.STEP_UP_REQUIRED, 'Confirm your password to continue');
    if (!ctx.stepUpToken) throw fail();
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; sid: string; typ: string }>(ctx.stepUpToken, {
        secret: this.config.auth.jwtSecret,
        algorithms: ['HS256'],
      });
      if (payload.typ !== 'step-up' || payload.sub !== ctx.actor.id || payload.sid !== ctx.actor.sessionId) throw fail();
    } catch {
      throw fail();
    }
  }
}
