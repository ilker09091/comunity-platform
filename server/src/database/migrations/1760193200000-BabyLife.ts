import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "Our baby", part two: baths and bedtime, colds, a shared piggy bank with a shop, a room to
 * decorate (with a photo of the parents), first words learned from the chat and a memory book.
 */
export class BabyLife1760193200000 implements MigrationInterface {
  name = 'BabyLife1760193200000';
  async up(q: QueryRunner) {
    await q.query(`ALTER TABLE babies
      ADD COLUMN coins integer NOT NULL DEFAULT 0 CHECK (coins >= 0),
      ADD COLUMN clean smallint NOT NULL DEFAULT 90 CHECK (clean BETWEEN 0 AND 100),
      ADD COLUMN clean_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN energy smallint NOT NULL DEFAULT 90 CHECK (energy BETWEEN 0 AND 100),
      ADD COLUMN energy_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN asleep_at timestamptz,
      ADD COLUMN sick_since timestamptz,
      ADD COLUMN medicine_by uuid[] NOT NULL DEFAULT '{}',
      ADD COLUMN medicine_at timestamptz,
      ADD COLUMN owned text[] NOT NULL DEFAULT '{}',
      ADD COLUMN decor jsonb NOT NULL DEFAULT '{}',
      ADD COLUMN photo_message_id uuid REFERENCES direct_messages(id) ON DELETE SET NULL,
      ADD COLUMN hug_low_at timestamptz,
      ADD COLUMN hug_high_at timestamptz,
      ADD COLUMN last_hug_day date,
      ADD COLUMN family_hugs integer NOT NULL DEFAULT 0,
      ADD COLUMN last_word_day date`);
    await q.query(`ALTER TABLE baby_care
      ADD COLUMN baths smallint NOT NULL DEFAULT 0,
      ADD COLUMN sleeps smallint NOT NULL DEFAULT 0`);
    await q.query(`CREATE TABLE baby_words (
      baby_id uuid NOT NULL REFERENCES babies(id) ON DELETE CASCADE,
      word varchar(24) NOT NULL,
      taught_by uuid REFERENCES users(id) ON DELETE SET NULL,
      learned_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (baby_id, word))`);
    await q.query(`CREATE TABLE baby_moments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      baby_id uuid NOT NULL REFERENCES babies(id) ON DELETE CASCADE,
      kind varchar(16) NOT NULL,
      data jsonb NOT NULL DEFAULT '{}',
      by_id uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now())`);
    await q.query('CREATE INDEX baby_moments_baby ON baby_moments(baby_id, created_at DESC)');
    // Children born before this get their birth as the first page of the memory book.
    await q.query(`INSERT INTO baby_moments(baby_id, kind, data, created_at)
      SELECT id, 'born', jsonb_build_object('stage', 1, 'outfit', 0), born_at FROM babies WHERE born_at IS NOT NULL`);
  }
  async down(q: QueryRunner) {
    await q.query('DROP TABLE baby_moments');
    await q.query('DROP TABLE baby_words');
    await q.query('ALTER TABLE baby_care DROP COLUMN baths, DROP COLUMN sleeps');
    await q.query(`ALTER TABLE babies DROP COLUMN coins, DROP COLUMN clean, DROP COLUMN clean_at, DROP COLUMN energy,
      DROP COLUMN energy_at, DROP COLUMN asleep_at, DROP COLUMN sick_since, DROP COLUMN medicine_by, DROP COLUMN medicine_at,
      DROP COLUMN owned, DROP COLUMN decor, DROP COLUMN photo_message_id, DROP COLUMN hug_low_at, DROP COLUMN hug_high_at,
      DROP COLUMN last_hug_day, DROP COLUMN family_hugs, DROP COLUMN last_word_day`);
  }
}
