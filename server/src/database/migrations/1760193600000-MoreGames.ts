import { MigrationInterface, QueryRunner } from 'typeorm';

/** Every mini game a chat can host. */
export const GAME_KINDS = [
  'xox', 'connect4', 'rps', 'memory', 'thisorthat', 'gomoku', 'qa', 'tod',
  'hangman', 'bulls', 'dots', 'reversi', 'mangala', 'battleship', 'pig', 'wordchain', 'lies', 'nhie', 'knowme', 'story',
] as const;
export type GameKind = (typeof GAME_KINDS)[number];

const list = (values: readonly string[]) => values.map((v) => `'${v}'`).join(',');
const OLD = ['xox', 'connect4', 'rps', 'memory', 'thisorthat', 'gomoku', 'qa', 'tod'];

/**
 * Twelve more games: Hangman, Number Puzzle, Dots and Boxes, Reversi, Mangala, Battleship,
 * Dice Duel, Word Chain, Two Truths and a Lie, Never Have I Ever, How Well Do You Know Me, Story.
 */
export class MoreGames1760193600000 implements MigrationInterface {
  name = 'MoreGames1760193600000';
  async up(q: QueryRunner) {
    await q.query('ALTER TABLE chat_games DROP CONSTRAINT IF EXISTS chat_games_kind_check');
    await q.query(`ALTER TABLE chat_games ADD CONSTRAINT chat_games_kind_check CHECK (kind IN (${list(GAME_KINDS)}))`);
  }
  async down(q: QueryRunner) {
    await q.query(`DELETE FROM chat_games WHERE kind NOT IN (${list(OLD)})`);
    await q.query('ALTER TABLE chat_games DROP CONSTRAINT IF EXISTS chat_games_kind_check');
    await q.query(`ALTER TABLE chat_games ADD CONSTRAINT chat_games_kind_check CHECK (kind IN (${list(OLD)}))`);
  }
}
