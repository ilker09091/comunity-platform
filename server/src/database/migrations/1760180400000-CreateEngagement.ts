import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEngagement1760180400000 implements MigrationInterface {
  name = 'CreateEngagement1760180400000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE post_likes (
        user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        post_id     uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        created_at  timestamptz(3) NOT NULL DEFAULT now(),
        CONSTRAINT pk_post_likes PRIMARY KEY (user_id, post_id)
      )`);
    await q.query(`CREATE INDEX ix_post_likes_post ON post_likes (post_id, created_at DESC, user_id)`);

    await q.query(`
      CREATE TABLE bookmarks (
        user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        post_id     uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        created_at  timestamptz(3) NOT NULL DEFAULT now(),
        CONSTRAINT pk_bookmarks PRIMARY KEY (user_id, post_id)
      )`);
    await q.query(`CREATE INDEX ix_bookmarks_user_created ON bookmarks (user_id, created_at DESC, post_id)`);

    // The composite FK (parent_id, post_id) -> comments(id, post_id) makes cross-post
    // parent references impossible at the database level.
    await q.query(`
      CREATE TABLE comments (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id            uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        author_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        parent_id          uuid,
        depth              smallint NOT NULL DEFAULT 0,
        content            text NOT NULL,
        moderation_status  moderation_status NOT NULL DEFAULT 'ACTIVE',
        like_count         integer NOT NULL DEFAULT 0,
        reply_count        integer NOT NULL DEFAULT 0,
        created_at         timestamptz(3) NOT NULL DEFAULT now(),
        updated_at         timestamptz(3) NOT NULL DEFAULT now(),
        edited_at          timestamptz(3),
        deleted_at         timestamptz(3),
        CONSTRAINT uq_comments_id_post UNIQUE (id, post_id),
        CONSTRAINT fk_comments_parent FOREIGN KEY (parent_id, post_id)
          REFERENCES comments(id, post_id) ON DELETE CASCADE,
        CONSTRAINT ck_comments_depth CHECK (depth >= 0 AND ((parent_id IS NULL) = (depth = 0))),
        CONSTRAINT ck_comments_content_length CHECK (char_length(content) BETWEEN 1 AND 10000),
        CONSTRAINT ck_comments_counts CHECK (like_count >= 0 AND reply_count >= 0)
      )`);
    await q.query(`CREATE INDEX ix_comments_post_top ON comments (post_id, created_at, id) WHERE parent_id IS NULL`);
    await q.query(`CREATE INDEX ix_comments_parent ON comments (parent_id, created_at, id) WHERE parent_id IS NOT NULL`);
    await q.query(`CREATE INDEX ix_comments_author ON comments (author_id, created_at DESC)`);

    await q.query(`
      CREATE TABLE comment_likes (
        user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        comment_id  uuid NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
        created_at  timestamptz(3) NOT NULL DEFAULT now(),
        CONSTRAINT pk_comment_likes PRIMARY KEY (user_id, comment_id)
      )`);
    await q.query(`CREATE INDEX ix_comment_likes_comment ON comment_likes (comment_id)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE comment_likes`);
    await q.query(`DROP TABLE comments`);
    await q.query(`DROP TABLE bookmarks`);
    await q.query(`DROP TABLE post_likes`);
  }
}
