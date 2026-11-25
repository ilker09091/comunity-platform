import { chessStart, inCheck, legalMoves, play as chessPlay, type ChessState } from './chess.js';
import { damaMoves, damaMustCapture, damaPlay, damaResult, damaStart, type DamaState } from './dama.js';
import { GameRuleError, leader, shuffle, written, type GameMove, type GameStatus } from './game-core.js';
import { BAR, isMars, tavlaMove, tavlaStart, tavlaSteps, tavlaUndo, type TavlaState } from './tavla.js';

/**
 * Third batch of chat games: Love Map, Question of the Day, Who's More Likely, Bucket List,
 * Color Word, Emoji Riddle, Sudoku Duel, Word Search, Pişti, Coin Toss, Spin the Wheel, Dama,
 * Tavla and Chess. Pure rules; `thirdView` shows one player what they may see.
 */

export const THIRD_KINDS = ['lovemap', 'daily', 'whomore', 'bucket', 'colorword', 'emoji', 'sudoku', 'wordsearch', 'pisti', 'coin', 'wheel', 'dama', 'tavla', 'chess'] as const;
export type ThirdKind = (typeof THIRD_KINDS)[number];
/** Games anyone can move in at any time (no turns). */
export const THIRD_FREE: readonly ThirdKind[] = ['daily', 'whomore', 'bucket', 'sudoku', 'wordsearch'];
export type Lang = 'en' | 'tr';

type Choice = 'a' | 'b';
export type LoveRound = { asker: number; question: string | null; answer: string | null; guess: string | null; right: boolean | null };
export type LoveState = { rounds: LoveRound[]; scores: number[]; total: number };
export type DailyState = { q: number; answers: (string | null)[] };
export type WhoState = { order: number[]; round: number; picks: (Choice | null)[]; rounds: { q: number; answers: Choice[] }[] };
export type BucketItem = { text: string; by: number; done: boolean; doneBy: number | null };
export type BucketState = { items: BucketItem[]; closedBy: number | null };
export type ColorRound = { setter: number; word: string | null; guesses: { word: string; marks: number[] }[]; solved: boolean | null };
export type ColorState = { rounds: ColorRound[]; scores: number[]; total: number };
export type EmojiRound = { teller: number; clue: string | null; answer: string | null; guesses: string[]; solved: boolean | null };
export type EmojiState = { rounds: EmojiRound[]; scores: number[]; total: number };
export type SudokuState = { puzzle: number[]; boards: number[][] };
export type WordSearchState = { lang: Lang; grid: string[]; words: { word: string; cells: number[]; by: number | null }[] };
export type PistiState = {
  deck: string[]; hands: string[][]; pile: string[]; captured: string[][]; pistis: number[][];
  lastTaker: number | null; toMove: number; last: { player: number; card: string; took: boolean; pisti: number } | null;
};
export type CoinState = { stake: string | null; call: Choice | null; result: Choice | null };
export type WheelState = { options: string[] | null; result: number | null };
export type ThirdState =
  | LoveState | DailyState | WhoState | BucketState | ColorState | EmojiState | SudokuState | WordSearchState
  | PistiState | CoinState | WheelState | DamaState | TavlaState | ChessState;
export type ThirdOutcome = { state: ThirdState; next: number | null; status: GameStatus; winner: number | null };

export const LOVE_ROUNDS = 6;
export const WHO_ROUNDS = 10;
export const BUCKET_MAX = 40;
export const BUCKET_TEXT = 80;
export const COLOR_LEN = 5;
export const COLOR_TRIES = 6;
export const COLOR_ROUNDS = 2;
export const EMOJI_ROUNDS = 4;
export const EMOJI_TRIES = 3;
export const SUDOKU_HOLES = 44;
export const SEARCH_SIZE = 9;
export const SEARCH_WORDS = 7;
export const WHEEL_MAX = 8;

/** Questions of the day: one a day, the same for everyone. */
export const DAILY_QUESTIONS = [
  'What made you smile today?',
  'What is one thing you want us to do together this month?',
  'Which song reminds you of me?',
  'What is your favorite memory of us?',
  'If we could teleport anywhere tonight, where would we go?',
  'What is something small I do that you love?',
  'What are you grateful for today?',
  'What was the best part of your week?',
  'Which food would you eat every day if you could?',
  'What is a dream you have never told anyone?',
  'What do you think we will be doing in ten years?',
  'What is the funniest thing that happened to you recently?',
  'Which movie should we watch together next?',
  'What is one habit you want to start?',
  'When did you last feel really proud of yourself?',
  'What would your perfect Sunday look like?',
  'What is something you want to learn this year?',
  'What makes you feel loved?',
  'Which place in the city do you like the most?',
  'What was your first impression of me?',
  'What is the best advice you ever got?',
  'If you could have any superpower, which one would you pick?',
  'What is your comfort food on a bad day?',
  'What is one thing that always calms you down?',
  'What would you name our pet?',
  'Which season fits your mood today?',
  'What is something you are looking forward to?',
  'Who was your childhood hero?',
  'What is the last thing that made you laugh out loud?',
  'What do you want to tell me but never said?',
];

