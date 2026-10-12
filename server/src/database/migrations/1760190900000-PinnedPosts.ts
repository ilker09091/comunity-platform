import { MigrationInterface, QueryRunner } from 'typeorm';

/** Posts pinned by administrators to the top of the home feed. Additive; nothing is pinned initially. */
export class PinnedPosts1760190900000 implements MigrationInterface {
  name = 'PinnedPosts1760190900000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS pinned_at timestamptz`);
    await q.query(`CREATE INDEX IF NOT EXISTS posts_pinned_idx ON posts (pinned_at DESC) WHERE pinned_at IS NOT NULL`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS posts_pinned_idx`);
    await q.query(`ALTER TABLE posts DROP COLUMN IF EXISTS pinned_at`);
  }
}
