import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { decodeCursor, iso, toPage } from '../../common/utils/cursor.js';
import { notBlockedSql, sqlOne, sqlRows } from '../../common/utils/sql.js';
import { ContentDeletionService } from '../media/content-deletion.service.js';
import { PushService } from './push.service.js';
import { BabiesService } from './babies.service.js';
import { MediaService } from '../media/media.service.js';
import { MediaUrlService } from '../media/media-url.service.js';
import { StickersService } from './stickers.service.js';
import { GifsService } from '../gifs/gifs.js';
import type { ChatTheme } from '../../database/migrations/1760192700000-StrictStreaksAndChatThemes.js';
import type { GameKind } from '../../database/migrations/1760193700000-EvenMoreGames.js';
import { EXTRA_KINDS, extraPicks, extraView, type ExtraKind, type ExtraState } from './games-extra.js';
import { THIRD_KINDS, thirdPicks, thirdView, type ThirdKind, type ThirdState } from './games-third.js';
import { applyMove, firstTurn, GameRuleError, initialState, NO_WINNER, THIS_OR_THAT, type BoardState, type GameState, type MemoryState, type RpsState, type TotState, type QaState, type TodState, type GameMove } from './games.js';
import { PostsQueryService } from '../posts/posts-query.service.js';
import {
  USER_AVATAR_JOIN,
  USER_SUMMARY_COLUMNS,
  UsersService,
  type UserSummaryRow,
} from '../users/users.service.js';
import {
  ChatGameDto,
  ChatPrefsDto,
  DirectMessageDto,
  MessageReplyRefDto,
  MessageStatusDto,
  MessagePeerDto,
  SendMessageDto,
} from './social.dto.js';

/** Someone counts as online while their app polled us this recently. */
export const ONLINE_WINDOW_SQL = "interval '45 seconds'";
/** A typing signal lasts this long unless refreshed. */
const TYPING_WINDOW_SQL = "interval '6 seconds'";
/** Opened view-once media can still finish loading for this long, then it is deleted. */
const VIEW_ONCE_GRACE_SQL = "interval '2 minutes'";

/**
 * A thread from `peer` is a request for `owner` until the owner follows them, writes to them
 * or accepts it. Arguments are SQL expressions.
 */