/** "Who is more likely to…" prompts. */
export const WHO_PROMPTS = [
  'Who is more likely to be late?',
  'Who gets jealous more easily?',
  'Who apologizes first after a fight?',
  'Who is the better cook?',
  'Who falls asleep first during a movie?',
  'Who spends more time on the phone?',
  'Who is more romantic?',
  'Who would survive longer on a desert island?',
  'Who laughs at their own jokes?',
  'Who forgets important dates?',
  'Who is messier?',
  'Who gets hungry first?',
  'Who cries more at movies?',
  'Who is the better driver?',
  'Who says "I love you" more often?',
  'Who is more stubborn?',
  'Who takes longer to get ready?',
  'Who is better at saving money?',
  'Who would get lost without a map?',
  'Who is the morning grump?',
  'Who plans the dates?',
  'Who is more likely to adopt a pet on a whim?',
  'Who sends more voice notes?',
  'Who is more competitive in games?',
  'Who remembers song lyrics better?',
  'Who gets angry when hungry?',
  'Who would win a dance battle?',
  'Who is more likely to start a new hobby and quit?',
  'Who steals the blanket at night?',
  'Who is the better listener?',
];

/** Word lists for Word Search (upper case, no spaces). */
export const SEARCH_LISTS: Record<Lang, string[]> = {
  en: [
    'LOVE', 'HEART', 'KISS', 'HUG', 'SMILE', 'DREAM', 'HONEY', 'SWEET', 'DATE', 'ROSE', 'MOON', 'STAR', 'SUN', 'BEACH',
    'MUSIC', 'DANCE', 'COFFEE', 'CAKE', 'TRIP', 'HOME', 'BABY', 'HAPPY', 'CANDY', 'PARTY', 'FRIEND', 'MAGIC', 'OCEAN',
    'FLOWER', 'SPRING', 'CLOUD', 'TRUST', 'LAUGH', 'PEACH', 'APPLE', 'MOVIE', 'NIGHT',
  ],
  tr: [
    'AŞK', 'KALP', 'ÖPÜCÜK', 'SEVGİ', 'GÜLÜŞ', 'RÜYA', 'BAL', 'TATLI', 'GÜL', 'AY', 'YILDIZ', 'GÜNEŞ', 'DENİZ', 'MÜZİK',
    'DANS', 'KAHVE', 'PASTA', 'TATİL', 'EV', 'BEBEK', 'MUTLU', 'ŞEKER', 'PARTİ', 'DOST', 'SİHİR', 'OKYANUS', 'ÇİÇEK',
    'BAHAR', 'BULUT', 'GÜVEN', 'KAHKAHA', 'ŞEFTALİ', 'ELMA', 'SİNEMA', 'GECE', 'HAYAL',
  ],
};
const ALPHABET: Record<Lang, string> = { en: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', tr: 'ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ' };

/* -------------------------------------------------------------------------------------------- */
/* Helpers                                                                                       */

const upper = (s: string) => s.toLocaleUpperCase('tr');
/** For comparing written answers: lower case, letters and digits only. */
export const plain = (s: string) => s.toLocaleLowerCase('tr').replace(/[^\p{L}\p{N}]/gu, '');
const int = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);
const loveRound = (asker: number): LoveRound => ({ asker, question: null, answer: null, guess: null, right: null });
const colorRound = (setter: number): ColorRound => ({ setter, word: null, guesses: [], solved: null });
const emojiRound = (teller: number): EmojiRound => ({ teller, clue: null, answer: null, guesses: [], solved: null });

/** Two lines: the first and the second, each written. */
function twoLines(text: string | undefined, max: [number, number], what: string) {
  const [a, ...rest] = (text ?? '').split('\n');
  const b = rest.join(' ');
  if (!a?.trim() || !b.trim()) throw new GameRuleError(what);
  return [written(a, max[0]), written(b, max[1])];
}

