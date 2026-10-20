import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomInt } from 'node:crypto';
import { EntityManager } from 'typeorm';
import type { UserRole } from '../../common/decorators/auth.decorators.js';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { iso } from '../../common/utils/cursor.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import { ContentDeletionService } from '../media/content-deletion.service.js';
import { AuditService, type RequestContext } from '../platform/audit.service.js';
import { assertOutranks, assertPermission, hasPermission } from '../platform/permissions.js';
import { StepUpService } from '../platform/step-up.service.js';
import { ARGON2_OPTIONS } from '../auth/auth.service.js';
import { AdminReadService, userRefCols } from './admin-read.service.js';
import {
  AdminSessionDto,
  AdminUpdateProfileDto,
  AdminUserActivityDto,
  AdminUserNoteDto,
} from './dto/admin-accounts.dto.js';

interface Target { id: string; username: string; role: UserRole }

/**
 * Detailed account management for staff: devices/sessions, profile clean-up, internal notes
 * and an activity overview. State changes are rank-checked and audited in the same transaction.
 */
@Injectable()
export class AdminAccountsService {
  constructor(
    private readonly read: AdminReadService,
    private readonly audit: AuditService,
    private readonly deletion: ContentDeletionService,
    private readonly stepUp: StepUpService,
  ) {}

