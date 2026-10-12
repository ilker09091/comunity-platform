import type { DataSource, EntityManager } from 'typeorm';
import { sqlRows } from './sql.js';

/**
 * Recomputes denormalized counters from the source rows. Only content members can currently see
 * (not deleted, moderation ACTIVE) is counted, so hiding, removing or deleting content is reflected
 * immediately on profiles and posts.
 */
export async function recountUserPosts(m: EntityManager | DataSource, userIds: string[]) {
  if (!userIds.length) return;
  // Take the author locks BEFORE the counting statement gets its snapshot. Concurrent
  // deletes/creates must not overwrite this count with a snapshot from before waiting.
  await sqlRows(m, `SELECT id FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [userIds]);
  await sqlRows(
    m,
    `UPDATE users u SET post_count = (
        SELECT count(*)::int FROM posts p WHERE p.author_id = u.id AND p.kind <> 'REPOST' AND p.deleted_at IS NULL AND p.moderation_status = 'ACTIVE')
      WHERE u.id = ANY($1::uuid[])`,
    [userIds],
  );
}

export async function recountPostEngagement(m: EntityManager | DataSource, postIds: string[]) {
  if (!postIds.length) return;
  await sqlRows(
    m,
    `UPDATE posts p SET
        comment_count = (SELECT count(*)::int FROM comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL AND c.moderation_status = 'ACTIVE'),
        repost_count = (SELECT count(*)::int FROM posts r WHERE r.referenced_post_id = p.id AND r.kind = 'REPOST' AND r.deleted_at IS NULL AND r.moderation_status = 'ACTIVE'),
        quote_count = (SELECT count(*)::int FROM posts q WHERE q.referenced_post_id = p.id AND q.kind = 'QUOTE' AND q.deleted_at IS NULL AND q.moderation_status = 'ACTIVE')
      WHERE p.id = ANY($1::uuid[])`,
    [postIds],
  );
}

export async function recountReplies(m: EntityManager | DataSource, commentIds: string[]) {
  if (!commentIds.length) return;
  await sqlRows(
    m,
    `UPDATE comments c SET reply_count = (
        SELECT count(*)::int FROM comments r WHERE r.parent_id = c.id AND r.deleted_at IS NULL AND r.moderation_status = 'ACTIVE')
      WHERE c.id = ANY($1::uuid[])`,
    [commentIds],
  );
}
