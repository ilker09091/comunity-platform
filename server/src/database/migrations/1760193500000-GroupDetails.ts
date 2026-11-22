import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Groups, Telegram style: a description, admins, member permissions, a pinned message, muting,
 * system events ("Ece added Can") and per-person read/delivery times for "Seen by".
 */
export class GroupDetails1760193500000 implements MigrationInterface {
  name = 'GroupDetails1760193500000';
  async up(q: QueryRunner) {
    await q.query(`ALTER TABLE chat_groups
      ADD COLUMN description varchar(255),
      ADD COLUMN pinned_message_id uuid REFERENCES group_messages(id) ON DELETE SET NULL,
      ADD COLUMN members_can_add boolean NOT NULL DEFAULT false,
      ADD COLUMN members_can_edit boolean NOT NULL DEFAULT false`);
    await q.query(`ALTER TABLE chat_group_members
      ADD COLUMN role varchar(10) NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
      ADD COLUMN muted boolean NOT NULL DEFAULT false,
      ADD COLUMN added_by uuid REFERENCES users(id) ON DELETE SET NULL`);
    await q.query(`ALTER TABLE group_messages ADD COLUMN event jsonb`);
    // When each person first got / read up to a point in the group: "Seen by Ece · 14:02".
    await q.query(`CREATE TABLE group_read_marks (
      group_id uuid NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind char(1) NOT NULL CHECK (kind IN ('d','r')),
      seq bigint NOT NULL,
      at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (group_id, user_id, kind, seq))`);
  }
  async down(q: QueryRunner) {
    await q.query('DROP TABLE group_read_marks');
    await q.query('ALTER TABLE group_messages DROP COLUMN event');
    await q.query('ALTER TABLE chat_group_members DROP COLUMN role, DROP COLUMN muted, DROP COLUMN added_by');
    await q.query('ALTER TABLE chat_groups DROP COLUMN description, DROP COLUMN pinned_message_id, DROP COLUMN members_can_add, DROP COLUMN members_can_edit');
  }
}
