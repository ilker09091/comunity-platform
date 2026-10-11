import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { iso } from '../../common/utils/cursor.js';
import { sqlRows } from '../../common/utils/sql.js';
import { MediaUrlService } from '../media/media-url.service.js';
import type {
  AdminCommentRowDto,
  AdminPostRowDto,
  AdminReelRowDto,
  AdminReportRowDto,
  AdminUserRefDto,
  AdminUserRowDto,
  AuditLogDto,
} from './dto/admin.dto.js';

type Row = Record<string, any>;

/** `<alias>.` columns needed for an AdminUserRefDto, prefixed `<p>_`. */
export const userRefCols = (u: string, av: string, p: string) =>
  `${u}.id AS ${p}_id, ${u}.username::text AS ${p}_username, ${u}.display_name AS ${p}_display_name,
   ${u}.role AS ${p}_role, ${u}.status AS ${p}_status, ${av}.storage_key AS ${p}_avatar`;

const POST_ROW_SQL = `
  SELECT p.id, p.kind, left(p.content, 200) AS content_preview, p.visibility, p.moderation_status, p.deleted_at,
         p.like_count, p.comment_count, p.repost_count, p.quote_count, p.bookmark_count, p.created_at,
         ${userRefCols('a', 'aav', 'a')},
         coalesce(md.images, 0) AS images, coalesce(md.videos, 0) AS videos, md.thumb_key,
         rc.total AS report_count, rc.open AS open_report_count
    FROM posts p
    JOIN users a ON a.id = p.author_id
    LEFT JOIN media aav ON aav.id = a.avatar_media_id
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE m.type = 'IMAGE')::int AS images,
             count(*) FILTER (WHERE m.type = 'VIDEO')::int AS videos,
             (array_agg(m.storage_key ORDER BY pm.position) FILTER (WHERE m.type = 'IMAGE'))[1] AS thumb_key
        FROM post_media pm JOIN media m ON m.id = pm.media_id WHERE pm.post_id = p.id) md ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS total, count(*) FILTER (WHERE r.status IN ('OPEN', 'IN_REVIEW'))::int AS open
        FROM reports r WHERE r.target_type = 'POST' AND r.target_id = p.id) rc ON true`;

const REEL_COLS = `, v.id AS v_id, v.storage_key AS v_key, v.mime_type AS v_mime, v.size_bytes AS v_size,
  v.width AS v_width, v.height AS v_height, v.duration_ms AS v_duration, v.status AS v_status`;
const REEL_JOIN = `
    JOIN LATERAL (
      SELECT m.* FROM post_media pm JOIN media m ON m.id = pm.media_id
       WHERE pm.post_id = p.id AND m.type = 'VIDEO' ORDER BY pm.position LIMIT 1) v ON true`;

const COMMENT_ROW_SQL = `
  SELECT c.id, c.content, c.post_id, c.parent_id, c.depth, c.like_count, c.reply_count, c.moderation_status,
         c.deleted_at, c.created_at, left(coalesce(p.content, ''), 120) AS post_preview,
         ${userRefCols('a', 'aav', 'a')},
         rc.total AS report_count, rc.open AS open_report_count
    FROM comments c
    JOIN posts p ON p.id = c.post_id
    JOIN users a ON a.id = c.author_id
    LEFT JOIN media aav ON aav.id = a.avatar_media_id
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS total, count(*) FILTER (WHERE r.status IN ('OPEN', 'IN_REVIEW'))::int AS open
        FROM reports r WHERE r.target_type = 'COMMENT' AND r.target_id = c.id) rc ON true`;

