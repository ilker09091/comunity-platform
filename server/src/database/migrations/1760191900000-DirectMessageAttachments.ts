import { MigrationInterface, QueryRunner } from 'typeorm';

export class DirectMessageAttachments1760191900000 implements MigrationInterface {
  name = 'DirectMessageAttachments1760191900000';
  async up(q: QueryRunner) {
    await q.query('UPDATE direct_messages SET delivered_at=read_at WHERE read_at IS NOT NULL AND delivered_at IS NULL');
    await q.query('CREATE INDEX ix_messages_delivery_pending ON direct_messages(recipient_id,created_at,id) WHERE delivered_at IS NULL');
    await q.query(`CREATE TABLE sticker_favorites (
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sticker_id uuid NOT NULL REFERENCES stickers(id) ON DELETE CASCADE,
      created_at timestamptz(3) NOT NULL DEFAULT now(), PRIMARY KEY(user_id, sticker_id)
    )`);
    await q.query(`CREATE TABLE message_audio_uploads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      storage_key text NOT NULL UNIQUE, duration_ms int NOT NULL CHECK(duration_ms BETWEEN 250 AND 120100),
      created_at timestamptz(3) NOT NULL DEFAULT now()
    )`);
    await q.query(`ALTER TABLE direct_messages
      ADD COLUMN sticker_id uuid REFERENCES stickers(id) ON DELETE SET NULL,
      ADD COLUMN has_sticker boolean NOT NULL DEFAULT false,
      ADD COLUMN audio_key text UNIQUE,
      ADD COLUMN audio_duration_ms int`);
    await q.query('CREATE INDEX ix_messages_sticker ON direct_messages(sticker_id) WHERE sticker_id IS NOT NULL');
    await q.query(`CREATE FUNCTION queue_message_audio_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.audio_key IS NOT NULL THEN
          INSERT INTO media_file_deletions(storage_key) VALUES(OLD.audio_key) ON CONFLICT DO NOTHING;
        END IF;
        RETURN OLD;
      END;
    $$`);
    await q.query(`CREATE TRIGGER message_audio_deletion AFTER DELETE ON direct_messages
      FOR EACH ROW EXECUTE FUNCTION queue_message_audio_deletion()`);
    await q.query(`CREATE FUNCTION queue_staged_message_audio_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT EXISTS(SELECT 1 FROM direct_messages WHERE audio_key=OLD.storage_key) THEN
          INSERT INTO media_file_deletions(storage_key) VALUES(OLD.storage_key) ON CONFLICT DO NOTHING;
        END IF;
        RETURN OLD;
      END;
    $$`);
    await q.query(`CREATE TRIGGER staged_message_audio_deletion AFTER DELETE ON message_audio_uploads
      FOR EACH ROW EXECUTE FUNCTION queue_staged_message_audio_deletion()`);
  }
  async down(q: QueryRunner) {
    await q.query('DROP INDEX ix_messages_delivery_pending');
    // Queue files before dropping references, including clips belonging to deleted accounts.
    await q.query(`INSERT INTO media_file_deletions(storage_key)
      SELECT audio_key FROM direct_messages WHERE audio_key IS NOT NULL
      UNION SELECT storage_key FROM message_audio_uploads ON CONFLICT DO NOTHING`);
    await q.query('DROP TRIGGER message_audio_deletion ON direct_messages');
    await q.query('DROP FUNCTION queue_message_audio_deletion()');
    await q.query('ALTER TABLE direct_messages DROP COLUMN sticker_id, DROP COLUMN has_sticker, DROP COLUMN audio_key, DROP COLUMN audio_duration_ms');
    await q.query('DROP TABLE message_audio_uploads, sticker_favorites');
    await q.query('DROP FUNCTION queue_staged_message_audio_deletion()');
  }
}