  private async target(m: EntityManager, id: string, lock = true): Promise<Target> {
    const row = await sqlOne<Target>(m, `SELECT id, username::text AS username, role FROM users WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
    if (!row) throw AppException.notFound(ErrorCode.USER_NOT_FOUND, 'User not found');
    return row;
  }

  // ---- Sessions ---------------------------------------------------------------------------------

  async sessions(ctx: RequestContext, id: string): Promise<AdminSessionDto[]> {
    assertPermission(ctx.actor.role, 'users.read');
    const showIp = hasPermission(ctx.actor.role, 'users.email.read');
    await this.target(this.read.db.manager, id, false);
    const rows = await sqlRows(this.read.db,
      `SELECT id, user_agent, ip_address, created_at, last_used_at, expires_at, revoked_at, revoked_reason,
          (revoked_at IS NULL AND expires_at > now()) AS active
        FROM sessions WHERE user_id = $1
        ORDER BY (revoked_at IS NULL AND expires_at > now()) DESC, last_used_at DESC LIMIT 50`, [id]);
    return rows.map(r => ({
      id: r.id, userAgent: r.user_agent, ipAddress: showIp ? r.ip_address : null, createdAt: iso(r.created_at)!,
      lastUsedAt: iso(r.last_used_at)!, expiresAt: iso(r.expires_at)!, revokedAt: iso(r.revoked_at), revokedReason: r.revoked_reason,
      active: r.active,
    }));
  }
  /** Signs the account out of one device, or of every device when `sessionId` is omitted. */
  async revokeSessions(ctx: RequestContext, id: string, reason: string, sessionId?: string): Promise<{ revoked: number }> {
    assertPermission(ctx.actor.role, 'users.suspend');
    return this.read.db.transaction(async m => {
      assertOutranks(ctx.actor, await this.target(m, id));
      const rows = await sqlRows(m,
        `UPDATE sessions SET revoked_at = now(), revoked_reason = 'admin'
          WHERE user_id = $1 AND revoked_at IS NULL ${sessionId ? 'AND id = $2' : ''} RETURNING id`,
        sessionId ? [id, sessionId] : [id]);
      if (sessionId && !rows.length) throw AppException.notFound(ErrorCode.NOT_FOUND, 'Session not found or already signed out');
      await this.audit.record(m, ctx, {
        action: 'user.sessions.revoked', targetType: 'USER', targetId: id,
        metadata: { reason, count: rows.length, sessionId: sessionId ?? null },
      });
      return { revoked: rows.length };
    });
  }

  // ---- Password -----------------------------------------------------------------------------------

  /**
   * Sets a new password (chosen by staff, or generated and shown once) and signs the account out
   * everywhere. Needs step-up; the password itself is never logged or audited.
   */
  async resetPassword(ctx: RequestContext, id: string, reason: string, password?: string) {
    assertPermission(ctx.actor.role, 'users.update');
    await this.stepUp.assert(ctx);
    // Unambiguous characters, always with letters and digits.
    const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const generated = password ? null
      : Array.from({ length: 14 }, (_, i) => (i === 4 ? '23456789' : i === 9 ? 'abcdefghjkmnpqrstuvwxyz' : alphabet)).map(set => set[randomInt(set.length)]).join('');
    const hash = await argon2.hash(password ?? generated!, ARGON2_OPTIONS);
    return this.read.db.transaction(async m => {
      assertOutranks(ctx.actor, await this.target(m, id));
      await sqlRows(m, 'UPDATE users SET password_hash = $2, password_changed_at = now(), updated_at = now() WHERE id = $1', [id, hash]);
      const revoked = await sqlRows(m,
        `UPDATE sessions SET revoked_at = now(), revoked_reason = 'password_reset' WHERE user_id = $1 AND revoked_at IS NULL RETURNING id`, [id]);
      await this.audit.record(m, ctx, {
        action: 'user.password.reset', targetType: 'USER', targetId: id,
        metadata: { reason, generated: !password, revokedSessions: revoked.length },
      });
      return { temporaryPassword: generated, revokedSessions: revoked.length };
    });
  }

  // ---- Profile ------------------------------------------------------------------------------------

  async updateProfile(ctx: RequestContext, id: string, dto: AdminUpdateProfileDto): Promise<{ changed: string[] }> {
    assertPermission(ctx.actor.role, 'users.update');
    const files = await this.read.db.transaction(async m => {
      assertOutranks(ctx.actor, await this.target(m, id));
      const before = (await sqlOne(m,
        `SELECT username::text AS username, display_name, bio, location, website, is_private, avatar_media_id, cover_media_id
           FROM users WHERE id = $1`, [id]))!;
      const columns: [string, string, unknown][] = [
        ['displayName', 'display_name', dto.displayName], ['username', 'username', dto.username], ['bio', 'bio', dto.bio],
        ['location', 'location', dto.location], ['website', 'website', dto.website], ['isPrivate', 'is_private', dto.isPrivate],
      ];
      const changes = columns.filter(([, column, value]) => value !== undefined && value !== before[column]);
      if (dto.username && dto.username.toLowerCase() !== String(before.username).toLowerCase()
        && await sqlOne(m, 'SELECT 1 FROM users WHERE username = $1 AND id <> $2', [dto.username, id]))
        throw AppException.conflict(ErrorCode.USERNAME_TAKEN, 'This username is already taken');
      const media: string[] = [];
      const sets = changes.map(([, column], i) => `${column} = $${i + 2}`);
      if (dto.removeAvatar && before.avatar_media_id) { sets.push('avatar_media_id = NULL'); media.push(before.avatar_media_id); }
      if (dto.removeCover && before.cover_media_id) { sets.push('cover_media_id = NULL'); media.push(before.cover_media_id); }
      const changed = [...changes.map(([field]) => field), ...(dto.removeAvatar && before.avatar_media_id ? ['avatar'] : []),
        ...(dto.removeCover && before.cover_media_id ? ['cover'] : [])];
      if (!changed.length) return { changed, files: { keys: [], bytes: 0 } };
      await sqlRows(m, `UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, [id, ...changes.map(([, , value]) => value)]);
      // Previous values make the edit reviewable without storing anything the user did not publish.
      await this.audit.record(m, ctx, {
        action: 'user.profile.updated', targetType: 'USER', targetId: id,
        metadata: { reason: dto.reason, changed, previous: Object.fromEntries(changes.map(([field, column]) => [field, before[column]])) },
      });
      return { changed, files: await this.deletion.deleteMedia(m, media) };
    });
    await this.deletion.removeFiles(files.files);
    return { changed: files.changed };
  }

  // ---- Notes --------------------------------------------------------------------------------------

  async notes(ctx: RequestContext, id: string): Promise<AdminUserNoteDto[]> {
    assertPermission(ctx.actor.role, 'users.read');
    const rows = await sqlRows(this.read.db,
      `SELECT n.id, n.body, n.created_at, n.author_id, ${userRefCols('a', 'aav', 'a')}
         FROM admin_user_notes n LEFT JOIN users a ON a.id = n.author_id LEFT JOIN media aav ON aav.id = a.avatar_media_id
        WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT 100`, [id]);
    const manage = hasPermission(ctx.actor.role, 'users.update');
    return rows.map(r => ({
      id: r.id, body: r.body, author: this.read.ref(r, 'a'), createdAt: iso(r.created_at)!,
      canDelete: r.author_id === ctx.actor.id || manage,
    }));
  }
  async addNote(ctx: RequestContext, id: string, body: string): Promise<AdminUserNoteDto> {
    assertPermission(ctx.actor.role, 'users.warn');
    const noteId = await this.read.db.transaction(async m => {
      await this.target(m, id, false);
      const row = await sqlOne<{ id: string }>(m,
        'INSERT INTO admin_user_notes(user_id, author_id, body) VALUES ($1, $2, $3) RETURNING id', [id, ctx.actor.id, body]);
      await this.audit.record(m, ctx, { action: 'user.note.added', targetType: 'USER', targetId: id, metadata: { noteId: row!.id } });
      return row!.id;
    });
    return (await this.notes(ctx, id)).find(note => note.id === noteId)!;
  }
  async deleteNote(ctx: RequestContext, id: string, noteId: string): Promise<void> {
    assertPermission(ctx.actor.role, 'users.warn');
    await this.read.db.transaction(async m => {
      const note = await sqlOne<{ author_id: string | null }>(m,
        'SELECT author_id FROM admin_user_notes WHERE id = $1 AND user_id = $2 FOR UPDATE', [noteId, id]);
      if (!note) throw AppException.notFound(ErrorCode.NOT_FOUND, 'Note not found');
      if (note.author_id !== ctx.actor.id) assertPermission(ctx.actor.role, 'users.update');
      await m.query('DELETE FROM admin_user_notes WHERE id = $1', [noteId]);
      await this.audit.record(m, ctx, { action: 'user.note.deleted', targetType: 'USER', targetId: id, metadata: { noteId } });
    });
  }

  // ---- Activity -----------------------------------------------------------------------------------

  /** Counts only: staff see how an account is used without reading private messages. */
  async activity(ctx: RequestContext, id: string): Promise<AdminUserActivityDto> {
    assertPermission(ctx.actor.role, 'users.read');
    await this.target(this.read.db.manager, id, false);
    const counts = (await sqlOne(this.read.db,
      `SELECT
         (SELECT count(*)::int FROM direct_messages WHERE sender_id = $1 AND call_id IS NULL) AS sent,
         (SELECT count(*)::int FROM direct_messages WHERE recipient_id = $1 AND call_id IS NULL) AS received,
         (SELECT count(DISTINCT CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END)::int
            FROM direct_messages WHERE sender_id = $1 OR recipient_id = $1) AS conversations,
         (SELECT count(*)::int FROM direct_messages WHERE call_id IS NOT NULL AND (sender_id = $1 OR recipient_id = $1)
            AND created_at > now() - interval '30 days') AS calls,
         (SELECT count(*)::int FROM stories WHERE author_id = $1 AND expires_at > now()) AS stories,
         (SELECT count(*)::int FROM stickers WHERE owner_id = $1) AS stickers,
         (SELECT count(*)::int FROM bookmarks WHERE user_id = $1) AS bookmarks,
         (SELECT count(*)::int FROM post_likes WHERE user_id = $1) AS likes,
         (SELECT count(*)::int FROM reports WHERE reporter_id = $1) AS reports`, [id]))!;
    const circles = await sqlRows(this.read.db,
      `SELECT c.id, c.name, c.emoji, c.color, cm.role, cm.joined_at,
          (SELECT count(*)::int FROM circle_members x WHERE x.circle_id = c.id) AS members
         FROM circle_members cm JOIN circles c ON c.id = cm.circle_id WHERE cm.user_id = $1 ORDER BY cm.joined_at DESC`, [id]);
    const days = await sqlRows<{ n: number }>(this.read.db,
      `SELECT count(p.id)::int AS n
         FROM generate_series((now() AT TIME ZONE 'UTC')::date - 13, (now() AT TIME ZONE 'UTC')::date, interval '1 day') d
         LEFT JOIN posts p ON p.author_id = $1 AND p.deleted_at IS NULL AND (p.created_at AT TIME ZONE 'UTC')::date = d::date
        GROUP BY d ORDER BY d`, [id]);
    return {
      messagesSent: counts.sent, messagesReceived: counts.received, conversations: counts.conversations, recentCalls: counts.calls,
      activeStories: counts.stories, stickers: counts.stickers, bookmarks: counts.bookmarks, likesGiven: counts.likes,
      reportsFiled: counts.reports, postsByDay: days.map(d => d.n),
      circles: circles.map(c => ({ id: c.id, name: c.name, emoji: c.emoji, color: c.color, role: c.role, memberCount: c.members, joinedAt: iso(c.joined_at)! })),
    };
  }
}