const REPORT_ROW_SQL = `
  SELECT r.id, r.target_type, r.target_id, r.reason, r.details, r.status, r.resolution_note, r.resolved_at, r.created_at,
         ${userRefCols('rp', 'rpav', 'rp')},
         ${userRefCols('asg', 'asgav', 'asg')},
         ${userRefCols('ow', 'owav', 'ow')},
         t.preview AS t_preview, t.tstatus AS t_status, t.deleted_at AS t_deleted, (t.owner_id IS NOT NULL) AS t_exists,
         coalesce(t.is_reel, false) AS is_reel,
         (SELECT count(*)::int FROM reports r2
           WHERE r2.target_type = r.target_type AND r2.target_id = r.target_id AND r2.status IN ('OPEN', 'IN_REVIEW')) AS same_pending
    FROM reports r
    JOIN users rp ON rp.id = r.reporter_id
    LEFT JOIN media rpav ON rpav.id = rp.avatar_media_id
    LEFT JOIN users asg ON asg.id = r.assigned_to_id
    LEFT JOIN media asgav ON asgav.id = asg.avatar_media_id
    LEFT JOIN LATERAL (
      SELECT p.author_id AS owner_id, left(coalesce(p.content, ''), 160) AS preview, p.moderation_status::text AS tstatus,
             p.deleted_at, EXISTS (SELECT 1 FROM post_media pm JOIN media m ON m.id = pm.media_id
                                    WHERE pm.post_id = p.id AND m.type = 'VIDEO') AS is_reel
        FROM posts p WHERE r.target_type = 'POST' AND p.id = r.target_id
      UNION ALL
      SELECT c.author_id, left(c.content, 160), c.moderation_status::text, c.deleted_at, false
        FROM comments c WHERE r.target_type = 'COMMENT' AND c.id = r.target_id
      UNION ALL
      SELECT u.id, u.display_name, u.status::text, NULL, false
        FROM users u WHERE r.target_type = 'USER' AND u.id = r.target_id) t ON true
    LEFT JOIN users ow ON ow.id = t.owner_id
    LEFT JOIN media owav ON owav.id = ow.avatar_media_id`;

const AUDIT_ROW_SQL = `
  SELECT l.id, l.action, l.actor_role, l.target_type, l.target_id, l.metadata, l.request_id, l.ip_address, l.created_at,
         ${userRefCols('u', 'uav', 'u')},
         CASE l.target_type
           WHEN 'USER' THEN (SELECT '@' || x.username::text FROM users x WHERE x.id = l.target_id)
           WHEN 'POST' THEN (SELECT left(coalesce(nullif(x.content, ''), '(media post)'), 60) FROM posts x WHERE x.id = l.target_id)
           WHEN 'COMMENT' THEN (SELECT left(x.content, 60) FROM comments x WHERE x.id = l.target_id)
           WHEN 'ANNOUNCEMENT' THEN (SELECT x.title FROM announcements x WHERE x.id = l.target_id)
           WHEN 'REPORT' THEN (SELECT x.reason::text || ' report' FROM reports x WHERE x.id = l.target_id)
           ELSE NULL
         END AS target_label
    FROM admin_audit_logs l
    LEFT JOIN users u ON u.id = l.actor_id
    LEFT JOIN media uav ON uav.id = u.avatar_media_id`;

export const USER_ROW_SQL = (emailVisible: boolean) => `
  SELECT ${userRefCols('u', 'uav', 'u')}, ${emailVisible ? 'u.email::text' : 'NULL::text'} AS email,
         u.created_at, u.last_active_at, u.post_count, u.follower_count, u.following_count,
         rc.total AS report_count, rc.open AS open_report_count
    FROM users u
    LEFT JOIN media uav ON uav.id = u.avatar_media_id
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS total, count(*) FILTER (WHERE r.status IN ('OPEN', 'IN_REVIEW'))::int AS open
        FROM reports r
       WHERE (r.target_type = 'USER' AND r.target_id = u.id)
          OR (r.target_type = 'POST' AND r.target_id IN (SELECT x.id FROM posts x WHERE x.author_id = u.id))
          OR (r.target_type = 'COMMENT' AND r.target_id IN (SELECT x.id FROM comments x WHERE x.author_id = u.id))) rc ON true`;

/** Shared SQL projections and mappers for admin read models (one query per list page). */
@Injectable()
export class AdminReadService {
  constructor(
    @InjectDataSource() readonly db: DataSource,
    readonly urls: MediaUrlService,
  ) {}

  readonly sql = { post: POST_ROW_SQL, reelCols: REEL_COLS, reelJoin: REEL_JOIN, comment: COMMENT_ROW_SQL, report: REPORT_ROW_SQL, audit: AUDIT_ROW_SQL };

  ref(r: Row, p: string): AdminUserRefDto | null {
    if (!r[`${p}_id`]) return null;
    return {
      id: r[`${p}_id`],
      username: r[`${p}_username`],
      displayName: r[`${p}_display_name`],
      avatarUrl: this.urls.url(r[`${p}_avatar`] ?? null),
      role: r[`${p}_role`],
      status: r[`${p}_status`],
    };
  }

