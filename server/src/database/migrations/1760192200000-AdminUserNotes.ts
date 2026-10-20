import { MigrationInterface, QueryRunner } from 'typeorm';

/** Internal notes staff keep on an account; never visible to the account itself. */
export class AdminUserNotes1760192200000 implements MigrationInterface {
  name = 'AdminUserNotes1760192200000';
  async up(q: QueryRunner) {
    await q.query(`CREATE TABLE admin_user_notes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      author_id uuid REFERENCES users(id) ON DELETE SET NULL,
      body varchar(2000) NOT NULL,
      created_at timestamptz(3) NOT NULL DEFAULT now()
    )`);
    await q.query('CREATE INDEX ix_admin_user_notes ON admin_user_notes(user_id, created_at DESC)');
  }
  async down(q: QueryRunner) {
    await q.query('DROP TABLE admin_user_notes');
  }
}
