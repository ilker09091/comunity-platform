import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * WhatsApp-style delivery ticks, quoted replies, view-once media, typing and online presence
 * for direct messages, plus Instagram-style notes (short text with an optional 15 s song clip).
 */
export class MessagingPresenceNotes1760191500000 implements MigrationInterface {
  name = 'MessagingPresenceNotes1760191500000';
  async up(q: QueryRunner): Promise<void> {
    // users.last_active_at already exists (admin analytics); messaging refreshes it more often.
    await q.query(`ALTER TABLE direct_messages
      ADD COLUMN reply_to_id uuid REFERENCES direct_messages(id) ON DELETE SET NULL,
      ADD COLUMN view_once boolean NOT NULL DEFAULT false,
      ADD COLUMN opened_at timestamptz(3),
      ADD COLUMN delivered_at timestamptz(3)`);
    // Everything sent before ticks existed counts as delivered.
    await q.query('UPDATE direct_messages SET delivered_at = COALESCE(read_at, created_at)');
    await q.query(
      'CREATE INDEX ix_messages_undelivered ON direct_messages(recipient_id) WHERE delivered_at IS NULL',
    );
    await q.query(
      'CREATE INDEX ix_messages_view_once ON direct_messages(opened_at) WHERE view_once AND media_id IS NOT NULL',
    );
    await q.query(`CREATE TABLE typing_status (
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      peer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      updated_at timestamptz(3) NOT NULL DEFAULT now(), PRIMARY KEY(user_id, peer_id)
    )`);
    await q.query(`CREATE TABLE note_audio (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      storage_key varchar(64) NOT NULL UNIQUE,
      duration_ms int NOT NULL,
      created_at timestamptz(3) NOT NULL DEFAULT now()
    )`);
    await q.query(`CREATE TABLE notes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      author_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      text varchar(60) NOT NULL DEFAULT '',
      audio_key varchar(64) UNIQUE,
      audio_duration_ms int,
      song_title varchar(80),
      created_at timestamptz(3) NOT NULL DEFAULT now(),
      expires_at timestamptz(3) NOT NULL DEFAULT (now() + interval '24 hours'),
      CONSTRAINT ck_notes_content CHECK (text <> '' OR audio_key IS NOT NULL)
    )`);
    await q.query('CREATE INDEX ix_notes_expiry ON notes(expires_at)');
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE notes, note_audio, typing_status');
    await q.query('DROP INDEX ix_messages_view_once');
    await q.query('DROP INDEX ix_messages_undelivered');
    await q.query(`ALTER TABLE direct_messages DROP COLUMN reply_to_id, DROP COLUMN view_once,
      DROP COLUMN opened_at, DROP COLUMN delivered_at`);
  }
}
