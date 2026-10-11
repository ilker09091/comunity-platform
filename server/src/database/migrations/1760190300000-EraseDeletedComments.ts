import { MigrationInterface, QueryRunner } from 'typeorm';

export class EraseDeletedComments1760190300000 implements MigrationInterface {
  name = 'EraseDeletedComments1760190300000';

  async up(q: QueryRunner): Promise<void> {
    // Empty placeholders are needed only to preserve other people's replies.
    await q.query(`ALTER TABLE comments DROP CONSTRAINT ck_comments_content_length`);
    await q.query(`ALTER TABLE comments ADD CONSTRAINT ck_comments_content_length CHECK (
      (deleted_at IS NOT NULL AND content = '') OR char_length(content) BETWEEN 1 AND 10000
    )`);
    await q.query(`UPDATE comments SET content = '' WHERE deleted_at IS NOT NULL`);
  }

  async down(q: QueryRunner): Promise<void> {
    const erased = await q.query(`SELECT 1 FROM comments WHERE content = '' LIMIT 1`);
    if (erased.length) throw new Error('Cannot restore erased comments to the old nonempty-content schema');
    await q.query(`ALTER TABLE comments DROP CONSTRAINT ck_comments_content_length`);
    await q.query(`ALTER TABLE comments ADD CONSTRAINT ck_comments_content_length CHECK (char_length(content) BETWEEN 1 AND 10000)`);
  }
}
