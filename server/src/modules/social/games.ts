import type { GameKind } from '../../database/migrations/1760193700000-EvenMoreGames.js';
import { GameRuleError, shuffle, TEXT_MAX, written, type GameMove, type GameStatus } from './game-core.js';
import { applyExtraMove, EXTRA_KINDS, extraInitialState, type ExtraKind, type ExtraState } from './games-extra.js';
import { applyThirdMove, THIRD_FREE, THIRD_KINDS, thirdFirstTurn, thirdInitialState, type Lang, type ThirdKind, type ThirdState } from './games-third.js';

export { GameRuleError, TEXT_MAX, type GameMove, type GameStatus };

/** Pure rules for the in-chat mini games; the service only stores and authorizes. */

export type RpsChoice = 'rock' | 'paper' | 'scissors';
export type TotChoice = 'a' | 'b';
export type BoardState = { board: number[]; line: number[] };
export type RpsState = { picks: (RpsChoice | null)[]; scores: number[]; rounds: { choices: RpsChoice[]; winner: number | null }[] };
/** Memory: `shown` is the last mismatched pair, visible until the next card is turned. */
export type MemoryState = { cards: string[]; owners: number[]; flipped: number[]; shown: number[]; scores: number[] };
export type TotState = { order: number[]; round: number; picks: (TotChoice | null)[]; rounds: { q: number; answers: TotChoice[] }[] };
/** Q&A: one asks, the other answers; "what do you mean?" lets the answerer ask back first. */
export type QaRound = { asker: number; question: string | null; clarify: string | null; clarification: string | null; answer: string | null };
export type QaState = { rounds: QaRound[]; phase: 'ask' | 'answer' | 'explain'; chances: number[]; total: number };
/** Truth or dare: `player` picks, the other writes the question or dare, `player` replies (or passes). */
export type TodRound = { player: number; pick: 'truth' | 'dare' | null; prompt: string | null; reply: string | null; passed: boolean };
export type TodState = { rounds: TodRound[]; phase: 'pick' | 'prompt' | 'reply'; chances: number[]; total: number };
export type GameState = BoardState | RpsState | MemoryState | TotState | QaState | TodState | ExtraState | ThirdState;

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

/** Q&A: six questions (three each), and two "what do you mean?" per player. */
export const QA_ROUNDS = 6;
export const QA_CLARIFY = 2;
/** Truth or dare: eight turns (four each), and two passes per player. */
export const TOD_ROUNDS = 8;
export const TOD_PASSES = 2;

/** Games where both play at the same time at the start, so nobody has the first turn. */
export const SIMULTANEOUS_START: readonly GameKind[] = ['rps', 'thisorthat', 'nhie', 'knowme', 'bulls', ...THIRD_FREE];

const isExtra = (kind: GameKind): kind is ExtraKind => (EXTRA_KINDS as readonly string[]).includes(kind);
export const isThird = (kind: GameKind): kind is ThirdKind => (THIRD_KINDS as readonly string[]).includes(kind);

/** Index (into players) of who moves first, or null when both may play at once. */
export function firstTurn(kind: GameKind, state: GameState): number | null {
  if (isThird(kind)) return thirdFirstTurn(kind, state as ThirdState);
  return SIMULTANEOUS_START.includes(kind) ? null : 0;
}

const qaRound = (asker: number): QaRound => ({ asker, question: null, clarify: null, clarification: null, answer: null });
const todRound = (player: number): TodRound => ({ player, pick: null, prompt: null, reply: null, passed: false });