/** Color Word marks: 2 right letter right place, 1 in the word elsewhere, 0 not in it. Repeated letters count once each. */
export function colorMarks(secret: string, guess: string) {
  const s = [...secret], g = [...guess];
  const marks: number[] = g.map((ch, i) => (ch === s[i] ? 2 : 0));
  const left: Record<string, number> = {};
  s.forEach((ch, i) => { if (marks[i] !== 2) left[ch] = (left[ch] ?? 0) + 1; });
  g.forEach((ch, i) => {
    if (marks[i] !== 2 && left[ch]) { marks[i] = 1; left[ch]--; }
  });
  return marks;
}
function colorWord(text: string | undefined) {
  const w = upper((text ?? '').trim());
  if (!/^\p{L}+$/u.test(w) || [...w].length !== COLOR_LEN) throw new GameRuleError(`Use a ${COLOR_LEN}-letter word`);
  return w;
}

/* Sudoku */
export function sudokuValid(board: number[]) {
  for (let i = 0; i < 9; i++) {
    const rows = new Set<number>(), cols = new Set<number>(), boxes = new Set<number>();
    for (let j = 0; j < 9; j++) {
      const r = board[i * 9 + j], c = board[j * 9 + i];
      const b = board[(Math.floor(i / 3) * 3 + Math.floor(j / 3)) * 9 + (i % 3) * 3 + (j % 3)];
      if (!r || !c || !b || rows.has(r) || cols.has(c) || boxes.has(b)) return false;
      rows.add(r); cols.add(c); boxes.add(b);
    }
  }
  return true;
}
/** Cells that clash with another cell in their row, column or box. */
export function sudokuConflicts(board: number[]) {
  const bad = new Set<number>();
  for (let a = 0; a < 81; a++) {
    if (!board[a]) continue;
    for (let b = a + 1; b < 81; b++) {
      if (board[a] !== board[b]) continue;
      const same = Math.floor(a / 9) === Math.floor(b / 9) || a % 9 === b % 9
        || (Math.floor(a / 27) === Math.floor(b / 27) && Math.floor((a % 9) / 3) === Math.floor((b % 9) / 3));
      if (same) { bad.add(a); bad.add(b); }
    }
  }
  return [...bad];
}
export function sudokuSolution(random: () => number) {
  const grid = Array.from({ length: 81 }, () => 0);
  const ok = (i: number, n: number) => {
    const r = Math.floor(i / 9), c = i % 9;
    for (let k = 0; k < 9; k++) {
      if (grid[r * 9 + k] === n || grid[k * 9 + c] === n) return false;
      const br = Math.floor(r / 3) * 3 + Math.floor(k / 3), bc = Math.floor(c / 3) * 3 + (k % 3);
      if (grid[br * 9 + bc] === n) return false;
    }
    return true;
  };
  const fill = (i: number): boolean => {
    if (i === 81) return true;
    for (const n of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], random)) {
      if (!ok(i, n)) continue;
      grid[i] = n;
      if (fill(i + 1)) return true;
    }
    grid[i] = 0;
    return false;
  };
  fill(0);
  return grid;
}

/* Word search */
const SEARCH_DIRS = [[0, 1], [1, 0], [1, 1], [-1, 1], [0, -1], [-1, 0], [-1, -1], [1, -1]];
export function buildSearch(lang: Lang, random: () => number): WordSearchState {
  const n = SEARCH_SIZE;
  for (let attempt = 0; attempt < 50; attempt++) {
    const grid: string[] = Array.from({ length: n * n }, () => '');
    const words: WordSearchState['words'] = [];
    for (const word of shuffle(SEARCH_LISTS[lang].filter((w) => [...w].length <= n), random)) {
      if (words.length >= SEARCH_WORDS) break;
      const letters = [...word];
      for (let tries = 0; tries < 60; tries++) {
        const [dr, dc] = SEARCH_DIRS[Math.floor(random() * SEARCH_DIRS.length)];
        const r = Math.floor(random() * n), c = Math.floor(random() * n);
        const cells = letters.map((_, i) => [r + dr * i, c + dc * i]);
        if (!cells.every(([rr, cc]) => rr >= 0 && rr < n && cc >= 0 && cc < n)) continue;
        const idx = cells.map(([rr, cc]) => rr * n + cc);
        if (!idx.every((cell, i) => !grid[cell] || grid[cell] === letters[i])) continue;
        idx.forEach((cell, i) => { grid[cell] = letters[i]; });
        words.push({ word, cells: idx, by: null });
        break;
      }
    }
    if (words.length < SEARCH_WORDS) continue;
    const alphabet = [...ALPHABET[lang]];
    for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = alphabet[Math.floor(random() * alphabet.length)];
    return { lang, grid, words };
  }
  throw new Error('Could not build the word search');
}
/** The straight line of cells from `a` to `b` (inclusive), or null if they're not in a line. */
export function searchLine(a: number, b: number, n = SEARCH_SIZE) {
  const ar = Math.floor(a / n), ac = a % n, br = Math.floor(b / n), bc = b % n;
  const dr = Math.sign(br - ar), dc = Math.sign(bc - ac);
  const len = Math.max(Math.abs(br - ar), Math.abs(bc - ac));
  if (!(ar === br || ac === bc || Math.abs(br - ar) === Math.abs(bc - ac))) return null;
  return Array.from({ length: len + 1 }, (_, i) => (ar + dr * i) * n + ac + dc * i);
}

