import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Additive enum values for the admin control center. Kept in a migration of their own
 * because PostgreSQL cannot use a newly added enum value inside the same transaction.
 */
export class AdminEnumValues1760190000000 implements MigrationInterface {
  name = 'AdminEnumValues1760190000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'SUPPORT' BEFORE 'MODERATOR'`);
    await q.query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'SUPER_ADMIN' AFTER 'ADMIN'`);
    await q.query(`ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'BANNED' AFTER 'SUSPENDED'`);
    await q.query(`ALTER TYPE moderation_status ADD VALUE IF NOT EXISTS 'HIDDEN' BEFORE 'REMOVED'`);
    await q.query(`ALTER TYPE report_status ADD VALUE IF NOT EXISTS 'IN_REVIEW' AFTER 'OPEN'`);
  }

  /** Enum values cannot be dropped in PostgreSQL: map them back and recreate the old types. */
  async down(q: QueryRunner): Promise<void> {
    const recreate = async (
      type: string,
      values: string[],
      columns: { table: string; column: string; default?: string }[],
    ) => {
      await q.query(`ALTER TYPE ${type} RENAME TO ${type}_old`);
      await q.query(`CREATE TYPE ${type} AS ENUM (${values.map((v) => `'${v}'`).join(', ')})`);
      for (const c of columns) {
        if (c.default) await q.query(`ALTER TABLE ${c.table} ALTER COLUMN ${c.column} DROP DEFAULT`);
        await q.query(`ALTER TABLE ${c.table} ALTER COLUMN ${c.column} TYPE ${type} USING ${c.column}::text::${type}`);
        if (c.default) await q.query(`ALTER TABLE ${c.table} ALTER COLUMN ${c.column} SET DEFAULT '${c.default}'`);
      }
      await q.query(`DROP TYPE ${type}_old`);
    };

    await q.query(`UPDATE users SET role = 'ADMIN' WHERE role = 'SUPER_ADMIN'`);
    await q.query(`UPDATE users SET role = 'USER' WHERE role = 'SUPPORT'`);
    await recreate('user_role', ['USER', 'MODERATOR', 'ADMIN'], [{ table: 'users', column: 'role', default: 'USER' }]);

    await q.query(`UPDATE users SET status = 'SUSPENDED' WHERE status = 'BANNED'`);
    await recreate('user_status', ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'], [{ table: 'users', column: 'status', default: 'ACTIVE' }]);

    await q.query(`UPDATE posts SET moderation_status = 'REMOVED' WHERE moderation_status = 'HIDDEN'`);
    await q.query(`UPDATE comments SET moderation_status = 'REMOVED' WHERE moderation_status = 'HIDDEN'`);
    await recreate('moderation_status', ['ACTIVE', 'REMOVED'], [
      { table: 'posts', column: 'moderation_status', default: 'ACTIVE' },
      { table: 'comments', column: 'moderation_status', default: 'ACTIVE' },
    ]);

    await q.query(`UPDATE reports SET status = 'OPEN' WHERE status = 'IN_REVIEW'`);
    await q.query(`DROP INDEX IF EXISTS uq_reports_open_per_reporter`);
    await recreate('report_status', ['OPEN', 'RESOLVED', 'DISMISSED'], [{ table: 'reports', column: 'status', default: 'OPEN' }]);
    await q.query(`CREATE UNIQUE INDEX uq_reports_open_per_reporter ON reports (reporter_id, target_type, target_id) WHERE status = 'OPEN'`);
  }
}