export function initialState(kind: GameKind, random: () => number = Math.random, lang: Lang = 'en'): GameState {
  if (isExtra(kind)) return extraInitialState(kind, random);
  if (isThird(kind)) return thirdInitialState(kind, random, lang);
  switch (kind) {
    case 'rps':
      return { picks: [null, null], scores: [0, 0], rounds: [] };
    case 'memory':
      return { cards: shuffle([...MEMORY_FACES, ...MEMORY_FACES], random), owners: new Array(16).fill(0), flipped: [], shown: [], scores: [0, 0] };
    case 'thisorthat':
      return { order: shuffle(THIS_OR_THAT.map((_, i) => i), random).slice(0, TOT_ROUNDS), round: 0, picks: [null, null], rounds: [] };
    case 'gomoku':
      return { board: new Array(GOMOKU_SIZE * GOMOKU_SIZE).fill(0), line: [] };
    case 'qa':
      return { rounds: [qaRound(0)], phase: 'ask', chances: [QA_CLARIFY, QA_CLARIFY], total: QA_ROUNDS };
    case 'tod':
      return { rounds: [todRound(0)], phase: 'pick', chances: [TOD_PASSES, TOD_PASSES], total: TOD_ROUNDS };
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
  move: GameMove,
  random: () => number = Math.random,
): Outcome {
  if (isExtra(kind)) return applyExtraMove(kind, current as ExtraState, player, turn, move, random);
  if (isThird(kind)) return applyThirdMove(kind, current as ThirdState, player, turn, move, random);
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

  if (kind === 'qa') {
    const state = structuredClone(current as QaState);
    const round = state.rounds[state.rounds.length - 1];
    const answerer = 1 - round.asker;
    if (state.phase === 'ask') {
      if (move.action !== 'ask') throw new GameRuleError('Ask your question');
      round.question = written(move.text);
      state.phase = 'answer';
      return { state, next: answerer, status: 'active', winner: null };
    }
    if (state.phase === 'explain') {
      if (move.action !== 'explain') throw new GameRuleError('Explain what you meant');
      round.clarification = written(move.text);
      state.phase = 'answer';
      return { state, next: answerer, status: 'active', winner: null };
    }
    if (move.action === 'clarify') {
      if (round.clarify !== null) throw new GameRuleError('You already asked about this question');
      if (state.chances[player] <= 0) throw new GameRuleError('No "what do you mean?" left');
      round.clarify = written(move.text);
      state.chances[player]--;
      state.phase = 'explain';
      return { state, next: round.asker, status: 'active', winner: null };
    }
    if (move.action !== 'answer') throw new GameRuleError('Answer the question');
    round.answer = written(move.text);
    if (state.rounds.length >= state.total) return { state, next: null, status: 'done', winner: null };
    // Roles swap: whoever answered asks next.
    state.rounds.push(qaRound(answerer));
    state.phase = 'ask';
    return { state, next: answerer, status: 'active', winner: null };
  }

  if (kind === 'tod') {
    const state = structuredClone(current as TodState);
    const round = state.rounds[state.rounds.length - 1];
    const other = 1 - round.player;
    if (state.phase === 'pick') {
      if (move.action !== 'pick' || (move.choice !== 'truth' && move.choice !== 'dare')) throw new GameRuleError('Pick truth or dare');
      round.pick = move.choice;
      state.phase = 'prompt';
      return { state, next: other, status: 'active', winner: null };
    }
    if (state.phase === 'prompt') {
      if (move.action !== 'prompt') throw new GameRuleError(round.pick === 'dare' ? 'Write a dare' : 'Write a question');
      round.prompt = written(move.text);
      state.phase = 'reply';
      return { state, next: round.player, status: 'active', winner: null };
    }
    if (move.action === 'pass') {
      if (state.chances[player] <= 0) throw new GameRuleError('No passes left');
      state.chances[player]--;
      round.passed = true;
    } else if (move.action === 'reply') {
      round.reply = written(move.text);
    } else throw new GameRuleError('Reply or pass');
    if (state.rounds.length >= state.total) return { state, next: null, status: 'done', winner: null };
    state.rounds.push(todRound(other));
    state.phase = 'pick';
    return { state, next: other, status: 'active', winner: null };
  }

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
