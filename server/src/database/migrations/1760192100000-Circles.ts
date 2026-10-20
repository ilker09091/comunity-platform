import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Circles: small private groups (3–30 people) with a shared streak, a daily question whose
 * answers unlock after you answer, time-boxed shared albums and a group feed.
 */
export class Circles1760192100000 implements MigrationInterface {
  name = 'Circles1760192100000';
  async up(q: QueryRunner) {
    await q.query(`CREATE TABLE circles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name varchar(40) NOT NULL,
      emoji varchar(16) NOT NULL,
      color varchar(7) NOT NULL CHECK (color ~ '^#[0-9a-f]{6}$'),
      description varchar(160),
      kind varchar(8) NOT NULL DEFAULT 'friends' CHECK (kind IN ('friends','class','club')),
      invite_code varchar(10) NOT NULL UNIQUE,
      members_can_invite boolean NOT NULL DEFAULT true,
      streak_rule varchar(4) NOT NULL DEFAULT 'auto' CHECK (streak_rule IN ('auto','all','most','half')),
      streak_days int NOT NULL DEFAULT 0,
      best_streak int NOT NULL DEFAULT 0,
      last_completed_day date,
      created_at timestamptz(3) NOT NULL DEFAULT now()
    )`);
    await q.query(`CREATE TABLE circle_members (
      circle_id uuid NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role varchar(6) NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
      joined_at timestamptz(3) NOT NULL DEFAULT now(),
      last_seen_at timestamptz(3) NOT NULL DEFAULT now(),
      PRIMARY KEY (circle_id, user_id)
    )`);
    await q.query(`CREATE UNIQUE INDEX ux_circle_owner ON circle_members(circle_id) WHERE role = 'owner'`);
    await q.query('CREATE INDEX ix_circle_members_user ON circle_members(user_id, joined_at)');
    await q.query(`CREATE TABLE circle_prompts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      circle_id uuid NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
      day date NOT NULL,
      kind varchar(5) NOT NULL CHECK (kind IN ('text','photo','poll')),
      text varchar(200) NOT NULL,
      options jsonb CHECK (options IS NULL OR jsonb_typeof(options) = 'array'),
      author_id uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz(3) NOT NULL DEFAULT now(),
      UNIQUE (circle_id, day)
    )`);
    await q.query(`CREATE TABLE circle_albums (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      circle_id uuid NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
      title varchar(60) NOT NULL,
      created_by uuid REFERENCES users(id) ON DELETE SET NULL,
      closes_at timestamptz(3) NOT NULL,
      created_at timestamptz(3) NOT NULL DEFAULT now()
    )`);
    await q.query('CREATE INDEX ix_circle_albums ON circle_albums(circle_id, created_at DESC, id DESC)');
    // A deleted photo/video takes its post with it; text-only posts stay.
    await q.query(`CREATE TABLE circle_posts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      circle_id uuid NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
      author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      prompt_id uuid REFERENCES circle_prompts(id) ON DELETE CASCADE,
      album_id uuid REFERENCES circle_albums(id) ON DELETE CASCADE,
      content varchar(1000),
      media_id uuid UNIQUE REFERENCES media(id) ON DELETE CASCADE,
      poll_choice smallint CHECK (poll_choice BETWEEN 0 AND 5),
      created_at timestamptz(3) NOT NULL DEFAULT now(),
      CHECK (content IS NOT NULL OR media_id IS NOT NULL OR poll_choice IS NOT NULL),
      CHECK (prompt_id IS NULL OR album_id IS NULL)
    )`);
    await q.query('CREATE UNIQUE INDEX ux_circle_answer ON circle_posts(prompt_id, author_id) WHERE prompt_id IS NOT NULL');
    await q.query('CREATE INDEX ix_circle_feed ON circle_posts(circle_id, created_at DESC, id DESC) WHERE prompt_id IS NULL AND album_id IS NULL');
    await q.query('CREATE INDEX ix_circle_album_items ON circle_posts(album_id, created_at DESC, id DESC) WHERE album_id IS NOT NULL');
    await q.query('CREATE INDEX ix_circle_posts_author ON circle_posts(author_id)');
    // Who did something for the circle on each UTC day; drives the shared streak.
    await q.query(`CREATE TABLE circle_activity (
      circle_id uuid NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
      day date NOT NULL,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (circle_id, day, user_id)
    )`);
    // Leaving or account deletion never strands a circle: the longest-standing admin (else member)
    // becomes owner, and a circle whose last member leaves is removed.
    await q.query(`CREATE FUNCTION circle_member_left() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.role = 'owner' AND EXISTS (SELECT 1 FROM circles WHERE id = OLD.circle_id) THEN
          UPDATE circle_members SET role = 'owner'
           WHERE (circle_id, user_id) = (
             SELECT circle_id, user_id FROM circle_members WHERE circle_id = OLD.circle_id
              ORDER BY (role = 'admin') DESC, joined_at, user_id LIMIT 1);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM circle_members WHERE circle_id = OLD.circle_id) THEN
          DELETE FROM circles WHERE id = OLD.circle_id;
        END IF;
        RETURN OLD;
      END $$`);
    await q.query(`CREATE TRIGGER circle_member_left AFTER DELETE ON circle_members
      FOR EACH ROW EXECUTE FUNCTION circle_member_left()`);
  }
  async down(q: QueryRunner) {
    await q.query('DROP TRIGGER circle_member_left ON circle_members');
    await q.query('DROP FUNCTION circle_member_left()');
    // Media rows are left for the hourly orphan cleanup once nothing references them.
    await q.query('DROP TABLE circle_activity, circle_posts, circle_albums, circle_prompts, circle_members, circles');
  }
}
