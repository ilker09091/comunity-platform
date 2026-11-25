/** Shared pieces of the in-chat mini games (rules live in games.ts and games-extra.ts). */

export type GameMove = { cell?: number; choice?: string; action?: string; text?: string };
export type GameStatus = 'active' | 'won' | 'draw' | 'done';

/** An illegal move: the message is shown to the player. */
export class GameRuleError extends Error {}

export const TEXT_MAX = 300;

/** Written moves: trimmed, never empty, never longer than `max`. */
export function written(text: string | undefined, max = TEXT_MAX) {
  const t = (text ?? '').trim();
  if (!t) throw new GameRuleError('Write something first');
  if (t.length > max) throw new GameRuleError(`Keep it under ${max} characters`);
  return t;
}

export function shuffle<T>(items: T[], random: () => number) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Who has more: the winner's index, or null for a tie. */
export function leader(scores: number[]) {
  return scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1;
}
