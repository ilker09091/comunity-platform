import { MigrationInterface, QueryRunner } from 'typeorm';

export class PermanentMediaDeletion1760190200000 implements MigrationInterface {
  name = 'PermanentMediaDeletion1760190200000';

  async up(q: QueryRunner): Promise<void> {
    // Only deletion work is retained, never the deleted video or post content.
    await q.query(`CREATE TABLE media_file_deletions (
      storage_key text PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      attempts integer NOT NULL DEFAULT 0
    )`);
    await q.query(`CREATE INDEX ix_media_file_deletions_retry ON media_file_deletions (next_attempt_at)`);
    // Enqueue in the SAME transaction as every media deletion, including admin cleanup.
    // Rollback also rolls back the queue; a process crash after commit cannot lose the key.
    await q.query(`CREATE FUNCTION queue_media_file_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO media_file_deletions (storage_key) VALUES (OLD.storage_key) ON CONFLICT DO NOTHING;
        RETURN OLD;
      END;
    $$`);
    await q.query(`CREATE TRIGGER media_file_deletion AFTER DELETE ON media
      FOR EACH ROW EXECUTE FUNCTION queue_media_file_deletion()`);
    await q.query(`UPDATE users u SET post_count = (
      SELECT count(*)::int FROM posts p
      WHERE p.author_id = u.id AND p.deleted_at IS NULL AND p.moderation_status = 'ACTIVE'
    )`);
  }

  async down(q: QueryRunner): Promise<void> {
    // Never discard outstanding deletions when reverting a deployment.
    const pending = await q.query(`SELECT 1 FROM media_file_deletions LIMIT 1`);
    if (pending.length) throw new Error('Finish pending media file deletions before reverting this migration');
    await q.query(`DROP TRIGGER media_file_deletion ON media`);
    await q.query(`DROP FUNCTION queue_media_file_deletion()`);
    await q.query(`DROP TABLE media_file_deletions`);
  }
}
