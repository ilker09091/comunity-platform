import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSocialGraph1760180200000 implements MigrationInterface {
  name = 'CreateSocialGraph1760180200000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE follows (
        follower_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        following_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at    timestamptz(3) NOT NULL DEFAULT now(),
        CONSTRAINT pk_follows PRIMARY KEY (follower_id, following_id),
        CONSTRAINT ck_follows_not_self CHECK (follower_id <> following_id)
      )`);
    await q.query(`CREATE INDEX ix_follows_following ON follows (following_id, created_at DESC, follower_id)`);
    await q.query(`CREATE INDEX ix_follows_follower ON follows (follower_id, created_at DESC, following_id)`);

    await q.query(`
      CREATE TABLE follow_requests (
        requester_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        target_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at    timestamptz(3) NOT NULL DEFAULT now(),
        CONSTRAINT pk_follow_requests PRIMARY KEY (requester_id, target_id),
        CONSTRAINT ck_follow_requests_not_self CHECK (requester_id <> target_id)
      )`);
    await q.query(`CREATE INDEX ix_follow_requests_target ON follow_requests (target_id, created_at DESC, requester_id)`);

    await q.query(`
      CREATE TABLE blocks (
        blocker_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        blocked_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  timestamptz(3) NOT NULL DEFAULT now(),
        CONSTRAINT pk_blocks PRIMARY KEY (blocker_id, blocked_id),
        CONSTRAINT ck_blocks_not_self CHECK (blocker_id <> blocked_id)
      )`);
    await q.query(`CREATE INDEX ix_blocks_blocked ON blocks (blocked_id, blocker_id)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE blocks`);
    await q.query(`DROP TABLE follow_requests`);
    await q.query(`DROP TABLE follows`);
  }
}
