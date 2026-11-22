import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { decodeCursor, iso, toPage } from '../../common/utils/cursor.js';
import { notBlockedSql, sqlOne, sqlRows } from '../../common/utils/sql.js';
import { ContentDeletionService } from '../media/content-deletion.service.js';
import { MediaService } from '../media/media.service.js';
import { MediaUrlService } from '../media/media-url.service.js';
import { UsersService, USER_SUMMARY_COLUMNS, USER_AVATAR_JOIN } from '../users/users.service.js';
import { MessagesService } from './messages.service.js';
import { StickersService } from './stickers.service.js';
import { PushService } from './push.service.js';
import { GifsService } from '../gifs/gifs.js';
import { PostsQueryService } from '../posts/posts-query.service.js';
import {
  CreateGroupDto, GroupDto, GroupDetailDto, GroupEventType, GroupMediaListDto, GroupMessageDto, GroupPermissionsDto,
  GroupReceiptsDto, GroupRole, UpdateGroupDto,
} from './groups.dto.js';
import { SendMessageDto } from './social.dto.js';

type Db = DataSource | EntityManager;
type Row = Record<string, any>;
const MAX_MEMBERS = 32;
const first = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] || 'Someone';

/** What a system event says, from the point of view of everyone (the client localises it). */
export function eventText(type: GroupEventType, actor: string, targets: string[], value: string | null) {
  const who = targets.join(', ');
  switch (type) {
    case 'created': return `${actor} created the group`;
    case 'added': return `${actor} added ${who}`;
    case 'removed': return `${actor} removed ${who}`;
    case 'left': return `${actor} left the group`;
    case 'joined': return `${actor} joined the group`;
    case 'renamed': return `${actor} changed the group name to “${value ?? ''}”`;
    case 'photo': return value === 'removed' ? `${actor} removed the group photo` : `${actor} changed the group photo`;
    case 'description': return value ? `${actor} changed the group description` : `${actor} removed the group description`;
    case 'pinned': return `${actor} pinned “${value ?? ''}”`;
    case 'unpinned': return `${actor} unpinned a message`;
    case 'admin': return `${actor} made ${who} an admin`;
    case 'unadmin': return `${actor} removed ${who} as admin`;
    case 'owner': return `${actor} made ${who} the group owner`;
  }
}

/** A short line for a message: its text or what kind of attachment it is. */
const PREVIEW_SQL = (m: string) => `coalesce(${m}.content,CASE WHEN ${m}.gif IS NOT NULL THEN 'GIF' WHEN ${m}.has_sticker THEN 'Sticker'
  WHEN ${m}.audio_key IS NOT NULL THEN 'Voice message' WHEN ${m}.post_id IS NOT NULL THEN 'Shared a post' ELSE 'Photo' END)`;

@Injectable()
export class GroupsService {
  constructor(@InjectDataSource() private readonly db: DataSource, private readonly messages: MessagesService,
    private readonly users: UsersService, private readonly media: MediaService, private readonly stickers: StickersService,
    private readonly gifs: GifsService, private readonly deletion: ContentDeletionService, private readonly push: PushService,
    private readonly posts: PostsQueryService, private readonly urls: MediaUrlService) {}

  /* ------------------------------------------------------------------ membership and rights */

