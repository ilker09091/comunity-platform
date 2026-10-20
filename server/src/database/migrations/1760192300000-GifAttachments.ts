import { MigrationInterface, QueryRunner } from 'typeorm';

/** GIFs (resolved from GIPHY by the server) in direct messages and comments. */
export class GifAttachments1760192300000 implements MigrationInterface {
  name = 'GifAttachments1760192300000';
  async up(q: QueryRunner) {
    await q.query(`ALTER TABLE direct_messages ADD COLUMN gif jsonb CHECK (gif IS NULL OR jsonb_typeof(gif) = 'object')`);
    await q.query(`ALTER TABLE comments ADD COLUMN gif jsonb CHECK (gif IS NULL OR jsonb_typeof(gif) = 'object')`);
    await q.query('ALTER TABLE comments DROP CONSTRAINT ck_comments_content_length');
    await q.query(`ALTER TABLE comments ADD CONSTRAINT ck_comments_content_length CHECK (
      char_length(content) <= 10000 AND (char_length(content) >= 1 OR deleted_at IS NOT NULL OR has_sticker OR gif IS NOT NULL)
    )`);
  }
  async down(q: QueryRunner) {
    await q.query(`DELETE FROM comments WHERE content = '' AND deleted_at IS NULL AND NOT has_sticker AND gif IS NOT NULL`);
    await q.query('ALTER TABLE comments DROP CONSTRAINT ck_comments_content_length');
    await q.query(`ALTER TABLE comments ADD CONSTRAINT ck_comments_content_length CHECK (
      char_length(content) <= 10000 AND (char_length(content) >= 1 OR deleted_at IS NOT NULL OR has_sticker)
    )`);
    await q.query('ALTER TABLE comments DROP COLUMN gif');
    await q.query('ALTER TABLE direct_messages DROP COLUMN gif');
  }
}
