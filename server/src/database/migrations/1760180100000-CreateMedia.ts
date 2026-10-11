import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMedia1760180100000 implements MigrationInterface {
  name = 'CreateMedia1760180100000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TYPE media_type AS ENUM ('IMAGE', 'VIDEO')`);
    await q.query(`CREATE TYPE media_status AS ENUM ('PROCESSING', 'READY', 'FAILED')`);
    // Only metadata lives in PostgreSQL; binaries live in the configured storage driver.
    await q.query(`
      CREATE TABLE media (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type         media_type   NOT NULL,
        status       media_status NOT NULL DEFAULT 'READY',
        storage_key  varchar(255) NOT NULL,
        mime_type    varchar(100) NOT NULL,
        size_bytes   bigint       NOT NULL,
        width        integer,
        height       integer,
        duration_ms  integer,
        created_at   timestamptz(3) NOT NULL DEFAULT now(),
        CONSTRAINT uq_media_storage_key UNIQUE (storage_key),
        CONSTRAINT ck_media_size CHECK (size_bytes > 0)
      )`);
    await q.query(`CREATE INDEX ix_media_owner ON media (owner_id, created_at)`);
    await q.query(`CREATE INDEX ix_media_created ON media (created_at)`);

    await q.query(`ALTER TABLE users ADD CONSTRAINT fk_users_avatar_media
      FOREIGN KEY (avatar_media_id) REFERENCES media(id) ON DELETE SET NULL`);
    await q.query(`ALTER TABLE users ADD CONSTRAINT fk_users_cover_media
      FOREIGN KEY (cover_media_id) REFERENCES media(id) ON DELETE SET NULL`);
    await q.query(`CREATE INDEX ix_users_avatar_media ON users (avatar_media_id) WHERE avatar_media_id IS NOT NULL`);
    await q.query(`CREATE INDEX ix_users_cover_media ON users (cover_media_id) WHERE cover_media_id IS NOT NULL`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX ix_users_cover_media`);
    await q.query(`DROP INDEX ix_users_avatar_media`);
    await q.query(`ALTER TABLE users DROP CONSTRAINT fk_users_cover_media`);
    await q.query(`ALTER TABLE users DROP CONSTRAINT fk_users_avatar_media`);
    await q.query(`DROP TABLE media`);
    await q.query(`DROP TYPE media_status`);
    await q.query(`DROP TYPE media_type`);
  }
}
