import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "Our baby": a virtual child two people raise together in their chat. One person asks with a
 * message, the other accepts; the child then grows with daily care (feeding, playing, talking).
 */
export class OurBaby1760193100000 implements MigrationInterface {
  name = 'OurBaby1760193100000';
  async up(q: QueryRunner) {
    await q.query(`CREATE TABLE babies (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      low_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      high_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name varchar(24) NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 24),
      gender varchar(4) NOT NULL CHECK (gender IN ('girl','boy')),
      status varchar(8) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','declined','ended')),
      requested_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      born_at timestamptz,
      xp integer NOT NULL DEFAULT 0 CHECK (xp >= 0),
      fullness smallint NOT NULL DEFAULT 80 CHECK (fullness BETWEEN 0 AND 100),
      fullness_at timestamptz NOT NULL DEFAULT now(),
      happiness smallint NOT NULL DEFAULT 80 CHECK (happiness BETWEEN 0 AND 100),
      happiness_at timestamptz NOT NULL DEFAULT now(),
      outfit smallint NOT NULL DEFAULT 0 CHECK (outfit BETWEEN 0 AND 5),
      last_bonus_day date,
      CHECK (low_id < high_id))`);
    // One child (or one open request) per couple at a time.
    await q.query(`CREATE UNIQUE INDEX babies_one_per_pair ON babies(low_id, high_id) WHERE status IN ('pending','active')`);
    await q.query(`CREATE TABLE baby_care (
      baby_id uuid NOT NULL REFERENCES babies(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day date NOT NULL,
      feeds smallint NOT NULL DEFAULT 0,
      plays smallint NOT NULL DEFAULT 0,
      chats smallint NOT NULL DEFAULT 0,
      games smallint NOT NULL DEFAULT 0,
      xp integer NOT NULL DEFAULT 0,
      PRIMARY KEY (baby_id, user_id, day))`);
    await q.query('ALTER TABLE direct_messages ADD COLUMN baby_id uuid REFERENCES babies(id) ON DELETE SET NULL');
    await q.query('CREATE INDEX direct_messages_baby ON direct_messages(baby_id) WHERE baby_id IS NOT NULL');
  }
  async down(q: QueryRunner) {
    await q.query('ALTER TABLE direct_messages DROP COLUMN baby_id');
    await q.query('DROP TABLE baby_care');
    await q.query('DROP TABLE babies');
  }
}