/* Pişti */
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const rankOf = (card: string) => card.slice(0, -1);
export function pistiPoints(cards: string[]) {
  return cards.reduce((sum, c) => sum + (c === '10♦' ? 3 : c === '2♣' ? 2 : rankOf(c) === 'A' || rankOf(c) === 'J' ? 1 : 0), 0);
}
export function pistiScores(s: PistiState) {
  const scores = [0, 1].map((p) => pistiPoints(s.captured[p]) + s.pistis[p].reduce((a, b) => a + b, 0));
  // Most cards: +3.
  const [a, b] = [s.captured[0].length, s.captured[1].length];
  if (a !== b) scores[a > b ? 0 : 1] += 3;
  return scores;
}
function dealPisti(random: () => number): PistiState {
  const deck = shuffle(SUITS.flatMap((s) => RANKS.map((r) => `${r}${s}`)), random);
  // The open card on the table may not be a jack.
  const pile = deck.splice(0, 4);
  if (rankOf(pile[3]) === 'J') {
    const swap = deck.findIndex((c) => rankOf(c) !== 'J');
    [pile[3], deck[swap]] = [deck[swap], pile[3]];
  }
  const hands = [deck.splice(0, 4), deck.splice(0, 4)];
  return { deck, hands, pile, captured: [[], []], pistis: [[], []], lastTaker: null, toMove: 0, last: null };
}

/* -------------------------------------------------------------------------------------------- */

export function thirdInitialState(kind: ThirdKind, random: () => number, lang: Lang = 'en', now = Date.now()): ThirdState {
  switch (kind) {
    case 'lovemap': return { rounds: [loveRound(0)], scores: [0, 0], total: LOVE_ROUNDS };
    case 'daily': return { q: Math.floor(now / 86_400_000) % DAILY_QUESTIONS.length, answers: [null, null] };
    case 'whomore': return { order: shuffle(WHO_PROMPTS.map((_, i) => i), random).slice(0, WHO_ROUNDS), round: 0, picks: [null, null], rounds: [] };
    case 'bucket': return { items: [], closedBy: null };
    case 'colorword': return { rounds: [colorRound(0)], scores: [0, 0], total: COLOR_ROUNDS };
    case 'emoji': return { rounds: [emojiRound(0)], scores: [0, 0], total: EMOJI_ROUNDS };
    case 'sudoku': {
      const puzzle = sudokuSolution(random);
      for (const cell of shuffle(Array.from({ length: 81 }, (_, i) => i), random).slice(0, SUDOKU_HOLES)) puzzle[cell] = 0;
      return { puzzle, boards: [[...puzzle], [...puzzle]] };
    }
    case 'wordsearch': return buildSearch(lang, random);
    case 'pisti': return dealPisti(random);
    case 'coin': return { stake: null, call: null, result: null };
    case 'wheel': return { options: null, result: null };
    case 'dama': return damaStart();
    case 'tavla': return tavlaStart(random);
    case 'chess': return chessStart();
  }
}

/** Who moves first: null when both may play at once. */
export function thirdFirstTurn(kind: ThirdKind, state: ThirdState): number | null {
  if (THIRD_FREE.includes(kind)) return null;
  if (kind === 'tavla') return (state as TavlaState).toMove;
  return 0;
}

