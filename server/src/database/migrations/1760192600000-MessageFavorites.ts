import { MigrationInterface, QueryRunner } from 'typeorm';

/** Starred direct messages: private to the person who starred them. */
export class MessageFavorites1760192600000 implements MigrationInterface {
  name='MessageFavorites1760192600000';
  async up(q:QueryRunner) {
    await q.query(`CREATE TABLE message_favorites (
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message_id uuid NOT NULL REFERENCES direct_messages(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, message_id))`);
    await q.query('CREATE INDEX message_favorites_user_recent ON message_favorites(user_id, created_at DESC, message_id DESC)');
    await q.query('CREATE INDEX message_favorites_message ON message_favorites(message_id)');
    // Shared-media tab: attachments of one conversation, newest first.
    await q.query(`CREATE INDEX direct_messages_pair_media ON direct_messages(least(sender_id, recipient_id), greatest(sender_id, recipient_id), created_at DESC, id DESC)
      WHERE (media_id IS NOT NULL AND NOT view_once) OR gif IS NOT NULL`);
  }
  async down(q:QueryRunner) {
    await q.query('DROP INDEX IF EXISTS direct_messages_pair_media');
    await q.query('DROP TABLE message_favorites');
  }
}