  private async member(m: Db, id: string, userId: string, lock = false) {
    const row = await sqlOne(m, `SELECT g.*,gm.read_seq,gm.role,gm.muted FROM chat_groups g JOIN chat_group_members gm ON gm.group_id=g.id
      WHERE g.id=$1 AND gm.user_id=$2${lock ? ' FOR UPDATE OF g' : ''}`, [id, userId]);
    if (!row) throw AppException.notFound(ErrorCode.NOT_FOUND, 'Group not found');
    return row;
  }
  private roleOf(group: Row, userId: string): GroupRole {
    return group.owner_id === userId ? 'owner' : group.role === 'admin' ? 'admin' : 'member';
  }
  private manages(group: Row, userId: string) {
    return this.roleOf(group, userId) !== 'member';
  }
  private requireOwner(group: Row, viewer: string) {
    if (group.owner_id !== viewer) throw AppException.forbidden(ErrorCode.FORBIDDEN, 'Only the group owner can do this');
  }
  private requireAdmin(group: Row, viewer: string) {
    if (!this.manages(group, viewer)) throw AppException.forbidden(ErrorCode.FORBIDDEN, 'Only group admins can do this');
  }
  private requireEdit(group: Row, viewer: string) {
    if (!this.manages(group, viewer) && !group.members_can_edit) throw AppException.forbidden(ErrorCode.FORBIDDEN, 'Only group admins can change the group info');
  }
  private requireAdd(group: Row, viewer: string) {
    if (!this.manages(group, viewer) && !group.members_can_add) throw AppException.forbidden(ErrorCode.FORBIDDEN, 'Only group admins can add people');
  }
  private async eligible(m: Db, owner: string, ids: string[]) {
    for (const id of ids) {
      if (id === owner) continue;
      try { await this.messages.assertCallPeer(owner, id, m); } catch (error) {
        if (error instanceof AppException && error.getStatus() === 403) throw AppException.forbidden(ErrorCode.FORBIDDEN, 'Add people who follow you or have accepted your messages');
        throw error;
      }
    }
  }
  private async names(m: Db, ids: string[]) {
    if (!ids.length) return [];
    const rows = await sqlRows<{ id: string; display_name: string }>(m, 'SELECT id,display_name FROM users WHERE id=ANY($1::uuid[])', [ids]);
    return ids.map((id) => first(rows.find((r) => r.id === id)?.display_name));
  }
  /** A system message in the chat ("Ece added Can"). */
  private async event(m: Db, groupId: string, actor: string, type: GroupEventType, targets: string[] = [], value: string | null = null) {
    await sqlRows(m, `INSERT INTO group_messages(group_id,sender_id,event) VALUES($1,$2,$3)`, [groupId, actor, JSON.stringify({ type, targets, value })]);
    await sqlRows(m, 'UPDATE chat_groups SET updated_at=now() WHERE id=$1', [groupId]);
  }

  /* ------------------------------------------------------------------ groups */

