import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReelRecommendations1760190400000 implements MigrationInterface {
  name='ReelRecommendations1760190400000';
  async up(q:QueryRunner):Promise<void> {
    await q.query(`CREATE TABLE reel_watch_history (
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      first_viewed_at timestamptz NOT NULL DEFAULT now(), last_viewed_at timestamptz NOT NULL DEFAULT now(),
      watched_ms bigint NOT NULL DEFAULT 0 CHECK(watched_ms>=0), duration_ms integer CHECK(duration_ms>0),
      meaningful_at timestamptz, completion_count integer NOT NULL DEFAULT 0 CHECK(completion_count>=0),
      replay_count integer NOT NULL DEFAULT 0 CHECK(replay_count>=0), skip_count integer NOT NULL DEFAULT 0 CHECK(skip_count>=0),
      last_interaction_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,post_id))`);
    await q.query(`CREATE INDEX ix_reel_history_post_recent ON reel_watch_history(post_id,last_viewed_at DESC) WHERE meaningful_at IS NOT NULL`);
    await q.query(`CREATE INDEX ix_reel_history_viewer_recent ON reel_watch_history(user_id,last_interaction_at DESC)`);
    await q.query(`CREATE INDEX ix_reel_history_quick_skips ON reel_watch_history(user_id,last_interaction_at DESC) WHERE meaningful_at IS NULL AND skip_count>0`);
    await q.query(`CREATE TABLE reel_feedback (
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,post_id))`);
    await q.query(`CREATE INDEX ix_reel_feedback_recent ON reel_feedback(user_id,created_at DESC)`);
    await q.query(`CREATE TABLE reel_recommendation_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '48 hours',
      allow_rewatch boolean NOT NULL DEFAULT false, next_position integer NOT NULL DEFAULT 0,
      last_creator uuid, creator_streak smallint NOT NULL DEFAULT 0)`);
    await q.query(`CREATE INDEX ix_reel_sessions_expiry ON reel_recommendation_sessions(expires_at)`);
    await q.query(`CREATE INDEX ix_reel_sessions_viewer ON reel_recommendation_sessions(user_id,created_at DESC)`);
    await q.query(`CREATE TABLE reel_recommendation_impressions (
      session_id uuid NOT NULL REFERENCES reel_recommendation_sessions(id) ON DELETE CASCADE,
      post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      position integer NOT NULL, score double precision NOT NULL DEFAULT 0, direct boolean NOT NULL DEFAULT false,
      exposed_at timestamptz, started_at timestamptz, last_event_at timestamptz,
      last_sequence integer NOT NULL DEFAULT 0, watched_ms bigint NOT NULL DEFAULT 0,
      duration_ms integer, last_position_ms integer NOT NULL DEFAULT 0, loop_watched_ms integer NOT NULL DEFAULT 0,
      meaningful_at timestamptz, completed boolean NOT NULL DEFAULT false, skipped boolean NOT NULL DEFAULT false,
      PRIMARY KEY(session_id,post_id), UNIQUE(session_id,position))`);
    await q.query(`CREATE INDEX ix_reel_impressions_page ON reel_recommendation_impressions(session_id,position) WHERE direct=false`);
    await q.query(`CREATE INDEX ix_media_video_type ON media(id) WHERE type='VIDEO'`);
    await q.query(`CREATE INDEX ix_posts_reel_candidates ON posts(created_at DESC,id DESC,author_id)
      WHERE deleted_at IS NULL AND kind<>'REPOST' AND moderation_status='ACTIVE'`);
  }
  async down(q:QueryRunner):Promise<void> {
    await q.query(`DROP INDEX ix_posts_reel_candidates`);
    await q.query(`DROP INDEX ix_media_video_type`);
    await q.query(`DROP TABLE reel_recommendation_impressions`);
    await q.query(`DROP TABLE reel_recommendation_sessions`);
    await q.query(`DROP TABLE reel_feedback`);
    await q.query(`DROP TABLE reel_watch_history`);
  }
}
