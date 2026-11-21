import type { GameKind } from '../../database/migrations/1760193000000-MoreChatGames.js';

/** Pure rules for the in-chat mini games; the service only stores and authorizes. */

export type RpsChoice = 'rock' | 'paper' | 'scissors';
export type TotChoice = 'a' | 'b';
export type BoardState = { board: number[]; line: number[] };
export type RpsState = { picks: (RpsChoice | null)[]; scores: number[]; rounds: { choices: RpsChoice[]; winner: number | null }[] };
/** Memory: `shown` is the last mismatched pair, visible until the next card is turned. */
export type MemoryState = { cards: string[]; owners: number[]; flipped: number[]; shown: number[]; scores: number[] };
export type TotState = { order: number[]; round: number; picks: (TotChoice | null)[]; rounds: { q: number; answers: TotChoice[] }[] };
export type GameState = BoardState | RpsState | MemoryState | TotState;
export type GameStatus = 'active' | 'won' | 'draw' | 'done';

export type Outcome = { state: GameState; next: number | null; status: GameStatus; winner: number | null };

export const C4_COLS = 7;
export const C4_ROWS = 6;
export const GOMOKU_SIZE = 9;
/** Rock-paper-scissors is played to two round wins (best of three, ties replayed). */
export const RPS_TARGET = 2;
export const MEMORY_FACES = ['❤️', '🌹', '🍓', '🧸', '💍', '🍫', '🌙', '⭐'];
export const TOT_ROUNDS = 8;
/** "This or that": both answer in secret, then see whether you think alike. */
export const THIS_OR_THAT: [string, string][] = [
  ['Beach', 'Mountains'],
  ['Coffee', 'Tea'],
  ['Night in', 'Night out'],
  ['Movie', 'Series'],
  ['Sunrise', 'Sunset'],
  ['Cats', 'Dogs'],
  ['Pizza', 'Burger'],
  ['Texting', 'Calling'],
  ['Summer', 'Winter'],
  ['Sweet', 'Salty'],
  ['Road trip', 'Flight'],
  ['Early bird', 'Night owl'],
  ['Comedy', 'Horror'],
  ['Cook together', 'Order in'],
  ['City break', 'Countryside'],
  ['Surprise gift', 'Chosen gift'],
  ['Rain', 'Snow'],
  ['Dancing', 'Karaoke'],
  ['Books', 'Podcasts'],
  ['Breakfast date', 'Dinner date'],
  ['Matching outfits', 'Never'],
  ['Big wedding', 'Small wedding'],
  ['Stargazing', 'Bonfire'],
  ['Chocolate', 'Ice cream'],
];

export class GameRuleError extends Error {}

function shuffle<T>(items: T[], random: () => number) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function initialState(kind: GameKind, random: () => number = Math.random): GameState {
  switch (kind) {
    case 'rps':
      return { picks: [null, null], scores: [0, 0], rounds: [] };
    case 'memory':
      return { cards: shuffle([...MEMORY_FACES, ...MEMORY_FACES], random), owners: new Array(16).fill(0), flipped: [], shown: [], scores: [0, 0] };
    case 'thisorthat':
      return { order: shuffle(THIS_OR_THAT.map((_, i) => i), random).slice(0, TOT_ROUNDS), round: 0, picks: [null, null], rounds: [] };
    case 'gomoku':
      return { board: new Array(GOMOKU_SIZE * GOMOKU_SIZE).fill(0), line: [] };
    case 'connect4':
      return { board: new Array(C4_COLS * C4_ROWS).fill(0), line: [] };
    default:
      return { board: new Array(9).fill(0), line: [] };
  }
}

const XOX_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function xoxLine(board: number[], mark: number) {
  return XOX_LINES.find((line) => line.every((i) => board[i] === mark)) ?? null;
}

/** The run of `need`+ marks through `cell` in any direction, if there is one. */
function lineThrough(board: number[], cols: number, rows: number, cell: number, mark: number, need: number) {
  const row = Math.floor(cell / cols), col = cell % cols;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const line = [cell];
    for (const sign of [1, -1]) {
      for (let r = row + dr * sign, c = col + dc * sign; r >= 0 && r < rows && c >= 0 && c < cols; r += dr * sign, c += dc * sign) {
        if (board[r * cols + c] !== mark) break;
        line.push(r * cols + c);
      }
    }
    if (line.length >= need) return line.sort((a, b) => a - b);
  }
  return null;
}

