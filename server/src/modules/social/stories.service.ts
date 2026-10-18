import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { decodeCursor, iso, toPage } from '../../common/utils/cursor.js';
import {
  notBlockedSql,
  postVisibleSql,
  sqlOne,
  sqlRows,
} from '../../common/utils/sql.js';
import { MediaService } from '../media/media.service.js';
import { ContentDeletionService } from '../media/content-deletion.service.js';
import { PlatformSettingsService } from '../platform/platform-settings.service.js';
import { PostsQueryService } from '../posts/posts-query.service.js';
import {
  USER_AVATAR_JOIN,
  USER_SUMMARY_COLUMNS,
  UsersService,
} from '../users/users.service.js';
import { MessagesService } from './messages.service.js';
import { CreateStoryDto, StoryDto, StoryViewerDto } from './social.dto.js';

@Injectable()
export class StoriesService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly media: MediaService,
    private readonly users: UsersService,
    private readonly deletion: ContentDeletionService,
    private readonly settings: PlatformSettingsService,
    private readonly posts: PostsQueryService,
    private readonly messages: MessagesService,
  ) {}

  // Shared posts are re-checked for the viewer on every request, like shared posts in messages.
  private visible = `s.expires_at > now() AND u.status = 'ACTIVE'
    AND (md.status = 'READY' OR (s.post_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM posts sp JOIN users spa ON spa.id = sp.author_id
      WHERE sp.id = s.post_id AND ${postVisibleSql('sp', 'spa', '$1')})))
    AND ${notBlockedSql('u.id', '$1')}
    AND (u.id = $1 OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.following_id = u.id))`;

  private select = `SELECT s.*, row_to_json(md) AS media_row,
    u.username::text AS username, u.display_name, u.is_private, u.is_verified, av.storage_key AS avatar_key,
    EXISTS (SELECT 1 FROM story_views v WHERE v.story_id = s.id AND v.user_id = $1) AS viewed,
    EXISTS (SELECT 1 FROM story_likes l WHERE l.story_id = s.id AND l.user_id = $1) AS liked,
    CASE WHEN s.author_id = $1 THEN (SELECT count(*)::int FROM story_views v WHERE v.story_id = s.id) ELSE 0 END AS views,
    CASE WHEN s.author_id = $1 THEN (SELECT count(*)::int FROM story_likes l WHERE l.story_id = s.id) ELSE 0 END AS likes
    FROM stories s JOIN users u ON u.id = s.author_id LEFT JOIN media md ON md.id = s.media_id
    LEFT JOIN media av ON av.id = u.avatar_media_id`;

  private async hydrate(
    rows: Record<string, any>[],
    viewerId: string,
  ): Promise<StoryDto[]> {
    const postIds = [...new Set(rows.map((r) => r.post_id).filter(Boolean))];
    const posts = new Map(
      (await this.posts.hydrate(postIds, viewerId)).map((p) => [p.id, p]),
    );
    return rows.flatMap((r) => {
      const post = r.post_id ? posts.get(r.post_id) : undefined;
      const media = post
        ? post.media.find((m) => m.type === 'VIDEO')
        : r.media_row && this.media.toDto(r.media_row);
      if (!media) return [];
      return [
        {
          id: r.id,
          author: this.users.toSummary({ ...r, id: r.author_id } as any),
          media,
          post: post ?? null,
          caption: r.caption,
          createdAt: iso(r.created_at)!,
          expiresAt: iso(r.expires_at)!,
          isViewed: r.viewed,
          isLiked: r.liked,
          viewCount: r.views,
          likeCount: r.likes,
        },
      ];
    });
  }

  async list(viewerId: string, cursorStr: string | undefined, limit: number) {
    const cursor = decodeCursor(cursorStr, ['date', 'uuid']);
    const rows = await sqlRows(
      this.db,
      `${this.select} WHERE ${this.visible}
      ${cursor ? 'AND (s.created_at, s.id) < ($3::timestamptz, $4::uuid)' : ''}
      ORDER BY s.created_at DESC, s.id DESC LIMIT $2`,
      [viewerId, limit + 1, ...(cursor ?? [])],
    );
    const page = toPage(
      rows,
      limit,
      (r) => r,
      (r) => [iso(r.created_at)!, r.id],
    );
    return { ...page, items: await this.hydrate(page.items, viewerId) };
  }

  async create(authorId: string, dto: CreateStoryDto) {
    await this.settings.assertFeature('postCreation');
    if (!dto.mediaId === !dto.postId)
      throw AppException.badRequest(
        ErrorCode.VALIDATION_ERROR,
        'Choose a photo, a video or a Reel',
      );
    if (dto.postId) {
      const post = await this.posts.getOne(dto.postId, authorId);
      if (!post.media.some((m) => m.type === 'VIDEO'))
        throw AppException.badRequest(
          ErrorCode.INVALID_MEDIA,
          'Only Reels and video posts can be shared to your story',
        );
    }
    const id = await this.db.transaction(async (m) => {
      if (dto.postId)
        return (await sqlOne(
          m,
          'INSERT INTO stories(author_id, post_id, caption) VALUES ($1,$2,$3) RETURNING id',
          [authorId, dto.postId, dto.caption?.trim() || null],
        ))!.id;
      const [media] = await this.media.lockAttachable(m, authorId, [
        dto.mediaId!,
      ]);
      if (media.status !== 'READY')
        throw AppException.badRequest(
          ErrorCode.INVALID_MEDIA,
          'Wait for media processing to finish',
        );
      if (
        media.type === 'VIDEO' &&
        (!media.duration_ms || media.duration_ms > 60_000)
      ) {
        throw AppException.badRequest(
          ErrorCode.INVALID_MEDIA,
          'Story videos must be at most 60 seconds',
        );
      }
      return (await sqlOne(
        m,
        'INSERT INTO stories(author_id, media_id, caption) VALUES ($1,$2,$3) RETURNING id',
        [authorId, dto.mediaId, dto.caption?.trim() || null],
      ))!.id;
    });
    const [story] = await this.hydrate(
      await sqlRows(
        this.db,
        `${this.select} WHERE s.id = $2 AND ${this.visible}`,
        [authorId, id],
      ),
      authorId,
    );
    return story;
  }

  async view(viewerId: string, storyId: string) {
    const rows = await sqlRows(
      this.db,
      `INSERT INTO story_views(story_id, user_id)
      SELECT s.id, $1 FROM stories s JOIN users u ON u.id = s.author_id LEFT JOIN media md ON md.id = s.media_id
      WHERE s.id = $2 AND ${this.visible} AND s.author_id <> $1
      ON CONFLICT DO NOTHING RETURNING story_id`,
      [viewerId, storyId],
    );
    if (!rows.length) {
      const story = await sqlOne(
        this.db,
        `${this.select} WHERE s.id = $2 AND ${this.visible}`,
        [viewerId, storyId],
      );
      if (!story) throw AppException.notFound();
    }
  }

  /** A story someone else posted that the viewer can currently see. */
  private async visibleOther(viewerId: string, storyId: string) {
    const story = await sqlOne<{ author_id: string }>(
      this.db,
      `SELECT s.author_id FROM stories s JOIN users u ON u.id = s.author_id
      LEFT JOIN media md ON md.id = s.media_id WHERE s.id = $2 AND ${this.visible}`,
      [viewerId, storyId],
    );
    if (!story) throw AppException.notFound();
    if (story.author_id === viewerId)
      throw AppException.badRequest(
        ErrorCode.BAD_REQUEST,
        'You cannot do this on your own story',
      );
    return story;
  }

  async like(viewerId: string, storyId: string) {
    await this.visibleOther(viewerId, storyId);
    // Liking implies watching it, so it always appears in the author's viewer list.
    await sqlRows(
      this.db,
      `WITH v AS (INSERT INTO story_views(story_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING)
      INSERT INTO story_likes(story_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [storyId, viewerId],
    );
  }

  async unlike(viewerId: string, storyId: string) {
    await sqlRows(
      this.db,
      'DELETE FROM story_likes WHERE story_id = $1 AND user_id = $2',
      [storyId, viewerId],
    );
  }

  /** Replies go to the author as a direct message linked to the story. */
  async reply(viewerId: string, storyId: string, content: string) {
    const story = await this.visibleOther(viewerId, storyId);
    await sqlRows(
      this.db,
      'INSERT INTO story_views(story_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [storyId, viewerId],
    );
    return this.messages.send(viewerId, story.author_id, { content }, storyId);
  }

  /** Who watched (and liked) the author's own live story, most recent first. */
  async viewers(
    authorId: string,
    storyId: string,
    cursorStr: string | undefined,
    limit: number,
  ) {
    const story = await sqlOne(
      this.db,
      'SELECT 1 FROM stories WHERE id = $1 AND author_id = $2 AND expires_at > now()',
      [storyId, authorId],
    );
    if (!story) throw AppException.notFound();
    const cursor = decodeCursor(cursorStr, ['date', 'uuid']);
    const rows = await sqlRows(
      this.db,
      `SELECT v.created_at AS viewed_at, ${USER_SUMMARY_COLUMNS},
        EXISTS (SELECT 1 FROM story_likes l WHERE l.story_id = v.story_id AND l.user_id = v.user_id) AS liked
      FROM story_views v JOIN users u ON u.id = v.user_id ${USER_AVATAR_JOIN}
      WHERE v.story_id = $1 AND u.status = 'ACTIVE'
      ${cursor ? 'AND (v.created_at, u.id) < ($3::timestamptz, $4::uuid)' : ''}
      ORDER BY v.created_at DESC, u.id DESC LIMIT $2`,
      [storyId, limit + 1, ...(cursor ?? [])],
    );
    return toPage(
      rows,
      limit,
      (r): StoryViewerDto => ({
        user: this.users.toSummary(r as any),
        viewedAt: iso(r.viewed_at)!,
        liked: r.liked,
      }),
      (r) => [iso(r.viewed_at)!, r.id],
    );
  }

  async remove(authorId: string, storyId: string) {
    const files = await this.db.transaction(async (m) => {
      const story = await sqlOne(
        m,
        'DELETE FROM stories WHERE id = $1 AND author_id = $2 RETURNING media_id',
        [storyId, authorId],
      );
      if (!story) throw AppException.notFound();
      return this.deletion.deleteMedia(
        m,
        story.media_id ? [story.media_id] : [],
      );
    });
    await this.deletion.removeFiles(files);
  }

  @Cron(CronExpression.EVERY_HOUR, { name: 'expired-story-cleanup' })
  async cleanupExpired() {
    for (;;) {
      const result = await this.db.transaction(async (m) => {
        const rows = await sqlRows(
          m,
          `DELETE FROM stories WHERE id IN (
          SELECT id FROM stories WHERE expires_at <= now() ORDER BY expires_at LIMIT 200 FOR UPDATE SKIP LOCKED)
          RETURNING media_id`,
        );
        return {
          count: rows.length,
          files: await this.deletion.deleteMedia(
            m,
            rows.map((r) => r.media_id).filter(Boolean),
          ),
        };
      });
      await this.deletion.removeFiles(result.files);
      if (result.count < 200) break;
    }
  }
}
