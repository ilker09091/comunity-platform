import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Continuous Reels discovery: a recommendation session runs repeating cycles. Cycle 1 serves unwatched
 * Reels; when it is exhausted the next cycle makes every eligible Reel available again in a new order.
 * A Reel may therefore appear once per cycle in the same session. Persistent watch history is untouched.
 */
export class ReelDiscoveryCycles1760191000000 implements MigrationInterface {
  name = 'ReelDiscoveryCycles1760191000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE reel_recommendation_sessions
      ADD COLUMN IF NOT EXISTS cycle integer NOT NULL DEFAULT 1 CHECK (cycle >= 1),
      ADD COLUMN IF NOT EXISTS seed integer NOT NULL DEFAULT floor(random() * 2147483647)::int`);
    await q.query(`ALTER TABLE reel_recommendation_impressions ADD COLUMN IF NOT EXISTS cycle integer NOT NULL DEFAULT 1`);
    await q.query(`ALTER TABLE reel_recommendation_impressions DROP CONSTRAINT reel_recommendation_impressions_pkey`);
    await q.query(`ALTER TABLE reel_recommendation_impressions ADD PRIMARY KEY (session_id, cycle, post_id)`);
    // Watch events and direct exposures look a Reel up by session + post, newest cycle first.
    await q.query(`CREATE INDEX IF NOT EXISTS ix_reel_impressions_post ON reel_recommendation_impressions (session_id, post_id, cycle DESC)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS ix_reel_impressions_post`);
    // Repeated entries from later cycles cannot fit the old (session_id, post_id) key.
    await q.query(`DELETE FROM reel_recommendation_impressions WHERE cycle > 1`);
    await q.query(`ALTER TABLE reel_recommendation_impressions DROP CONSTRAINT reel_recommendation_impressions_pkey`);
    await q.query(`ALTER TABLE reel_recommendation_impressions ADD PRIMARY KEY (session_id, post_id)`);
    await q.query(`ALTER TABLE reel_recommendation_impressions DROP COLUMN IF EXISTS cycle`);
    await q.query(`ALTER TABLE reel_recommendation_sessions DROP COLUMN IF EXISTS seed, DROP COLUMN IF EXISTS cycle`);
  }
}