  async create(viewer: string, dto: CreateGroupDto): Promise<GroupDetailDto> {
    const ids = [...new Set([viewer, ...dto.memberIds])];
    if (ids.length < 2 || ids.length > MAX_MEMBERS) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Choose 1 to 31 other people');
    const id = await this.db.transaction(async (m) => {
      await sqlRows(m, 'SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [ids]);
      const full = await sqlOne(m, 'SELECT user_id FROM chat_group_members WHERE user_id=ANY($1::uuid[]) GROUP BY user_id HAVING count(*)>=50 LIMIT 1', [ids]);
      if (full) throw AppException.conflict(ErrorCode.CONFLICT, 'A person can join up to 50 group chats');
      await this.eligible(m, viewer, ids);
      if (await sqlOne(m, 'SELECT 1 FROM blocks WHERE blocker_id=ANY($1::uuid[]) AND blocked_id=ANY($1::uuid[])', [ids]))
        throw AppException.forbidden(ErrorCode.FORBIDDEN, 'Some people cannot be added to the same group');
      if (dto.avatarMediaId) await this.media.lockAttachable(m, viewer, [dto.avatarMediaId], { imagesOnly: true });
      const row = await sqlOne<{ id: string }>(m, 'INSERT INTO chat_groups(name,owner_id,description,avatar_media_id) VALUES($1,$2,$3,$4) RETURNING id',
        [dto.name.trim(), viewer, dto.description?.trim() || null, dto.avatarMediaId ?? null]);
      await sqlRows(m, 'INSERT INTO chat_group_members(group_id,user_id,added_by) SELECT $1,unnest($2::uuid[]),$3', [row!.id, ids, viewer]);
      await this.event(m, row!.id, viewer, 'created', [], dto.name.trim());
      return row!.id;
    });
    return this.get(viewer, id);
  }

  private columns = `g.*,gm.muted,gm.role,(SELECT storage_key FROM media WHERE id=g.avatar_media_id) avatar_key,
    (SELECT count(*)::int FROM chat_group_members x WHERE x.group_id=g.id) member_count,
    (SELECT count(*)::int FROM group_messages msg WHERE msg.group_id=g.id AND msg.seq>gm.read_seq AND msg.sender_id<>$1 AND ${notBlockedSql('msg.sender_id', '$1')}) unread_count,
    (SELECT json_build_object('text',${PREVIEW_SQL('msg')},'event',msg.event,'sender',msg.sender_id,'name',u.display_name)
      FROM group_messages msg JOIN users u ON u.id=msg.sender_id WHERE msg.group_id=g.id AND ${notBlockedSql('msg.sender_id', '$1')}
      ORDER BY msg.created_at DESC,msg.id DESC LIMIT 1) last`;

  private summary(r: Row, viewer: string): GroupDto {
    const last = r.last as { text: string; event: Row | null; sender: string; name: string } | null;
    const lastMessage = !last ? null : last.event
      ? eventText(last.event.type, last.sender === viewer ? 'You' : first(last.name), last.event.targets ?? [], last.event.value ?? null)
      : last.text;
    return {
      id: r.id, name: r.name, avatarUrl: this.urls.url(r.avatar_key ?? null), ownerId: r.owner_id, memberCount: r.member_count,
      unreadCount: r.unread_count ?? 0, lastMessage, lastSenderName: last && !last.event && last.sender !== viewer ? first(last.name) : null,
      muted: !!r.muted, updatedAt: iso(r.updated_at)!,
    };
  }
  async list(viewer: string, cursorStr?: string, limit = 20) {
    const cursor = decodeCursor(cursorStr, ['date', 'uuid']);
    const rows = await sqlRows(this.db, `SELECT ${this.columns} FROM chat_groups g JOIN chat_group_members gm ON gm.group_id=g.id AND gm.user_id=$1
      ${cursor ? 'WHERE (g.updated_at,g.id)<($2::timestamptz,$3::uuid)' : ''} ORDER BY g.updated_at DESC,g.id DESC LIMIT $${cursor ? 4 : 2}`,
    cursor ? [viewer, ...cursor, limit + 1] : [viewer, limit + 1]);
    return toPage(rows, limit, (r) => this.summary(r, viewer), (r) => [iso(r.updated_at)!, r.id]);
  }
  async get(viewer: string, id: string): Promise<GroupDetailDto> {
    await this.member(this.db, id, viewer);
    const r = await sqlOne(this.db, `SELECT ${this.columns},
        (SELECT json_build_object('id',p.id,'name',pu.display_name,'text',${PREVIEW_SQL('p')}) FROM group_messages p JOIN users pu ON pu.id=p.sender_id
          WHERE p.id=g.pinned_message_id AND ${notBlockedSql('p.sender_id', '$1')}) pinned
      FROM chat_groups g JOIN chat_group_members gm ON gm.group_id=g.id AND gm.user_id=$1 WHERE g.id=$2`, [viewer, id]);
    const members = await sqlRows(this.db, `SELECT ${USER_SUMMARY_COLUMNS}, ${notBlockedSql('u.id', '$2')} visible,
        CASE WHEN x.user_id=g.owner_id THEN 'owner' ELSE x.role END member_role, x.joined_at member_joined
      FROM chat_group_members x JOIN chat_groups g ON g.id=x.group_id JOIN users u ON u.id=x.user_id ${USER_AVATAR_JOIN}
      WHERE x.group_id=$1 ORDER BY (x.user_id=g.owner_id) DESC,(x.role='admin') DESC,x.joined_at,u.id`, [id, viewer]);
    const pinned = r!.pinned as { id: string; name: string; text: string } | null;
    return {
      ...this.summary(r!, viewer),
      description: r!.description ?? null,
      myRole: this.roleOf(r!, viewer),
      membersCanAdd: !!r!.members_can_add,
      membersCanEdit: !!r!.members_can_edit,
      pinned: pinned ? { id: pinned.id, senderName: first(pinned.name), preview: pinned.text.slice(0, 140) } : null,
      createdAt: iso(r!.created_at)!,
      members: members.map((member) => {
        const base = member.visible ? this.users.toSummary(member as any)
          : { ...this.users.toSummary(member as any), displayName: 'Circle user', username: '', avatarUrl: null, isVerified: false };
        return { ...base, role: member.member_role as GroupRole, joinedAt: iso(member.member_joined)! };
      }),
    };
  }

  /** Name and description. */
  async update(viewer: string, id: string, dto: UpdateGroupDto) {
    await this.db.transaction(async (m) => {
      const group = await this.member(m, id, viewer, true);
      this.requireEdit(group, viewer);
      const name = dto.name?.trim();
      if (dto.name !== undefined && !name) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Give the group a name');
      if (name && name !== group.name) {
        await sqlRows(m, 'UPDATE chat_groups SET name=$2 WHERE id=$1', [id, name]);
        await this.event(m, id, viewer, 'renamed', [], name);
      }
      if (dto.description !== undefined) {
        const description = dto.description.trim() || null;
        if (description !== (group.description ?? null)) {
          await sqlRows(m, 'UPDATE chat_groups SET description=$2 WHERE id=$1', [id, description]);
          await this.event(m, id, viewer, 'description', [], description);
        }
      }
    });
    return this.get(viewer, id);
  }
  async permissions(viewer: string, id: string, dto: GroupPermissionsDto) {
    await this.db.transaction(async (m) => {
      this.requireOwner(await this.member(m, id, viewer, true), viewer);
      await sqlRows(m, 'UPDATE chat_groups SET members_can_add=coalesce($2,members_can_add),members_can_edit=coalesce($3,members_can_edit) WHERE id=$1',
        [id, dto.membersCanAdd ?? null, dto.membersCanEdit ?? null]);
    });
    return this.get(viewer, id);
  }
  /** Owner makes someone an admin, takes it away, or hands the whole group over. */
  async setRole(viewer: string, id: string, target: string, role: 'admin' | 'member' | 'owner') {
    await this.db.transaction(async (m) => {
      const group = await this.member(m, id, viewer, true);
      this.requireOwner(group, viewer);
      if (target === viewer) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'You are already the owner');
      const row = await sqlOne<{ role: string }>(m, 'SELECT role FROM chat_group_members WHERE group_id=$1 AND user_id=$2', [id, target]);
      if (!row) throw AppException.notFound(ErrorCode.NOT_FOUND, 'They are not in this group');
      const [name] = await this.names(m, [target]);
      if (role === 'owner') {
        await sqlRows(m, 'UPDATE chat_groups SET owner_id=$2 WHERE id=$1', [id, target]);
        await sqlRows(m, `UPDATE chat_group_members SET role='admin' WHERE group_id=$1 AND user_id=ANY($2::uuid[])`, [id, [viewer, target]]);
        await this.event(m, id, viewer, 'owner', [name]);
      } else if (row.role !== role) {
        await sqlRows(m, 'UPDATE chat_group_members SET role=$3 WHERE group_id=$1 AND user_id=$2', [id, target, role]);
        await this.event(m, id, viewer, role === 'admin' ? 'admin' : 'unadmin', [name]);
      }
    });
    return this.get(viewer, id);
  }
  async setAvatar(viewer: string, id: string, mediaId: string | null) {
    const files = await this.db.transaction(async (m) => {
      const group = await this.member(m, id, viewer, true);
      this.requireEdit(group, viewer);
      if (group.avatar_media_id === mediaId) return null;
      if (mediaId) await this.media.lockAttachable(m, viewer, [mediaId], { imagesOnly: true });
      await sqlRows(m, 'UPDATE chat_groups SET avatar_media_id=$2 WHERE id=$1', [id, mediaId]);
      await this.event(m, id, viewer, 'photo', [], mediaId ? null : 'removed');
      return this.deletion.deleteMedia(m, group.avatar_media_id ? [group.avatar_media_id] : []);
    });
    if (files) await this.deletion.removeFiles(files);
    return this.get(viewer, id);
  }
  async members(viewer: string, id: string, ids: string[]) {
    await this.db.transaction(async (m) => {
      const group = await this.member(m, id, viewer, true);
      this.requireAdd(group, viewer);
      await sqlRows(m, 'SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [ids]);
      const full = await sqlOne(m, `SELECT user_id FROM chat_group_members WHERE user_id=ANY($1::uuid[])
        AND user_id NOT IN(SELECT user_id FROM chat_group_members WHERE group_id=$2) GROUP BY user_id HAVING count(*)>=50 LIMIT 1`, [ids, id]);
      if (full) throw AppException.conflict(ErrorCode.CONFLICT, 'A person can join up to 50 group chats');
      await this.eligible(m, viewer, ids);
      const all = await sqlRows<{ user_id: string }>(m, 'SELECT user_id FROM chat_group_members WHERE group_id=$1', [id]);
      const together = [...new Set([...all.map((member) => member.user_id), ...ids])];
      if (await sqlOne(m, 'SELECT 1 FROM blocks WHERE blocker_id=ANY($1::uuid[]) AND blocked_id=ANY($1::uuid[])', [together]))
        throw AppException.forbidden(ErrorCode.FORBIDDEN, 'Some people cannot be added to the same group');
      if (together.length > MAX_MEMBERS) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, `A group can have up to ${MAX_MEMBERS} people`);
      const added = await sqlRows<{ user_id: string }>(m, `INSERT INTO chat_group_members(group_id,user_id,added_by) SELECT $1,unnest($2::uuid[]),$3
        ON CONFLICT DO NOTHING RETURNING user_id`, [id, ids, viewer]);
      if (added.length) await this.event(m, id, viewer, 'added', await this.names(m, added.map((a) => a.user_id)));
    });
    return this.get(viewer, id);
  }
  async removeMember(viewer: string, id: string, target: string) {
    if (viewer === target) return this.leave(viewer, id);
    await this.db.transaction(async (m) => {
      const group = await this.member(m, id, viewer, true);
      this.requireAdmin(group, viewer);
      const row = await sqlOne<{ role: string }>(m, 'SELECT role FROM chat_group_members WHERE group_id=$1 AND user_id=$2', [id, target]);
      if (!row) return;
      if (target === group.owner_id || (row.role === 'admin' && group.owner_id !== viewer))
        throw AppException.forbidden(ErrorCode.FORBIDDEN, 'Only the owner can remove admins');
      const [name] = await this.names(m, [target]);
      await sqlRows(m, 'DELETE FROM chat_group_members WHERE group_id=$1 AND user_id=$2', [id, target]);
      await this.event(m, id, viewer, 'removed', [name]);
    });
  }
  /** Removes the group and everything in it. */
  private async purge(m: EntityManager, id: string, avatar: string | null) {
    const rows = await sqlRows<{ media_id: string; audio_key: string }>(m, 'SELECT media_id,audio_key FROM group_messages WHERE group_id=$1', [id]);
    await sqlRows(m, 'DELETE FROM chat_groups WHERE id=$1', [id]);
    return [await this.deletion.deleteMedia(m, [avatar, ...rows.map((r) => r.media_id)].filter(Boolean) as string[]),
      await this.deletion.queueFiles(m, rows.map((r) => r.audio_key).filter(Boolean))];
  }
  async leave(viewer: string, id: string) {
    const files = await this.db.transaction(async (m) => {
      const group = await this.member(m, id, viewer, true);
      await sqlRows(m, 'DELETE FROM chat_group_members WHERE group_id=$1 AND user_id=$2', [id, viewer]);
      // Admins take over first, then whoever has been here longest.
      const next = await sqlOne<{ user_id: string }>(m, `SELECT user_id FROM chat_group_members WHERE group_id=$1
        ORDER BY (role='admin') DESC,joined_at,user_id LIMIT 1`, [id]);
      if (!next) return this.purge(m, id, group.avatar_media_id);
      await this.event(m, id, viewer, 'left');
      if (group.owner_id === viewer) {
        await sqlRows(m, 'UPDATE chat_groups SET owner_id=$2 WHERE id=$1', [id, next.user_id]);
        await sqlRows(m, `UPDATE chat_group_members SET role='admin' WHERE group_id=$1 AND user_id=$2`, [id, next.user_id]);
      }
      return null;
    });
    if (files) for (const pending of files) await this.deletion.removeFiles(pending);
  }
  /** Owner deletes the group for everyone. */
  async remove(viewer: string, id: string) {
    const files = await this.db.transaction(async (m) => {
      const group = await this.member(m, id, viewer, true);
      this.requireOwner(group, viewer);
      return this.purge(m, id, group.avatar_media_id);
    });
    for (const pending of files) await this.deletion.removeFiles(pending);
  }
  async pin(viewer: string, id: string, messageId: string | null) {
    await this.db.transaction(async (m) => {
      const group = await this.member(m, id, viewer, true);
      this.requireEdit(group, viewer);
      if (!messageId) {
        if (!group.pinned_message_id) return;
        await sqlRows(m, 'UPDATE chat_groups SET pinned_message_id=NULL WHERE id=$1', [id]);
        await this.event(m, id, viewer, 'unpinned');
        return;
      }
      const msg = await sqlOne<{ preview_text: string }>(m, `SELECT ${PREVIEW_SQL('p')} AS preview_text FROM group_messages p WHERE p.id=$1 AND p.group_id=$2 AND p.event IS NULL`, [messageId, id]);
      if (!msg) throw AppException.notFound(ErrorCode.NOT_FOUND, 'Message not found');
      if (group.pinned_message_id === messageId) return;
      await sqlRows(m, 'UPDATE chat_groups SET pinned_message_id=$2 WHERE id=$1', [id, messageId]);
      await this.event(m, id, viewer, 'pinned', [], msg.preview_text.length > 60 ? `${msg.preview_text.slice(0, 57)}…` : msg.preview_text);
    });
    return this.get(viewer, id);
  }
  async mute(viewer: string, id: string, muted: boolean) {
    await this.member(this.db, id, viewer);
    await sqlRows(this.db, 'UPDATE chat_group_members SET muted=$3 WHERE group_id=$1 AND user_id=$2', [id, viewer, muted]);
    return this.get(viewer, id);
  }
  /** Who has seen a message, who got it, and who is still waiting. */
  async receipts(viewer: string, id: string, messageId: string): Promise<GroupReceiptsDto> {
    await this.member(this.db, id, viewer);
    const msg = await sqlOne<{ seq: string; sender_id: string }>(this.db, 'SELECT seq,sender_id FROM group_messages WHERE id=$1 AND group_id=$2', [messageId, id]);
    if (!msg) throw AppException.notFound();
    const rows = await sqlRows(this.db, `SELECT ${USER_SUMMARY_COLUMNS}, x.read_seq>=$3 is_read, x.delivered_seq>=$3 is_delivered,
        (SELECT min(r.at) FROM group_read_marks r WHERE r.group_id=$1 AND r.user_id=x.user_id AND r.kind='r' AND r.seq>=$3) read_at,
        (SELECT min(r.at) FROM group_read_marks r WHERE r.group_id=$1 AND r.user_id=x.user_id AND r.kind='d' AND r.seq>=$3) delivered_at
      FROM chat_group_members x JOIN users u ON u.id=x.user_id ${USER_AVATAR_JOIN}
      WHERE x.group_id=$1 AND x.user_id<>$2 AND ${notBlockedSql('x.user_id', '$4')}
      ORDER BY read_at DESC NULLS LAST,delivered_at DESC NULLS LAST,u.display_name`, [id, msg.sender_id, msg.seq, viewer]);
    const out: GroupReceiptsDto = { readBy: [], deliveredTo: [], waiting: [] };
    for (const r of rows) {
      const user = this.users.toSummary(r as any);
      if (r.is_read) out.readBy.push({ user, at: iso(r.read_at) ?? null });
      else if (r.is_delivered) out.deliveredTo.push({ user, at: iso(r.delivered_at) ?? null });
      else out.waiting.push(user);
    }
    return out;
  }
  /** Photos and videos shared in the group, newest first. */
  async sharedMedia(viewer: string, id: string): Promise<GroupMediaListDto> {
    await this.member(this.db, id, viewer);
    const rows = await sqlRows(this.db, `SELECT msg.id,msg.created_at,md.type,md.storage_key FROM group_messages msg JOIN media md ON md.id=msg.media_id
      WHERE msg.group_id=$1 AND md.type IN ('IMAGE','VIDEO') AND md.status='READY' AND ${notBlockedSql('msg.sender_id', '$2')}
      ORDER BY msg.created_at DESC LIMIT 90`, [id, viewer]);
    return { items: rows.map((r) => ({ messageId: r.id, type: r.type, url: this.urls.url(r.storage_key)!, createdAt: iso(r.created_at)! })) };
  }

