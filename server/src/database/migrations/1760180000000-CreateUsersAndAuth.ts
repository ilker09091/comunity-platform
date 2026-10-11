import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsersAndAuth1760180000000 implements MigrationInterface {
  name = 'CreateUsersAndAuth1760180000000';

  async up(q: QueryRunner): Promise<void> {
    // Extensions are intentionally not dropped in down(): other schemas may rely on them.
    await q.query(`CREATE EXTENSION IF NOT EXISTS citext`);
    await q.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    await q.query(`CREATE TYPE user_status AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED')`);
    await q.query(`CREATE TYPE user_role AS ENUM ('USER', 'MODERATOR', 'ADMIN')`);

    await q.query(`
      CREATE TABLE users (
        id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        username             citext       NOT NULL,
        email                citext       NOT NULL,
        password_hash        text         NOT NULL,
        display_name         varchar(50)  NOT NULL,
        bio                  varchar(300),
        location             varchar(100),
        website              varchar(200),
        avatar_media_id      uuid,
        cover_media_id       uuid,
        is_private           boolean      NOT NULL DEFAULT false,
        status               user_status  NOT NULL DEFAULT 'ACTIVE',
        role                 user_role    NOT NULL DEFAULT 'USER',
        follower_count       integer      NOT NULL DEFAULT 0,
        following_count      integer      NOT NULL DEFAULT 0,
        post_count           integer      NOT NULL DEFAULT 0,
        password_changed_at  timestamptz(3),
        created_at           timestamptz(3) NOT NULL DEFAULT now(),
        updated_at           timestamptz(3) NOT NULL DEFAULT now(),
        CONSTRAINT uq_users_username UNIQUE (username),
        CONSTRAINT uq_users_email UNIQUE (email),
        CONSTRAINT ck_users_username_format CHECK (username ~ '^[A-Za-z0-9_]{3,30}$'),
        CONSTRAINT ck_users_counts CHECK (follower_count >= 0 AND following_count >= 0 AND post_count >= 0)
      )`);
    await q.query(`CREATE INDEX ix_users_username_trgm ON users USING gin (lower(username::text) gin_trgm_ops)`);
    await q.query(`CREATE INDEX ix_users_display_name_trgm ON users USING gin (lower(display_name) gin_trgm_ops)`);

    await q.query(`
      CREATE TABLE sessions (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_agent     varchar(255),
        ip_address     varchar(64),
        created_at     timestamptz(3) NOT NULL DEFAULT now(),
        last_used_at   timestamptz(3) NOT NULL DEFAULT now(),
        expires_at     timestamptz(3) NOT NULL,
        revoked_at     timestamptz(3),
        revoked_reason varchar(50)
      )`);
    await q.query(`CREATE INDEX ix_sessions_user_active ON sessions (user_id) WHERE revoked_at IS NULL`);

    await q.query(`
      CREATE TABLE refresh_tokens (
        id          uuid PRIMARY KEY,
        session_id  uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        token_hash  char(64) NOT NULL,
        expires_at  timestamptz(3) NOT NULL,
        used_at     timestamptz(3),
        created_at  timestamptz(3) NOT NULL DEFAULT now(),
        CONSTRAINT uq_refresh_tokens_hash UNIQUE (token_hash)
      )`);
    await q.query(`CREATE INDEX ix_refresh_tokens_session ON refresh_tokens (session_id)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE refresh_tokens`);
    await q.query(`DROP TABLE sessions`);
    await q.query(`DROP TABLE users`);
    await q.query(`DROP TYPE user_role`);
    await q.query(`DROP TYPE user_status`);
  }
}
