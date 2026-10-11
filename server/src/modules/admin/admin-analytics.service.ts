import { Injectable } from '@nestjs/common';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { recentServerErrors } from '../../common/errors/recent-errors.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import type { RequestContext } from '../platform/audit.service.js';
import { JobRegistryService } from '../platform/job-registry.service.js';
import { hasPermission } from '../platform/permissions.js';
import { PlatformSettingsService } from '../platform/platform-settings.service.js';
import { MediaService } from '../media/media.service.js';
import { AdminReadService, USER_ROW_SQL } from './admin-read.service.js';
import type {
  AlertDto,
  DashboardDto,
  Metric,
  OverviewDto,
  TimeseriesQueryDto,
  TimeseriesResponseDto,
  TopContentQueryDto,
  TopContentResponseDto,
} from './dto/admin.dto.js';

const HAS_VIDEO = `EXISTS (SELECT 1 FROM post_media pm JOIN media m ON m.id = pm.media_id
                    WHERE pm.post_id = p.id AND m.type = 'VIDEO' AND m.status = 'READY')`;

/** Event sources per metric: a timestamp column plus the counted expression. */
const SOURCES: Record<Metric, { sql: string; note: string | null }> = {
  registrations: { sql: `SELECT created_at AS ts, 1 AS w FROM users`, note: null },
  active_users: {
    sql: `SELECT day::timestamp AT TIME ZONE 'UTC' AS ts, user_id AS w FROM user_daily_activity`,
    note: 'Distinct users active per bucket; tracked only since the admin release (no earlier history).',
  },
  posts: { sql: `SELECT p.created_at AS ts, 1 AS w FROM posts p WHERE p.kind <> 'REPOST'`, note: 'Includes posts later deleted or moderated.' },
  reels: { sql: `SELECT p.created_at AS ts, 1 AS w FROM posts p WHERE p.kind <> 'REPOST' AND ${HAS_VIDEO}`, note: null },
  comments: { sql: `SELECT created_at AS ts, 1 AS w FROM comments`, note: null },
  likes: { sql: `SELECT created_at AS ts, 1 AS w FROM post_likes`, note: 'Current likes only — an unlike removes the record.' },
  reposts: { sql: `SELECT created_at AS ts, 1 AS w FROM posts WHERE kind = 'REPOST'`, note: null },
  bookmarks: { sql: `SELECT created_at AS ts, 1 AS w FROM bookmarks`, note: 'Current bookmarks only.' },
  reports_created: { sql: `SELECT created_at AS ts, 1 AS w FROM reports`, note: null },
  reports_resolved: { sql: `SELECT resolved_at AS ts, 1 AS w FROM reports WHERE resolved_at IS NOT NULL AND status IN ('RESOLVED', 'DISMISSED')`, note: null },
};
const MAX_BUCKETS = { day: 400, week: 260, month: 120 } as const;

@Injectable()
export class AdminAnalyticsService {
  private overviewCache: { value: OverviewDto; expires: number } | null = null;

  constructor(
    private readonly read: AdminReadService,
    private readonly settings: PlatformSettingsService,
    private readonly jobs: JobRegistryService,
    private readonly media: MediaService,
  ) {}

  /** Platform counters (cached for 30 s; each is an exact COUNT on indexed columns). */
  async overview(): Promise<OverviewDto> {
    if (this.overviewCache && this.overviewCache.expires > Date.now()) return this.overviewCache.value;
    const r = (await sqlOne(
      this.read.db,
      `SELECT
         (SELECT count(*)::int FROM users) AS total_users,
         (SELECT count(*)::int FROM users WHERE last_active_at > now() - interval '24 hours') AS active_24h,
         (SELECT count(*)::int FROM users WHERE last_active_at > now() - interval '7 days') AS active_7d,
         (SELECT count(*)::int FROM users WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS new_today,
         (SELECT count(*)::int FROM users WHERE created_at >= now() - interval '7 days') AS new_7d,
         (SELECT count(*)::int FROM posts WHERE kind <> 'REPOST' AND deleted_at IS NULL) AS total_posts,
         (SELECT count(*)::int FROM posts WHERE kind <> 'REPOST' AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS posts_today,
         (SELECT count(*)::int FROM posts p WHERE p.kind <> 'REPOST' AND p.deleted_at IS NULL AND ${HAS_VIDEO}) AS total_reels,
         (SELECT count(*)::int FROM comments WHERE deleted_at IS NULL) AS total_comments,
         (SELECT count(*)::int FROM post_likes) AS total_likes,
         (SELECT count(*)::int FROM posts WHERE kind = 'REPOST' AND deleted_at IS NULL) AS total_reposts,
         (SELECT count(*)::int FROM bookmarks) AS total_bookmarks,
         (SELECT count(*)::int FROM reports WHERE status IN ('OPEN', 'IN_REVIEW')) AS pending_reports,
         (SELECT count(*)::int FROM users WHERE status = 'SUSPENDED') AS suspended,
         (SELECT count(*)::int FROM users WHERE status = 'BANNED') AS banned,
         (SELECT min(day)::text FROM user_daily_activity) AS tracked_since`,
    ))!;
    const trackedSince: Date | null = r.tracked_since ? new Date(`${r.tracked_since}T00:00:00Z`) : null;
    const trackedHours = trackedSince ? (Date.now() - trackedSince.getTime()) / 3_600_000 : 0;
    const value: OverviewDto = {
      totalUsers: r.total_users,
      activeUsers24h: trackedHours >= 24 ? r.active_24h : null,
      activeUsers7d: trackedHours >= 24 * 7 ? r.active_7d : null,
      newUsersToday: r.new_today,
      newUsers7d: r.new_7d,
      totalPosts: r.total_posts,
      postsToday: r.posts_today,
      totalReels: r.total_reels,
      totalComments: r.total_comments,
      totalLikes: r.total_likes,
      totalReposts: r.total_reposts,
      totalBookmarks: r.total_bookmarks,
      pendingReports: r.pending_reports,
      suspendedAccounts: r.suspended,
      bannedAccounts: r.banned,
      activityTrackedSince: trackedSince?.toISOString() ?? null,
      generatedAt: new Date().toISOString(),
    };
    this.overviewCache = { value, expires: Date.now() + 30_000 };
    return value;
  }

