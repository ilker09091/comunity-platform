import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { DataSource, EntityManager } from 'typeorm';
import { appConfig } from '../../config/app.config.js';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import { RESERVED_USERNAMES } from '../users/dto/user.dto.js';
import { UsersService } from '../users/users.service.js';
import { AccountGovernanceService } from '../platform/account-governance.service.js';
import { PlatformSettingsService } from '../platform/platform-settings.service.js';
import { AuthResponseDto, ChangePasswordDto, LoginDto, RegisterDto } from './dto/auth.dto.js';

// OWASP-recommended Argon2id parameters (19 MiB, t=2, p=1).
export const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

interface RefreshPayload {
  sub: string;
  sid: string;
  jti: string;
  typ: 'refresh';
}

export interface ClientMeta {
  userAgent?: string;
  ip?: string;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  /** Hash verified when the account does not exist, to equalise login timing. */
  private dummyHash = '';

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly jwt: JwtService,
    private readonly users: UsersService,
    private readonly settings: PlatformSettingsService,
    private readonly governance: AccountGovernanceService,
    @Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>,
  ) {}

  async onModuleInit() {
    this.dummyHash = await argon2.hash(randomUUID(), ARGON2_OPTIONS);
  }

  async register(dto: RegisterDto, meta: ClientMeta): Promise<AuthResponseDto> {
    const conflict = () =>
      AppException.conflict(ErrorCode.ACCOUNT_CONFLICT, 'An account with this email or username cannot be created');
    await this.settings.assertFeature('registration');
    if (RESERVED_USERNAMES.has(dto.username.toLowerCase())) throw conflict();

    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);
    let userId: string;
    try {
      const row = await sqlOne<{ id: string }>(
        this.db,
        `INSERT INTO users (username, email, password_hash, display_name, password_changed_at)
         VALUES ($1, $2, $3, $4, now()) RETURNING id`,
        [dto.username, dto.email, passwordHash, dto.displayName ?? dto.username],
      );
      userId = row!.id;
    } catch (error) {
      if ((error as { driverError?: { code?: string } }).driverError?.code === '23505') throw conflict();
      throw error;
    }
    this.logger.log({ message: 'User registered', userId });
    return this.startSession(userId, meta);
  }

  async login(dto: LoginDto, meta: ClientMeta): Promise<AuthResponseDto> {
    const isEmail = dto.identifier.includes('@');
    const user = await sqlOne<{ id: string; password_hash: string; status: string }>(
      this.db,
      `SELECT id, password_hash, status FROM users WHERE ${isEmail ? 'email' : 'username'} = $1`,
      [dto.identifier],
    );
    const valid = await argon2.verify(user?.password_hash ?? this.dummyHash, dto.password).catch(() => false);
    if (!user || !valid) {
      this.logger.warn({ message: 'Failed login', ip: meta.ip });
      throw AppException.unauthorized(ErrorCode.INVALID_CREDENTIALS, 'Invalid credentials');
    }
    // Status is only revealed after the password has been proven.
    if (user.status === 'SUSPENDED' && (await this.governance.liftExpired(user.id)) > 0) user.status = 'ACTIVE';
    if (user.status !== 'ACTIVE') {
      throw AppException.forbidden(
        ErrorCode.ACCOUNT_SUSPENDED,
        user.status === 'BANNED' ? 'This account has been banned' : 'This account is suspended',
      );
    }
    if (argon2.needsRehash(user.password_hash, ARGON2_OPTIONS)) {
      const rehashed = await argon2.hash(dto.password, ARGON2_OPTIONS);
      await sqlRows(this.db, `UPDATE users SET password_hash = $2 WHERE id = $1`, [user.id, rehashed]);
    }
    return this.startSession(user.id, meta);
  }

  /**
   * Rotates a refresh token. Every refresh token is single-use: presenting an already used
   * token is treated as theft and revokes the whole session (all its descendants).
   */
  async refresh(refreshToken: string): Promise<AuthResponseDto> {
    const invalid = () => AppException.unauthorized(ErrorCode.INVALID_REFRESH_TOKEN, 'Refresh token is invalid or expired');
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(refreshToken, {
        secret: this.config.auth.jwtRefreshSecret,
        algorithms: ['HS256'],
      });
    } catch {
      throw invalid();
    }
    if (payload.typ !== 'refresh' || !payload.jti || !payload.sid || !payload.sub) throw invalid();

    const outcome = await this.db.transaction(async (m) => {
      const token = await sqlOne<{ token_hash: string; used_at: Date | null; expires_at: Date; session_id: string }>(
        m,
        `SELECT rt.token_hash, rt.used_at, rt.expires_at, rt.session_id
           FROM refresh_tokens rt WHERE rt.id = $1 FOR UPDATE`,
        [payload.jti],
      );
      if (!token || token.session_id !== payload.sid) return { error: invalid() };
      const a = Buffer.from(token.token_hash);
      const b = Buffer.from(sha256(refreshToken));
      if (a.length !== b.length || !timingSafeEqual(a, b)) return { error: invalid() };

      const session = await sqlOne<{ user_id: string; revoked_at: Date | null; status: string }>(
        m,
        `SELECT s.user_id, s.revoked_at, u.status FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.id = $1 FOR UPDATE OF s`,
        [payload.sid],
      );
      if (!session || session.revoked_at) return { error: invalid() };

      if (token.used_at) {
        await this.revokeSession(m, payload.sid, 'refresh_token_reuse');
        this.logger.warn({ message: 'Refresh token reuse detected; session revoked', sessionId: payload.sid, userId: session.user_id });
        return { error: invalid(), commit: true };
      }
      if (token.expires_at.getTime() <= Date.now()) return { error: invalid() };
      if (session.status !== 'ACTIVE') {
        return { error: AppException.forbidden(ErrorCode.ACCOUNT_SUSPENDED, 'This account is not active') };
      }

      await sqlRows(m, `UPDATE refresh_tokens SET used_at = now() WHERE id = $1`, [payload.jti]);
      return { tokens: await this.issueTokens(m, session.user_id, payload.sid) };
    });

    if ('error' in outcome && outcome.error) throw outcome.error;
    const tokens = outcome.tokens!;
    return { ...tokens, user: await this.users.getMe(payload.sub) };
  }

  async logout(sessionId: string): Promise<void> {
    await this.revokeSession(this.db, sessionId, 'logout');
  }

  async logoutAll(userId: string): Promise<void> {
    await sqlRows(
      this.db,
      `UPDATE sessions SET revoked_at = now(), revoked_reason = 'logout_all' WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
  }

  /** Changes the password and revokes every other session of the user. */
  async changePassword(userId: string, sessionId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await sqlOne<{ password_hash: string }>(this.db, `SELECT password_hash FROM users WHERE id = $1`, [userId]);
    const valid = user ? await argon2.verify(user.password_hash, dto.currentPassword).catch(() => false) : false;
    if (!valid) {
      throw new AppException(HttpStatus.BAD_REQUEST, ErrorCode.WRONG_PASSWORD, 'Current password is incorrect');
    }
    const hash = await argon2.hash(dto.newPassword, ARGON2_OPTIONS);
    await this.db.transaction(async (m) => {
      await sqlRows(m, `UPDATE users SET password_hash = $2, password_changed_at = now(), updated_at = now() WHERE id = $1`, [userId, hash]);
      await sqlRows(
        m,
        `UPDATE sessions SET revoked_at = now(), revoked_reason = 'password_changed'
          WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`,
        [userId, sessionId],
      );
    });
    this.logger.log({ message: 'Password changed', userId });
  }

  /** Separate refresh-token chain for an authenticated user's background importer. */
  async backgroundSession(userId: string, meta: ClientMeta): Promise<AuthResponseDto> {
    return this.startSession(userId, { ...meta, userAgent: 'Circle Video Importer background worker' });
  }

  private async startSession(userId: string, meta: ClientMeta): Promise<AuthResponseDto> {
    const tokens = await this.db.transaction(async (m) => {
      const session = await sqlOne<{ id: string }>(
        m,
        `INSERT INTO sessions (user_id, user_agent, ip_address, expires_at)
         VALUES ($1, $2, $3, now() + make_interval(secs => $4)) RETURNING id`,
        [userId, meta.userAgent?.slice(0, 255) ?? null, meta.ip?.slice(0, 64) ?? null, this.config.auth.refreshTtlSeconds],
      );
      return this.issueTokens(m, userId, session!.id);
    });
    return { ...tokens, user: await this.users.getMe(userId) };
  }

  private async issueTokens(m: EntityManager, userId: string, sessionId: string) {
    const { accessTtlSeconds, refreshTtlSeconds, jwtSecret, jwtRefreshSecret } = this.config.auth;
    const jti = randomUUID();
    const now = Date.now();
    const accessToken = await this.jwt.signAsync(
      { sub: userId, sid: sessionId, typ: 'access' },
      { secret: jwtSecret, expiresIn: accessTtlSeconds, algorithm: 'HS256' },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, sid: sessionId, jti, typ: 'refresh' },
      { secret: jwtRefreshSecret, expiresIn: refreshTtlSeconds, algorithm: 'HS256' },
    );
    const refreshExpiresAt = new Date(now + refreshTtlSeconds * 1000);
    await sqlRows(
      m,
      `INSERT INTO refresh_tokens (id, session_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
      [jti, sessionId, sha256(refreshToken), refreshExpiresAt],
    );
    // Sliding session: the session lives as long as its newest refresh token.
    await sqlRows(m, `UPDATE sessions SET expires_at = $2, last_used_at = now() WHERE id = $1`, [sessionId, refreshExpiresAt]);
    return {
      tokenType: 'Bearer' as const,
      accessToken,
      accessTokenExpiresAt: new Date(now + accessTtlSeconds * 1000).toISOString(),
      refreshToken,
      refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
    };
  }

  private async revokeSession(db: DataSource | EntityManager, sessionId: string, reason: string) {
    await sqlRows(
      db,
      `UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId, reason],
    );
  }
}
