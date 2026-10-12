import { MigrationInterface, QueryRunner } from 'typeorm';

/** Post counts include the user's own posts and quotes, but not plain reposts. Recomputes stored counts (no data removed). */
export class PostCountExcludesReposts1760190700000 implements MigrationInterface {
  name = 'PostCountExcludesReposts1760190700000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`UPDATE users u SET post_count = (
      SELECT count(*)::int FROM posts p
       WHERE p.author_id = u.id AND p.kind <> 'REPOST' AND p.deleted_at IS NULL AND p.moderation_status = 'ACTIVE')`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`UPDATE users u SET post_count = (
      SELECT count(*)::int FROM posts p
       WHERE p.author_id = u.id AND p.deleted_at IS NULL AND p.moderation_status = 'ACTIVE')`);
  }
}