  userRow(r: Row): AdminUserRowDto {
    return {
      ...this.ref(r, 'u')!,
      email: r.email ?? null,
      createdAt: iso(r.created_at)!,
      lastActiveAt: iso(r.last_active_at),
      postCount: r.post_count,
      followerCount: r.follower_count,
      followingCount: r.following_count,
      reportCount: r.report_count ?? 0,
      openReportCount: r.open_report_count ?? 0,
    };
  }

  postRow(r: Row): AdminPostRowDto {
    return {
      id: r.id,
      kind: r.kind,
      contentPreview: r.content_preview,
      author: this.ref(r, 'a')!,
      media: { images: r.images, videos: r.videos },
      thumbnailUrl: this.urls.url(r.thumb_key ?? null),
      visibility: r.visibility,
      moderationStatus: r.moderation_status,
      deletedAt: iso(r.deleted_at),
      likeCount: r.like_count,
      commentCount: r.comment_count,
      repostCount: r.repost_count,
      quoteCount: r.quote_count,
      reportCount: r.report_count ?? 0,
      openReportCount: r.open_report_count ?? 0,
      createdAt: iso(r.created_at)!,
    };
  }

  reelRow(r: Row): AdminReelRowDto {
    return {
      ...this.postRow(r),
      video: {
        mediaId: r.v_id,
        url: this.urls.url(r.v_key),
        mimeType: r.v_mime,
        sizeBytes: Number(r.v_size),
        width: r.v_width,
        height: r.v_height,
        durationMs: r.v_duration,
        status: r.v_status,
      },
    };
  }

  commentRow(r: Row): AdminCommentRowDto {
    return {
      id: r.id,
      content: r.content,
      author: this.ref(r, 'a')!,
      postId: r.post_id,
      postPreview: r.post_preview || null,
      parentId: r.parent_id,
      depth: r.depth,
      likeCount: r.like_count,
      replyCount: r.reply_count,
      moderationStatus: r.moderation_status,
      deletedAt: iso(r.deleted_at),
      reportCount: r.report_count ?? 0,
      openReportCount: r.open_report_count ?? 0,
      createdAt: iso(r.created_at)!,
    };
  }

  reportRow(r: Row): AdminReportRowDto {
    return {
      id: r.id,
      targetType: r.target_type,
      isReel: r.is_reel,
      targetId: r.target_id,
      reason: r.reason,
      details: r.details,
      status: r.status,
      reporter: this.ref(r, 'rp')!,
      assignee: this.ref(r, 'asg'),
      target: {
        exists: r.t_exists,
        preview: r.t_preview ?? null,
        owner: this.ref(r, 'ow'),
        status: r.t_status ?? null,
        deletedAt: iso(r.t_deleted),
      },
      samePendingCount: r.same_pending,
      resolutionNote: r.resolution_note,
      resolvedAt: iso(r.resolved_at),
      createdAt: iso(r.created_at)!,
    };
  }

  auditRow(r: Row): AuditLogDto {
    return {
      id: r.id,
      action: r.action,
      actor: this.ref(r, 'u'),
      actorRole: r.actor_role,
      targetType: r.target_type,
      targetId: r.target_id,
      targetLabel: r.target_label ?? null,
      metadata: r.metadata ?? {},
      requestId: r.request_id,
      ipAddress: r.ip_address,
      createdAt: iso(r.created_at)!,
    };
  }

  /** Audit events for a target (moderation history), newest first. */
  async history(targetType: string, targetIds: string[], limit = 30): Promise<AuditLogDto[]> {
    if (!targetIds.length) return [];
    const rows = await sqlRows(
      this.db,
      `${AUDIT_ROW_SQL} WHERE l.target_type = $1 AND l.target_id = ANY($2::uuid[]) ORDER BY l.created_at DESC, l.id DESC LIMIT $3`,
      [targetType, targetIds, limit],
    );
    return rows.map((r) => this.auditRow(r));
  }

  async reportsFor(where: string, params: unknown[], limit = 20): Promise<AdminReportRowDto[]> {
    const rows = await sqlRows(this.db, `${REPORT_ROW_SQL} WHERE ${where} ORDER BY r.created_at DESC LIMIT ${limit}`, params);
    return rows.map((r) => this.reportRow(r));
  }
}

/** Builds `$n` placeholders while collecting parameters. */
export class Params {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

export const likeTerm = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
