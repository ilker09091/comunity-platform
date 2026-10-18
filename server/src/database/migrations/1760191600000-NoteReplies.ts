import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Replies to notes are direct messages that keep a snapshot of the note (text and song title),
 * because notes are replaced or expire after 24 hours.
 */
export class NoteReplies1760191600000 implements MigrationInterface {
  name = 'NoteReplies1760191600000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE direct_messages
      ADD COLUMN note_reply boolean NOT NULL DEFAULT false,
      ADD COLUMN note_text varchar(60),
      ADD COLUMN note_song varchar(80)`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(
      'ALTER TABLE direct_messages DROP COLUMN note_reply, DROP COLUMN note_text, DROP COLUMN note_song',
    );
  }
}
