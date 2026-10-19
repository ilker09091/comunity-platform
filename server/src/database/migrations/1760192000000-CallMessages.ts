import { MigrationInterface, QueryRunner } from 'typeorm';

const streakFunction = (skipCalls: boolean) => `CREATE OR REPLACE FUNCTION record_message_streak() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE lo uuid := least(NEW.sender_id,NEW.recipient_id); hi uuid := greatest(NEW.sender_id,NEW.recipient_id);
        today date := (NEW.created_at AT TIME ZONE 'UTC')::date; s message_streaks%ROWTYPE;
      BEGIN
        ${skipCalls ? 'IF NEW.call_id IS NOT NULL THEN RETURN NEW; END IF;' : ''}
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
      END $$`;

/** Instagram-style call history in the conversation: one message per finished call. */
export class CallMessages1760192000000 implements MigrationInterface {
  name = 'CallMessages1760192000000';
  async up(q: QueryRunner) {
    // No foreign key: call rows are purged after a day, the conversation keeps the record.
    await q.query(`ALTER TABLE direct_messages
      ADD COLUMN call_id uuid UNIQUE,
      ADD COLUMN call_kind varchar(5) CHECK (call_kind IN ('audio','video')),
      ADD COLUMN call_status varchar(10) CHECK (call_status IN ('completed','missed','declined','cancelled')),
      ADD COLUMN call_duration_s int CHECK (call_duration_s >= 0)`);
    // A call log is not a message someone sent; it must not keep a streak alive.
    await q.query(streakFunction(true));
  }
  async down(q: QueryRunner) {
    await q.query(streakFunction(false));
    await q.query('ALTER TABLE direct_messages DROP COLUMN call_id, DROP COLUMN call_kind, DROP COLUMN call_status, DROP COLUMN call_duration_s');
  }
}
