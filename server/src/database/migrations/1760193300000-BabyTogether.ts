import { MigrationInterface, QueryRunner } from 'typeorm';

/** "Our baby" together: who is with the child right now (and where), and little signals between parents. */
export class BabyTogether1760193300000 implements MigrationInterface {
  name = 'BabyTogether1760193300000';
  async up(q: QueryRunner) {
    await q.query(`ALTER TABLE babies
      ADD COLUMN here_low_at timestamptz,
      ADD COLUMN here_high_at timestamptz,
      ADD COLUMN here_low_scene varchar(12),
      ADD COLUMN here_high_scene varchar(12)`);
    await q.query(`CREATE TABLE baby_signals (
      id bigserial PRIMARY KEY,
      baby_id uuid NOT NULL REFERENCES babies(id) ON DELETE CASCADE,
      from_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind varchar(8) NOT NULL CHECK (kind IN ('heart','wave','kiss','star')),
      created_at timestamptz NOT NULL DEFAULT now())`);
    await q.query('CREATE INDEX baby_signals_baby ON baby_signals(baby_id, id)');
  }
  async down(q: QueryRunner) {
    await q.query('DROP TABLE baby_signals');
    await q.query('ALTER TABLE babies DROP COLUMN here_low_at, DROP COLUMN here_high_at, DROP COLUMN here_low_scene, DROP COLUMN here_high_scene');
  }
}
