import { MigrationInterface, QueryRunner } from 'typeorm';

export class MessagesAndStories1760191200000 implements MigrationInterface {
  name = 'MessagesAndStories1760191200000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE direct_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content varchar(2000),
      media_id uuid UNIQUE REFERENCES media(id) ON DELETE SET NULL,
      post_id uuid REFERENCES posts(id) ON DELETE SET NULL,
      created_at timestamptz(3) NOT NULL DEFAULT now(),
      read_at timestamptz(3), CHECK (sender_id <> recipient_id)
    )`);
    await q.query(
      'CREATE INDEX ix_messages_sender ON direct_messages(sender_id, recipient_id, created_at DESC, id DESC)',
    );
    await q.query(
      'CREATE INDEX ix_messages_recipient ON direct_messages(recipient_id, sender_id, created_at DESC, id DESC)',
    );
    await q.query(
      'CREATE INDEX ix_messages_unread ON direct_messages(recipient_id) WHERE read_at IS NULL',
    );
    await q.query(`CREATE TABLE stories (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      media_id uuid NOT NULL UNIQUE REFERENCES media(id) ON DELETE CASCADE,
      caption varchar(300),
      created_at timestamptz(3) NOT NULL DEFAULT now(),
      expires_at timestamptz(3) NOT NULL DEFAULT (now() + interval '24 hours')
    )`);
    await q.query(
      'CREATE INDEX ix_stories_author ON stories(author_id, created_at DESC, id DESC)',
    );
    await q.query('CREATE INDEX ix_stories_expiry ON stories(expires_at)');
    await q.query(`CREATE TABLE story_views (
      story_id uuid NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at timestamptz(3) NOT NULL DEFAULT now(), PRIMARY KEY(story_id, user_id)
    )`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE story_views, stories, direct_messages');
  }
}
