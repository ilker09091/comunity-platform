import { MigrationInterface, QueryRunner } from 'typeorm';

/** Blue verification badge granted by administrators. Additive; existing accounts start unverified. */
export class VerifiedBadge1760190800000 implements MigrationInterface {
  name = 'VerifiedBadge1760190800000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE users DROP COLUMN IF EXISTS is_verified`);
  }
}
