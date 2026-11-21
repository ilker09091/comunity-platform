import { MigrationInterface, QueryRunner } from 'typeorm';

/** Every mini game a chat can host. Q&A and Truth or Dare are played with written answers. */
export const GAME_KINDS = ['xox', 'connect4', 'rps', 'memory', 'thisorthat', 'gomoku', 'qa', 'tod'] as const;
export type GameKind = (typeof GAME_KINDS)[number];

const list = (values: readonly string[]) => values.map((v) => `'${v}'`).join(',');

/** Q&A ("what do you mean?" allowed) and Truth or Dare. */
export class TalkGames1760193400000 implements MigrationInterface {
  name = 'TalkGames1760193400000';
  async up(q: QueryRunner) {
    await q.query('ALTER TABLE chat_games DROP CONSTRAINT IF EXISTS chat_games_kind_check');
    await q.query(`ALTER TABLE chat_games ADD CONSTRAINT chat_games_kind_check CHECK (kind IN (${list(GAME_KINDS)}))`);
  }
  async down(q: QueryRunner) {
    await q.query(`DELETE FROM chat_games WHERE kind IN ('qa','tod')`);
    await q.query('ALTER TABLE chat_games DROP CONSTRAINT IF EXISTS chat_games_kind_check');
    await q.query(`ALTER TABLE chat_games ADD CONSTRAINT chat_games_kind_check CHECK (kind IN ('xox','connect4','rps','memory','thisorthat','gomoku'))`);
  }
}
