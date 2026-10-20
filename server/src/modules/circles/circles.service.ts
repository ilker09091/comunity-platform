import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomInt } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { decodeCursor, iso, toPage } from '../../common/utils/cursor.js';
import { sanitizeText } from '../../common/utils/sanitize.js';
import { notBlockedSql, sqlOne, sqlRows } from '../../common/utils/sql.js';
import { ContentDeletionService } from '../media/content-deletion.service.js';
import { MediaService, type MediaRow } from '../media/media.service.js';
import { USER_AVATAR_JOIN, USER_SUMMARY_COLUMNS, UsersService, type UserSummaryRow } from '../users/users.service.js';
import { promptFor } from './circle-prompts.js';
import {
  CircleAlbumDto,
  CircleDto,
  CircleInviteDto,
  CircleMemberDto,
  CirclePostDto,
  CirclePromptDto,
  CircleRole,
  CreateCircleAlbumDto,
  CreateCircleDto,
  CreateCirclePostDto,
  CreateCirclePromptDto,
  StreakRule,
  UpdateCircleDto,
} from './circles.dto.js';

type Db = DataSource | EntityManager;
export const MAX_CIRCLE_MEMBERS = 30;
const MAX_MEMBERSHIPS = 30;
const MAX_OPEN_ALBUMS = 5;
/** Days are UTC, like message streaks, so every member shares the same "today". */
const TODAY = `(now() AT TIME ZONE 'UTC')::date`;
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RANK: Record<CircleRole, number> = { owner: 3, admin: 2, member: 1 };

interface CircleRow {
  id: string; name: string; emoji: string; color: string; description: string | null; kind: CircleDto['kind'];
  invite_code: string; members_can_invite: boolean; streak_rule: StreakRule; streak_days: number; best_streak: number;
  created_at: Date; role: CircleRole; member_count: number; today_count: number; contributed: boolean; alive: boolean;
  completed_today: boolean; at_risk: boolean; answered_today: boolean; has_new: boolean;
}
interface PostRow extends UserSummaryRow {
  post_id: string; author_id: string; content: string | null; media_id: string | null; poll_choice: number | null;
  prompt_id: string | null; album_id: string | null; post_created_at: Date;
}

/** People needed on a day to keep the shared streak alive (never fewer than two). */
export function streakNeeded(rule: StreakRule, members: number): number {
  if (members < 2) return 0;
  const share = rule === 'all' ? members : rule === 'half' ? Math.ceil(members / 2)
    : rule === 'most' || members > 6 ? Math.ceil((members * 2) / 3) : members;
  return Math.max(2, share);
}

