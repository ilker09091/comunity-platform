import { Injectable } from '@nestjs/common';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { iso } from '../../common/utils/cursor.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import type { RequestContext } from '../platform/audit.service.js';
import { assignableRoles, hasPermission, ROLE_PERMISSIONS, ROLE_RANK } from '../platform/permissions.js';
import { AdminReadService, likeTerm, Params, USER_ROW_SQL, userRefCols } from './admin-read.service.js';
import type {
  AdminMeDto,
  AdminPage,
  AdminUserDetailDto,
  AdminUserRowDto,
  AdminUsersQueryDto,
} from './dto/admin.dto.js';
import { UserRoleEnum } from '../users/dto/user.dto.js';

const USER_SORTS: Record<string, string> = {
  created: 'x.created_at',
  lastActive: 'x.last_active_at',
  followers: 'x.follower_count',
  posts: 'x.post_count',
  reports: 'x.report_count',
};

@Injectable()
export class AdminUsersService {
  constructor(private readonly read: AdminReadService) {}

  async me(ctx: RequestContext): Promise<AdminMeDto> {
    const row = await sqlOne(this.read.db, `${USER_ROW_SQL(false)} WHERE u.id = $1`, [ctx.actor.id]);
    if (!row) throw AppException.notFound(ErrorCode.USER_NOT_FOUND, 'User not found');
    const role = ctx.actor.role as UserRoleEnum;
    return {
      user: this.read.ref(row, 'u')!,
      role,
      rank: ROLE_RANK[role],
      permissions: [...ROLE_PERMISSIONS[role]],
      assignableRoles: hasPermission(role, 'users.roles.manage')
        ? (assignableRoles(role).filter((r) => hasPermission(role, 'admins.manage') || ROLE_RANK[r] < ROLE_RANK.ADMIN) as UserRoleEnum[])
        : [],
    };
  }

