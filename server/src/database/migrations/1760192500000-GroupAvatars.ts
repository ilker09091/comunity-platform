import { MigrationInterface, QueryRunner } from 'typeorm';

export class GroupAvatars1760192500000 implements MigrationInterface {
  name='GroupAvatars1760192500000';
  async up(q:QueryRunner) {
    await q.query('ALTER TABLE chat_groups ADD COLUMN avatar_media_id uuid REFERENCES media(id) ON DELETE SET NULL');
    await q.query('CREATE INDEX chat_groups_avatar_media ON chat_groups(avatar_media_id) WHERE avatar_media_id IS NOT NULL');
  }
  async down(q:QueryRunner) {
    await q.query('ALTER TABLE chat_groups DROP COLUMN avatar_media_id');
  }
}