export function applyThirdMove(
  kind: ThirdKind, current: ThirdState, player: number, turn: number | null, move: GameMove, random: () => number,
): ThirdOutcome {
  const other = 1 - player;
  const active = (state: ThirdState, next: number | null): ThirdOutcome => ({ state, next, status: 'active', winner: null });
  const finish = (state: ThirdState, scores: number[]): ThirdOutcome => {
    const w = leader(scores);
    return { state, next: null, status: w === null ? 'draw' : 'won', winner: w };
  };

  /* Games without turns. */
  switch (kind) {
    case 'daily': {
      const s = structuredClone(current as DailyState);
      if (move.action !== 'answer') throw new GameRuleError('Write your answer');
      if (s.answers[player] !== null) throw new GameRuleError('You already answered');
      s.answers[player] = written(move.text);
      return s.answers.every((a) => a !== null) ? { state: s, next: null, status: 'done', winner: null } : active(s, null);
    }
    case 'whomore': {
      const s = structuredClone(current as WhoState);
      if (move.choice !== 'a' && move.choice !== 'b') throw new GameRuleError('Choose one of the two');
      if (s.picks[player]) throw new GameRuleError('You already answered this one');
      s.picks[player] = move.choice;
      const [a, b] = s.picks;
      if (!a || !b) return active(s, null);
      s.rounds.push({ q: s.order[s.round], answers: [a, b] });
      s.round++;
      s.picks = [null, null];
      return s.round >= s.order.length ? { state: s, next: null, status: 'done', winner: null } : active(s, null);
    }
    case 'bucket': {
      const s = structuredClone(current as BucketState);
      if (move.action === 'add') {
        if (s.items.length >= BUCKET_MAX) throw new GameRuleError('The list is full');
        const text = written(move.text, BUCKET_TEXT);
        if (s.items.some((i) => i.text.toLocaleLowerCase('tr') === text.toLocaleLowerCase('tr'))) throw new GameRuleError('That one is already on the list');
        s.items.push({ text, by: player, done: false, doneBy: null });
        return active(s, null);
      }
      if (move.action === 'toggle') {
        const item = int(move.cell) ? s.items[move.cell] : undefined;
        if (!item) throw new GameRuleError('Pick something on the list');
        item.done = !item.done;
        item.doneBy = item.done ? player : null;
        return active(s, null);
      }
      if (move.action === 'close') {
        if (!s.items.length) throw new GameRuleError('Add something first');
        s.closedBy = player;
        return { state: s, next: null, status: 'done', winner: null };
      }
      throw new GameRuleError('Add, tick or close the list');
    }
    case 'sudoku': {
      const s = structuredClone(current as SudokuState);
      const cell = move.cell;
      if (move.action !== 'set' || !int(cell) || cell < 0 || cell > 80) throw new GameRuleError('Choose a square');
      if (s.puzzle[cell]) throw new GameRuleError('That number is given');
      const n = Number(move.text ?? '');
      if (!Number.isInteger(n) || n < 0 || n > 9) throw new GameRuleError('Use a number from 1 to 9');
      s.boards[player][cell] = n;
      return sudokuValid(s.boards[player]) ? { state: s, next: null, status: 'won', winner: player } : active(s, null);
    }
    case 'wordsearch': {
      const s = structuredClone(current as WordSearchState);
      const cell = move.cell;
      if (!int(cell) || cell < 0) throw new GameRuleError('Drag across a word');
      const a = Math.floor(cell / 100), b = cell % 100;
      const line = a < SEARCH_SIZE * SEARCH_SIZE && b < SEARCH_SIZE * SEARCH_SIZE ? searchLine(a, b) : null;
      if (!line || line.length < 2) throw new GameRuleError('Drag across a word in a straight line');
      const key = line.join(','), back = [...line].reverse().join(',');
      const found = s.words.find((w) => w.cells.join(',') === key || w.cells.join(',') === back);
      if (!found) throw new GameRuleError("That's not one of the words");
      if (found.by !== null) throw new GameRuleError('Already found');
      found.by = player;
      if (s.words.every((w) => w.by !== null)) return finish(s, [0, 1].map((p) => s.words.filter((w) => w.by === p).length));
      return active(s, null);
    }
  }

  if (turn !== player) throw new GameRuleError("It's not your turn");

  switch (kind) {
    case 'lovemap': {
      const s = structuredClone(current as LoveState);
      const r = s.rounds[s.rounds.length - 1];
      if (r.question === null) {
        if (move.action !== 'prompt') throw new GameRuleError('Ask a question about you');
        [r.question, r.answer] = twoLines(move.text, [140, 100], 'Write a question and its answer');
        return active(s, other);
      }
      if (r.guess === null) {
        if (move.action !== 'reply') throw new GameRuleError('Write your guess');
        r.guess = written(move.text, 100);
        // A word-for-word match needs no judging.
        if (plain(r.guess) === plain(r.answer!)) r.right = true;
        else return active(s, r.asker);
      } else {
        if (move.action !== 'judge' || (move.cell !== 0 && move.cell !== 1)) throw new GameRuleError('Was the guess right?');
        r.right = move.cell === 1;
      }
      if (r.right) s.scores[1 - r.asker]++;
      if (s.rounds.length >= s.total) return finish(s, s.scores);
      // Whoever guessed asks next.
      s.rounds.push(loveRound(1 - r.asker));
      return active(s, 1 - r.asker);
    }

    case 'colorword': {
      const s = structuredClone(current as ColorState);
      const r = s.rounds[s.rounds.length - 1];
      if (r.word === null) {
        if (move.action !== 'prompt') throw new GameRuleError('Choose a secret word');
        r.word = colorWord(move.text);
        return active(s, other);
      }
      if (move.action !== 'guess') throw new GameRuleError('Guess the word');
      const guess = colorWord(move.text);
      const marks = colorMarks(r.word, guess);
      r.guesses.push({ word: guess, marks });
      if (marks.every((m) => m === 2)) r.solved = true;
      else if (r.guesses.length >= COLOR_TRIES) r.solved = false;
      else return active(s, player);
      // Fewer guesses, more points.
      if (r.solved) s.scores[player] += COLOR_TRIES + 1 - r.guesses.length;
      if (s.rounds.length >= s.total) return finish(s, s.scores);
      s.rounds.push(colorRound(player));
      return active(s, player);
    }

    case 'emoji': {
      const s = structuredClone(current as EmojiState);
      const r = s.rounds[s.rounds.length - 1];
      if (r.clue === null) {
        if (move.action !== 'prompt') throw new GameRuleError('Write the emojis and the answer');
        [r.clue, r.answer] = twoLines(move.text, [40, 60], 'Write the emojis and the answer');
        if (/[\p{L}\p{N}]/u.test(r.clue)) throw new GameRuleError('Use only emojis for the clue');
        return active(s, other);
      }
      if (move.action === 'pass') r.solved = false;
      else if (move.action === 'guess') {
        const guess = written(move.text, 60);
        r.guesses.push(guess);
        if (plain(guess) === plain(r.answer!)) r.solved = true;
        else if (r.guesses.length >= EMOJI_TRIES) r.solved = false;
        else return active(s, player);
      } else throw new GameRuleError('Guess or give up');
      s.scores[r.solved ? player : r.teller]++;
      if (s.rounds.length >= s.total) return finish(s, s.scores);
      s.rounds.push(emojiRound(player));
      return active(s, player);
    }

    case 'pisti': {
      const s = structuredClone(current as PistiState);
      const hand = s.hands[player];
      const i = move.cell;
      if (!int(i) || i < 0 || i >= hand.length) throw new GameRuleError('Pick a card from your hand');
      const [card] = hand.splice(i, 1);
      const top = s.pile[s.pile.length - 1];
      const jack = rankOf(card) === 'J';
      let took = false, pisti = 0;
      if (top && (jack || rankOf(card) === rankOf(top))) {
        // Taking a single card with the same rank is a pişti (jack on jack: double).
        if (s.pile.length === 1 && rankOf(card) === rankOf(top)) pisti = jack ? 20 : 10;
        if (pisti) s.pistis[player].push(pisti);
        s.captured[player].push(...s.pile, card);
        s.pile = [];
        s.lastTaker = player;
        took = true;
      } else s.pile.push(card);
      s.last = { player, card, took, pisti };
      if (s.hands[0].length || s.hands[1].length) return active(s, other);
      if (s.deck.length) {
        s.hands = [s.deck.splice(0, 4), s.deck.splice(0, 4)];
        return active(s, other);
      }
      // Last cards on the table go to whoever took last.
      if (s.pile.length && s.lastTaker !== null) { s.captured[s.lastTaker].push(...s.pile); s.pile = []; }
      return finish(s, pistiScores(s));
    }

    case 'coin': {
      const s = structuredClone(current as CoinState);
      if (s.stake === null) {
        if (move.action !== 'prompt') throw new GameRuleError("Write what it's for");
        s.stake = written(move.text, 100);
        return active(s, other);
      }
      if (move.choice !== 'a' && move.choice !== 'b') throw new GameRuleError('Heads or tails?');
      s.call = move.choice;
      s.result = random() < 0.5 ? 'a' : 'b';
      return { state: s, next: null, status: 'won', winner: s.call === s.result ? player : other };
    }

    case 'wheel': {
      const s = structuredClone(current as WheelState);
      if (s.options === null) {
        if (move.action !== 'prompt') throw new GameRuleError('Write the options');
        const options = (move.text ?? '').split('\n').map((o) => o.trim()).filter(Boolean);
        if (options.length < 2 || options.length > WHEEL_MAX) throw new GameRuleError(`Write 2 to ${WHEEL_MAX} options, one per line`);
        s.options = options.map((o) => written(o, 40));
        return active(s, other);
      }
      if (move.action !== 'roll') throw new GameRuleError('Spin the wheel');
      s.result = Math.floor(random() * s.options.length);
      return { state: s, next: null, status: 'done', winner: null };
    }

    case 'dama': {
      const s = current as DamaState;
      const path = (move.text ?? '').split('-').map(Number);
      if (move.action !== 'move' || path.length < 2 || !path.every((c) => Number.isInteger(c) && c >= 0 && c < 64)) throw new GameRuleError('Choose a piece and where it goes');
      const next = damaPlay(s, path);
      if (!next) throw new GameRuleError(damaMustCapture(s) ? 'You have to capture, and finish the whole capture' : "You can't move there");
      const result = damaResult(next);
      if (result) return { state: next, next: null, status: result.draw ? 'draw' : 'won', winner: result.winner };
      return active(next, next.toMove);
    }

    case 'tavla': {
      const s = current as TavlaState;
      if (move.action === 'undo') {
        const back = tavlaUndo(s);
        if (!back) throw new GameRuleError('Nothing to take back');
        return active(back, player);
      }
      const die = Number(move.text);
      if (move.action !== 'move' || !int(move.cell) || !Number.isInteger(die)) throw new GameRuleError('Choose a checker and a die');
      const out = tavlaMove(s, player, move.cell, die, random);
      if (!out) throw new GameRuleError("That move isn't allowed");
      if (out.winner !== null) return { state: out.state, next: null, status: 'won', winner: out.winner };
      return active(out.state, out.state.toMove);
    }

    case 'chess': {
      const s = current as ChessState;
      const m = /^(\d{1,2})-(\d{1,2})(?:=([qrbn]))?$/.exec(move.text ?? '');
      if (move.action !== 'move' || !m) throw new GameRuleError('Choose a piece and where it goes');
      const next = chessPlay(s, { from: Number(m[1]), to: Number(m[2]), promo: m[3] });
      if (!next) throw new GameRuleError("That move isn't allowed");
      if (next.end === 'mate') return { state: next, next: null, status: 'won', winner: player };
      if (next.end) return { state: next, next: null, status: 'draw', winner: null };
      return active(next, other);
    }
  }
  throw new GameRuleError('Unknown game');
}

