import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { decodeCursor, iso, toPage } from '../../common/utils/cursor.js';
import { notBlockedSql, sqlOne, sqlRows } from '../../common/utils/sql.js';
import { ContentDeletionService } from '../media/content-deletion.service.js';
import { MediaService } from '../media/media.service.js';
import { PostsQueryService } from '../posts/posts-query.service.js';
import {
  USER_AVATAR_JOIN,
  USER_SUMMARY_COLUMNS,
  UsersService,
} from '../users/users.service.js';
import {
  DirectMessageDto,
  MessageStatusDto,
  SendMessageDto,
} from './social.dto.js';

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
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly users: UsersService,
    private readonly media: MediaService,
    private readonly posts: PostsQueryService,
    private readonly deletion: ContentDeletionService,
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

  private async assertPeer(viewerId: string, peerId: string, sending = false) {
    if (viewerId === peerId)
      throw AppException.badRequest(
        ErrorCode.BAD_REQUEST,
        'You cannot message yourself',
      );
    const peer = await this.users.getActiveTarget(peerId);
    const relationship = await this.users.relationship(viewerId, peerId);
    if (relationship.isBlocking || relationship.isBlockedBy)
      throw AppException.forbidden(
        ErrorCode.BLOCKED,
        'Messaging is unavailable for this account',
      );
    if (sending && peer.is_private && !relationship.isFollowing) {
      throw AppException.forbidden(
        ErrorCode.PRIVATE_ACCOUNT,
        'Follow this private account before sending a message',
      );
    }
  }

  private async hydrate(
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
    return rows.map((r) => ({
      id: r.id,
      senderId: r.sender_id,
      recipientId: r.recipient_id,
      content: r.content,
      media: byMedia.get(r.media_id) ?? null,
      post: byPost.get(r.post_id) ?? null,
      storyReply: r.story_reply
        ? { storyId: r.story_id ?? null, media: byStory.get(r.story_id) ?? null }
        : null,
      createdAt: iso(r.created_at)!,
      readAt: iso(r.read_at),
    }));
  }

  async send(
    senderId: string,
    recipientId: string,
    dto: SendMessageDto,
    storyId?: string,
  ) {
    await this.assertPeer(senderId, recipientId, true);
    if (!dto.content && !dto.mediaId && !dto.postId)
      throw AppException.badRequest(
        ErrorCode.VALIDATION_ERROR,
        'Write a message or select a video',
      );
    if (dto.mediaId && dto.postId)
      throw AppException.badRequest(
        ErrorCode.VALIDATION_ERROR,
        'Choose one attachment',
      );
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
        if (media.type !== 'VIDEO' || media.status !== 'READY') {
          throw AppException.badRequest(
            ErrorCode.INVALID_MEDIA,
            'Wait for the video to finish processing',
          );
        }
      }
      return (await sqlOne(
        m,
        `INSERT INTO direct_messages(sender_id, recipient_id, content, media_id, post_id, story_id, story_reply)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          senderId,
          recipientId,
          dto.content || null,
          dto.mediaId ?? null,
          dto.postId ?? null,
          storyId ?? null,
          !!storyId,
        ],
      ))!;
    });
    return (await this.hydrate([row], senderId))[0];
  }

  async list(
    viewerId: string,
    peerId: string,
    cursorStr: string | undefined,
    limit: number,
  ) {
    await this.assertPeer(viewerId, peerId);
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

  async conversations(
    viewerId: string,
    cursorStr: string | undefined,
    limit: number,
    folder?: 'primary' | 'requests',
  ) {
    const cursor = decodeCursor(cursorStr, ['date', 'uuid']);
    const isRequest = requestSql('$1', 'u.id');
    const rows = await sqlRows(
      this.db,
      `WITH latest AS (
      SELECT DISTINCT ON (CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END)
        d.*, CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS peer_id
      FROM direct_messages d WHERE sender_id = $1 OR recipient_id = $1
      ORDER BY CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END, created_at DESC, id DESC
    ) SELECT l.*, ${USER_SUMMARY_COLUMNS}, l.id AS message_id,
      (SELECT count(*)::int FROM direct_messages d WHERE d.recipient_id = $1 AND d.sender_id = u.id AND d.read_at IS NULL) AS unread,
      ${isRequest} AS is_request
      FROM latest l JOIN users u ON u.id = l.peer_id ${USER_AVATAR_JOIN}
      WHERE u.status = 'ACTIVE' AND ${notBlockedSql('u.id', '$1')}
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
        user: this.users.toSummary(r as any),
        lastMessage: messages[i],
        unreadCount: r.unread,
        isRequest: r.is_request,
      })),
    };
  }

  async status(viewerId: string, peerId: string): Promise<MessageStatusDto> {
    await this.assertPeer(viewerId, peerId);
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
    return {
      isRequest: mine.request && mine.sent,
      awaitingAcceptance,
      canSend: allowed && !awaitingAcceptance,
    };
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
    return {
      count:
        (
          await sqlOne(
            this.db,
            `SELECT count(*)::int AS n FROM direct_messages d
      JOIN users u ON u.id = d.sender_id WHERE d.recipient_id = $1 AND d.read_at IS NULL
      AND u.status = 'ACTIVE' AND ${notBlockedSql('u.id', '$1')}`,
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
      `UPDATE direct_messages SET read_at = now() WHERE recipient_id = $1 AND sender_id = $2
      AND read_at IS NULL AND (created_at, id) <= ($3::timestamptz, $4::uuid)`,
      [viewerId, message.sender_id, message.created_at, message.id],
    );
  }
}
