import { MigrationInterface, QueryRunner } from 'typeorm';

/** Instagram-style reactions: one emoji per person per message. */
export class MessageReactions1760192800000 implements MigrationInterface {
  name = 'MessageReactions1760192800000';
  async up(q: QueryRunner) {
    await q.query(`CREATE TABLE message_reactions (
      message_id uuid NOT NULL REFERENCES direct_messages(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji varchar(16) NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 16),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (message_id, user_id))`);
    await q.query('CREATE INDEX message_reactions_user ON message_reactions(user_id)');
  }
  async down(q: QueryRunner) {
    await q.query('DROP TABLE message_reactions');
  }
}
