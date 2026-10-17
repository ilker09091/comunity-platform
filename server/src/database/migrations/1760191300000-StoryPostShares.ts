import { MigrationInterface, QueryRunner } from 'typeorm';

/** A story can now show an existing Reel/video post instead of its own uploaded media. */
export class StoryPostShares1760191300000 implements MigrationInterface {
  name = 'StoryPostShares1760191300000';
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE stories ALTER COLUMN media_id DROP NOT NULL');
    await q.query(
      'ALTER TABLE stories ADD COLUMN post_id uuid REFERENCES posts(id) ON DELETE CASCADE',
    );
    await q.query(
      'ALTER TABLE stories ADD CONSTRAINT ck_stories_one_source CHECK ((media_id IS NULL) <> (post_id IS NULL))',
    );
    await q.query(
      'CREATE INDEX ix_stories_post ON stories(post_id) WHERE post_id IS NOT NULL',
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DELETE FROM stories WHERE media_id IS NULL');
    await q.query('DROP INDEX ix_stories_post');
    await q.query('ALTER TABLE stories DROP CONSTRAINT ck_stories_one_source');
    await q.query('ALTER TABLE stories DROP COLUMN post_id');
    await q.query('ALTER TABLE stories ALTER COLUMN media_id SET NOT NULL');
  }
}
