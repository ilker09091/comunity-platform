import { MigrationInterface, QueryRunner } from 'typeorm';

export class GroupMessaging1760192400000 implements MigrationInterface {
  name='GroupMessaging1760192400000';
  async up(q:QueryRunner) {
    await q.query(`ALTER TABLE direct_messages ADD COLUMN edited_at timestamptz`);
    await q.query(`CREATE TABLE chat_groups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(60) NOT NULL CHECK(length(trim(name))>0),
      owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE TABLE chat_group_members (
      group_id uuid NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at timestamptz NOT NULL DEFAULT now(), delivered_seq bigint NOT NULL DEFAULT 0, read_seq bigint NOT NULL DEFAULT 0,
      PRIMARY KEY(group_id,user_id))`);
    await q.query(`CREATE INDEX chat_group_members_user ON chat_group_members(user_id,group_id)`);
    await q.query(`CREATE TABLE group_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seq bigserial UNIQUE NOT NULL,
      group_id uuid NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
      sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content varchar(2000), media_id uuid REFERENCES media(id) ON DELETE SET NULL,
      post_id uuid REFERENCES posts(id) ON DELETE SET NULL, sticker_id uuid REFERENCES stickers(id) ON DELETE SET NULL,
      has_sticker boolean NOT NULL DEFAULT false, audio_key text, audio_duration_ms integer, gif jsonb,
      reply_to_id uuid REFERENCES group_messages(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(), edited_at timestamptz)`);
    await q.query(`CREATE INDEX group_messages_timeline ON group_messages(group_id,created_at DESC,id DESC)`);
  }
  async down(q:QueryRunner) {
    await q.query('DROP TABLE group_messages,chat_group_members,chat_groups');
    await q.query('ALTER TABLE direct_messages DROP COLUMN edited_at');
  }
}
