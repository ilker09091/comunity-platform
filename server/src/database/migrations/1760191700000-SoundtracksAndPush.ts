import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reel music that waits for its video to finish processing, audio clips uploaded in pieces,
 * and Web Push subscriptions (with the server's own VAPID key pair).
 */
export class SoundtracksAndPush1760191700000 implements MigrationInterface {
  name = 'SoundtracksAndPush1760191700000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE audio_uploads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      path text NOT NULL,
      duration_ms int NOT NULL,
      created_at timestamptz(3) NOT NULL DEFAULT now()
    )`);
    await q.query(`CREATE TABLE media_soundtracks (
      media_id uuid PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
      audio_id uuid NOT NULL REFERENCES audio_uploads(id) ON DELETE CASCADE,
      mix boolean NOT NULL DEFAULT false,
      created_at timestamptz(3) NOT NULL DEFAULT now()
    )`);
    await q.query(`CREATE TABLE push_subscriptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint text NOT NULL UNIQUE,
      p256dh text,
      auth text,
      created_at timestamptz(3) NOT NULL DEFAULT now(),
      last_success_at timestamptz(3)
    )`);
    await q.query('CREATE INDEX ix_push_subscriptions_user ON push_subscriptions(user_id)');
    await q.query(`CREATE TABLE push_vapid_keys (
      id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      public_key text NOT NULL,
      private_key text NOT NULL,
      created_at timestamptz(3) NOT NULL DEFAULT now()
    )`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE push_vapid_keys, push_subscriptions, media_soundtracks, audio_uploads');
  }
}
