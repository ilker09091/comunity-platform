import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotificationsAndReports1760180500000 implements MigrationInterface {
  name = 'CreateNotificationsAndReports1760180500000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TYPE notification_type AS ENUM (
      'NEW_FOLLOWER', 'FOLLOW_REQUEST', 'FOLLOW_ACCEPTED', 'POST_LIKE', 'COMMENT',
      'COMMENT_REPLY', 'COMMENT_LIKE', 'REPOST', 'QUOTE_REPOST')`);
    await q.query(`
      CREATE TABLE notifications (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        recipient_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        actor_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type          notification_type NOT NULL,
        post_id       uuid REFERENCES posts(id) ON DELETE CASCADE,
        comment_id    uuid REFERENCES comments(id) ON DELETE CASCADE,
        dedupe_key    varchar(200) NOT NULL,
        read_at       timestamptz(3),
        created_at    timestamptz(3) NOT NULL DEFAULT now(),
        CONSTRAINT uq_notifications_dedupe UNIQUE (recipient_id, dedupe_key),
        CONSTRAINT ck_notifications_not_self CHECK (recipient_id <> actor_id)
      )`);
    await q.query(`CREATE INDEX ix_notifications_recipient ON notifications (recipient_id, created_at DESC, id DESC)`);
    await q.query(`CREATE INDEX ix_notifications_unread ON notifications (recipient_id) WHERE read_at IS NULL`);

    await q.query(`CREATE TYPE report_target_type AS ENUM ('POST', 'COMMENT', 'USER')`);
    await q.query(`CREATE TYPE report_reason AS ENUM (
      'SPAM', 'HARASSMENT', 'HATE_SPEECH', 'VIOLENCE', 'NUDITY', 'SELF_HARM',
      'MISINFORMATION', 'IMPERSONATION', 'INTELLECTUAL_PROPERTY', 'OTHER')`);
    await q.query(`CREATE TYPE report_status AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED')`);
    // target_id is polymorphic (no FK) so reports survive deletion of the reported entity
    // and remain available for audit.
    await q.query(`
      CREATE TABLE reports (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        reporter_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        target_type      report_target_type NOT NULL,
        target_id        uuid NOT NULL,
        reason           report_reason NOT NULL,
        details          varchar(1000),
        status           report_status NOT NULL DEFAULT 'OPEN',
        resolution_note  varchar(1000),
        resolved_by_id   uuid REFERENCES users(id) ON DELETE SET NULL,
        resolved_at      timestamptz(3),
        created_at       timestamptz(3) NOT NULL DEFAULT now(),
        updated_at       timestamptz(3) NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE UNIQUE INDEX uq_reports_open_per_reporter ON reports (reporter_id, target_type, target_id) WHERE status = 'OPEN'`);
    await q.query(`CREATE INDEX ix_reports_status_created ON reports (status, created_at DESC, id DESC)`);
    await q.query(`CREATE INDEX ix_reports_target ON reports (target_type, target_id)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE reports`);
    await q.query(`DROP TYPE report_status`);
    await q.query(`DROP TYPE report_reason`);
    await q.query(`DROP TYPE report_target_type`);
    await q.query(`DROP TABLE notifications`);
    await q.query(`DROP TYPE notification_type`);
  }
}
