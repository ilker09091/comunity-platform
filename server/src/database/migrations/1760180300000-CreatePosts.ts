import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePosts1760180300000 implements MigrationInterface {
  name = 'CreatePosts1760180300000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TYPE post_kind AS ENUM ('POST', 'REPOST', 'QUOTE')`);
    await q.query(`CREATE TYPE post_visibility AS ENUM ('PUBLIC', 'FOLLOWERS')`);
    await q.query(`CREATE TYPE moderation_status AS ENUM ('ACTIVE', 'REMOVED')`);

    // Simple reposts and quote reposts are rows in posts (kind REPOST / QUOTE) pointing at
    // referenced_post_id. This keeps every feed a single keyset-paginated query.
    await q.query(`
      CREATE TABLE posts (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        author_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind                post_kind         NOT NULL DEFAULT 'POST',
        content             text,
        referenced_post_id  uuid REFERENCES posts(id) ON DELETE SET NULL,
        visibility          post_visibility   NOT NULL DEFAULT 'PUBLIC',
        moderation_status   moderation_status NOT NULL DEFAULT 'ACTIVE',
        like_count          integer NOT NULL DEFAULT 0,
        comment_count       integer NOT NULL DEFAULT 0,
        repost_count        integer NOT NULL DEFAULT 0,
        quote_count         integer NOT NULL DEFAULT 0,
        bookmark_count      integer NOT NULL DEFAULT 0,
        search_vector       tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED,
        created_at          timestamptz(3) NOT NULL DEFAULT now(),
        updated_at          timestamptz(3) NOT NULL DEFAULT now(),
        edited_at           timestamptz(3),
        deleted_at          timestamptz(3),
        CONSTRAINT ck_posts_content_length CHECK (content IS NULL OR char_length(content) <= 10000),
        CONSTRAINT ck_posts_kind_shape CHECK (
          (kind = 'POST' AND referenced_post_id IS NULL)
          OR (kind = 'REPOST' AND content IS NULL)
          OR kind = 'QUOTE'
        ),
        CONSTRAINT ck_posts_not_self_reference CHECK (referenced_post_id IS NULL OR referenced_post_id <> id),
        CONSTRAINT ck_posts_counts CHECK (
          like_count >= 0 AND comment_count >= 0 AND repost_count >= 0
          AND quote_count >= 0 AND bookmark_count >= 0
        )
      )`);
    await q.query(`CREATE INDEX ix_posts_created ON posts (created_at DESC, id DESC) WHERE deleted_at IS NULL`);
    await q.query(`CREATE INDEX ix_posts_author_created ON posts (author_id, created_at DESC, id DESC) WHERE deleted_at IS NULL`);
    await q.query(`CREATE INDEX ix_posts_referenced ON posts (referenced_post_id, kind, created_at DESC) WHERE deleted_at IS NULL`);
    await q.query(`CREATE INDEX ix_posts_search ON posts USING gin (search_vector)`);
    // A user can hold at most one live simple repost of a given post (concurrency-safe).
    await q.query(`CREATE UNIQUE INDEX uq_posts_simple_repost ON posts (author_id, referenced_post_id)
      WHERE kind = 'REPOST' AND deleted_at IS NULL`);

    await q.query(`
      CREATE TABLE post_media (
        post_id   uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        media_id  uuid NOT NULL REFERENCES media(id) ON DELETE RESTRICT,
        position  smallint NOT NULL,
        CONSTRAINT pk_post_media PRIMARY KEY (post_id, position),
        CONSTRAINT uq_post_media_media UNIQUE (media_id),
        CONSTRAINT ck_post_media_position CHECK (position >= 0 AND position < 20)
      )`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE post_media`);
    await q.query(`DROP TABLE posts`);
    await q.query(`DROP TYPE moderation_status`);
    await q.query(`DROP TYPE post_visibility`);
    await q.query(`DROP TYPE post_kind`);
  }
}