  async timeseries(q: TimeseriesQueryDto): Promise<TimeseriesResponseDto> {
    const interval = q.interval ?? 'day';
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (!(from < to)) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Validation failed', [{ field: 'to', message: 'to must be after from' }]);
    const unitMs = { day: 864e5, week: 6048e5, month: 2592e6 }[interval];
    if ((to.getTime() - from.getTime()) / unitMs > MAX_BUCKETS[interval])
      throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Validation failed', [
        { field: 'interval', message: `Too many ${interval}s in range (max ${MAX_BUCKETS[interval]}); use a larger interval` },
      ]);
    const series = [];
    for (const metric of new Set(q.metrics)) {
      const source = SOURCES[metric];
      const value = metric === 'active_users' ? 'count(DISTINCT src.w)' : 'count(*)';
      // `interval` is a validated enum literal; all user values are bound parameters.
      const rows = await sqlRows<{ t: string; n: number }>(
        this.read.db,
        `WITH buckets AS (
           SELECT generate_series(date_trunc('${interval}', $1::timestamptz AT TIME ZONE 'UTC'),
                                  $2::timestamptz AT TIME ZONE 'UTC' - interval '1 microsecond',
                                  interval '1 ${interval}') AS t)
         SELECT to_char(b.t, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS t, coalesce(c.n, 0)::int AS n
           FROM buckets b
           LEFT JOIN (
             SELECT date_trunc('${interval}', src.ts AT TIME ZONE 'UTC') AS t, ${value} AS n
               FROM (${source.sql}) src
              WHERE src.ts >= $1::timestamptz AND src.ts < $2::timestamptz
              GROUP BY 1) c ON c.t = b.t
          ORDER BY b.t`,
        [from.toISOString(), to.toISOString()],
      );
      const points = rows.map((row) => ({ t: new Date(row.t).toISOString(), value: row.n }));
      series.push({
        metric,
        total: metric === 'active_users' ? await this.distinctActive(from, to) : points.reduce((s, p) => s + p.value, 0),
        points,
        note: source.note,
      });
    }
    return { interval, from: from.toISOString(), to: to.toISOString(), series };
  }

  private async distinctActive(from: Date, to: Date): Promise<number> {
    const row = await sqlOne<{ n: number }>(
      this.read.db,
      `SELECT count(DISTINCT user_id)::int AS n FROM user_daily_activity
        WHERE day >= ($1::timestamptz AT TIME ZONE 'UTC')::date AND day < ($2::timestamptz AT TIME ZONE 'UTC')::date + 1`,
      [from.toISOString(), to.toISOString()],
    );
    return row?.n ?? 0;
  }

  async topContent(q: TopContentQueryDto): Promise<TopContentResponseDto> {
    const by = q.by ?? 'engagement';
    const score = {
      likes: 'x.like_count',
      comments: 'x.comment_count',
      reposts: '(x.repost_count + x.quote_count)',
      engagement: '(x.like_count + 2 * x.comment_count + 3 * (x.repost_count + x.quote_count))',
    }[by];
    const rows = await sqlRows(
      this.read.db,
      `SELECT x.*, ${score} AS score FROM (${this.read.sql.post}
          WHERE p.kind <> 'REPOST' AND p.deleted_at IS NULL AND p.created_at >= $1::timestamptz AND p.created_at < $2::timestamptz
          ${q.kind === 'reels' ? `AND ${HAS_VIDEO}` : ''}) x
        WHERE ${score} > 0
        ORDER BY score DESC, x.created_at DESC LIMIT $3`,
      [q.from, q.to, q.limit ?? 10],
    );
    return { items: rows.map((r) => ({ ...this.read.postRow(r), score: Number(r.score) })), viewsTracked: false };
  }

  async dashboard(ctx: RequestContext): Promise<DashboardDto> {
    const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(ctx.actor.role, p);
    const overview = await this.overview();
    const emails = can('users.email.read');
    const [users, posts, reels, reports, actions] = await Promise.all([
      sqlRows(this.read.db, `${USER_ROW_SQL(emails)} ORDER BY u.created_at DESC LIMIT 6`),
      sqlRows(this.read.db, `${this.read.sql.post} WHERE p.kind <> 'REPOST' ORDER BY p.created_at DESC LIMIT 6`),
      sqlRows(
        this.read.db,
        `${this.read.sql.post.replace('SELECT p.id,', `SELECT p.id${this.read.sql.reelCols},`).replace(
          'LEFT JOIN media aav ON aav.id = a.avatar_media_id',
          `LEFT JOIN media aav ON aav.id = a.avatar_media_id ${this.read.sql.reelJoin}`,
        )} WHERE p.kind <> 'REPOST' ORDER BY p.created_at DESC LIMIT 6`,
      ),
      can('reports.read')
        ? sqlRows(this.read.db, `${this.read.sql.report} WHERE r.status IN ('OPEN', 'IN_REVIEW') ORDER BY r.created_at DESC LIMIT 6`)
        : Promise.resolve([]),
      can('audit.read') ? sqlRows(this.read.db, `${this.read.sql.audit} ORDER BY l.created_at DESC LIMIT 8`) : Promise.resolve([]),
    ]);
    return {
      overview,
      recentUsers: users.map((r) => this.read.userRow(r)),
      latestPosts: posts.map((r) => this.read.postRow(r)),
      latestReels: reels.map((r) => this.read.reelRow(r)),
      recentReports: reports.map((r) => this.read.reportRow(r)),
      recentActions: actions.map((r) => this.read.auditRow(r)),
      alerts: await this.alerts(ctx, overview),
    };
  }

  /** Alerts derived from real state only. */
  private async alerts(ctx: RequestContext, overview: OverviewDto): Promise<AlertDto[]> {
    const alerts: AlertDto[] = [];
    const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(ctx.actor.role, p);
    if (can('reports.read') && overview.pendingReports > 0) {
      const oldest = await sqlOne<{ at: Date }>(this.read.db, `SELECT min(created_at) AS at FROM reports WHERE status IN ('OPEN', 'IN_REVIEW')`);
      const hours = oldest?.at ? Math.floor((Date.now() - new Date(oldest.at).getTime()) / 3_600_000) : 0;
      alerts.push({
        level: hours >= 24 ? 'critical' : 'warning',
        title: `${overview.pendingReports} report${overview.pendingReports === 1 ? '' : 's'} awaiting review`,
        detail: hours >= 1 ? `The oldest has been waiting ${hours} hour${hours === 1 ? '' : 's'}.` : 'All received within the last hour.',
        href: '/admin/reports',
      });
    }
    const settings = await this.settings.get();
    if (settings.general.readOnlyMode)
      alerts.push({ level: 'warning', title: 'Read-only mode is on', detail: 'Members cannot post, comment or upload.', href: '/admin/settings' });
    const disabled = Object.entries(settings.features).filter(([, on]) => !on).map(([k]) => k);
    if (disabled.length)
      alerts.push({ level: 'info', title: 'Features disabled', detail: disabled.join(', '), href: '/admin/settings' });
    if (can('media.manage')) {
      const failed = await sqlOne<{ n: number }>(this.read.db, `SELECT count(*)::int AS n FROM media WHERE status = 'FAILED'`);
      if (failed!.n) alerts.push({ level: 'warning', title: `${failed!.n} media file(s) failed processing`, detail: 'Review them in the media library.', href: '/admin/media?status=FAILED' });
    }
    if (can('system.read')) {
      const storage = await this.media.storageHealth();
      if (!storage.writable) alerts.push({ level: 'critical', title: 'Media storage is not writable', detail: storage.detail ?? 'Uploads will fail.', href: '/admin/system' });
      const hourAgo = Date.now() - 3_600_000;
      const errors = recentServerErrors().filter((e) => new Date(e.at).getTime() > hourAgo).length;
      if (errors) alerts.push({ level: 'warning', title: `${errors} server error(s) in the last hour`, detail: 'See System Status for details.', href: '/admin/system' });
      for (const job of this.jobs.list().filter((j) => j.lastStatus === 'FAILED'))
        alerts.push({ level: 'warning', title: `Job "${job.name}" failed`, detail: job.lastDetail ?? '', href: '/admin/system' });
    }
    return alerts;
  }
}