  /* ------------------------------------------------------------------ messages */

  private async hydrate(rows: Row[], viewer: string): Promise<GroupMessageDto[]> {
    const clean = rows.map((r) => ({ ...r, id: r.message_id ?? r.id, recipient_id: viewer, reply_to_id: null }));
    const messages = await this.messages.hydrate(clean, viewer);
    return messages.map((message, i) => {
      const row = rows[i];
      const parent = row.parent_preview;
      const event = row.event as { type: GroupEventType; targets?: string[]; value?: string | null } | null;
      return {
        ...message, sender: this.users.toSummary({ ...row, id: row.sender_id } as any),
        event: event ? { type: event.type, targets: event.targets ?? [], value: event.value ?? null } : null,
        replyTo: row.reply_to_id ? {
          id: row.reply_to_id, senderId: row.parent_sender ?? row.sender_id,
          kind: !parent ? 'UNAVAILABLE' : parent.content ? 'TEXT' : parent.has_sticker ? 'STICKER' : parent.audio_key ? 'AUDIO' : parent.gif ? 'GIF' : parent.media_type === 'IMAGE' ? 'PHOTO' : parent.media_type === 'VIDEO' ? 'VIDEO' : parent.post_id ? 'POST' : 'UNAVAILABLE',
          preview: parent ? parent.content?.slice(0, 140) ?? null : 'Message unavailable', audioDurationMs: parent?.audio_duration_ms ?? null,
          thumbnailUrl: parent?.gif?.previewUrl ?? (parent?.media_type === 'IMAGE' ? this.urls.url(parent.media_key) : null),
        } : null,
      };
    });
  }
  private messageColumns = `msg.*,msg.id AS message_id,${USER_SUMMARY_COLUMNS},CASE WHEN ${notBlockedSql('parent.sender_id', '$1')}
    THEN json_build_object('content',parent.content,'has_sticker',parent.has_sticker,'audio_key',parent.audio_key,'audio_duration_ms',parent.audio_duration_ms,
      'gif',parent.gif,'post_id',parent.post_id,'media_type',parent_media.type,'media_key',parent_media.storage_key) END parent_preview,parent.sender_id parent_sender,
    CASE WHEN NOT EXISTS(SELECT 1 FROM chat_group_members x WHERE x.group_id=msg.group_id AND x.user_id<>msg.sender_id AND x.delivered_seq<msg.seq) THEN msg.created_at END delivered_at,
    CASE WHEN NOT EXISTS(SELECT 1 FROM chat_group_members x WHERE x.group_id=msg.group_id AND x.user_id<>msg.sender_id AND x.read_seq<msg.seq) THEN msg.created_at END read_at`;
  private messageJoins = `JOIN users u ON u.id=msg.sender_id ${USER_AVATAR_JOIN} LEFT JOIN group_messages parent ON parent.id=msg.reply_to_id LEFT JOIN media parent_media ON parent_media.id=parent.media_id`;
  async history(viewer: string, id: string, cursorStr?: string, limit = 30) {
    await this.member(this.db, id, viewer);
    const cursor = decodeCursor(cursorStr, ['date', 'uuid']);
    const rows = await sqlRows(this.db, `SELECT ${this.messageColumns} FROM group_messages msg ${this.messageJoins}
      WHERE msg.group_id=$2 AND ${notBlockedSql('msg.sender_id', '$1')} ${cursor ? 'AND (msg.created_at,msg.id)<($3::timestamptz,$4::uuid)' : ''}
      ORDER BY msg.created_at DESC,msg.id DESC LIMIT $${cursor ? 5 : 3}`,
    cursor ? [viewer, id, ...cursor, limit + 1] : [viewer, id, limit + 1]);
    const page = toPage(rows, limit, (r) => r, (r) => [iso(r.created_at)!, r.message_id]);
    return { ...page, items: await this.hydrate(page.items, viewer) };
  }
  async send(viewer: string, id: string, dto: SendMessageDto): Promise<GroupMessageDto> {
    await this.member(this.db, id, viewer);
    if (!dto.content?.trim() && !dto.mediaId && !dto.stickerId && !dto.gifId && !dto.audioId && !dto.postId) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Write a message or choose an attachment');
    if (dto.viewOnce) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'View-once attachments are only available in direct chats');
    if ([dto.mediaId, dto.stickerId, dto.gifId, dto.audioId, dto.postId].filter(Boolean).length > 1) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Choose one attachment');
    const gif = dto.gifId ? await this.gifs.resolve(dto.gifId) : null;
    if (dto.postId) await this.posts.getOne(dto.postId, viewer);
    const message = await this.db.transaction(async (m) => {
      await this.member(m, id, viewer, true);
      if (dto.replyToId && !await sqlOne(m, `SELECT 1 FROM group_messages msg WHERE msg.id=$1 AND msg.group_id=$2 AND msg.event IS NULL AND ${notBlockedSql('msg.sender_id', '$3')}`, [dto.replyToId, id, viewer])) throw AppException.notFound();
      if (dto.stickerId) await this.stickers.assertAvailable(viewer, dto.stickerId, m);
      if (dto.mediaId) {
        const [media] = await this.media.lockAttachable(m, viewer, [dto.mediaId]);
        if (media.status !== 'READY') throw AppException.badRequest(ErrorCode.INVALID_MEDIA, 'Wait for the attachment to finish processing');
      }
      const audio = dto.audioId ? await sqlOne(m, 'SELECT * FROM message_audio_uploads WHERE id=$1 AND owner_id=$2 FOR UPDATE', [dto.audioId, viewer]) : null;
      if (dto.audioId && !audio) throw AppException.notFound(ErrorCode.NOT_FOUND, 'Voice recording not found');
      const row = await sqlOne<{ id: string }>(m, `INSERT INTO group_messages(group_id,sender_id,content,media_id,post_id,sticker_id,has_sticker,audio_key,audio_duration_ms,gif,reply_to_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, [id, viewer, dto.content?.trim() || null, dto.mediaId ?? null, dto.postId ?? null, dto.stickerId ?? null, !!dto.stickerId, audio?.storage_key ?? null, audio?.duration_ms ?? null, gif ? JSON.stringify(gif) : null, dto.replyToId ?? null]);
      if (audio) await sqlRows(m, 'DELETE FROM message_audio_uploads WHERE id=$1', [dto.audioId]);
      await sqlRows(m, 'UPDATE chat_groups SET updated_at=now() WHERE id=$1', [id]);
      return row!.id;
    });
    // Muted members still get the message, just no notification.
    const members = await sqlRows<{ user_id: string }>(this.db, `SELECT user_id FROM chat_group_members WHERE group_id=$1 AND user_id<>$2 AND NOT muted AND ${notBlockedSql('user_id', '$2')}`, [id, viewer]);
    for (const member of members) this.push.notifyUser(member.user_id);
    return this.one(viewer, id, message);
  }
  private async one(viewer: string, id: string, message: string) {
    const row = await sqlOne(this.db, `SELECT ${this.messageColumns} FROM group_messages msg ${this.messageJoins} WHERE msg.group_id=$2 AND msg.id=$3`, [viewer, id, message]);
    if (!row) throw AppException.notFound();
    return (await this.hydrate([row], viewer))[0];
  }
  async edit(viewer: string, id: string, message: string, content: string) {
    if (!content.trim()) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Write a message');
    await this.db.transaction(async (m) => {
      await this.member(m, id, viewer, true);
      const row = await sqlOne(m, `UPDATE group_messages SET content=$4,edited_at=now() WHERE group_id=$1 AND id=$2 AND sender_id=$3 AND content IS NOT NULL AND event IS NULL RETURNING id`, [id, message, viewer, content.trim()]);
      if (!row) throw AppException.notFound();
    });
    return this.one(viewer, id, message);
  }
  async unsend(viewer: string, id: string, message: string) {
    const files = await this.db.transaction(async (m) => {
      await this.member(m, id, viewer, true);
      const row = await sqlOne(m, 'DELETE FROM group_messages WHERE group_id=$1 AND id=$2 AND sender_id=$3 AND event IS NULL RETURNING media_id,audio_key', [id, message, viewer]);
      if (!row) throw AppException.notFound();
      return [await this.deletion.deleteMedia(m, row.media_id ? [row.media_id] : []), await this.deletion.queueFiles(m, row.audio_key ? [row.audio_key] : [])];
    });
    for (const pending of files) await this.deletion.removeFiles(pending);
  }
  async acknowledge(viewer: string, id: string, message: string, read = false) {
    await this.member(this.db, id, viewer);
    const row = await sqlOne<{ seq: string }>(this.db, 'SELECT seq FROM group_messages WHERE id=$1 AND group_id=$2', [message, id]);
    if (!row) throw AppException.notFound();
    await this.db.transaction(async (m) => {
      const prev = await sqlOne<{ delivered_seq: string; read_seq: string }>(m,
        'SELECT delivered_seq,read_seq FROM chat_group_members WHERE group_id=$1 AND user_id=$2 FOR UPDATE', [id, viewer]);
      if (!prev) return;
      const seq = BigInt(row.seq);
      await sqlRows(m, `UPDATE chat_group_members SET delivered_seq=greatest(delivered_seq,$3),read_seq=greatest(read_seq,CASE WHEN $4 THEN $3::bigint ELSE read_seq END)
        WHERE group_id=$1 AND user_id=$2`, [id, viewer, row.seq, read]);
      // Remember when each point was reached, for "Seen by … at 14:02".
      if (seq > BigInt(prev.delivered_seq)) await sqlRows(m, `INSERT INTO group_read_marks(group_id,user_id,kind,seq) VALUES($1,$2,'d',$3) ON CONFLICT DO NOTHING`, [id, viewer, row.seq]);
      if (read && seq > BigInt(prev.read_seq)) await sqlRows(m, `INSERT INTO group_read_marks(group_id,user_id,kind,seq) VALUES($1,$2,'r',$3) ON CONFLICT DO NOTHING`, [id, viewer, row.seq]);
    });
  }
}