  async list(ctx: RequestContext, q: AdminUsersQueryDto): Promise<AdminPage<AdminUserRowDto>> {
    const emails = hasPermission(ctx.actor.role, 'users.email.read');
    const p = new Params();
    const where: string[] = [];
    if (q.q) {
      const term = p.add(likeTerm(q.q));
      where.push(`(u.username::text ILIKE ${term} OR u.display_name ILIKE ${term}${emails ? ` OR u.email::text ILIKE ${term}` : ''})`);
    }
    if (q.status) where.push(`u.status = ${p.add(q.status)}`);
    if (q.role) where.push(`u.role = ${p.add(q.role)}`);
    if (q.staff) where.push(`u.role <> 'USER'`);
    if (q.createdFrom) where.push(`u.created_at >= ${p.add(q.createdFrom)}::timestamptz`);
    if (q.createdTo) where.push(`u.created_at < ${p.add(q.createdTo)}::timestamptz`);
    const page = q.page ?? 1;
    const size = q.pageSize ?? 25;
    const order = q.order === 'asc' ? 'ASC' : 'DESC';
    const sort = USER_SORTS[q.sort ?? 'created'];
    const rows = await sqlRows(
      this.read.db,
      `SELECT x.*, count(*) OVER()::int AS total_count FROM (${USER_ROW_SQL(emails)}
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}) x
        ORDER BY ${sort} ${order} NULLS LAST, x.u_id ${order}
        LIMIT ${p.add(size)} OFFSET ${p.add((page - 1) * size)}`,
      p.values,
    );
    // The window count runs before LIMIT; only a page past the end needs a separate count.
    const total = rows.length
      ? rows[0].total_count
      : page > 1
        ? (
            await sqlOne<{ n: number }>(
              this.read.db,
              `SELECT count(*)::int AS n FROM users u ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
              p.values.slice(0, p.values.length - 2),
            )
          )!.n
        : 0;
    return { items: rows.map((r) => this.read.userRow(r)), page, pageSize: size, total };
  }

  async detail(ctx: RequestContext, id: string): Promise<AdminUserDetailDto> {
    const emails = hasPermission(ctx.actor.role, 'users.email.read');
    const row = await sqlOne(
      this.read.db,
      `SELECT x.*, uu.bio, uu.location, uu.website, uu.is_private, cv.storage_key AS cover_key
         FROM (${USER_ROW_SQL(emails)} WHERE u.id = $1) x
         JOIN users uu ON uu.id = x.u_id
         LEFT JOIN media cv ON cv.id = uu.cover_media_id`,
      [id],
    );
    if (!row) throw AppException.notFound(ErrorCode.USER_NOT_FOUND, 'User not found');
    const counts = (await sqlOne(
      this.read.db,
      `SELECT
         (SELECT count(*)::int FROM posts WHERE author_id = $1 AND kind <> 'REPOST' AND deleted_at IS NULL) AS posts,
         (SELECT count(*)::int FROM posts p WHERE p.author_id = $1 AND p.kind <> 'REPOST' AND p.deleted_at IS NULL
             AND EXISTS (SELECT 1 FROM post_media pm JOIN media m ON m.id = pm.media_id WHERE pm.post_id = p.id AND m.type = 'VIDEO')) AS reels,
         (SELECT count(*)::int FROM comments WHERE author_id = $1 AND deleted_at IS NULL) AS comments,
         (SELECT count(*)::int FROM posts WHERE author_id = $1 AND kind = 'REPOST' AND deleted_at IS NULL) AS reposts,
         (SELECT count(*)::int FROM posts WHERE author_id = $1 AND moderation_status <> 'ACTIVE') AS moderated_posts,
         (SELECT count(*)::int FROM comments WHERE author_id = $1 AND moderation_status <> 'ACTIVE') AS moderated_comments,
         (SELECT count(*)::int FROM blocks WHERE blocker_id = $1) AS blocking,
         (SELECT count(*)::int FROM blocks WHERE blocked_id = $1) AS blocked_by,
         (SELECT count(*)::int FROM follow_requests WHERE target_id = $1) AS pending_requests,
         (SELECT count(*)::int FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()) AS sessions`,
      [id],
    ))!;
    const restrictions = await sqlRows(
      this.read.db,
      `SELECT ar.*, ${userRefCols('cb', 'cbav', 'cb')}
         FROM account_restrictions ar
         LEFT JOIN users cb ON cb.id = ar.created_by_id
         LEFT JOIN media cbav ON cbav.id = cb.avatar_media_id
        WHERE ar.user_id = $1 ORDER BY ar.created_at DESC LIMIT 50`,
      [id],
    );
    const warnings = await sqlRows(
      this.read.db,
      `SELECT w.*, ${userRefCols('cb', 'cbav', 'cb')}
         FROM user_warnings w
         LEFT JOIN users cb ON cb.id = w.created_by_id
         LEFT JOIN media cbav ON cbav.id = cb.avatar_media_id
        WHERE w.user_id = $1 ORDER BY w.created_at DESC LIMIT 50`,
      [id],
    );
    const reports = await this.read.reportsFor(
      `(r.target_type = 'USER' AND r.target_id = $1)
        OR (r.target_type = 'POST' AND r.target_id IN (SELECT x.id FROM posts x WHERE x.author_id = $1))
        OR (r.target_type = 'COMMENT' AND r.target_id IN (SELECT x.id FROM comments x WHERE x.author_id = $1))`,
      [id],
    );
    return {
      user: this.read.userRow(row),
      bio: row.bio,
      location: row.location,
      website: row.website,
      coverUrl: this.read.urls.url(row.cover_key ?? null),
      isPrivate: row.is_private,
      activeSessions: counts.sessions,
      content: {
        posts: counts.posts,
        reels: counts.reels,
        comments: counts.comments,
        reposts: counts.reposts,
        moderatedPosts: counts.moderated_posts,
        moderatedComments: counts.moderated_comments,
      },
      relationships: {
        followers: row.follower_count,
        following: row.following_count,
        blocking: counts.blocking,
        blockedBy: counts.blocked_by,
        pendingFollowRequests: counts.pending_requests,
      },
      restrictions: restrictions.map((r) => ({
        id: r.id,
        type: r.type,
        reason: r.reason,
        startsAt: iso(r.starts_at)!,
        expiresAt: iso(r.expires_at),
        createdBy: this.read.ref(r, 'cb'),
        liftedAt: iso(r.lifted_at),
        liftReason: r.lift_reason,
        active: !r.lifted_at && (!r.expires_at || new Date(r.expires_at) > new Date()),
      })),
      warnings: warnings.map((w) => ({
        id: w.id,
        reason: w.reason,
        message: w.message,
        createdBy: this.read.ref(w, 'cb'),
        createdAt: iso(w.created_at)!,
        readAt: iso(w.read_at),
      })),
      reports,
      history: await this.read.history('USER', [id]),
    };
  }
}
