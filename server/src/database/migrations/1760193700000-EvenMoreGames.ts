import { MigrationInterface, QueryRunner } from 'typeorm';

/** Every mini game a chat can host. */
export const GAME_KINDS = [
  'xox', 'connect4', 'rps', 'memory', 'thisorthat', 'gomoku', 'qa', 'tod',
  'hangman', 'bulls', 'dots', 'reversi', 'mangala', 'battleship', 'pig', 'wordchain', 'lies', 'nhie', 'knowme', 'story',
  'lovemap', 'daily', 'whomore', 'bucket', 'colorword', 'emoji', 'sudoku', 'wordsearch', 'pisti', 'coin', 'wheel', 'dama', 'tavla', 'chess',
] as const;
export type GameKind = (typeof GAME_KINDS)[number];

const list = (values: readonly string[]) => values.map((v) => `'${v}'`).join(',');
const BEFORE = GAME_KINDS.slice(0, 20);

/**
 * Fourteen more games: Love Map, Question of the Day, Who's More Likely, Bucket List, Color Word,
 * Emoji Riddle, Sudoku Duel, Word Search, Pişti, Coin Toss, Spin the Wheel, Dama, Tavla, Chess.
 */
export class EvenMoreGames1760193700000 implements MigrationInterface {
  name = 'EvenMoreGames1760193700000';
  async up(q: QueryRunner) {
    await q.query('ALTER TABLE chat_games DROP CONSTRAINT IF EXISTS chat_games_kind_check');
    await q.query(`ALTER TABLE chat_games ADD CONSTRAINT chat_games_kind_check CHECK (kind IN (${list(GAME_KINDS)}))`);
  }
  async down(q: QueryRunner) {
    await q.query(`DELETE FROM chat_games WHERE kind NOT IN (${list(BEFORE)})`);
    await q.query('ALTER TABLE chat_games DROP CONSTRAINT IF EXISTS chat_games_kind_check');
    await q.query(`ALTER TABLE chat_games ADD CONSTRAINT chat_games_kind_check CHECK (kind IN (${list(BEFORE)}))`);
  }
}
