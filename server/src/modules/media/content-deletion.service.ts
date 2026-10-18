import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { recountPostEngagement, recountReplies, recountUserPosts } from '../../common/utils/counters.js';
import { sqlRows } from '../../common/utils/sql.js';
import { JobRegistryService } from '../platform/job-registry.service.js';
import { STORAGE_DRIVER, type StorageDriver } from './storage/storage.driver.js';

export interface DeletionResult {
  posts: number;
  comments: number;
  files: number;
  freedBytes: number;
}
/** Storage objects to remove once the database transaction has committed. */
export interface PendingFiles {
  keys: string[];
  bytes: number;
}

/**
 * Permanent deletion of posts, comments and media. Rows are deleted (foreign keys cascade to likes,
 * bookmarks, notifications and comments) and the files are removed from storage — nothing can be
 * restored. Denormalized counters are recomputed from the remaining data so profiles stay accurate.
 *
 * Usage: call `deletePosts` / `deleteComments` / `deleteMedia` inside a transaction, then pass the
 * returned `files` to `removeFiles` after commit (a rolled-back transaction must never lose files).
 */
@Injectable()
export class ContentDeletionService implements OnModuleInit {
  private readonly logger = new Logger(ContentDeletionService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    private readonly jobs: JobRegistryService,
  ) {}

  async onModuleInit() {
    this.jobs.register('deleted-content-purge', 'Every hour', 'Permanently removes content deleted before permanent deletion existed, and its files');
    this.jobs.register('media-file-deletion', 'Every minute', 'Retries committed file deletions until storage confirms removal');
    // Also finish deletions interrupted by a restart, without waiting an hour.
    await this.purgeLegacyDeleted();
    await this.retryFiles();
  }

  /** Deletes posts (plus reposts of them) and their now-unused media. Returns affected counts and files. */
  async deletePosts(m: EntityManager, postIds: string[]): Promise<DeletionResult & { pending: PendingFiles }> {
    if (!postIds.length) return { posts: 0, comments: 0, files: 0, freedBytes: 0, pending: { keys: [], bytes: 0 } };
    // Plain reposts of a deleted post would point at nothing, so they go too. Quotes keep their own text.
    const rows = await sqlRows<{ id: string; author_id: string; referenced_post_id: string | null }>(
      m,
      `SELECT id, author_id, referenced_post_id FROM posts
        WHERE id = ANY($1::uuid[]) OR (kind = 'REPOST' AND referenced_post_id = ANY($1::uuid[]))
        FOR UPDATE`,
      [postIds],
    );
    if (!rows.length) return { posts: 0, comments: 0, files: 0, freedBytes: 0, pending: { keys: [], bytes: 0 } };
    const ids = rows.map((r) => r.id);
    const media = await sqlRows<{ media_id: string }>(m, `SELECT DISTINCT media_id FROM post_media WHERE post_id = ANY($1::uuid[])`, [ids]);
    const commentCount = await sqlRows<{ n: number }>(m, `SELECT count(*)::int AS n FROM comments WHERE post_id = ANY($1::uuid[])`, [ids]);
    // Quotes of these posts lose their reference (FK ON DELETE SET NULL); recount their targets' counters below.
    await sqlRows(m, `DELETE FROM posts WHERE id = ANY($1::uuid[])`, [ids]);
    const files = await this.deleteMedia(m, media.map((x) => x.media_id));
    await recountUserPosts(m, [...new Set(rows.map((r) => r.author_id))]);
    await recountPostEngagement(m, [...new Set(rows.map((r) => r.referenced_post_id).filter((x): x is string => !!x && !ids.includes(x)))]);
    return { posts: ids.length, comments: commentCount[0]?.n ?? 0, files: files.keys.length, freedBytes: files.bytes, pending: files };
  }

  /**
   * Deletes comments. A comment that still has replies becomes an empty placeholder (text erased) so
   * other people's replies keep their place; placeholders left without replies are removed too.
   */
  async deleteComments(m: EntityManager, commentIds: string[]): Promise<number> {
    if (!commentIds.length) return 0;
    const rows = await sqlRows<{ id: string; post_id: string; parent_id: string | null }>(
      m,
      `SELECT id, post_id, parent_id FROM comments WHERE id = ANY($1::uuid[]) FOR UPDATE`,
      [commentIds],
    );
    if (!rows.length) return 0;
    const ids = rows.map((r) => r.id);
    // Erase the text everywhere first (placeholders keep no user data).
    await sqlRows(m, `UPDATE comments SET content = '', deleted_at = coalesce(deleted_at, now()), updated_at = now() WHERE id = ANY($1::uuid[])`, [ids]);
    await sqlRows(m, `DELETE FROM comment_likes WHERE comment_id = ANY($1::uuid[])`, [ids]);
    await sqlRows(m, `DELETE FROM notifications WHERE comment_id = ANY($1::uuid[])`, [ids]);
    // Remove deleted comments without replies, then any placeholder ancestors that became empty.
    let candidates = ids;
    const parents = new Set<string>();
    for (let depth = 0; depth < 20 && candidates.length; depth++) {
      const removed = await sqlRows<{ parent_id: string | null }>(
        m,
        `DELETE FROM comments c WHERE c.id = ANY($1::uuid[]) AND c.deleted_at IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM comments r WHERE r.parent_id = c.id)
          RETURNING c.parent_id`,
        [candidates],
      );
      candidates = removed.map((r) => r.parent_id).filter((p): p is string => !!p);
      candidates.forEach((p) => parents.add(p));
    }
    rows.forEach((r) => r.parent_id && parents.add(r.parent_id));
    await recountReplies(m, [...parents]);
    await recountPostEngagement(m, [...new Set(rows.map((r) => r.post_id))]);
    return ids.length;
  }