const requestSql = (owner: string, peer: string) => `(
  NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ${owner} AND f.following_id = ${peer})
  AND NOT EXISTS (SELECT 1 FROM direct_messages r WHERE r.sender_id = ${owner} AND r.recipient_id = ${peer})
  AND NOT EXISTS (SELECT 1 FROM message_request_acceptances a WHERE a.user_id = ${owner} AND a.peer_id = ${peer}))`;

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly users: UsersService,
    private readonly media: MediaService,
    private readonly posts: PostsQueryService,
    private readonly deletion: ContentDeletionService,
    private readonly push: PushService,
    private readonly stickers: StickersService,
    private readonly urls: MediaUrlService,
    private readonly gifs: GifsService,
    private readonly babies: BabiesService,
  ) {}

  /** Whether `owner` still treats `peer` as a message request, and whether `peer` already wrote. */
  private async requestState(
    m: DataSource | EntityManager,
    ownerId: string,
    peerId: string,
  ) {
    const row = await sqlOne<{ request: boolean; sent: boolean }>(
      m,
      `SELECT ${requestSql('$1::uuid', '$2::uuid')} AS request,
        EXISTS (SELECT 1 FROM direct_messages d WHERE d.sender_id = $2 AND d.recipient_id = $1) AS sent`,
      [ownerId, peerId],
    );
    return { request: !!row?.request, sent: !!row?.sent };
  }

  async assertConversationPeer(viewerId: string, peerId: string) {
    await this.assertPeer(viewerId, peerId);
  }

  private async historyPeer(viewerId:string,peerId:string) {
    if(viewerId===peerId)throw AppException.notFound(ErrorCode.USER_NOT_FOUND,'User not found');
    await this.users.getActiveTarget(peerId);
    const relationship=await this.users.relationship(viewerId,peerId);
    if((relationship.isBlocking||relationship.isBlockedBy)&&!await sqlOne(this.db,`SELECT 1 FROM direct_messages
      WHERE (sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1) LIMIT 1`,[viewerId,peerId]))
      throw AppException.notFound(ErrorCode.USER_NOT_FOUND,'User not found');
    return relationship;
  }

  async peer(viewerId:string,username:string):Promise<MessagePeerDto> {
    const row=await sqlOne<UserSummaryRow>(this.db,`SELECT ${USER_SUMMARY_COLUMNS} FROM users u ${USER_AVATAR_JOIN}
      WHERE u.username=$1 AND u.status='ACTIVE'`,[username]);
    if(!row)throw AppException.notFound(ErrorCode.USER_NOT_FOUND,'User not found');
    const rel=await this.historyPeer(viewerId,row.id),unavailable=rel.isBlocking||rel.isBlockedBy;
    const summary=this.users.toSummary(row);
    return {...summary,...(unavailable?{displayName:'Circle user',avatarUrl:null,isPrivate:true,isVerified:false}:{}),
      isUnavailable:unavailable,isBlocking:rel.isBlocking,isFollowing:!unavailable&&rel.isFollowing};
  }

  async assertCallPeer(viewerId: string, peerId: string, m: DataSource | EntityManager = this.db) {
    await this.assertPeer(viewerId, peerId, true);
    const state = await this.requestState(m, peerId, viewerId);
    if (state.request) throw AppException.forbidden(ErrorCode.INVALID_STATE, 'Calls are available after your message request is accepted');
    // Recheck against the transaction too, so an existing block never authorizes signaling.
    if (await sqlOne(m, `SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)`, [viewerId,peerId]))
      throw AppException.notFound(ErrorCode.USER_NOT_FOUND, 'User not found');
  }

  private async assertPeer(viewerId: string, peerId: string, sending = false) {
    if (viewerId === peerId)
      throw AppException.badRequest(
        ErrorCode.BAD_REQUEST,
        'You cannot message yourself',
      );
    const peer = await this.users.getActiveTarget(peerId);
    const relationship = await this.users.relationship(viewerId, peerId);
    if (relationship.isBlocking || relationship.isBlockedBy)
      throw AppException.notFound(ErrorCode.USER_NOT_FOUND, 'User not found');
    if (sending && peer.is_private && !relationship.isFollowing) {
      throw AppException.forbidden(
        ErrorCode.PRIVATE_ACCOUNT,
        'Follow this private account before sending a message',
      );
    }
  }

  async hydrate(
    rows: Record<string, any>[],
    viewerId: string,
  ): Promise<DirectMessageDto[]> {
    const mediaIds = rows.map((r) => r.media_id).filter(Boolean);
    const media = mediaIds.length
      ? await sqlRows(
          this.db,
          'SELECT * FROM media WHERE id = ANY($1::uuid[])',
          [mediaIds],
        )
      : [];
    const byMedia = new Map(
      media.map((m) => [m.id, this.media.toDto(m as any)]),
    );
    const postIds = [...new Set(rows.map((r) => r.post_id).filter(Boolean))];
    // Re-check visibility every time; a shared private/deleted post never becomes a permanent access grant.
    const byPost = new Map();
    for (const id of postIds) {
      try {
        byPost.set(id, await this.posts.getOne(id, viewerId));
      } catch (e) {
        if (!(e instanceof AppException) || ![403, 404].includes(e.getStatus()))
          throw e;
      }
    }
    // Story replies show the story while it is live; expired stories never expose media again.
    const storyIds = [
      ...new Set(
        rows.filter((r) => r.story_reply && r.story_id).map((r) => r.story_id),
      ),
    ];
    const stories = storyIds.length
      ? await sqlRows(
          this.db,
          `SELECT s.id, s.post_id, row_to_json(md) AS media_row FROM stories s
          LEFT JOIN media md ON md.id = s.media_id
          WHERE s.id = ANY($1::uuid[]) AND s.expires_at > now()`,
          [storyIds],
        )
      : [];
    const storyPosts = new Map(
      (
        await this.posts.hydrate(
          stories.map((s) => s.post_id).filter(Boolean),
          viewerId,
        )
      ).map((p) => [p.id, p]),
    );
    const byStory = new Map(
      stories.map((s) => [
        s.id,
        s.post_id
          ? (storyPosts
              .get(s.post_id)
              ?.media.find((m) => m.type === 'VIDEO') ?? null)
          : s.media_row
            ? this.media.toDto(s.media_row)
            : null,
      ]),
    );
    const replyIds = [...new Set(rows.map((r) => r.reply_to_id).filter(Boolean))];
    const parents = replyIds.length
      ? await sqlRows(
          this.db,
          `SELECT d.id, d.sender_id, d.content, d.post_id, d.story_reply, d.view_once, d.has_sticker, d.audio_key, d.call_id, d.gif, d.game_id, d.baby_id,
              d.audio_duration_ms, m.type AS media_type, m.storage_key AS media_key, sk.emoji AS sticker_emoji, skm.storage_key AS sticker_key
          FROM direct_messages d LEFT JOIN media m ON m.id = d.media_id
          LEFT JOIN stickers sk ON sk.id = d.sticker_id LEFT JOIN media skm ON skm.id = sk.media_id
          WHERE d.id = ANY($1::uuid[])`,
          [replyIds],
        )
      : [];
    const byParent = new Map<string, MessageReplyRefDto>(
      parents.map((m) => [
        m.id,
        {
          id: m.id,
          senderId: m.sender_id,
          kind: m.view_once
            ? 'VIEW_ONCE'
            : m.content
              ? 'TEXT'
              : m.game_id ? 'GAME' : m.baby_id ? 'BABY' : m.has_sticker ? 'STICKER' : m.audio_key ? 'AUDIO' : m.call_id ? 'CALL' : m.gif ? 'GIF' : m.media_type === 'IMAGE'
                ? 'PHOTO'
                : m.media_type === 'VIDEO'
                  ? 'VIDEO'
                  : m.post_id
                    ? 'POST'
                    : m.story_reply
                      ? 'STORY'
                      : 'UNAVAILABLE',
          preview: m.view_once ? null : m.content ? String(m.content).slice(0, 140) : m.sticker_emoji ?? null,
          audioDurationMs: m.audio_key ? m.audio_duration_ms ?? null : null,
          // WhatsApp-style quote thumbnail; view-once media never leaks into a quote.
          thumbnailUrl: m.view_once ? null : m.gif?.previewUrl ?? (m.media_type === 'IMAGE' ? this.urls.url(m.media_key ?? null)
            : m.sticker_key ? this.urls.url(m.sticker_key) : null),
        },
      ]),
    );
    const stickers=await this.stickers.hydrate([...new Set(rows.map(r=>r.sticker_id).filter(Boolean))],viewerId);
    const ids=rows.map(r=>r.id).filter(Boolean);
    const starred=new Set(ids.length?(await sqlRows<{message_id:string}>(this.db,
      'SELECT message_id FROM message_favorites WHERE user_id=$1 AND message_id=ANY($2::uuid[])',[viewerId,ids])).map(r=>r.message_id):[]);
    const reactions=new Map<string,{userId:string;emoji:string}[]>();
    if(ids.length)for(const r of await sqlRows<{message_id:string;user_id:string;emoji:string}>(this.db,
      'SELECT message_id,user_id,emoji FROM message_reactions WHERE message_id=ANY($1::uuid[]) ORDER BY created_at',[ids]))
      reactions.set(r.message_id,[...(reactions.get(r.message_id)??[]),{userId:r.user_id,emoji:r.emoji}]);
    const gameIds=[...new Set(rows.map(r=>r.game_id).filter(Boolean))];
    const games=new Map(gameIds.length?(await sqlRows(this.db,'SELECT * FROM chat_games WHERE id=ANY($1::uuid[])',[gameIds]))
      .map(g=>[g.id,this.gameDto(g,viewerId)]):[]);
    const babies=await this.babies.invites([...new Set(rows.map(r=>r.baby_id).filter(Boolean))]);
    return rows.map((r) => ({
      game: r.game_id ? (games.get(r.game_id) ?? null) : null,
      baby: r.baby_id ? (babies.get(r.baby_id) ?? null) : null,
      isFavorite: starred.has(r.id),
      reactions: reactions.get(r.id) ?? [],
      gif: r.gif ?? null,
      editedAt: iso(r.edited_at),
      call: r.call_id
        ? { kind: r.call_kind, status: r.call_status, durationSeconds: r.call_duration_s ?? null }
        : null,
      sticker:stickers.get(r.sticker_id)??null,
      hasSticker:!!r.has_sticker,
      audioUrl:this.urls.url(r.audio_key??null),
      audioDurationMs:r.audio_duration_ms??null,
      id: r.id,
      senderId: r.sender_id,
      recipientId: r.recipient_id,
      content: r.content,
      // View-once media is only ever handed out by `open`, exactly once, to the recipient.
      media: r.view_once ? null : (byMedia.get(r.media_id) ?? null),
      post: byPost.get(r.post_id) ?? null,
      replyTo: r.reply_to_id ? (byParent.get(r.reply_to_id) ?? null) : null,
      viewOnce: !!r.view_once,
      viewOnceType:
        r.view_once && !r.opened_at && r.media_id
          ? (byMedia.get(r.media_id)?.type ?? null)
          : null,
      openedAt: iso(r.opened_at),
      deliveredAt: iso(r.delivered_at),
      storyReply: r.story_reply
        ? { storyId: r.story_id ?? null, media: byStory.get(r.story_id) ?? null }
        : null,
      noteReply: r.note_reply ? { text: r.note_text ?? '', songTitle: r.note_song ?? null } : null,
      createdAt: iso(r.created_at)!,
      readAt: iso(r.read_at),
    }));
  }

  async send(
    senderId: string,
    recipientId: string,
    dto: SendMessageDto,
    storyId?: string,
    note?: { text: string; songTitle: string | null },
  ) {
    await this.assertPeer(senderId, recipientId, true);
    if (!dto.content && !dto.mediaId && !dto.postId && !dto.stickerId && !dto.audioId && !dto.gifId)
      throw AppException.badRequest(
        ErrorCode.VALIDATION_ERROR,
        'Write a message or select a video',
      );
    if ([dto.mediaId,dto.postId,dto.stickerId,dto.audioId,dto.gifId].filter(Boolean).length>1)
      throw AppException.badRequest(
        ErrorCode.VALIDATION_ERROR,
        'Choose one attachment',
      );
    if (dto.viewOnce && !dto.mediaId)
      throw AppException.badRequest(
        ErrorCode.VALIDATION_ERROR,
        'View once needs a photo or video',
      );
    if (dto.replyToId) {
      const parent = await sqlOne(
        this.db,
        `SELECT 1 FROM direct_messages WHERE id = $1
        AND ((sender_id = $2 AND recipient_id = $3) OR (sender_id = $3 AND recipient_id = $2))`,
        [dto.replyToId, senderId, recipientId],
      );
      if (!parent) throw AppException.notFound(ErrorCode.NOT_FOUND, 'Message not found');
    }
    const gif = dto.gifId ? await this.gifs.resolve(dto.gifId) : null;
    if (dto.postId) {
      await this.posts.getOne(dto.postId, senderId);
      await this.posts.getOne(dto.postId, recipientId);
    }
    const row = await this.db.transaction(async (m) => {
      // One send per pair at a time, so a pending request can never slip in twice.
      await sqlRows(
        m,
        'SELECT pg_advisory_xact_lock(hashtext(least($1::text, $2::text) || greatest($1::text, $2::text)))',
        [senderId, recipientId],
      );
      // Graph changes and calls lock these same rows in this order. Recheck after taking
      // the locks: a block committed while this send was waiting must stop the message.
      await sqlRows(m, 'SELECT id FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[senderId, recipientId]]);
      if (await sqlOne(m, `SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)`, [senderId, recipientId]))
        throw AppException.notFound(ErrorCode.USER_NOT_FOUND, 'User not found');
      if(dto.stickerId)await this.stickers.assertAvailable(senderId,dto.stickerId,m);
      const audio=dto.audioId?await sqlOne<{storage_key:string;duration_ms:number}>(m,
        'SELECT storage_key,duration_ms FROM message_audio_uploads WHERE id=$1 AND owner_id=$2 FOR UPDATE',[dto.audioId,senderId]):null;
      if(dto.audioId&&!audio)throw AppException.notFound(ErrorCode.NOT_FOUND,'Voice recording not found');
      const pending = await this.requestState(m, recipientId, senderId);
      if (pending.request && pending.sent)
        throw AppException.forbidden(
          ErrorCode.INVALID_STATE,
          'Your message request is waiting. You can write again once they accept it.',
        );
      if (dto.mediaId) {
        const [media] = await this.media.lockAttachable(m, senderId, [
          dto.mediaId,
        ]);
        if (media.status !== 'READY') {
          throw AppException.badRequest(
            ErrorCode.INVALID_MEDIA,
            'Wait for the video to finish processing',
          );
        }
      }
      const message=(await sqlOne(
        m,
        `INSERT INTO direct_messages(sender_id, recipient_id, content, media_id, post_id, story_id, story_reply, reply_to_id, view_once,
          note_reply, note_text, note_song, sticker_id, has_sticker, audio_key, audio_duration_ms, gif)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
        [
          senderId,
          recipientId,
          dto.content || null,
          dto.mediaId ?? null,
          dto.postId ?? null,
          storyId ?? null,
          !!storyId,
          dto.replyToId ?? null,
          !!dto.viewOnce,
          !!note,
          note?.text ?? null,
          note?.songTitle ?? null,
          dto.stickerId??null,!!dto.stickerId,audio?.storage_key??null,audio?.duration_ms??null,
          gif ? JSON.stringify(gif) : null,
        ],
      ))!;
      if(dto.audioId)await sqlRows(m,'DELETE FROM message_audio_uploads WHERE id=$1',[dto.audioId]);
      return message;
    });
    // Wake the recipient's phones/browsers (the service worker fetches and shows the message).
    this.push.notifyUser(recipientId);
    // Talking to each other is part of raising your baby together.
    void this.babies.onMessage(senderId, recipientId, dto.content ?? null);
    return (await this.hydrate([row], senderId))[0];
  }

  async list(
    viewerId: string,
    peerId: string,
    cursorStr: string | undefined,
    limit: number,
  ) {
    await this.historyPeer(viewerId, peerId);
    const cursor = decodeCursor(cursorStr, ['date', 'uuid']);
    const rows = await sqlRows(
      this.db,
      `SELECT * FROM direct_messages
      WHERE ((sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1))
      ${cursor ? 'AND (created_at, id) < ($4::timestamptz, $5::uuid)' : ''}
      ORDER BY created_at DESC, id DESC LIMIT $3`,
      [viewerId, peerId, limit + 1, ...(cursor ?? [])],
    );
    const page = toPage(
      rows,
      limit,
      (r) => r,
      (r) => [iso(r.created_at)!, r.id],
    );
    return { ...page, items: await this.hydrate(page.items, viewerId) };
  }

  /** Stars a message of one of your conversations; only you see your stars. */
  async favorite(viewerId:string,messageId:string) {
    const row=await sqlOne<{sender_id:string;recipient_id:string}>(this.db,
      'SELECT sender_id,recipient_id FROM direct_messages WHERE id=$1 AND (sender_id=$2 OR recipient_id=$2)',[messageId,viewerId]);
    if(!row)throw AppException.notFound(ErrorCode.NOT_FOUND,'Message not found');
    await this.historyPeer(viewerId,row.sender_id===viewerId?row.recipient_id:row.sender_id);
    await sqlRows(this.db,'INSERT INTO message_favorites(user_id,message_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',[viewerId,messageId]);
  }

  /** One reaction per person per message (sending another emoji replaces it). */
  async react(viewerId:string,messageId:string,emoji:string) {
    const row=await sqlOne<{sender_id:string;recipient_id:string}>(this.db,
      'SELECT sender_id,recipient_id FROM direct_messages WHERE id=$1 AND (sender_id=$2 OR recipient_id=$2)',[messageId,viewerId]);
    if(!row)throw AppException.notFound(ErrorCode.NOT_FOUND,'Message not found');
    await this.assertPeer(viewerId,row.sender_id===viewerId?row.recipient_id:row.sender_id);
    await sqlRows(this.db,`INSERT INTO message_reactions(message_id,user_id,emoji) VALUES ($1,$2,$3)
      ON CONFLICT (message_id,user_id) DO UPDATE SET emoji=EXCLUDED.emoji,created_at=now()`,[messageId,viewerId,emoji]);
    this.push.notifyUser(row.sender_id===viewerId?row.recipient_id:row.sender_id);
  }

  async unreact(viewerId:string,messageId:string) {
    await sqlRows(this.db,'DELETE FROM message_reactions WHERE message_id=$1 AND user_id=$2',[messageId,viewerId]);
  }

  /** "Together" stats for the conversation with `peerId`. */
  async together(viewerId:string,peerId:string) {
    await this.historyPeer(viewerId,peerId);
    const row=await sqlOne<{since:Date|null;messages:number;photos:number;voice:number;call_s:number;days:number}>(this.db,`
      WITH pair AS (SELECT * FROM direct_messages d
        WHERE least(d.sender_id,d.recipient_id)=least($1::uuid,$2::uuid) AND greatest(d.sender_id,d.recipient_id)=greatest($1::uuid,$2::uuid))
      SELECT min(created_at) AS since,
        count(*) FILTER (WHERE call_id IS NULL)::int AS messages,
        count(*) FILTER (WHERE media_id IS NOT NULL AND NOT view_once)::int AS photos,
        count(*) FILTER (WHERE audio_key IS NOT NULL)::int AS voice,
        coalesce(sum(call_duration_s) FILTER (WHERE call_status='completed'),0)::int AS call_s,
        (SELECT count(*)::int FROM (SELECT (created_at AT TIME ZONE 'UTC')::date FROM pair WHERE call_id IS NULL
          GROUP BY 1 HAVING count(DISTINCT sender_id)=2) both_days) AS days
      FROM pair`,[viewerId,peerId]);
    return {since:iso(row?.since??null),messages:row?.messages??0,photos:row?.photos??0,voiceNotes:row?.voice??0,
      callMinutes:Math.round((row?.call_s??0)/60),daysTogether:row?.days??0};
  }

  async unfavorite(viewerId:string,messageId:string) {
    await sqlRows(this.db,'DELETE FROM message_favorites WHERE user_id=$1 AND message_id=$2',[viewerId,messageId]);
  }

  /** Your starred messages in the conversation with `peerId`, most recently starred first. */
  async favorites(viewerId:string,peerId:string,cursorStr:string|undefined,limit:number) {
    await this.historyPeer(viewerId,peerId);
    const cursor=decodeCursor(cursorStr,['date','uuid']);
    const rows=await sqlRows(this.db,`SELECT d.*, f.created_at AS starred_at FROM message_favorites f
      JOIN direct_messages d ON d.id=f.message_id
      WHERE f.user_id=$1 AND ((d.sender_id=$1 AND d.recipient_id=$2) OR (d.sender_id=$2 AND d.recipient_id=$1))
      ${cursor?'AND (f.created_at, d.id) < ($4::timestamptz, $5::uuid)':''}
      ORDER BY f.created_at DESC, d.id DESC LIMIT $3`,[viewerId,peerId,limit+1,...(cursor??[])]);
    const page=toPage(rows,limit,(r)=>r,(r)=>[iso(r.starred_at)!,r.id]);
    return {...page,items:await this.hydrate(page.items,viewerId)};
  }

  /** WhatsApp-style "Media, links": photos, videos and GIFs, or messages with links. */
  async sharedMedia(viewerId:string,peerId:string,kind:'media'|'links',cursorStr:string|undefined,limit:number) {
    await this.historyPeer(viewerId,peerId);
    const cursor=decodeCursor(cursorStr,['date','uuid']);
    const filter=kind==='links'?`d.content ~* '(https?://|www[.])'`
      :`((d.media_id IS NOT NULL AND NOT d.view_once) OR d.gif IS NOT NULL)`;
    const rows=await sqlRows(this.db,`SELECT d.* FROM direct_messages d
      WHERE least(d.sender_id,d.recipient_id)=least($1::uuid,$2::uuid) AND greatest(d.sender_id,d.recipient_id)=greatest($1::uuid,$2::uuid)
      AND ${filter}
      ${cursor?'AND (d.created_at, d.id) < ($4::timestamptz, $5::uuid)':''}
      ORDER BY d.created_at DESC, d.id DESC LIMIT $3`,[viewerId,peerId,limit+1,...(cursor??[])]);
    const page=toPage(rows,limit,(r)=>r,(r)=>[iso(r.created_at)!,r.id]);
    return {...page,items:await this.hydrate(page.items,viewerId)};
  }

  async conversations(
    viewerId: string,
    cursorStr: string | undefined,
    limit: number,
    folder?: 'primary' | 'requests',
  ) {
    const cursor = decodeCursor(cursorStr, ['date', 'uuid']);
    const unavailableSql=`NOT ${notBlockedSql('u.id','$1')}`;
    const isRequest = `(${requestSql('$1', 'u.id')} AND NOT (${unavailableSql}))`;
    const rows = await sqlRows(
      this.db,
      `WITH latest AS (
      SELECT DISTINCT ON (CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END)
        d.*, CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS peer_id
      FROM direct_messages d WHERE sender_id = $1 OR recipient_id = $1
      ORDER BY CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END, created_at DESC, id DESC
    ) SELECT l.*, ${USER_SUMMARY_COLUMNS}, l.id AS message_id, ${unavailableSql} AS contact_unavailable,
      (SELECT count(*)::int FROM direct_messages d WHERE d.recipient_id = $1 AND d.sender_id = u.id AND d.read_at IS NULL) AS unread,
      ${isRequest} AS is_request,
      u.last_active_at, (u.last_active_at > now() - ${ONLINE_WINDOW_SQL}) AS online,
      CASE WHEN streak.days>=3 AND streak.last_completed_day>=(now() AT TIME ZONE 'UTC')::date-1 THEN streak.days ELSE 0 END AS streak_days,
      (streak.last_completed_day=(now() AT TIME ZONE 'UTC')::date-1
        AND (now() AT TIME ZONE 'UTC')>=(now() AT TIME ZONE 'UTC')::date+interval '16 hours') AS streak_fading
      , cpref.nickname AS pref_nickname
      FROM latest l JOIN users u ON u.id = l.peer_id ${USER_AVATAR_JOIN}
      LEFT JOIN conversation_prefs cpref ON cpref.user_id = $1 AND cpref.peer_id = u.id
      LEFT JOIN message_streaks streak ON streak.low_id=least($1::uuid,u.id) AND streak.high_id=greatest($1::uuid,u.id)
      WHERE u.status = 'ACTIVE'
      ${folder ? `AND ${folder === 'requests' ? '' : 'NOT '}${isRequest}` : ''}
      ${cursor ? 'AND (l.created_at, l.id) < ($3::timestamptz, $4::uuid)' : ''}
      ORDER BY l.created_at DESC, l.id DESC LIMIT $2`,
      [viewerId, limit + 1, ...(cursor ?? [])],
    );
    const page = toPage(
      rows,
      limit,
      (r) => r,
      (r) => [iso(r.created_at)!, r.message_id],
    );
    const messages = await this.hydrate(
      page.items.map((r) => ({ ...r, id: r.message_id })),
      viewerId,
    );
    return {
      ...page,
      items: page.items.map((r, i) => ({
        user: r.contact_unavailable?{...this.users.toSummary(r as any),displayName:'Circle user',avatarUrl:null,isVerified:false,isPrivate:true}:this.users.toSummary(r as any),
        lastMessage: messages[i],
        unreadCount: r.contact_unavailable?0:r.unread,
        isUnavailable: !!r.contact_unavailable,
        isRequest: r.is_request,
        online: !r.contact_unavailable&&!!r.online,
        lastActiveAt: r.contact_unavailable?null:iso(r.last_active_at),
        streakDays: r.contact_unavailable?0:r.streak_days ?? 0,
        streakFading: !!r.streak_fading,
        nickname: r.contact_unavailable ? null : (r.pref_nickname ?? null),
      })),
    };
  }

  async status(viewerId: string, peerId: string): Promise<MessageStatusDto> {
    const rel=await this.historyPeer(viewerId,peerId);
    const theme=(await sqlOne<{theme:string}>(this.db,'SELECT theme FROM conversation_themes WHERE low_id=least($1::uuid,$2::uuid) AND high_id=greatest($1::uuid,$2::uuid)',[viewerId,peerId]))?.theme??null;
    const prefs=await this.prefs(viewerId,peerId);
    if(rel.isBlocking||rel.isBlockedBy)return {isUnavailable:true,isBlocking:rel.isBlocking,isRequest:false,awaitingAcceptance:false,
      canSend:false,peerTyping:false,peerOnline:false,peerLastActiveAt:null,theme,...prefs};
    const mine = await this.requestState(this.db, viewerId, peerId);
    const theirs = await this.requestState(this.db, peerId, viewerId);
    const awaitingAcceptance = theirs.request && theirs.sent;
    let allowed = true;
    try {
      await this.assertPeer(viewerId, peerId, true);
    } catch (e) {
      if (!(e instanceof AppException)) throw e;
      allowed = false;
    }
    await this.touch(viewerId);
    const presence = await sqlOne<{ typing: boolean; online: boolean; last_active_at: Date | null }>(
      this.db,
      `SELECT u.last_active_at, (u.last_active_at > now() - ${ONLINE_WINDOW_SQL}) AS online,
        EXISTS (SELECT 1 FROM typing_status t WHERE t.user_id = u.id AND t.peer_id = $2
          AND t.updated_at > now() - ${TYPING_WINDOW_SQL}) AS typing
      FROM users u WHERE u.id = $1`,
      [peerId, viewerId],
    );
    return {
      isUnavailable:false,
      isBlocking:false,
      isRequest: mine.request && mine.sent,
      awaitingAcceptance,
      canSend: allowed && !awaitingAcceptance,
      peerTyping: !!presence?.typing,
      peerOnline: !!presence?.online,
      peerLastActiveAt: iso(presence?.last_active_at ?? null),
      theme,
      ...prefs,
    };
  }

  /** Instagram-style chat theme, shared by both people in the conversation. */
  async setTheme(viewerId:string,peerId:string,theme:ChatTheme) {
    await this.assertPeer(viewerId,peerId);
    if(theme==='default'){
      await sqlRows(this.db,'DELETE FROM conversation_themes WHERE low_id=least($1::uuid,$2::uuid) AND high_id=greatest($1::uuid,$2::uuid)',[viewerId,peerId]);
      return;
    }
    await sqlRows(this.db,`INSERT INTO conversation_themes(low_id,high_id,theme,updated_by) VALUES (least($1::uuid,$2::uuid),greatest($1::uuid,$2::uuid),$3,$1)
      ON CONFLICT (low_id,high_id) DO UPDATE SET theme=EXCLUDED.theme,updated_by=EXCLUDED.updated_by,updated_at=now()`,[viewerId,peerId,theme]);
  }

  /** Your private nickname and wallpaper for a conversation. */
  private async prefs(viewerId:string,peerId:string) {
    const row=await sqlOne<{nickname:string|null;media:Record<string,any>|null}>(this.db,`SELECT p.nickname, row_to_json(md) AS media
      FROM conversation_prefs p LEFT JOIN media md ON md.id=p.wallpaper_media_id WHERE p.user_id=$1 AND p.peer_id=$2`,[viewerId,peerId]);
    return {nickname:row?.nickname??null,wallpaperUrl:row?.media?this.media.toDto(row.media as any).url:null};
  }

  /** Only the fields present in `dto` change; the wallpaper is an uploaded image you own. */
  async setPrefs(viewerId:string,peerId:string,dto:ChatPrefsDto) {
    await this.historyPeer(viewerId,peerId);
    const files=await this.db.transaction(async m=>{
      const current=await sqlOne<{nickname:string|null;wallpaper_media_id:string|null}>(m,
        'SELECT nickname,wallpaper_media_id FROM conversation_prefs WHERE user_id=$1 AND peer_id=$2 FOR UPDATE',[viewerId,peerId]);
      const nickname=dto.nickname!==undefined?(dto.nickname?.trim()||null):current?.nickname??null;
      const wallpaper=dto.wallpaperMediaId!==undefined?dto.wallpaperMediaId:current?.wallpaper_media_id??null;
      const replaced=current?.wallpaper_media_id&&current.wallpaper_media_id!==wallpaper?current.wallpaper_media_id:null;
      if(wallpaper&&wallpaper!==current?.wallpaper_media_id)await this.media.lockAttachable(m,viewerId,[wallpaper],{imagesOnly:true});
      if(!nickname&&!wallpaper)await sqlRows(m,'DELETE FROM conversation_prefs WHERE user_id=$1 AND peer_id=$2',[viewerId,peerId]);
      else await sqlRows(m,`INSERT INTO conversation_prefs(user_id,peer_id,nickname,wallpaper_media_id) VALUES ($1,$2,$3,$4)
        ON CONFLICT (user_id,peer_id) DO UPDATE SET nickname=EXCLUDED.nickname,wallpaper_media_id=EXCLUDED.wallpaper_media_id,updated_at=now()`,
        [viewerId,peerId,nickname,wallpaper]);
      return replaced?this.deletion.deleteMedia(m,[replaced]):null;
    });
    if(files)await this.deletion.removeFiles(files);
    return this.prefs(viewerId,peerId);
  }

  private gameDto(g:Record<string,any>,viewerId:string):ChatGameDto {
    const state=g.state as GameState, me=(g.players as string[]).indexOf(viewerId), kind=g.kind as GameKind;
    const rps=kind==='rps'?state as RpsState:null;
    const memory=kind==='memory'?state as MemoryState:null;
    const tot=kind==='thisorthat'?state as TotState:null;
    const qa=kind==='qa'?state as QaState:null;
    const tod=kind==='tod'?state as TodState:null;
    const extra=(EXTRA_KINDS as readonly string[]).includes(kind)?kind as ExtraKind:null;
    const third=(THIRD_KINDS as readonly string[]).includes(kind)?kind as ThirdKind:null;
    const over=g.status!=='active';
    const view=extra?extraView(extra,state as ExtraState,me,over):third?thirdView(third,state as ThirdState,me,over):{};
    const board=!rps&&!memory&&!tot&&!qa&&!tod&&!extra&&!third?state as BoardState:null;
    const picks=rps?.picks??tot?.picks??(extra?extraPicks(extra,state as ExtraState):third?thirdPicks(third,state as ThirdState):null);
    const label=(q:number)=>[...(THIS_OR_THAT[q]??['',''])];
    return {
      id:g.id,kind,players:g.players,
      board:board?.board??[],line:board?.line??[],
      turnId:g.turn_id??null,status:g.status,winnerId:g.winner_id??null,
      scores:rps?.scores??memory?.scores??(Array.isArray(view.scores)?view.scores as number[]:[]),
      rounds:rps?rps.rounds.map(r=>({choices:r.choices,winner:r.winner,labels:[]}))
        :tot?tot.rounds.map(r=>({choices:r.answers,winner:null,labels:label(r.q)})):[],
      // Memory faces stay secret until a card is turned up; so do the other player's picks.
      cards:memory?memory.cards.map((c,i)=>memory.owners[i]||memory.flipped.includes(i)||memory.shown.includes(i)?c:''):[],
      owners:memory?.owners??[],
      flipped:memory?[...memory.flipped,...memory.shown]:[],
      prompt:tot&&tot.round<tot.order.length?label(tot.order[tot.round]):[],
      myChoice:picks&&me>=0?picks[me]??null:null,
      peerReady:!!(picks&&me>=0&&picks[1-me]),
      phase:qa?.phase??tod?.phase??null,
      turns:qa?qa.rounds.map(r=>({who:r.asker,pick:null,question:r.question,clarify:r.clarify,clarification:r.clarification,answer:r.answer,passed:false}))
        :tod?tod.rounds.map(r=>({who:r.player,pick:r.pick,question:r.prompt,clarify:null,clarification:null,answer:r.reply,passed:r.passed})):[],
      chances:qa?.chances??tod?.chances??[],
      round:tot?.round??(qa?qa.rounds.length-1:tod?tod.rounds.length-1:typeof view.round==='number'?view.round:0),
      totalRounds:tot?.order.length??qa?.total??tod?.total??(typeof view.total==='number'?view.total:0),
      view,
      updatedAt:iso(g.updated_at)!,
    };
  }

  /** Starts a mini game: it arrives as a message, and you move first. */
  async startGame(viewerId:string,peerId:string,kind:GameKind,lang:'en'|'tr'='en') {
    await this.assertPeer(viewerId,peerId,true);
    const row=await this.db.transaction(async m=>{
      await sqlRows(m,'SELECT pg_advisory_xact_lock(hashtext(least($1::text, $2::text) || greatest($1::text, $2::text)))',[viewerId,peerId]);
      if(await sqlOne(m,`SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)`,[viewerId,peerId]))
        throw AppException.notFound(ErrorCode.USER_NOT_FOUND,'User not found');
      if((await this.requestState(m,peerId,viewerId)).request)
        throw AppException.forbidden(ErrorCode.INVALID_STATE,'Games are available after your message request is accepted');
      const state=initialState(kind,Math.random,lang), first=firstTurn(kind,state);
      const game=(await sqlOne<{id:string}>(m,`INSERT INTO chat_games(low_id,high_id,kind,players,state,turn_id,created_by)
        VALUES (least($1::uuid,$2::uuid),greatest($1::uuid,$2::uuid),$3,ARRAY[$1::uuid,$2::uuid],$4,$5,$1) RETURNING id`,
        [viewerId,peerId,kind,JSON.stringify(state),first===null?null:[viewerId,peerId][first]]))!;
      return (await sqlOne(m,'INSERT INTO direct_messages(sender_id,recipient_id,game_id) VALUES ($1,$2,$3) RETURNING *',[viewerId,peerId,game.id]))!;
    });
    this.push.notifyUser(peerId);
    return (await this.hydrate([row],viewerId))[0];
  }

  /** Asks the other person to have a baby together; the request arrives as a message. */
  async startBaby(viewerId:string,peerId:string,name:string,gender:'girl'|'boy') {
    await this.assertPeer(viewerId,peerId,true);
    const row=await this.db.transaction(async m=>{
      await sqlRows(m,'SELECT pg_advisory_xact_lock(hashtext(least($1::text, $2::text) || greatest($1::text, $2::text)))',[viewerId,peerId]);
      if(await sqlOne(m,`SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)`,[viewerId,peerId]))
        throw AppException.notFound(ErrorCode.USER_NOT_FOUND,'User not found');
      if((await this.requestState(m,peerId,viewerId)).request)
        throw AppException.forbidden(ErrorCode.INVALID_STATE,'This is available after your message request is accepted');
      await this.babies.assertNone(m,viewerId,peerId);
      const baby=await this.babies.create(m,viewerId,peerId,name,gender);
      return (await sqlOne(m,'INSERT INTO direct_messages(sender_id,recipient_id,baby_id) VALUES ($1,$2,$3) RETURNING *',[viewerId,peerId,baby.id]))!;
    });
    this.push.notifyUser(peerId);
    return (await this.hydrate([row],viewerId))[0];
  }

  async baby(viewerId:string,peerId:string) {
    await this.historyPeer(viewerId,peerId);
    return this.babies.current(viewerId,peerId);
  }

  private async gameRow(m:DataSource|EntityManager,viewerId:string,gameId:string,lock=false) {
    const g=await sqlOne(m,`SELECT * FROM chat_games WHERE id=$1 AND $2::uuid=ANY(players)${lock?' FOR UPDATE':''}`,[gameId,viewerId]);
    if(!g)throw AppException.notFound(ErrorCode.NOT_FOUND,'Game not found');
    return g;
  }

  async game(viewerId:string,gameId:string) {
    const g=await this.gameRow(this.db,viewerId,gameId);
    await this.historyPeer(viewerId,(g.players as string[]).find(id=>id!==viewerId)!);
    return this.gameDto(g,viewerId);
  }

  /** Games still going on in this chat (moved in during the last two weeks), newest first. */
  async activeGames(viewerId:string,peerId:string) {
    await this.historyPeer(viewerId,peerId);
    const rows=await sqlRows(this.db,`SELECT * FROM chat_games WHERE low_id=least($1::uuid,$2::uuid) AND high_id=greatest($1::uuid,$2::uuid)
      AND status='active' AND updated_at>now()-interval '14 days' ORDER BY updated_at DESC LIMIT 6`,[viewerId,peerId]);
    return rows.map(g=>this.gameDto(g,viewerId));
  }

  /**
   * Ends a game early: the other player wins (games nobody wins are just closed). It doesn't
   * count as a finished game for the baby, so starting and ending games earns nothing.
   */
  async resign(viewerId:string,gameId:string) {
    const g=await this.db.transaction(async m=>{
      const g=await this.gameRow(m,viewerId,gameId,true);
      if(g.status!=='active')throw AppException.badRequest(ErrorCode.INVALID_STATE,'This game is over');
      const other=(g.players as string[]).find(id=>id!==viewerId)!;
      const scored=!NO_WINNER.includes(g.kind as GameKind);
      return (await sqlOne(m,`UPDATE chat_games SET status=$2,winner_id=$3,turn_id=NULL,updated_at=now() WHERE id=$1 RETURNING *`,
        [gameId,scored?'won':'done',scored?other:null]))!;
    });
    return this.gameDto(g,viewerId);
  }

  async move(viewerId:string,gameId:string,move:GameMove) {
    const g=await this.db.transaction(async m=>{
      const g=await this.gameRow(m,viewerId,gameId,true);
      const players=g.players as string[], me=players.indexOf(viewerId);
      await this.assertPeer(viewerId,players[1-me]);
      if(g.status!=='active')throw AppException.badRequest(ErrorCode.INVALID_STATE,'This game is over');
      let out;
      try{out=applyMove(g.kind,g.state,me,g.turn_id?players.indexOf(g.turn_id):null,move);}
      catch(e){if(e instanceof GameRuleError)throw AppException.badRequest(ErrorCode.INVALID_STATE,e.message);throw e;}
      return (await sqlOne(m,'UPDATE chat_games SET state=$2,turn_id=$3,status=$4,winner_id=$5,updated_at=now() WHERE id=$1 RETURNING *',
        [gameId,JSON.stringify(out.state),out.next===null?null:players[out.next],out.status,out.winner===null?null:players[out.winner]]))!;
    });
    if(g.status!=='active')void this.babies.onGameFinished(g.players as string[]);
    return this.gameDto(g,viewerId);
  }

  /** Records that the viewer's app is open (throttled to one write per 20 s). */
  async touch(viewerId: string) {
    await sqlRows(
      this.db,
      `UPDATE users SET last_active_at = now()
      WHERE id = $1 AND (last_active_at IS NULL OR last_active_at < now() - interval '20 seconds')`,
      [viewerId],
    );
  }

  async pendingDelivery(viewerId:string) {
    const rows=await sqlRows<{id:string}>(this.db,`SELECT d.id FROM direct_messages d JOIN users u ON u.id=d.sender_id
      WHERE d.recipient_id=$1 AND d.delivered_at IS NULL AND u.status='ACTIVE' AND ${notBlockedSql('d.sender_id','$1')}
      ORDER BY d.created_at,d.id LIMIT 100`,[viewerId]);
    const groups=await sqlRows<{id:string}>(this.db,`SELECT DISTINCT ON(msg.group_id) msg.id FROM group_messages msg
      JOIN chat_group_members gm ON gm.group_id=msg.group_id AND gm.user_id=$1 JOIN users u ON u.id=msg.sender_id
      WHERE msg.seq>gm.delivered_seq AND msg.sender_id<>$1 AND u.status='ACTIVE' AND ${notBlockedSql('msg.sender_id','$1')}
      ORDER BY msg.group_id,msg.seq DESC LIMIT 100`,[viewerId]);
    return {messageIds:rows.map(r=>r.id),groupMessageIds:groups.map(r=>r.id)};
  }
  /** Explicit acknowledgment from a device that received these message IDs. */
  async delivered(viewerId: string, ids:string[], groupIds:string[] = []) {
    await sqlRows(
      this.db,
      `UPDATE direct_messages d SET delivered_at = now() WHERE recipient_id = $1 AND id=ANY($2::uuid[])
        AND delivered_at IS NULL AND ${notBlockedSql('d.sender_id','$1')}`,
      [viewerId,ids],
    );
    if(groupIds.length)await sqlRows(this.db,`UPDATE chat_group_members gm SET delivered_seq=greatest(gm.delivered_seq,received.seq)
      FROM(SELECT msg.group_id,max(msg.seq) seq FROM group_messages msg JOIN users u ON u.id=msg.sender_id
        WHERE msg.id=ANY($2::uuid[]) AND msg.sender_id<>$1 AND u.status='ACTIVE' AND ${notBlockedSql('msg.sender_id','$1')} GROUP BY msg.group_id) received
      WHERE gm.user_id=$1 AND gm.group_id=received.group_id`,[viewerId,groupIds]);
  }

  async typing(viewerId: string, peerId: string) {
    await this.assertPeer(viewerId, peerId);
    await sqlRows(
      this.db,
      `INSERT INTO typing_status(user_id, peer_id) VALUES ($1, $2)
      ON CONFLICT (user_id, peer_id) DO UPDATE SET updated_at = now()`,
      [viewerId, peerId],
    );
  }

  async stopTyping(viewerId: string, peerId: string) {
    await sqlRows(this.db, 'DELETE FROM typing_status WHERE user_id = $1 AND peer_id = $2', [
      viewerId,
      peerId,
    ]);
  }

  /** The recipient opens a view-once photo/video: its URL is returned this one time only. */
  async open(viewerId: string, messageId: string) {
    const row = await this.db.transaction(async (m) => {
      const message = await sqlOne(
        m,
        'SELECT * FROM direct_messages WHERE id = $1 AND recipient_id = $2 AND view_once FOR UPDATE',
        [messageId, viewerId],
      );
      if (!message) throw AppException.notFound();
      if (message.opened_at || !message.media_id)
        throw AppException.conflict(ErrorCode.INVALID_STATE, 'This photo was already opened');
      await this.assertPeer(viewerId, message.sender_id);
      await sqlRows(m, 'UPDATE direct_messages SET opened_at = now() WHERE id = $1', [messageId]);
      return sqlOne(m, 'SELECT * FROM media WHERE id = $1', [message.media_id]);
    });
    if (!row) throw AppException.notFound();
    return this.media.toDto(row as any);
  }

  /** Deletes view-once media shortly after it was opened (the message keeps an "Opened" marker). */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'view-once-media-cleanup' })
  async purgeOpenedViewOnce() {
    try {
      for (;;) {
        const result = await this.db.transaction(async (m) => {
          const rows = await sqlRows<{ media_id: string }>(
            m,
            `WITH t AS (
              SELECT id, media_id FROM direct_messages
              WHERE view_once AND media_id IS NOT NULL AND opened_at < now() - ${VIEW_ONCE_GRACE_SQL}
              ORDER BY opened_at LIMIT 200 FOR UPDATE SKIP LOCKED)
            UPDATE direct_messages d SET media_id = NULL FROM t WHERE d.id = t.id RETURNING t.media_id`,
          );
          return {
            count: rows.length,
            files: await this.deletion.deleteMedia(m, rows.map((r) => r.media_id)),
          };
        });
        await this.deletion.removeFiles(result.files);
        if (result.count < 200) break;
      }
    } catch (error) {
      this.logger.warn({ message: 'View-once cleanup failed', error: (error as Error).message });
    }
  }

  async accept(viewerId: string, peerId: string) {
    await this.assertPeer(viewerId, peerId);
    const state = await this.requestState(this.db, viewerId, peerId);
    if (!state.sent) throw AppException.notFound();
    await sqlRows(
      this.db,
      `INSERT INTO message_request_acceptances(user_id, peer_id) VALUES ($1, $2)
      ON CONFLICT DO NOTHING`,
      [viewerId, peerId],
    );
  }

  /** Unsend: permanently deletes one of your own messages (and its attachment) for both people. */
  async editMessage(viewerId:string,messageId:string,content:string) {
    if(!content.trim())throw AppException.badRequest(ErrorCode.VALIDATION_ERROR,'Write a message');
    const row=await sqlOne(this.db,`UPDATE direct_messages d SET content=$3,edited_at=now() WHERE id=$1 AND sender_id=$2 AND content IS NOT NULL AND NOT view_once
      AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=d.sender_id AND b.blocked_id=d.recipient_id) OR (b.blocker_id=d.recipient_id AND b.blocked_id=d.sender_id)) RETURNING *`,[messageId,viewerId,content.trim()]);
    if(!row)throw AppException.notFound(ErrorCode.NOT_FOUND,'Message not found or cannot be edited');
    return (await this.hydrate([row],viewerId))[0];
  }

  async removeMessage(viewerId: string, messageId: string) {
    const files = await this.db.transaction(async (m) => {
      const row = await sqlOne<{ media_id: string | null }>(
        m,
        'DELETE FROM direct_messages WHERE id = $1 AND sender_id = $2 RETURNING media_id',
        [messageId, viewerId],
      );
      if (!row) throw AppException.notFound(ErrorCode.NOT_FOUND, 'Message not found');
      return this.deletion.deleteMedia(m, row.media_id ? [row.media_id] : []);
    });
    await this.deletion.removeFiles(files);
  }

  /** Permanently deletes the whole conversation with `peerId` (both sides) and its attachments. */
  async removeConversation(viewerId: string, peerId: string) {
    if (viewerId === peerId) throw AppException.notFound();
    const files = await this.db.transaction(async (m) => {
      const rows = await sqlRows<{ media_id: string | null }>(
        m,
        `DELETE FROM direct_messages
        WHERE (sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1)
        RETURNING media_id`,
        [viewerId, peerId],
      );
      if (!rows.length) throw AppException.notFound(ErrorCode.NOT_FOUND, 'Conversation not found');
      await sqlRows(
        m,
        'DELETE FROM typing_status WHERE (user_id = $1 AND peer_id = $2) OR (user_id = $2 AND peer_id = $1)',
        [viewerId, peerId],
      );
      return this.deletion.deleteMedia(
        m,
        rows.map((r) => r.media_id).filter((id): id is string => !!id),
      );
    });
    await this.deletion.removeFiles(files);
  }

  /** Deletes a pending request (the peer's messages to you). They may send a new one later. */
  async decline(viewerId: string, peerId: string) {
    const files = await this.db.transaction(async (m) => {
      const state = await this.requestState(m, viewerId, peerId);
      if (!state.request || !state.sent)
        throw AppException.conflict(
          ErrorCode.INVALID_STATE,
          'This conversation is not a message request',
        );
      const rows = await sqlRows<{ media_id: string | null }>(
        m,
        'DELETE FROM direct_messages WHERE sender_id = $1 AND recipient_id = $2 RETURNING media_id',
        [peerId, viewerId],
      );
      return this.deletion.deleteMedia(
        m,
        rows.map((r) => r.media_id).filter((id): id is string => !!id),
      );
    });
    await this.deletion.removeFiles(files);
  }

  async unread(viewerId: string) {
    // Polled by every open app: doubles as the presence heartbeat and delivery receipt.
    await this.touch(viewerId);
    return {
      count:
        (
          await sqlOne(
            this.db,
            `SELECT ((SELECT count(*) FROM direct_messages d
      JOIN users u ON u.id = d.sender_id WHERE d.recipient_id = $1 AND d.read_at IS NULL
      AND u.status = 'ACTIVE' AND ${notBlockedSql('u.id', '$1')}) +
      (SELECT count(*) FROM group_messages msg JOIN chat_group_members gm ON gm.group_id=msg.group_id AND gm.user_id=$1
       JOIN users gu ON gu.id=msg.sender_id WHERE msg.seq>gm.read_seq AND msg.sender_id<>$1 AND gu.status='ACTIVE' AND ${notBlockedSql('msg.sender_id','$1')}))::int AS n`,
            [viewerId],
          )
        )?.n ?? 0,
    };
  }

  async read(viewerId: string, messageId: string) {
    const message = await sqlOne(
      this.db,
      'SELECT * FROM direct_messages WHERE id = $1 AND recipient_id = $2',
      [messageId, viewerId],
    );
    if (!message) throw AppException.notFound();
    await this.assertPeer(viewerId, message.sender_id);
    await sqlRows(
      this.db,
      `UPDATE direct_messages SET read_at = now(),delivered_at=coalesce(delivered_at,now()) WHERE recipient_id = $1 AND sender_id = $2
      AND read_at IS NULL AND (created_at, id) <= ($3::timestamptz, $4::uuid)`,
      [viewerId, message.sender_id, message.created_at, message.id],
    );
  }
}
