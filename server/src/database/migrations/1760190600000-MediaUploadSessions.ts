import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Resumable, chunked uploads. Large phone videos are sent in small pieces so no single request
 * exceeds a reverse proxy's body limit, and an interrupted upload continues where it stopped.
 */
export class MediaUploadSessions1760190600000 implements MigrationInterface {
  name = 'MediaUploadSessions1760190600000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE media_upload_sessions (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        file_name  text NOT NULL,
        size       bigint NOT NULL CHECK (size > 0),
        received   bigint NOT NULL DEFAULT 0 CHECK (received >= 0 AND received <= size),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX ix_media_upload_sessions_owner ON media_upload_sessions (owner_id)`);
    await q.query(`CREATE INDEX ix_media_upload_sessions_updated ON media_upload_sessions (updated_at)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS media_upload_sessions`);
  }
}
