import { MigrationInterface, QueryRunner } from 'typeorm';

export class AdminControlCenter1760190100000 implements MigrationInterface {
  name = 'AdminControlCenter1760190100000';

  async up(q: QueryRunner): Promise<void> {
    // ---- Activity tracking (forward-only; no historical backfill is fabricated) ----
    await q.query(`ALTER TABLE users ADD COLUMN last_active_at timestamptz(3)`);
    await q.query(`CREATE INDEX ix_users_last_active ON users (last_active_at) WHERE last_active_at IS NOT NULL`);
    await q.query(`CREATE INDEX ix_users_created ON users (created_at DESC, id DESC)`);
    await q.query(`CREATE INDEX ix_users_staff ON users (role) WHERE role <> 'USER'`);
    await q.query(`CREATE INDEX ix_users_restricted ON users (status) WHERE status <> 'ACTIVE'`);
    await q.query(`
      CREATE TABLE user_daily_activity (
        day      date NOT NULL,
        user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT pk_user_daily_activity PRIMARY KEY (day, user_id)
      )`);

    // ---- Account restrictions and warnings ----
    await q.query(`CREATE TYPE restriction_type AS ENUM ('SUSPENSION', 'BAN')`);
    await q.query(`
      CREATE TABLE account_restrictions (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type           restriction_type NOT NULL,
        reason         varchar(1000) NOT NULL,
        starts_at      timestamptz(3) NOT NULL DEFAULT now(),
        expires_at     timestamptz(3),
        created_by_id  uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at     timestamptz(3) NOT NULL DEFAULT now(),
        lifted_at      timestamptz(3),
        lifted_by_id   uuid REFERENCES users(id) ON DELETE SET NULL,
        lift_reason    varchar(1000),
        CONSTRAINT ck_restrictions_expiry CHECK (expires_at IS NULL OR expires_at > starts_at),
        CONSTRAINT ck_restrictions_ban_no_expiry CHECK (type = 'SUSPENSION' OR expires_at IS NULL)
      )`);
    await q.query(`CREATE INDEX ix_restrictions_user ON account_restrictions (user_id, created_at DESC)`);
    await q.query(`CREATE INDEX ix_restrictions_expiring ON account_restrictions (expires_at)
      WHERE lifted_at IS NULL AND expires_at IS NOT NULL`);

    await q.query(`
      CREATE TABLE user_warnings (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reason         report_reason NOT NULL,
        message        varchar(1000) NOT NULL,
        report_id      uuid REFERENCES reports(id) ON DELETE SET NULL,
        created_by_id  uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at     timestamptz(3) NOT NULL DEFAULT now(),
        read_at        timestamptz(3)
      )`);
    await q.query(`CREATE INDEX ix_warnings_user ON user_warnings (user_id, created_at DESC)`);

    // ---- Report workflow ----
    await q.query(`ALTER TABLE reports ADD COLUMN assigned_to_id uuid REFERENCES users(id) ON DELETE SET NULL`);
    await q.query(`CREATE INDEX ix_reports_assigned ON reports (assigned_to_id) WHERE assigned_to_id IS NOT NULL`);
    await q.query(`CREATE INDEX ix_reports_created ON reports (created_at)`);
    await q.query(`CREATE INDEX ix_reports_resolved ON reports (resolved_at) WHERE resolved_at IS NOT NULL`);
    // A report under review still counts as "open" for duplicate prevention.
    await q.query(`DROP INDEX uq_reports_open_per_reporter`);
    await q.query(`CREATE UNIQUE INDEX uq_reports_open_per_reporter ON reports (reporter_id, target_type, target_id)
      WHERE status IN ('OPEN', 'IN_REVIEW')`);
    await q.query(`
      CREATE TABLE report_notes (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        report_id   uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        author_id   uuid REFERENCES users(id) ON DELETE SET NULL,
        body        varchar(2000) NOT NULL,
        created_at  timestamptz(3) NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX ix_report_notes_report ON report_notes (report_id, created_at)`);

    // ---- Audit log (append-only; no FKs so history survives any user deletion) ----
    await q.query(`
      CREATE TABLE admin_audit_logs (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_id     uuid,
        actor_role   varchar(20),
        action       varchar(64) NOT NULL,
        target_type  varchar(32),
        target_id    uuid,
        metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
        request_id   varchar(128),
        ip_address   varchar(64),
        created_at   timestamptz(3) NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX ix_audit_created ON admin_audit_logs (created_at DESC, id DESC)`);
    await q.query(`CREATE INDEX ix_audit_actor ON admin_audit_logs (actor_id, created_at DESC)`);
    await q.query(`CREATE INDEX ix_audit_target ON admin_audit_logs (target_type, target_id, created_at DESC)`);
    await q.query(`CREATE INDEX ix_audit_action ON admin_audit_logs (action, created_at DESC)`);
    await q.query(`
      CREATE FUNCTION admin_audit_logs_append_only() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'admin_audit_logs is append-only';
      END;
      $$ LANGUAGE plpgsql`);
    await q.query(`CREATE TRIGGER trg_admin_audit_logs_append_only BEFORE UPDATE OR DELETE ON admin_audit_logs
      FOR EACH ROW EXECUTE FUNCTION admin_audit_logs_append_only()`);

    // ---- Platform settings ----
    await q.query(`
      CREATE TABLE platform_settings (
        key            varchar(64) PRIMARY KEY,
        value          jsonb NOT NULL,
        updated_by_id  uuid REFERENCES users(id) ON DELETE SET NULL,
        updated_at     timestamptz(3) NOT NULL DEFAULT now()
      )`);

    // ---- Announcements (inbox model: no per-user fan-out for "all users") ----
    await q.query(`CREATE TYPE announcement_audience AS ENUM ('ALL', 'SELECTED')`);
    await q.query(`CREATE TYPE announcement_status AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED')`);
    await q.query(`
      CREATE TABLE announcements (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        title            varchar(120) NOT NULL,
        body             varchar(2000) NOT NULL,
        audience         announcement_audience NOT NULL DEFAULT 'ALL',
        status           announcement_status NOT NULL DEFAULT 'DRAFT',
        recipient_count  integer,
        created_by_id    uuid REFERENCES users(id) ON DELETE SET NULL,
        published_by_id  uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at       timestamptz(3) NOT NULL DEFAULT now(),
        updated_at       timestamptz(3) NOT NULL DEFAULT now(),
        published_at     timestamptz(3),
        archived_at      timestamptz(3)
      )`);
    await q.query(`CREATE INDEX ix_announcements_status ON announcements (status, created_at DESC)`);
    await q.query(`CREATE INDEX ix_announcements_published ON announcements (published_at DESC) WHERE status = 'PUBLISHED'`);
    await q.query(`
      CREATE TABLE announcement_recipients (
        announcement_id  uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
        user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT pk_announcement_recipients PRIMARY KEY (announcement_id, user_id)
      )`);
    await q.query(`CREATE INDEX ix_announcement_recipients_user ON announcement_recipients (user_id)`);
    await q.query(`
      CREATE TABLE announcement_reads (
        announcement_id  uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
        user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        read_at          timestamptz(3) NOT NULL DEFAULT now(),
        CONSTRAINT pk_announcement_reads PRIMARY KEY (announcement_id, user_id)
      )`);

    // ---- Aggregation indexes for dashboards ----
    await q.query(`CREATE INDEX ix_posts_created_all ON posts (created_at)`);
    await q.query(`CREATE INDEX ix_comments_created ON comments (created_at)`);
    await q.query(`CREATE INDEX ix_post_likes_created ON post_likes (created_at)`);
    await q.query(`CREATE INDEX ix_bookmarks_created ON bookmarks (created_at)`);
    await q.query(`CREATE INDEX ix_posts_moderation ON posts (moderation_status) WHERE moderation_status <> 'ACTIVE'`);
    await q.query(`CREATE INDEX ix_comments_moderation ON comments (moderation_status) WHERE moderation_status <> 'ACTIVE'`);
  }

