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
import { UsersService } from '../users/users.service.js';
import { CreateStoryDto, StoryDto } from './social.dto.js';

@Injectable()
export class StoriesService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly media: MediaService,
    private readonly users: UsersService,
    private readonly deletion: ContentDeletionService,
    private readonly settings: PlatformSettingsService,
    private readonly posts: PostsQueryService,
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
    CASE WHEN s.author_id = $1 THEN (SELECT count(*)::int FROM story_views v WHERE v.story_id = s.id) ELSE 0 END AS views
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
          viewCount: r.views,
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