/* -------------------------------------------------------------------------------------------- */
/* What one player sees                                                                          */

export function thirdView(kind: ThirdKind, current: ThirdState, me: number, over: boolean): Record<string, unknown> {
  const them = 1 - me;
  switch (kind) {
    case 'lovemap': {
      const s = current as LoveState;
      return {
        scores: s.scores, total: s.total,
        rounds: s.rounds.map((r) => ({
          asker: r.asker, question: r.question, guess: r.guess, right: r.right,
          answer: r.asker === me || r.right !== null || over ? r.answer : null,
        })),
      };
    }
    case 'daily': {
      const s = current as DailyState;
      const both = s.answers.every((a) => a !== null);
      return {
        question: DAILY_QUESTIONS[s.q] ?? DAILY_QUESTIONS[0],
        mine: me >= 0 ? s.answers[me] : null,
        theirs: me >= 0 && both ? s.answers[them] : null,
        answered: s.answers.map((a) => a !== null),
      };
    }
    case 'whomore': {
      const s = current as WhoState;
      return {
        round: s.round, total: s.order.length,
        prompt: s.round < s.order.length ? WHO_PROMPTS[s.order[s.round]] : null,
        // Each answer as the person it points at: "a" means "me".
        rounds: s.rounds.map((r) => ({ prompt: WHO_PROMPTS[r.q], picked: r.answers.map((a, p) => (a === 'a' ? p : 1 - p)) })),
      };
    }
    case 'bucket': {
      const s = current as BucketState;
      return { items: s.items, max: BUCKET_MAX, closedBy: s.closedBy, done: s.items.filter((i) => i.done).length };
    }
    case 'colorword': {
      const s = current as ColorState;
      return {
        scores: s.scores, total: s.total, tries: COLOR_TRIES, length: COLOR_LEN,
        rounds: s.rounds.map((r) => ({
          setter: r.setter, ready: r.word !== null, guesses: r.guesses, solved: r.solved,
          word: r.setter === me || r.solved !== null || over ? r.word : null,
        })),
      };
    }
    case 'emoji': {
      const s = current as EmojiState;
      return {
        scores: s.scores, total: s.total, tries: EMOJI_TRIES,
        rounds: s.rounds.map((r) => ({
          teller: r.teller, clue: r.clue, guesses: r.guesses, solved: r.solved,
          answer: r.teller === me || r.solved !== null || over ? r.answer : null,
        })),
      };
    }
    case 'sudoku': {
      const s = current as SudokuState;
      const filled = (p: number) => s.boards[p].filter((v, i) => v && !s.puzzle[i]).length;
      const holes = s.puzzle.filter((v) => !v).length;
      return {
        puzzle: s.puzzle,
        board: me >= 0 ? s.boards[me] : s.puzzle,
        conflicts: me >= 0 ? sudokuConflicts(s.boards[me]) : [],
        progress: me >= 0 ? [filled(me), filled(them)] : [],
        holes,
      };
    }
    case 'wordsearch': {
      const s = current as WordSearchState;
      return {
        size: SEARCH_SIZE, grid: s.grid,
        words: s.words.map((w) => ({ word: w.word, by: w.by, cells: w.by !== null || over ? w.cells : [] })),
        scores: [0, 1].map((p) => s.words.filter((w) => w.by === p).length),
      };
    }
    case 'pisti': {
      const s = current as PistiState;
      return {
        hand: me >= 0 ? s.hands[me] : [],
        theirCards: me >= 0 ? s.hands[them].length : 0,
        top: s.pile[s.pile.length - 1] ?? null,
        under: s.pile.length > 1 ? s.pile[s.pile.length - 2] : null,
        pile: s.pile.length, deck: s.deck.length,
        taken: s.captured.map((c) => c.length),
        pistis: s.pistis.map((p) => p.length),
        scores: pistiScores(s),
        last: s.last,
      };
    }
    case 'coin': return { ...(current as CoinState) };
    case 'wheel': return { ...(current as WheelState) };
    case 'dama': {
      const s = current as DamaState;
      return {
        board: s.board, toMove: s.toMove, last: s.last, captured: s.captured,
        moves: !over && s.toMove === me ? damaMoves(s) : [],
      };
    }
    case 'tavla': {
      const s = current as TavlaState;
      return {
        points: s.points, bar: s.bar, off: s.off, dice: s.dice, rolled: s.rolled, toMove: s.toMove,
        played: s.played, log: s.log, canUndo: s.played.length > 0 && s.toMove === me && !over,
        steps: !over && s.toMove === me ? tavlaSteps(s, me) : [],
        mars: over && (s.off[0] === 15 || s.off[1] === 15) ? isMars(s, s.off[0] === 15 ? 0 : 1) : false,
        bar_point: BAR,
      };
    }
    case 'chess': {
      const s = current as ChessState;
      return {
        board: s.board, toMove: s.toMove, last: s.last, moves: s.moves.slice(-12), end: s.end,
        check: !s.end && inCheck(s),
        legal: !over && s.toMove === me ? legalMoves(s).map((m) => `${m.from}-${m.to}${m.promo ? `=${m.promo}` : ''}`) : [],
        lastText: s.moves.length ? s.moves[s.moves.length - 1] : null,
        captured: capturedPieces(s.board),
      };
    }
  }
}

/** Pieces off the board, by color (from the starting set). */
function capturedPieces(board: string[]) {
  const start = 'rnbqkbnrpppppppp';
  const count = (set: string[], p: string) => set.filter((x) => x === p).length;
  const out: string[][] = [[], []];
  for (const color of [0, 1]) {
    const pieces = board.filter((p) => p && (color === 0 ? p === p.toUpperCase() : p === p.toLowerCase())).map((p) => p.toLowerCase());
    for (const t of 'qrbnp') {
      const missing = count([...start], t) - count(pieces, t);
      for (let i = 0; i < missing; i++) out[color].push(color === 0 ? t.toUpperCase() : t);
    }
  }
  return out;
}

/** Secret picks this round (Who's More Likely), for "you answered / they answered". */
export function thirdPicks(kind: ThirdKind, current: ThirdState): (string | null)[] | null {
  if (kind === 'whomore') return (current as WhoState).picks;
  if (kind === 'daily') return (current as DailyState).answers.map((a) => (a === null ? null : 'a'));
  return null;
}