@Injectable()
export class CirclesService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly users: UsersService,
    private readonly media: MediaService,
    private readonly deletion: ContentDeletionService,
  ) {}

  // ---- Membership -------------------------------------------------------------------------

  private async role(m: Db, circleId: string, userId: string, lock = false): Promise<CircleRole> {
    const row = await sqlOne<{ role: CircleRole }>(m,
      `SELECT role FROM circle_members WHERE circle_id = $1 AND user_id = $2${lock ? ' FOR UPDATE' : ''}`, [circleId, userId]);
    // Outsiders cannot tell a private circle from a missing one.
    if (!row) throw AppException.notFound(ErrorCode.NOT_FOUND, 'Circle not found');
    return row.role;
  }
  private assertRank(role: CircleRole, needed: CircleRole, action: string) {
    if (RANK[role] < RANK[needed]) throw AppException.forbidden(ErrorCode.FORBIDDEN, `Only circle ${needed}s can ${action}`);
  }
  private inviteCode() {
    return Array.from({ length: 8 }, () => INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)]).join('');
  }
  private async assertMembershipLimit(m: Db, userId: string) {
    const count = await sqlOne<{ n: number }>(m, 'SELECT count(*)::int AS n FROM circle_members WHERE user_id = $1', [userId]);
    if ((count?.n ?? 0) >= MAX_MEMBERSHIPS)
      throw AppException.conflict(ErrorCode.CONFLICT, `You can be in up to ${MAX_MEMBERSHIPS} circles. Leave one first.`);
  }

  // ---- Circles ----------------------------------------------------------------------------

  private async rows(viewerId: string, circleId?: string): Promise<CircleRow[]> {
    return sqlRows<CircleRow>(this.db,
      `SELECT c.*, cm.role,
          (SELECT count(*)::int FROM circle_members x WHERE x.circle_id = c.id) AS member_count,
          (SELECT count(*)::int FROM circle_activity a JOIN circle_members x ON x.circle_id = a.circle_id AND x.user_id = a.user_id
            WHERE a.circle_id = c.id AND a.day = ${TODAY}) AS today_count,
          EXISTS (SELECT 1 FROM circle_activity a WHERE a.circle_id = c.id AND a.day = ${TODAY} AND a.user_id = $1) AS contributed,
          COALESCE(c.last_completed_day >= ${TODAY} - 2, false) AS alive,
          COALESCE(c.last_completed_day = ${TODAY}, false) AS completed_today,
          COALESCE(c.last_completed_day = ${TODAY} - 2, false) AS at_risk,
          EXISTS (SELECT 1 FROM circle_posts p JOIN circle_prompts pr ON pr.id = p.prompt_id
            WHERE pr.circle_id = c.id AND pr.day = ${TODAY} AND p.author_id = $1) AS answered_today,
          (EXISTS (SELECT 1 FROM circle_posts p WHERE p.circle_id = c.id AND p.author_id <> $1 AND p.created_at > cm.last_seen_at)
            OR EXISTS (SELECT 1 FROM circle_albums al WHERE al.circle_id = c.id AND al.created_by <> $1 AND al.created_at > cm.last_seen_at)) AS has_new
        FROM circle_members cm JOIN circles c ON c.id = cm.circle_id
       WHERE cm.user_id = $1 ${circleId ? 'AND c.id = $2' : ''}
       ORDER BY GREATEST(cm.joined_at, (SELECT max(p.created_at) FROM circle_posts p WHERE p.circle_id = c.id)) DESC, c.id`,
      circleId ? [viewerId, circleId] : [viewerId]);
  }
  private async previews(viewerId: string, circleIds: string[]) {
    if (!circleIds.length) return new Map<string, UserSummaryRow[]>();
    const rows = await sqlRows<UserSummaryRow & { circle_id: string }>(this.db,
      `SELECT cm.circle_id, ${USER_SUMMARY_COLUMNS} FROM circle_members cm JOIN users u ON u.id = cm.user_id ${USER_AVATAR_JOIN}
        WHERE cm.circle_id = ANY($1::uuid[]) AND u.status = 'ACTIVE' AND ${notBlockedSql('u.id', '$2')}
        ORDER BY cm.circle_id, (cm.user_id = $2), cm.joined_at`, [circleIds, viewerId]);
    const byCircle = new Map<string, UserSummaryRow[]>();
    for (const row of rows) {
      const list = byCircle.get(row.circle_id) ?? [];
      if (list.length < 5) list.push(row);
      byCircle.set(row.circle_id, list);
    }
    return byCircle;
  }
  private toDto(row: CircleRow, members: UserSummaryRow[]): CircleDto {
    return {
      id: row.id, name: row.name, emoji: row.emoji, color: row.color, description: row.description, kind: row.kind,
      role: row.role, memberCount: row.member_count, members: members.map(u => this.users.toSummary(u)),
      streak: {
        days: row.alive ? row.streak_days : 0, best: row.best_streak, todayCount: row.today_count,
        needed: streakNeeded(row.streak_rule, row.member_count), completedToday: row.completed_today,
        contributedToday: row.contributed, atRisk: row.alive && row.at_risk && !row.completed_today,
      },
      streakRule: row.streak_rule, membersCanInvite: row.members_can_invite,
      inviteCode: row.role !== 'member' || row.members_can_invite ? row.invite_code : null,
      answeredToday: row.answered_today, hasNew: row.has_new, createdAt: iso(row.created_at)!,
    };
  }
  async list(viewerId: string): Promise<CircleDto[]> {
    const rows = await this.rows(viewerId);
    const members = await this.previews(viewerId, rows.map(r => r.id));
    return rows.map(r => this.toDto(r, members.get(r.id) ?? []));
  }
  private async one(viewerId: string, circleId: string): Promise<CircleDto> {
    const [row] = await this.rows(viewerId, circleId);
    if (!row) throw AppException.notFound(ErrorCode.NOT_FOUND, 'Circle not found');
    const members = await this.previews(viewerId, [row.id]);
    return this.toDto(row, members.get(row.id) ?? []);
  }
  /** Opening a circle clears its "new" dot. */
  async get(viewerId: string, circleId: string): Promise<CircleDto> {
    const dto = await this.one(viewerId, circleId);
    await sqlRows(this.db, 'UPDATE circle_members SET last_seen_at = now() WHERE circle_id = $1 AND user_id = $2', [circleId, viewerId]);
    return dto;
  }
  async create(userId: string, dto: CreateCircleDto): Promise<CircleDto> {
    const id = await this.db.transaction(async m => {
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 4242))', [userId]);
      await this.assertMembershipLimit(m, userId);
      for (let attempt = 0; ; attempt++) {
        try {
          const row = await sqlOne<{ id: string }>(m,
            `INSERT INTO circles(name, emoji, color, description, kind, invite_code) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [dto.name, dto.emoji, dto.color, dto.description ?? null, dto.kind ?? 'friends', this.inviteCode()]);
          await m.query(`INSERT INTO circle_members(circle_id, user_id, role) VALUES ($1, $2, 'owner')`, [row!.id, userId]);
          return row!.id;
        } catch (error) {
          // A clashing invite code is astronomically unlikely; try a fresh one.
          if ((error as { code?: string }).code !== '23505' || attempt >= 2) throw error;
        }
      }
    });
    return this.one(userId, id);
  }
  async update(userId: string, circleId: string, dto: UpdateCircleDto): Promise<CircleDto> {
    this.assertRank(await this.role(this.db, circleId, userId), 'admin', 'change circle settings');
    const fields: [string, unknown][] = [];
    if (dto.name !== undefined) fields.push(['name', dto.name]);
    if (dto.emoji !== undefined) fields.push(['emoji', dto.emoji]);
    if (dto.color !== undefined) fields.push(['color', dto.color]);
    if (dto.description !== undefined) fields.push(['description', dto.description]);
    if (dto.kind !== undefined) fields.push(['kind', dto.kind]);
    if (dto.streakRule !== undefined) fields.push(['streak_rule', dto.streakRule]);
    if (dto.membersCanInvite !== undefined) fields.push(['members_can_invite', dto.membersCanInvite]);
    if (fields.length)
      await sqlRows(this.db, `UPDATE circles SET ${fields.map(([column], i) => `${column} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [circleId, ...fields.map(([, value]) => value)]);
    return this.one(userId, circleId);
  }
  async resetInvite(userId: string, circleId: string): Promise<CircleDto> {
    this.assertRank(await this.role(this.db, circleId, userId), 'admin', 'reset the invite link');
    await sqlRows(this.db, 'UPDATE circles SET invite_code = $2 WHERE id = $1', [circleId, this.inviteCode()]);
    return this.one(userId, circleId);
  }
  async remove(userId: string, circleId: string): Promise<void> {
    const files = await this.db.transaction(async m => {
      this.assertRank(await this.role(m, circleId, userId, true), 'owner', 'delete the circle');
      const media = await sqlRows<{ media_id: string }>(m,
        'SELECT media_id FROM circle_posts WHERE circle_id = $1 AND media_id IS NOT NULL', [circleId]);
      await m.query('DELETE FROM circles WHERE id = $1', [circleId]);
      return this.deletion.deleteMedia(m, media.map(r => r.media_id));
    });
    await this.deletion.removeFiles(files);
  }

  // ---- Invites and members -----------------------------------------------------------------

  async invite(viewerId: string, code: string): Promise<CircleInviteDto> {
    const circle = await sqlOne<CircleRow & { member_count: number; is_member: boolean }>(this.db,
      `SELECT c.*, (SELECT count(*)::int FROM circle_members x WHERE x.circle_id = c.id) AS member_count,
          EXISTS (SELECT 1 FROM circle_members x WHERE x.circle_id = c.id AND x.user_id = $2) AS is_member
        FROM circles c WHERE c.invite_code = upper($1)`, [code, viewerId]);
    if (!circle) throw AppException.notFound(ErrorCode.NOT_FOUND, 'This invite link is invalid or was reset');
    const members = (await this.previews(viewerId, [circle.id])).get(circle.id) ?? [];
    return {
      name: circle.name, emoji: circle.emoji, color: circle.color, description: circle.description, kind: circle.kind,
      memberCount: circle.member_count, members: members.map(u => this.users.toSummary(u)),
      circleId: circle.is_member ? circle.id : null, full: circle.member_count >= MAX_CIRCLE_MEMBERS,
    };
  }
  async join(userId: string, code: string): Promise<CircleDto> {
    const circleId = await this.db.transaction(async m => {
      const circle = await sqlOne<{ id: string }>(m, 'SELECT id FROM circles WHERE invite_code = upper($1) FOR UPDATE', [code]);
      if (!circle) throw AppException.notFound(ErrorCode.NOT_FOUND, 'This invite link is invalid or was reset');
      if (await sqlOne(m, 'SELECT 1 FROM circle_members WHERE circle_id = $1 AND user_id = $2', [circle.id, userId])) return circle.id;
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 4242))', [userId]);
      await this.assertMembershipLimit(m, userId);
      const count = await sqlOne<{ n: number }>(m, 'SELECT count(*)::int AS n FROM circle_members WHERE circle_id = $1', [circle.id]);
      if ((count?.n ?? 0) >= MAX_CIRCLE_MEMBERS)
        throw AppException.conflict(ErrorCode.CONFLICT, `This circle is full (${MAX_CIRCLE_MEMBERS} people).`);
      await m.query('INSERT INTO circle_members(circle_id, user_id) VALUES ($1, $2)', [circle.id, userId]);
      return circle.id;
    });
    return this.one(userId, circleId);
  }
  async members(viewerId: string, circleId: string): Promise<CircleMemberDto[]> {
    await this.role(this.db, circleId, viewerId);
    const rows = await sqlRows<UserSummaryRow & { role: CircleRole; joined_at: Date; contributed: boolean }>(this.db,
      `SELECT ${USER_SUMMARY_COLUMNS}, cm.role, cm.joined_at,
          EXISTS (SELECT 1 FROM circle_activity a WHERE a.circle_id = cm.circle_id AND a.user_id = cm.user_id AND a.day = ${TODAY}) AS contributed
        FROM circle_members cm JOIN users u ON u.id = cm.user_id ${USER_AVATAR_JOIN}
       WHERE cm.circle_id = $1 AND u.status = 'ACTIVE'
       ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, cm.joined_at`, [circleId]);
    return rows.map(r => ({ user: this.users.toSummary(r), role: r.role, joinedAt: iso(r.joined_at)!, contributedToday: r.contributed }));
  }
  async setRole(userId: string, circleId: string, targetId: string, role: CircleRole): Promise<CircleMemberDto[]> {
    if (targetId === userId) throw AppException.badRequest(ErrorCode.BAD_REQUEST, 'You cannot change your own role');
    await this.db.transaction(async m => {
      this.assertRank(await this.role(m, circleId, userId, true), 'owner', 'change roles');
      await this.role(m, circleId, targetId, true);
      // Demote first: a circle has exactly one owner at every moment.
      if (role === 'owner') await m.query(`UPDATE circle_members SET role = 'admin' WHERE circle_id = $1 AND user_id = $2`, [circleId, userId]);
      await m.query('UPDATE circle_members SET role = $3 WHERE circle_id = $1 AND user_id = $2', [circleId, targetId, role]);
    });
    return this.members(userId, circleId);
  }
  async removeMember(userId: string, circleId: string, targetId: string): Promise<void> {
    if (targetId === userId) return this.leave(userId, circleId);
    await this.db.transaction(async m => {
      const actor = await this.role(m, circleId, userId, true), target = await this.role(m, circleId, targetId, true);
      this.assertRank(actor, 'admin', 'remove people');
      if (RANK[target] >= RANK[actor]) throw AppException.forbidden(ErrorCode.FORBIDDEN, 'You can only remove people with a lower role');
      await m.query('DELETE FROM circle_members WHERE circle_id = $1 AND user_id = $2', [circleId, targetId]);
    });
  }
  /** The last person out deletes the circle (and its uploads); an owner hands over first. */
  async leave(userId: string, circleId: string): Promise<void> {
    const files = await this.db.transaction(async m => {
      await sqlRows(m, 'SELECT 1 FROM circles WHERE id = $1 FOR UPDATE', [circleId]);
      await this.role(m, circleId, userId, true);
      const count = await sqlOne<{ n: number }>(m, 'SELECT count(*)::int AS n FROM circle_members WHERE circle_id = $1', [circleId]);
      const media = (count?.n ?? 0) <= 1 ? await sqlRows<{ media_id: string }>(m,
        'SELECT media_id FROM circle_posts WHERE circle_id = $1 AND media_id IS NOT NULL', [circleId]) : [];
      await m.query('DELETE FROM circle_members WHERE circle_id = $1 AND user_id = $2', [circleId, userId]);
      return this.deletion.deleteMedia(m, media.map(r => r.media_id));
    });
    await this.deletion.removeFiles(files);
  }

  // ---- Streak --------------------------------------------------------------------------------

  /** Anything a member does for the circle today counts once toward the shared streak. */
  private async contribute(m: EntityManager, circleId: string, userId: string) {
    await m.query(`INSERT INTO circle_activity(circle_id, day, user_id) VALUES ($1, ${TODAY}, $2) ON CONFLICT DO NOTHING`, [circleId, userId]);
    const circle = await sqlOne<{ streak_rule: StreakRule; members: number; done: number; completed: boolean }>(m,
      `SELECT c.streak_rule, COALESCE(c.last_completed_day = ${TODAY}, false) AS completed,
          (SELECT count(*)::int FROM circle_members x WHERE x.circle_id = c.id) AS members,
          (SELECT count(*)::int FROM circle_activity a JOIN circle_members x ON x.circle_id = a.circle_id AND x.user_id = a.user_id
            WHERE a.circle_id = c.id AND a.day = ${TODAY}) AS done
        FROM circles c WHERE c.id = $1 FOR UPDATE`, [circleId]);
    if (!circle || circle.completed) return;
    const needed = streakNeeded(circle.streak_rule, circle.members);
    if (!needed || circle.done < needed) return;
    // One day of grace, like direct-message streaks.
    await m.query(
      `UPDATE circles SET streak_days = CASE WHEN last_completed_day >= ${TODAY} - 2 THEN streak_days + 1 ELSE 1 END,
          best_streak = GREATEST(best_streak, CASE WHEN last_completed_day >= ${TODAY} - 2 THEN streak_days + 1 ELSE 1 END),
          last_completed_day = ${TODAY}
        WHERE id = $1`, [circleId]);
  }

  // ---- Posts, answers and album items -------------------------------------------------------

  private async posts(viewerId: string, where: string, params: unknown[], limit?: number, cursor?: (string | number)[] | null) {
    const base = params.length;
    return sqlRows<PostRow>(this.db,
      `SELECT p.id AS post_id, p.author_id, p.content, p.media_id, p.poll_choice, p.prompt_id, p.album_id,
          p.created_at AS post_created_at, ${USER_SUMMARY_COLUMNS}
        FROM circle_posts p JOIN users u ON u.id = p.author_id ${USER_AVATAR_JOIN}
       WHERE ${where} AND u.status = 'ACTIVE' AND ${notBlockedSql('u.id', `$${base + 1}`)}
       ${cursor ? `AND (p.created_at, p.id) < ($${base + 2}::timestamptz, $${base + 3}::uuid)` : ''}
       ORDER BY p.created_at DESC, p.id DESC ${limit ? `LIMIT ${limit + 1}` : ''}`,
      [...params, viewerId, ...(cursor ?? [])]);
  }
  private async hydrate(rows: PostRow[], viewerId: string, role: CircleRole): Promise<CirclePostDto[]> {
    const ids = rows.map(r => r.media_id).filter((id): id is string => !!id);
    const media = ids.length ? await sqlRows<MediaRow>(this.db, 'SELECT * FROM media WHERE id = ANY($1::uuid[])', [ids]) : [];
    const byId = new Map(media.map(row => [row.id, this.media.toDto(row)]));
    return rows.map(r => ({
      id: r.post_id, author: this.users.toSummary(r), content: r.content, media: r.media_id ? byId.get(r.media_id) ?? null : null,
      pollChoice: r.poll_choice, promptId: r.prompt_id, albumId: r.album_id,
      canDelete: r.author_id === viewerId || RANK[role] >= RANK.admin, createdAt: iso(r.post_created_at)!,
    }));
  }
  async feed(viewerId: string, circleId: string, cursorStr: string | undefined, limit: number) {
    const role = await this.role(this.db, circleId, viewerId);
    const cursor = decodeCursor(cursorStr, ['date', 'uuid']);
    const rows = await this.posts(viewerId, 'p.circle_id = $1 AND p.prompt_id IS NULL AND p.album_id IS NULL', [circleId], limit, cursor);
    const page = toPage(rows, limit, r => r, r => [iso(r.post_created_at)!, r.post_id]);
    return { ...page, items: await this.hydrate(page.items, viewerId, role) };
  }
  async createPost(userId: string, circleId: string, dto: CreateCirclePostDto): Promise<CirclePostDto> {
    const content = dto.content?.trim() || null;
    if (dto.promptId && dto.albumId) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Choose a question or an album, not both');
    const id = await this.db.transaction(async m => {
      await this.role(m, circleId, userId);
      let pollChoice: number | null = null;
      if (dto.promptId) {
        const prompt = await sqlOne<{ kind: 'text' | 'photo' | 'poll'; options: string[] | null; today: boolean }>(m,
          `SELECT kind, options, day = ${TODAY} AS today FROM circle_prompts WHERE id = $1 AND circle_id = $2`, [dto.promptId, circleId]);
        if (!prompt) throw AppException.notFound(ErrorCode.NOT_FOUND, 'Question not found');
        if (!prompt.today) throw AppException.conflict(ErrorCode.INVALID_STATE, 'This question is closed. A new one arrives every day.');
        if (prompt.kind === 'poll') {
          if (dto.pollChoice === undefined || dto.pollChoice >= (prompt.options?.length ?? 0))
            throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Pick one of the options');
          if (dto.mediaId) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Polls take a choice, not a photo');
          pollChoice = dto.pollChoice;
        } else if (prompt.kind === 'photo' && !dto.mediaId)
          throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'This question needs a photo or video');
        else if (prompt.kind === 'text' && !content && !dto.mediaId)
          throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Write your answer');
        if (await sqlOne(m, 'SELECT 1 FROM circle_posts WHERE prompt_id = $1 AND author_id = $2', [dto.promptId, userId]))
          throw AppException.conflict(ErrorCode.CONFLICT, 'You already answered today');
      } else {
        if (dto.pollChoice !== undefined) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Only poll answers take a choice');
        if (dto.albumId) {
          const album = await sqlOne<{ open: boolean }>(m,
            'SELECT closes_at > now() AS open FROM circle_albums WHERE id = $1 AND circle_id = $2 FOR SHARE', [dto.albumId, circleId]);
          if (!album) throw AppException.notFound(ErrorCode.NOT_FOUND, 'Album not found');
          if (!album.open) throw AppException.conflict(ErrorCode.INVALID_STATE, 'This album is closed');
          if (!dto.mediaId) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Add a photo or video to the album');
        } else if (!content && !dto.mediaId) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Write something or add a photo');
      }
      if (dto.mediaId) {
        const [media] = await this.media.lockAttachable(m, userId, [dto.mediaId]);
        if (media.status !== 'READY') throw AppException.badRequest(ErrorCode.INVALID_MEDIA, 'Wait for the video to finish processing');
      }
      const row = await sqlOne<{ id: string }>(m,
        `INSERT INTO circle_posts(circle_id, author_id, prompt_id, album_id, content, media_id, poll_choice)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [circleId, userId, dto.promptId ?? null, dto.albumId ?? null, content, dto.mediaId ?? null, pollChoice]);
      await this.contribute(m, circleId, userId);
      return row!.id;
    });
    const role = await this.role(this.db, circleId, userId);
    const [row] = await this.posts(userId, 'p.id = $1', [id]);
    return (await this.hydrate([row], userId, role))[0];
  }
  async deletePost(userId: string, circleId: string, postId: string): Promise<void> {
    const files = await this.db.transaction(async m => {
      const role = await this.role(m, circleId, userId);
      const post = await sqlOne<{ author_id: string; media_id: string | null }>(m,
        'SELECT author_id, media_id FROM circle_posts WHERE id = $1 AND circle_id = $2 FOR UPDATE', [postId, circleId]);
      if (!post) throw AppException.notFound(ErrorCode.NOT_FOUND, 'Post not found');
      if (post.author_id !== userId) this.assertRank(role, 'admin', "remove other people's posts");
      await m.query('DELETE FROM circle_posts WHERE id = $1', [postId]);
      return this.deletion.deleteMedia(m, post.media_id ? [post.media_id] : []);
    });
    await this.deletion.removeFiles(files);
  }

  // ---- Daily question -------------------------------------------------------------------------

  private async promptDto(viewerId: string, role: CircleRole, prompt: {
    id: string; day: string; kind: CirclePromptDto['kind']; text: string; options: string[] | null; author_id: string | null; today: boolean;
  }): Promise<CirclePromptDto> {
    const rows = await this.posts(viewerId, 'p.prompt_id = $1', [prompt.id]);
    const counts = await sqlOne<{ answered: number; members: number }>(this.db,
      `SELECT (SELECT count(*)::int FROM circle_posts WHERE prompt_id = $1) AS answered,
          (SELECT count(*)::int FROM circle_members WHERE circle_id = (SELECT circle_id FROM circle_prompts WHERE id = $1)) AS members`, [prompt.id]);
    const answers = await this.hydrate(rows, viewerId, role);
    const mine = answers.find(a => a.author.id === viewerId) ?? null;
    // Today's answers unlock once you have answered; earlier days are open to every member.
    const revealed = !prompt.today || !!mine;
    let results: number[] | null = null;
    if (prompt.kind === 'poll' && revealed && prompt.options) {
      const votes = await sqlRows<{ choice: number; n: number }>(this.db,
        'SELECT poll_choice AS choice, count(*)::int AS n FROM circle_posts WHERE prompt_id = $1 GROUP BY poll_choice', [prompt.id]);
      results = prompt.options.map((_, i) => votes.find(v => v.choice === i)?.n ?? 0);
    }
    const author = prompt.author_id ? await sqlOne<UserSummaryRow>(this.db,
      `SELECT ${USER_SUMMARY_COLUMNS} FROM users u ${USER_AVATAR_JOIN} WHERE u.id = $1`, [prompt.author_id]) : null;
    return {
      id: prompt.id, day: prompt.day, kind: prompt.kind, text: prompt.text, options: prompt.options,
      author: author ? this.users.toSummary(author) : null, answeredCount: counts?.answered ?? 0, memberCount: counts?.members ?? 0,
      myAnswer: mine, answers: revealed ? answers : [], results,
    };
  }
  private readonly promptColumns = `id, day::text AS day, kind, text, options, author_id, day = ${TODAY} AS today`;
  async today(viewerId: string, circleId: string): Promise<CirclePromptDto> {
    const role = await this.role(this.db, circleId, viewerId);
    const day = (await sqlOne<{ day: string }>(this.db, `SELECT ${TODAY}::text AS day`))!.day;
    const template = promptFor(circleId, day);
    await sqlRows(this.db,
      `INSERT INTO circle_prompts(circle_id, day, kind, text, options) VALUES ($1, $2::date, $3, $4, $5)
       ON CONFLICT (circle_id, day) DO NOTHING`,
      [circleId, day, template.kind, template.text, template.options ? JSON.stringify(template.options) : null]);
    const prompt = await sqlOne<Parameters<CirclesService['promptDto']>[2]>(this.db,
      `SELECT ${this.promptColumns} FROM circle_prompts WHERE circle_id = $1 AND day = $2::date`, [circleId, day]);
    return this.promptDto(viewerId, role, prompt!);
  }
  async history(viewerId: string, circleId: string, cursorStr: string | undefined, limit: number) {
    const role = await this.role(this.db, circleId, viewerId);
    const cursor = decodeCursor(cursorStr, ['date', 'uuid']);
    const rows = await sqlRows<Parameters<CirclesService['promptDto']>[2] & { created: Date }>(this.db,
      `SELECT ${this.promptColumns}, day::timestamptz AS created FROM circle_prompts
        WHERE circle_id = $1 AND day < ${TODAY} AND EXISTS (SELECT 1 FROM circle_posts p WHERE p.prompt_id = circle_prompts.id)
        ${cursor ? 'AND (day::timestamptz, id) < ($3::timestamptz, $4::uuid)' : ''}
        ORDER BY day DESC, id DESC LIMIT $2`, [circleId, limit + 1, ...(cursor ?? [])]);
    const page = toPage(rows, limit, r => r, r => [iso(r.created)!, r.id]);
    return { ...page, items: await Promise.all(page.items.map(p => this.promptDto(viewerId, role, p))) };
  }
  /** Admins can ask their own question: today if nobody answered yet, otherwise tomorrow. */
  async setPrompt(userId: string, circleId: string, dto: CreateCirclePromptDto): Promise<CirclePromptDto> {
    const role = await this.role(this.db, circleId, userId);
    this.assertRank(role, 'admin', 'write the daily question');
    const options = dto.kind === 'poll'
      ? (dto.options ?? []).map(o => sanitizeText(o, { multiline: false })).filter(Boolean) : null;
    if (options && (options.length < 2 || options.length > 6))
      throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'A poll needs two to six options');
    const id = await this.db.transaction(async m => {
      await sqlRows(m, 'SELECT 1 FROM circles WHERE id = $1 FOR UPDATE', [circleId]);
      const answered = await sqlOne(m,
        `SELECT 1 FROM circle_prompts pr JOIN circle_posts p ON p.prompt_id = pr.id WHERE pr.circle_id = $1 AND pr.day = ${TODAY}`, [circleId]);
      const row = await sqlOne<{ id: string }>(m,
        `INSERT INTO circle_prompts(circle_id, day, kind, text, options, author_id) VALUES ($1, ${TODAY} + $2::int, $3, $4, $5, $6)
         ON CONFLICT (circle_id, day) DO UPDATE SET kind = EXCLUDED.kind, text = EXCLUDED.text, options = EXCLUDED.options,
           author_id = EXCLUDED.author_id, created_at = now()
         RETURNING id`,
        [circleId, answered ? 1 : 0, dto.kind, dto.text, options ? JSON.stringify(options) : null, userId]);
      return row!.id;
    });
    const prompt = await sqlOne<Parameters<CirclesService['promptDto']>[2]>(this.db,
      `SELECT ${this.promptColumns} FROM circle_prompts WHERE id = $1`, [id]);
    return this.promptDto(userId, role, prompt!);
  }

  // ---- Albums ----------------------------------------------------------------------------------

  async albums(viewerId: string, circleId: string, cursorStr: string | undefined, limit: number) {
    const role = await this.role(this.db, circleId, viewerId);
    const cursor = decodeCursor(cursorStr, ['date', 'uuid']);
    const rows = await sqlRows<{ id: string; title: string; created_by: string | null; closes_at: Date; open: boolean;
      created_at: Date; item_count: number }>(this.db,
      `SELECT al.id, al.title, al.created_by, al.closes_at, al.closes_at > now() AS open, al.created_at,
          (SELECT count(*)::int FROM circle_posts p WHERE p.album_id = al.id) AS item_count
        FROM circle_albums al WHERE al.circle_id = $1
        ${cursor ? 'AND (al.created_at, al.id) < ($3::timestamptz, $4::uuid)' : ''}
        ORDER BY al.created_at DESC, al.id DESC LIMIT $2`, [circleId, limit + 1, ...(cursor ?? [])]);
    const page = toPage(rows, limit, r => r, r => [iso(r.created_at)!, r.id]);
    const creators = await sqlRows<UserSummaryRow>(this.db,
      `SELECT ${USER_SUMMARY_COLUMNS} FROM users u ${USER_AVATAR_JOIN} WHERE u.id = ANY($1::uuid[]) AND u.status = 'ACTIVE'`,
      [page.items.map(r => r.created_by).filter(Boolean)]);
    const byCreator = new Map(creators.map(u => [u.id, this.users.toSummary(u)]));
    const items: CircleAlbumDto[] = [];
    for (const album of page.items) {
      const previews = await this.posts(viewerId, 'p.album_id = $1 AND p.media_id IS NOT NULL', [album.id], 4);
      const media = await this.hydrate(previews.slice(0, 4), viewerId, role);
      items.push({
        id: album.id, title: album.title, createdBy: album.created_by ? byCreator.get(album.created_by) ?? null : null,
        closesAt: iso(album.closes_at)!, open: album.open, itemCount: album.item_count,
        preview: media.map(p => p.media).filter((x): x is NonNullable<typeof x> => !!x),
        canDelete: album.created_by === viewerId || RANK[role] >= RANK.admin, createdAt: iso(album.created_at)!,
      });
    }
    return { ...page, items };
  }
  async createAlbum(userId: string, circleId: string, dto: CreateCircleAlbumDto) {
    await this.db.transaction(async m => {
      await this.role(m, circleId, userId);
      await sqlRows(m, 'SELECT 1 FROM circles WHERE id = $1 FOR UPDATE', [circleId]);
      const open = await sqlOne<{ n: number }>(m,
        'SELECT count(*)::int AS n FROM circle_albums WHERE circle_id = $1 AND closes_at > now()', [circleId]);
      if ((open?.n ?? 0) >= MAX_OPEN_ALBUMS)
        throw AppException.conflict(ErrorCode.CONFLICT, `Up to ${MAX_OPEN_ALBUMS} albums can be open at once`);
      await m.query(`INSERT INTO circle_albums(circle_id, title, created_by, closes_at) VALUES ($1, $2, $3, now() + make_interval(hours => $4))`,
        [circleId, dto.title, userId, dto.hours]);
    });
    return (await this.albums(userId, circleId, undefined, 1)).items[0];
  }
  async albumItems(viewerId: string, circleId: string, albumId: string, cursorStr: string | undefined, limit: number) {
    const role = await this.role(this.db, circleId, viewerId);
    if (!(await sqlOne(this.db, 'SELECT 1 FROM circle_albums WHERE id = $1 AND circle_id = $2', [albumId, circleId])))
      throw AppException.notFound(ErrorCode.NOT_FOUND, 'Album not found');
    const cursor = decodeCursor(cursorStr, ['date', 'uuid']);
    const rows = await this.posts(viewerId, 'p.album_id = $1', [albumId], limit, cursor);
    const page = toPage(rows, limit, r => r, r => [iso(r.post_created_at)!, r.post_id]);
    return { ...page, items: await this.hydrate(page.items, viewerId, role) };
  }
  async deleteAlbum(userId: string, circleId: string, albumId: string): Promise<void> {
    const files = await this.db.transaction(async m => {
      const role = await this.role(m, circleId, userId);
      const album = await sqlOne<{ created_by: string | null }>(m,
        'SELECT created_by FROM circle_albums WHERE id = $1 AND circle_id = $2 FOR UPDATE', [albumId, circleId]);
      if (!album) throw AppException.notFound(ErrorCode.NOT_FOUND, 'Album not found');
      if (album.created_by !== userId) this.assertRank(role, 'admin', "delete other people's albums");
      const media = await sqlRows<{ media_id: string }>(m,
        'SELECT media_id FROM circle_posts WHERE album_id = $1 AND media_id IS NOT NULL', [albumId]);
      await m.query('DELETE FROM circle_albums WHERE id = $1', [albumId]);
      return this.deletion.deleteMedia(m, media.map(r => r.media_id));
    });
    await this.deletion.removeFiles(files);
  }
}
