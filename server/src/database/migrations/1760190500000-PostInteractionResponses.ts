import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Real responses to interactive posts (`[poll:…]`, `[quiz:…]`, `[slider:…]` tags): one response per
 * user and widget. Poll/quiz store the chosen option index, sliders a value from 0 to 100.
 */
export class PostInteractionResponses1760190500000 implements MigrationInterface {
  name = 'PostInteractionResponses1760190500000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE post_interaction_responses (
        post_id    uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind       text NOT NULL CHECK (kind IN ('POLL', 'QUIZ', 'SLIDER')),
        value      smallint NOT NULL CHECK (value BETWEEN 0 AND 100),
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (post_id, kind, user_id)
      )`);
    await q.query(`CREATE INDEX ix_interaction_responses_user ON post_interaction_responses (user_id)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS post_interaction_responses`);
  }
}