  /** Deletes media rows nothing references any more and returns their files for removal after commit. */
  async deleteMedia(m: EntityManager, mediaIds: string[]): Promise<PendingFiles> {
    if (!mediaIds.length) return { keys: [], bytes: 0 };
    const rows = await sqlRows<{ storage_key: string; size_bytes: string | number }>(
      m,
      `DELETE FROM media md WHERE md.id = ANY($1::uuid[])
          AND NOT EXISTS (SELECT 1 FROM post_media pm WHERE pm.media_id = md.id)
          AND NOT EXISTS (SELECT 1 FROM users u WHERE u.avatar_media_id = md.id OR u.cover_media_id = md.id)
          AND NOT EXISTS (SELECT 1 FROM direct_messages dm WHERE dm.media_id = md.id)
          AND NOT EXISTS (SELECT 1 FROM stories st WHERE st.media_id = md.id)
          AND NOT EXISTS (SELECT 1 FROM stickers sk WHERE sk.media_id = md.id)
        RETURNING md.storage_key, md.size_bytes`,
      [mediaIds],
    );
    return { keys: rows.map((r) => r.storage_key), bytes: rows.reduce((s, r) => s + Number(r.size_bytes), 0) };
  }

  /** Flushes deletion work saved by the media DELETE trigger, only after commit. */
  async removeFiles(files: PendingFiles): Promise<void> {
    // Chunk large admin batches; row locks keep multiple workers from sharing work.
    for (let start = 0; start < files.keys.length; start += 100) {
      await this.flushFiles(files.keys.slice(start, start + 100));
    }
  }

  private async flushFiles(keys?: string[]): Promise<{ removed: number; failed: number }> {
    return this.db.transaction(async (m) => {
      const rows = await sqlRows<{ storage_key: string }>(m,
        `SELECT storage_key FROM media_file_deletions
          WHERE ${keys ? 'storage_key = ANY($1::text[])' : 'next_attempt_at <= now()'}
          ORDER BY created_at, storage_key LIMIT 100 FOR UPDATE SKIP LOCKED`, keys ? [keys] : []);
      let removed = 0;
      let failed = 0;
      for (const { storage_key: key } of rows) {
        // Never delete a currently referenced object, even if a stale key was queued.
        const inUse = await sqlRows(m, `SELECT 1 FROM media WHERE storage_key = $1`, [key]);
        if (inUse.length) {
          await sqlRows(m, `DELETE FROM media_file_deletions WHERE storage_key = $1`, [key]);
          continue;
        }
        try {
          await this.storage.delete(key);
        } catch (error) {
          failed++;
          await sqlRows(m, `UPDATE media_file_deletions SET attempts = attempts + 1,
            next_attempt_at = now() + interval '1 minute' WHERE storage_key = $1`, [key]);
          this.logger.error({ message: 'Media file deletion failed; queued for retry', storageKey: key, error: String(error) });
          continue;
        }
        // If this transaction fails after unlinking, retrying an absent file is safe.
        await sqlRows(m, `DELETE FROM media_file_deletions WHERE storage_key = $1`, [key]);
        removed++;
      }
      return { removed, failed };
    });
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'media-file-deletion', waitForCompletion: true })
  async retryFiles(): Promise<void> {
    try {
      const { removed, failed } = await this.flushFiles();
      this.jobs.record('media-file-deletion', failed ? 'FAILED' : 'OK', `${removed} file(s) removed, ${failed} retrying`);
    } catch (error) {
      this.jobs.record('media-file-deletion', 'FAILED', String(error));
      this.logger.error({ message: 'Media deletion retry failed', error: String(error) });
    }
  }

  /**
   * Content deleted before permanent deletion existed was only flagged (`deleted_at`). Purge it in
   * small batches so its files are freed too.
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'deleted-content-purge', waitForCompletion: true })
  async purgeLegacyDeleted(): Promise<void> {
    try {
      let totals = { posts: 0, comments: 0, files: 0 };
      for (let i = 0; i < 20; i++) {
        const { result, files } = await this.db.transaction(async (m) => {
          const posts = await sqlRows<{ id: string }>(m, `SELECT id FROM posts WHERE deleted_at IS NOT NULL LIMIT 100`);
          const comments = await sqlRows<{ id: string }>(
            m,
            `SELECT id FROM comments WHERE deleted_at IS NOT NULL AND (content <> '' OR NOT EXISTS (SELECT 1 FROM comments r WHERE r.parent_id = comments.id)) LIMIT 200`,
          );
          const p = await this.deletePosts(m, posts.map((x) => x.id));
          const c = await this.deleteComments(m, comments.map((x) => x.id));
          return { result: { posts: p.posts, comments: c, files: p.files }, files: p.pending };
        });
        await this.removeFiles(files);
        totals = { posts: totals.posts + result.posts, comments: totals.comments + result.comments, files: totals.files + result.files };
        if (!result.posts && !result.comments) break;
      }
      this.jobs.record('deleted-content-purge', 'OK', `${totals.posts} post(s), ${totals.comments} comment(s), ${totals.files} file(s) purged`);
    } catch (error) {
      this.jobs.record('deleted-content-purge', 'FAILED', (error as Error).message);
      this.logger.error({ message: 'Deleted content purge failed', error: (error as Error).message });
    }
  }
}
