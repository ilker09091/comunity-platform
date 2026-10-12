import type {MigrationInterface,QueryRunner} from 'typeorm';
/** Additive state: persistent history survives cycles, existing sessions and content remain intact. */
export class ReelSmartState1760191100000 implements MigrationInterface {
 name='ReelSmartState1760191100000';
 async up(q:QueryRunner):Promise<void> {
  await q.query(`ALTER TABLE reel_watch_history ADD COLUMN first_exposed_at timestamptz,ADD COLUMN last_exposed_at timestamptz,ADD COLUMN impression_count integer NOT NULL DEFAULT 0,ADD COLUMN first_started_at timestamptz,ADD COLUMN last_started_at timestamptz`);
  // Legacy playback aggregates prove playback, unlike legacy prefetched session rows.
  await q.query(`UPDATE reel_watch_history SET first_started_at=first_viewed_at,last_started_at=last_viewed_at`);
  await q.query(`ALTER TABLE reel_recommendation_impressions ADD COLUMN delivered_at timestamptz,ADD COLUMN activated_at timestamptz`);
  await q.query(`UPDATE reel_recommendation_impressions SET exposed_at=NULL WHERE started_at IS NULL`);
  await q.query(`ALTER TABLE reel_recommendation_sessions ADD COLUMN ranking_version integer NOT NULL DEFAULT 2`);
  await q.query(`CREATE INDEX ix_reel_history_exposure ON reel_watch_history(user_id,last_exposed_at DESC) WHERE last_exposed_at IS NOT NULL`);
  await q.query(`CREATE INDEX ix_reel_impressions_exposed ON reel_recommendation_impressions(session_id,post_id,exposed_at DESC) WHERE exposed_at IS NOT NULL`);
  await q.query(`CREATE INDEX ix_reel_likes_user_recent ON post_likes(user_id,created_at DESC,post_id)`);
 }
 async down(q:QueryRunner):Promise<void> {
  await q.query('DROP INDEX ix_reel_likes_user_recent');await q.query('DROP INDEX ix_reel_impressions_exposed');await q.query('DROP INDEX ix_reel_history_exposure');
  await q.query('ALTER TABLE reel_recommendation_sessions DROP COLUMN ranking_version');
  await q.query('ALTER TABLE reel_recommendation_impressions DROP COLUMN delivered_at,DROP COLUMN activated_at');
  await q.query('ALTER TABLE reel_watch_history DROP COLUMN first_exposed_at,DROP COLUMN last_exposed_at,DROP COLUMN impression_count,DROP COLUMN first_started_at,DROP COLUMN last_started_at');
 }
}