const BEATS: Record<RpsChoice, RpsChoice> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

/**
 * Applies `player`'s move (index into players). `turn` is whose turn it is in turn-based games.
 * Throws GameRuleError for an illegal move.
 */
export function applyMove(
  kind: GameKind,
  current: GameState,
  player: number,
  turn: number | null,
  move: { cell?: number; choice?: string },
): Outcome {
  if (kind === 'rps') {
    const state = structuredClone(current as RpsState);
    const choice = move.choice as RpsChoice;
    if (!choice || !(choice in BEATS)) throw new GameRuleError('Pick rock, paper or scissors');
    if (state.picks[player]) throw new GameRuleError('You already picked this round');
    state.picks[player] = choice;
    const [a, b] = state.picks;
    if (!a || !b) return { state, next: null, status: 'active', winner: null };
    const winner = a === b ? null : BEATS[a] === b ? 0 : 1;
    state.rounds.push({ choices: [a, b], winner });
    if (winner !== null) state.scores[winner]++;
    state.picks = [null, null];
    const champion = state.scores.findIndex((s) => s >= RPS_TARGET);
    return champion >= 0
      ? { state, next: null, status: 'won', winner: champion }
      : { state, next: null, status: 'active', winner: null };
  }

  if (kind === 'thisorthat') {
    const state = structuredClone(current as TotState);
    const choice = move.choice as TotChoice;
    if (choice !== 'a' && choice !== 'b') throw new GameRuleError('Choose one of the two');
    if (state.picks[player]) throw new GameRuleError('You already answered this one');
    state.picks[player] = choice;
    const [a, b] = state.picks;
    if (!a || !b) return { state, next: null, status: 'active', winner: null };
    state.rounds.push({ q: state.order[state.round], answers: [a, b] });
    state.round++;
    state.picks = [null, null];
    return { state, next: null, status: state.round >= state.order.length ? 'done' : 'active', winner: null };
  }

  if (turn !== player) throw new GameRuleError("It's not your turn");

  if (kind === 'memory') {
    const state = structuredClone(current as MemoryState);
    const cell = move.cell;
    if (cell === undefined || cell < 0 || cell >= state.cards.length || state.owners[cell] || state.flipped.includes(cell))
      throw new GameRuleError('Pick a hidden card');
    state.shown = [];
    state.flipped.push(cell);
    if (state.flipped.length < 2) return { state, next: player, status: 'active', winner: null };
    const [a, b] = state.flipped;
    state.flipped = [];
    if (state.cards[a] !== state.cards[b]) {
      state.shown = [a, b];
      return { state, next: 1 - player, status: 'active', winner: null };
    }
    // A pair: it is yours, and you go again.
    state.owners[a] = state.owners[b] = player + 1;
    state.scores[player]++;
    if (!state.owners.every(Boolean)) return { state, next: player, status: 'active', winner: null };
    const [mine, theirs] = [state.scores[player], state.scores[1 - player]];
    if (mine === theirs) return { state, next: null, status: 'draw', winner: null };
    return { state, next: null, status: 'won', winner: mine > theirs ? player : 1 - player };
  }

  if (move.cell === undefined) throw new GameRuleError('Choose a square');
  const state = structuredClone(current as BoardState);
  const mark = player + 1;
  let cell = move.cell;
  let line: number[] | null;
  if (kind === 'connect4') {
    if (cell < 0 || cell >= C4_COLS) throw new GameRuleError('Choose a column');
    let row = C4_ROWS - 1;
    while (row >= 0 && state.board[row * C4_COLS + cell]) row--;
    if (row < 0) throw new GameRuleError('That column is full');
    cell = row * C4_COLS + cell;
    state.board[cell] = mark;
    line = lineThrough(state.board, C4_COLS, C4_ROWS, cell, mark, 4);
  } else {
    const size = kind === 'gomoku' ? GOMOKU_SIZE * GOMOKU_SIZE : 9;
    if (cell < 0 || cell >= size || state.board[cell]) throw new GameRuleError('That square is taken');
    state.board[cell] = mark;
    line = kind === 'gomoku' ? lineThrough(state.board, GOMOKU_SIZE, GOMOKU_SIZE, cell, mark, 5) : xoxLine(state.board, mark);
  }
  if (line) return { state: { ...state, line }, next: null, status: 'won', winner: player };
  if (state.board.every(Boolean)) return { state, next: null, status: 'draw', winner: null };
  return { state, next: 1 - player, status: 'active', winner: null };
}
