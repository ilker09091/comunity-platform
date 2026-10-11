import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { appConfig } from '../../config/app.config.js';
import { IS_PUBLIC_KEY, UserRole } from '../decorators/auth.decorators.js';
import type { AuthUser } from '../decorators/auth.decorators.js';
import { AppException, ErrorCode } from '../errors/app.exception.js';
import { sqlOne } from '../utils/sql.js';

/** Activity is written at most once per user per window (per instance) to keep request cost flat. */
const ACTIVITY_WINDOW_MS = 5 * 60 * 1000;
const lastActivityWrite = new Map<string, number>();

interface AccessTokenPayload {
  sub: string;
  sid: string;
  typ: 'access';
}

/**
 * Global guard. Verifies the bearer access token and checks server-side that the session
 * has not been revoked and the account is active, so logout/suspension take effect
 * immediately instead of waiting for token expiry.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @InjectDataSource() private readonly db: DataSource,
    @Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = this.extractToken(req);

    if (!token) {
      if (isPublic) return true;
      throw AppException.unauthorized();
    }
    // A supplied but invalid/expired token is always rejected (even on public routes)
    // so clients know to refresh instead of silently receiving anonymous data.
    req.user = await this.authenticate(token);
    return true;
  }

  private extractToken(req: Request): string | null {
    const header = req.headers.authorization;
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !value) {
      throw AppException.unauthorized(ErrorCode.INVALID_TOKEN, 'Malformed Authorization header');
    }
    return value;
  }

  private async authenticate(token: string): Promise<AuthUser> {
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.auth.jwtSecret,
        algorithms: ['HS256'],
      });
    } catch {
      throw AppException.unauthorized(ErrorCode.INVALID_TOKEN, 'Access token is invalid or expired');
    }
    if (payload.typ !== 'access' || !payload.sub || !payload.sid) {
      throw AppException.unauthorized(ErrorCode.INVALID_TOKEN, 'Access token is invalid or expired');
    }

    const row = await sqlOne<{ id: string; username: string; role: UserRole; status: string }>(
      this.db,
      `SELECT u.id, u.username, u.role, u.status
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL AND s.expires_at > now()`,
      [payload.sid, payload.sub],
    );
    if (!row) {
      throw AppException.unauthorized(ErrorCode.INVALID_TOKEN, 'Session has been revoked or expired');
    }
    if (row.status !== 'ACTIVE') {
      throw AppException.forbidden(ErrorCode.ACCOUNT_SUSPENDED, 'This account is not active');
    }
    this.trackActivity(row.id);
    return { id: row.id, username: row.username, role: row.role, sessionId: payload.sid };
  }

  /**
   * Records last activity and a daily-active marker (used for DAU/WAU). Fire-and-forget: a
   * failure here must never fail the request.
   */
  private trackActivity(userId: string) {
    const now = Date.now();
    if ((lastActivityWrite.get(userId) ?? 0) > now - ACTIVITY_WINDOW_MS) return;
    lastActivityWrite.set(userId, now);
    if (lastActivityWrite.size > 50_000) {
      for (const [id, at] of lastActivityWrite) if (at < now - ACTIVITY_WINDOW_MS) lastActivityWrite.delete(id);
    }
    this.db
      .query(
        `WITH touched AS (UPDATE users SET last_active_at = now() WHERE id = $1)
         INSERT INTO user_daily_activity (day, user_id) VALUES ((now() AT TIME ZONE 'UTC')::date, $1)
         ON CONFLICT DO NOTHING`,
        [userId],
      )
      .catch(() => lastActivityWrite.delete(userId));
  }
}
