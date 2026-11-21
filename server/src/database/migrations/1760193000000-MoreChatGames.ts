import { MigrationInterface, QueryRunner } from 'typeorm';

/** Every mini game a chat can host (the first three came with ChatPrefsAndGames). */
export const GAME_KINDS = ['xox', 'connect4', 'rps', 'memory', 'thisorthat', 'gomoku'] as const;
export type GameKind = (typeof GAME_KINDS)[number];

const list = (values: readonly string[]) => values.map((v) => `'${v}'`).join(',');

/** Memory, This or That and Five in a Row; This or That ends as "done" (nobody wins). */
export class MoreChatGames1760193000000 implements MigrationInterface {
  name = 'MoreChatGames1760193000000';
  async up(q: QueryRunner) {
    await q.query('ALTER TABLE chat_games DROP CONSTRAINT IF EXISTS chat_games_kind_check');
    await q.query(`ALTER TABLE chat_games ADD CONSTRAINT chat_games_kind_check CHECK (kind IN (${list(GAME_KINDS)}))`);
    await q.query('ALTER TABLE chat_games DROP CONSTRAINT IF EXISTS chat_games_status_check');
    await q.query(`ALTER TABLE chat_games ADD CONSTRAINT chat_games_status_check CHECK (status IN ('active','won','draw','done'))`);
  }
  async down(q: QueryRunner) {
    await q.query(`DELETE FROM chat_games WHERE kind NOT IN ('xox','connect4','rps') OR status = 'done'`);
    await q.query('ALTER TABLE chat_games DROP CONSTRAINT IF EXISTS chat_games_kind_check');
    await q.query(`ALTER TABLE chat_games ADD CONSTRAINT chat_games_kind_check CHECK (kind IN ('xox','connect4','rps'))`);
    await q.query('ALTER TABLE chat_games DROP CONSTRAINT IF EXISTS chat_games_status_check');
    await q.query(`ALTER TABLE chat_games ADD CONSTRAINT chat_games_status_check CHECK (status IN ('active','won','draw'))`);
  }
}
