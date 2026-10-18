import { MigrationInterface, QueryRunner } from 'typeorm';

/** Built-in sticker pack every user can send (owner_id IS NULL). */
export const SYSTEM_STICKERS: [string, string][] = [
  ['😂', 'Laughing'], ['😍', 'Love eyes'], ['🥹', 'Touched'], ['😎', 'Cool'],
  ['🤩', 'Star struck'], ['😭', 'Crying'], ['😡', 'Angry'], ['🤯', 'Mind blown'],
  ['🥳', 'Party'], ['😴', 'Sleepy'], ['🤔', 'Thinking'], ['🙈', 'See no evil'],
  ['❤️', 'Heart'], ['🔥', 'Fire'], ['💯', 'Hundred'], ['👏', 'Clap'],
  ['🙌', 'Raised hands'], ['👍', 'Thumbs up'], ['🎉', 'Celebrate'], ['✨', 'Sparkles'],
  ['👀', 'Eyes'], ['💀', 'Skull'], ['🫶', 'Heart hands'], ['🌹', 'Rose'],
];

/**
 * Story likes and replies, explicit message-request acceptance, and comment stickers
 * (a built-in pack plus stickers users create from their own images).
 */
export class StoryEngagementRequestsStickers1760191400000 implements MigrationInterface {
  name = 'StoryEngagementRequestsStickers1760191400000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE story_likes (
      story_id uuid NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at timestamptz(3) NOT NULL DEFAULT now(), PRIMARY KEY(story_id, user_id)
    )`);
    await q.query(
      'CREATE INDEX ix_story_views_story ON story_views(story_id, created_at DESC)',
    );
    await q.query(`ALTER TABLE direct_messages
      ADD COLUMN story_id uuid REFERENCES stories(id) ON DELETE SET NULL,
      ADD COLUMN story_reply boolean NOT NULL DEFAULT false`);
    await q.query(`CREATE TABLE message_request_acceptances (
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      peer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at timestamptz(3) NOT NULL DEFAULT now(), PRIMARY KEY(user_id, peer_id),
      CHECK (user_id <> peer_id)
    )`);
    await q.query(`CREATE TABLE stickers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid REFERENCES users(id) ON DELETE CASCADE,
      media_id uuid UNIQUE REFERENCES media(id) ON DELETE CASCADE,
      emoji varchar(16),
      name varchar(40) NOT NULL,
      position int NOT NULL DEFAULT 0,
      created_at timestamptz(3) NOT NULL DEFAULT now(),
      deleted_at timestamptz(3),
      CONSTRAINT ck_stickers_source CHECK ((media_id IS NULL) <> (emoji IS NULL)),
      CONSTRAINT ck_stickers_system_emoji CHECK ((owner_id IS NULL) = (emoji IS NOT NULL))
    )`);
    await q.query(
      'CREATE INDEX ix_stickers_owner ON stickers(owner_id, created_at DESC) WHERE deleted_at IS NULL',
    );
    for (const [i, [emoji, name]] of SYSTEM_STICKERS.entries())
      await q.query(
        'INSERT INTO stickers(emoji, name, position) VALUES ($1, $2, $3)',
        [emoji, name, i],
      );
    // has_sticker survives the sticker itself, so a sticker-only comment stays valid if it goes.
    await q.query(`ALTER TABLE comments
      ADD COLUMN sticker_id uuid REFERENCES stickers(id) ON DELETE SET NULL,
      ADD COLUMN has_sticker boolean NOT NULL DEFAULT false`);
    await q.query('ALTER TABLE comments DROP CONSTRAINT ck_comments_content_length');
    await q.query(`ALTER TABLE comments ADD CONSTRAINT ck_comments_content_length CHECK (
      char_length(content) <= 10000 AND (char_length(content) >= 1 OR deleted_at IS NOT NULL OR has_sticker)
    )`);
    await q.query(
      'CREATE INDEX ix_comments_sticker ON comments(sticker_id) WHERE sticker_id IS NOT NULL',
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(
      "DELETE FROM comments WHERE content = '' AND deleted_at IS NULL AND has_sticker",
    );
    await q.query('ALTER TABLE comments DROP CONSTRAINT ck_comments_content_length');
    await q.query(`ALTER TABLE comments ADD CONSTRAINT ck_comments_content_length CHECK (
      (deleted_at IS NOT NULL AND content = '') OR char_length(content) BETWEEN 1 AND 10000
    )`);
    await q.query('ALTER TABLE comments DROP COLUMN sticker_id, DROP COLUMN has_sticker');
    await q.query('DROP TABLE stickers, message_request_acceptances, story_likes');
    await q.query(
      'ALTER TABLE direct_messages DROP COLUMN story_id, DROP COLUMN story_reply',
    );
    await q.query('DROP INDEX ix_story_views_story');
  }
}