  async down(q: QueryRunner): Promise<void> {
    for (const index of [
      'ix_comments_moderation',
      'ix_posts_moderation',
      'ix_bookmarks_created',
      'ix_post_likes_created',
      'ix_comments_created',
      'ix_posts_created_all',
    ])
      await q.query(`DROP INDEX ${index}`);
    await q.query(`DROP TABLE announcement_reads`);
    await q.query(`DROP TABLE announcement_recipients`);
    await q.query(`DROP TABLE announcements`);
    await q.query(`DROP TYPE announcement_status`);
    await q.query(`DROP TYPE announcement_audience`);
    await q.query(`DROP TABLE platform_settings`);
    await q.query(`DROP TABLE admin_audit_logs`);
    await q.query(`DROP FUNCTION admin_audit_logs_append_only()`);
    await q.query(`DROP TABLE report_notes`);
    await q.query(`UPDATE reports SET status = 'OPEN' WHERE status = 'IN_REVIEW'`);
    await q.query(`DROP INDEX uq_reports_open_per_reporter`);
    await q.query(`CREATE UNIQUE INDEX uq_reports_open_per_reporter ON reports (reporter_id, target_type, target_id) WHERE status = 'OPEN'`);
    await q.query(`DROP INDEX ix_reports_resolved`);
    await q.query(`DROP INDEX ix_reports_created`);
    await q.query(`DROP INDEX ix_reports_assigned`);
    await q.query(`ALTER TABLE reports DROP COLUMN assigned_to_id`);
    await q.query(`DROP TABLE user_warnings`);
    await q.query(`DROP TABLE account_restrictions`);
    await q.query(`DROP TYPE restriction_type`);
    await q.query(`DROP TABLE user_daily_activity`);
    await q.query(`DROP INDEX ix_users_restricted`);
    await q.query(`DROP INDEX ix_users_staff`);
    await q.query(`DROP INDEX ix_users_created`);
    await q.query(`DROP INDEX ix_users_last_active`);
    await q.query(`ALTER TABLE users DROP COLUMN last_active_at`);
  }
}
