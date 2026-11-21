import { MigrationInterface, QueryRunner } from 'typeorm';

/** `graceDays` is how many missed UTC days a streak survives: 0 is TikTok's rule (every day). */
const streakFunction = (graceDays: number) => `CREATE OR REPLACE FUNCTION record_message_streak() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE lo uuid := least(NEW.sender_id,NEW.recipient_id); hi uuid := greatest(NEW.sender_id,NEW.recipient_id);
        today date := (NEW.created_at AT TIME ZONE 'UTC')::date; s message_streaks%ROWTYPE;
      BEGIN
        IF NEW.call_id IS NOT NULL THEN RETURN NEW; END IF;
        INSERT INTO message_streaks(low_id,high_id) VALUES(lo,hi) ON CONFLICT DO NOTHING;
        SELECT * INTO s FROM message_streaks WHERE low_id=lo AND high_id=hi FOR UPDATE;
        IF NEW.sender_id=lo THEN s.low_sent_day:=today; ELSE s.high_sent_day:=today; END IF;
        IF s.low_sent_day=today AND s.high_sent_day=today AND s.last_completed_day IS DISTINCT FROM today THEN
          s.days:=CASE WHEN s.last_completed_day>=today-${1 + graceDays} THEN s.days+1 ELSE 1 END;
          s.last_completed_day:=today;
        END IF;
        UPDATE message_streaks SET days=s.days,last_completed_day=s.last_completed_day,
          low_sent_day=s.low_sent_day,high_sent_day=s.high_sent_day WHERE low_id=lo AND high_id=hi;
        RETURN NEW;
      END $$`;

export const CHAT_THEMES = ['default', 'ocean', 'sunset', 'forest', 'lavender', 'midnight', 'candy', 'aurora', 'love', 'citrus'] as const;
export type ChatTheme = (typeof CHAT_THEMES)[number];

/**
 * TikTok-style streaks: both people must message on every UTC day (no grace day).
 * Chat themes (Instagram-style): one theme per conversation, shared by both people.
 */
export class StrictStreaksAndChatThemes1760192700000 implements MigrationInterface {
  name = 'StrictStreaksAndChatThemes1760192700000';
  async up(q: QueryRunner) {
    await q.query(streakFunction(0));
    await q.query(`CREATE TABLE conversation_themes (
      low_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      high_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      theme varchar(20) NOT NULL CHECK (theme IN (${CHAT_THEMES.map((t) => `'${t}'`).join(',')})),
      updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (low_id, high_id),
      CHECK (low_id < high_id))`);
  }
  async down(q: QueryRunner) {
    await q.query('DROP TABLE conversation_themes');
    await q.query(streakFunction(1));
  }
}
