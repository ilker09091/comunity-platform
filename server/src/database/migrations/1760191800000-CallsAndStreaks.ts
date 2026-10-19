import { MigrationInterface, QueryRunner } from 'typeorm';

export class CallsAndStreaks1760191800000 implements MigrationInterface {
  name = 'CallsAndStreaks1760191800000';
  async up(q: QueryRunner) {
    await q.query(`CREATE TABLE media_private_deletions(path text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE TABLE calls (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      caller_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      callee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('audio','video')),
      state text NOT NULL DEFAULT 'ringing' CHECK (state IN ('ringing','accepted','ended')),
      caller_device uuid NOT NULL, callee_device uuid,
      created_at timestamptz NOT NULL DEFAULT now(), accepted_at timestamptz, ended_at timestamptz,
      caller_seen_at timestamptz NOT NULL DEFAULT now(), callee_seen_at timestamptz,
      end_reason text, CHECK (caller_id <> callee_id)
    )`);
    await q.query(`CREATE INDEX ix_calls_caller_live ON calls(caller_id) WHERE state <> 'ended'`);
    await q.query(`CREATE INDEX ix_calls_callee_live ON calls(callee_id) WHERE state <> 'ended'`);
    await q.query(`CREATE TABLE call_signals (
      id bigserial PRIMARY KEY, call_id uuid NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
      sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('description','ice')), payload text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query('CREATE INDEX ix_call_signals_page ON call_signals(call_id,id)');
    await q.query(`CREATE TABLE message_streaks (
      low_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      high_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      days int NOT NULL DEFAULT 0, last_completed_day date,
      low_sent_day date, high_sent_day date,
      restore_month date, restores_used int NOT NULL DEFAULT 0,
      PRIMARY KEY(low_id,high_id), CHECK(low_id < high_id)
    )`);
    // Count successful sends at the database boundary, including media, post shares and story replies.
    // A deleted/unsent message cannot remove history or let a client manufacture extra days.
    await q.query(`CREATE FUNCTION record_message_streak() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE lo uuid := least(NEW.sender_id,NEW.recipient_id); hi uuid := greatest(NEW.sender_id,NEW.recipient_id);
        today date := (NEW.created_at AT TIME ZONE 'UTC')::date; s message_streaks%ROWTYPE;
      BEGIN
        INSERT INTO message_streaks(low_id,high_id) VALUES(lo,hi) ON CONFLICT DO NOTHING;
        SELECT * INTO s FROM message_streaks WHERE low_id=lo AND high_id=hi FOR UPDATE;
        IF NEW.sender_id=lo THEN s.low_sent_day:=today; ELSE s.high_sent_day:=today; END IF;
        IF s.low_sent_day=today AND s.high_sent_day=today AND s.last_completed_day IS DISTINCT FROM today THEN
          s.days:=CASE WHEN s.last_completed_day>=today-2 THEN s.days+1 ELSE 1 END;
          s.last_completed_day:=today;
        END IF;
        UPDATE message_streaks SET days=s.days,last_completed_day=s.last_completed_day,
          low_sent_day=s.low_sent_day,high_sent_day=s.high_sent_day WHERE low_id=lo AND high_id=hi;
        RETURN NEW;
      END $$`);
    await q.query('CREATE TRIGGER direct_message_streak AFTER INSERT ON direct_messages FOR EACH ROW EXECUTE FUNCTION record_message_streak()');
  }
  async down(q: QueryRunner) {
    await q.query('DROP TRIGGER direct_message_streak ON direct_messages');
    await q.query('DROP FUNCTION record_message_streak()');
    await q.query('DROP TABLE message_streaks, call_signals, calls, media_private_deletions');
  }
}
