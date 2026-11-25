import { GameRuleError, leader, shuffle, written, type GameMove, type GameStatus } from './game-core.js';

/**
 * Pure rules for the second batch of chat games. Each game keeps its whole state in one JSON
 * object; `extraView` turns it into what one player may see (secrets stay hidden).
 */

export const EXTRA_KINDS = ['hangman', 'bulls', 'dots', 'reversi', 'mangala', 'battleship', 'pig', 'wordchain', 'lies', 'nhie', 'knowme', 'story'] as const;
export type ExtraKind = (typeof EXTRA_KINDS)[number];

type Choice = 'a' | 'b';
export type HangmanRound = { setter: number; word: string | null; guessed: string[]; wrong: number; solved: boolean | null };
export type HangmanState = { rounds: HangmanRound[]; scores: number[]; total: number };
export type BullsGuess = { guess: string; plus: number; minus: number };
export type BullsState = { secrets: (string | null)[]; guesses: BullsGuess[][]; phase: 'set' | 'guess' };
export type DotsState = { lines: number[]; boxes: number[]; last: number | null };
export type ReversiState = { board: number[]; passed: number | null; last: number | null };
export type MangalaState = { pits: number[]; last: { player: number; pit: number; extra: boolean; captured: number } | null };
export type BattleshipState = { ships: number[][][]; shots: number[][] };
export type PigTurn = { player: number; rolls: number[]; banked: number; bust: boolean };
export type PigState = { scores: number[]; rolls: number[]; log: PigTurn[] };
export type ChainState = { words: { by: number; word: string }[]; gaveUp: number | null };
export type LiesRound = { teller: number; statements: string[] | null; lie: number | null; guess: number | null };
export type LiesState = { rounds: LiesRound[]; scores: number[]; total: number };
export type NhieState = { order: number[]; round: number; picks: (Choice | null)[]; rounds: { q: number; answers: Choice[] }[] };
export type KnowState = {
  order: number[]; round: number; picks: (Choice | null)[]; guesses: (Choice | null)[];
  rounds: { q: number; answers: Choice[]; guesses: Choice[] }[];
};
export type StoryState = { starter: number; lines: { by: number; text: string }[]; total: number };
export type ExtraState =
  | HangmanState | BullsState | DotsState | ReversiState | MangalaState | BattleshipState
  | PigState | ChainState | LiesState | NhieState | KnowState | StoryState;

export type ExtraOutcome = { state: ExtraState; next: number | null; status: GameStatus; winner: number | null };

export const HANGMAN_LIVES = 6;
export const HANGMAN_ROUNDS = 2;
export const BULLS_DIGITS = 4;
export const BULLS_MAX = 12;
export const DOTS = 4;
export const DOTS_H = (DOTS + 1) * DOTS;
export const DOTS_LINES = DOTS_H * 2;
export const REVERSI = 8;
export const SEA = 8;
export const FLEET = [4, 3, 3, 2, 2];
export const PIG_TARGET = 50;
export const CHAIN_MAX = 40;
export const LIES_ROUNDS = 4;
export const LIE_MAX = 90;
export const NHIE_ROUNDS = 10;
export const KNOW_ROUNDS = 8;
export const STORY_LINES = 12;
export const STORY_LINE_MAX = 200;

/** "Never have I ever…": both answer in secret, then see each other's answers. */
export const NEVER_HAVE_I_EVER = [
  'Never have I ever stayed up all night talking to someone',
  'Never have I ever sent a message to the wrong person',
  'Never have I ever pretended to like a gift',
  'Never have I ever fallen asleep during a movie at the cinema',
  'Never have I ever sung in the shower',
  'Never have I ever stalked an ex on social media',
  'Never have I ever cried at a cartoon',
  'Never have I ever forgotten a birthday',
  'Never have I ever eaten something off the floor',
  'Never have I ever laughed at the wrong moment',
  'Never have I ever lied about my age',
  'Never have I ever danced alone in my room',
  'Never have I ever had a crush on a teacher',
  'Never have I ever read someone else\'s messages',
  'Never have I ever got lost in my own city',
  'Never have I ever cooked something inedible',
  'Never have I ever said "I love you" first',
  'Never have I ever skipped school or work for fun',
  'Never have I ever talked to my pet like a person',
  'Never have I ever made a wish on a shooting star',
  'Never have I ever broken something and hidden it',
  'Never have I ever written a love letter',
  'Never have I ever been on a blind date',
  'Never have I ever fallen in public',
  'Never have I ever re-watched a series more than twice',
  'Never have I ever gone a whole day without my phone',
  'Never have I ever cheated in a board game',
  'Never have I ever googled myself',
  'Never have I ever laughed so hard I cried',
  'Never have I ever kept a diary',
];

/** "How well do you know me?": pick your own answer and guess your partner's. */
export const KNOW_ME: [string, string, string][] = [
  ['Morning person or night owl?', 'Morning', 'Night'],
  ['Sweet or salty snacks?', 'Sweet', 'Salty'],
  ['Beach holiday or city trip?', 'Beach', 'City'],
  ['Texting or voice notes?', 'Texting', 'Voice notes'],
  ['Cats or dogs?', 'Cats', 'Dogs'],
  ['Tea or coffee?', 'Tea', 'Coffee'],
  ['Stay in or go out on a Friday?', 'Stay in', 'Go out'],
  ['Summer or winter?', 'Summer ☀️', 'Winter ❄️'],
  ['Action film or romantic comedy?', 'Action', 'Rom-com'],
  ['Plan everything or go with the flow?', 'Plan', 'Go with the flow'],
  ['Pizza or sushi?', 'Pizza', 'Sushi'],
  ['Big party or small dinner?', 'Big party', 'Small dinner'],
  ['Mountains or sea?', 'Mountains', 'Sea'],
  ['Early to the airport or just in time?', 'Early', 'Just in time'],
  ['Books or films?', 'Books', 'Films'],
  ['Shower in the morning or at night?', 'Morning', 'Night'],
  ['Spend or save?', 'Spend it', 'Save it'],
  ['Messy desk or tidy desk?', 'Messy', 'Tidy'],
  ['Window seat or aisle seat?', 'Window', 'Aisle'],
  ['Chocolate or vanilla?', 'Chocolate', 'Vanilla'],
  ['Talk it out now or cool down first?', 'Talk now', 'Cool down'],
  ['Surprises: love them or hate them?', 'Love them', 'Hate them'],
  ['Cook at home or eat out?', 'Cook', 'Eat out'],
  ['Phone on silent or loud?', 'Silent', 'Loud'],
];

/** First lines for "Story together". */
export const STORY_STARTERS = [
  'One rainy night, someone knocked on our door three times…',
  'The map we found in the old book pointed to a tiny island…',
  'When I woke up, our cat could suddenly talk…',
  'We won a trip to the moon, but there was one strange rule…',
  'The elevator stopped between two floors, and the lights went out…',
  'Our new neighbor was definitely not human…',
  'At the bottom of the suitcase was a letter addressed to us, dated 2050…',
  'The fortune teller looked at our hands and went pale…',
  'Every time we kissed, it started to snow…',
  'We opened a little café on a street that wasn\'t on any map…',
];

const int = (n: unknown) => typeof n === 'number' && Number.isInteger(n);

/* -------------------------------------------------------------------------------------------- */
/* Setup                                                                                         */

/** Ships of every length, never touching (not even at the corners). */
export function placeFleet(random: () => number): number[][] {
  for (let attempt = 0; attempt < 100; attempt++) {
    const taken = new Set<number>();
    const ships: number[][] = [];
    for (const length of FLEET) {
      let placed: number[] | null = null;
      for (let tries = 0; tries < 200 && !placed; tries++) {
        const across = random() < 0.5;
        const r = Math.floor(random() * (across ? SEA : SEA - length + 1));
        const c = Math.floor(random() * (across ? SEA - length + 1 : SEA));
        const cells = Array.from({ length }, (_, i) => (across ? r * SEA + c + i : (r + i) * SEA + c));
        const clear = cells.every((cell) => {
          const cr = Math.floor(cell / SEA), cc = cell % SEA;
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            const nr = cr + dr, nc = cc + dc;
            if (nr >= 0 && nr < SEA && nc >= 0 && nc < SEA && taken.has(nr * SEA + nc)) return false;
          }
          return true;
        });
        if (clear) placed = cells;
      }
      if (!placed) break;
      placed.forEach((cell) => taken.add(cell));
      ships.push(placed);
    }
    if (ships.length === FLEET.length) return ships;
  }
  throw new Error('Could not place the fleet');
}

export function extraInitialState(kind: ExtraKind, random: () => number): ExtraState {
  switch (kind) {
    case 'hangman':
      return { rounds: [hangmanRound(0)], scores: [0, 0], total: HANGMAN_ROUNDS };
    case 'bulls':
      return { secrets: [null, null], guesses: [[], []], phase: 'set' };
    case 'dots':
      return { lines: new Array(DOTS_LINES).fill(0), boxes: new Array(DOTS * DOTS).fill(0), last: null };
    case 'reversi': {
      const board = new Array(REVERSI * REVERSI).fill(0);
      board[27] = board[36] = 2;
      board[28] = board[35] = 1;
      return { board, passed: null, last: null };
    }
    case 'mangala':
      return { pits: [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0], last: null };
    case 'battleship':
      return { ships: [placeFleet(random), placeFleet(random)], shots: [[], []] };
    case 'pig':
      return { scores: [0, 0], rolls: [], log: [] };
    case 'wordchain':
      return { words: [], gaveUp: null };
    case 'lies':
      return { rounds: [liesRound(0)], scores: [0, 0], total: LIES_ROUNDS };
    case 'nhie':
      return { order: shuffle(NEVER_HAVE_I_EVER.map((_, i) => i), random).slice(0, NHIE_ROUNDS), round: 0, picks: [null, null], rounds: [] };
    case 'knowme':
      return { order: shuffle(KNOW_ME.map((_, i) => i), random).slice(0, KNOW_ROUNDS), round: 0, picks: [null, null], guesses: [null, null], rounds: [] };
    case 'story':
      return { starter: Math.floor(random() * STORY_STARTERS.length), lines: [], total: STORY_LINES };
  }
}

const hangmanRound = (setter: number): HangmanRound => ({ setter, word: null, guessed: [], wrong: 0, solved: null });
const liesRound = (teller: number): LiesRound => ({ teller, statements: null, lie: null, guess: null });

/* -------------------------------------------------------------------------------------------- */
/* Helpers                                                                                       */

const upper = (s: string) => s.toLocaleUpperCase('tr');
const lower = (s: string) => s.toLocaleLowerCase('tr');

/** A hangman word or phrase: letters and single spaces, 2-20 letters in all. */
export function hangmanWord(text: string | undefined) {
  const w = upper((text ?? '').trim().replace(/\s+/g, ' '));
  const letters = w.replace(/ /g, '');
  if (!/^\p{L}+( \p{L}+)*$/u.test(w) || letters.length < 2 || letters.length > 20)
    throw new GameRuleError('Use letters only (2-20), spaces are allowed between words');
  return w;
}

const hangmanSolved = (round: HangmanRound) =>
  !!round.word && [...round.word].every((ch) => ch === ' ' || round.guessed.includes(ch));

/** Four different digits, not starting with 0. */
export function bullsNumber(text: string | undefined) {
  const n = (text ?? '').trim();
  if (!/^[1-9]\d{3}$/.test(n) || new Set(n).size !== BULLS_DIGITS)
    throw new GameRuleError('Use 4 different digits, not starting with 0');
  return n;
}

/** + digits in the right place, - digits in the number but elsewhere. */
export function bullsScore(secret: string, guess: string) {
  let plus = 0, minus = 0;
  for (let i = 0; i < guess.length; i++) {
    if (secret[i] === guess[i]) plus++;
    else if (secret.includes(guess[i])) minus++;
  }
  return { plus, minus };
}

/** The four lines around box (r, c): top, bottom, left, right. */
export function boxLines(r: number, c: number) {
  return [r * DOTS + c, (r + 1) * DOTS + c, DOTS_H + r * (DOTS + 1) + c, DOTS_H + r * (DOTS + 1) + c + 1];
}

const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
/** The opponent discs a disc at `cell` would turn over. */
export function reversiFlips(board: number[], cell: number, mark: number) {
  if (board[cell]) return [];
  const r0 = Math.floor(cell / REVERSI), c0 = cell % REVERSI, out: number[] = [];
  for (const [dr, dc] of DIRS) {
    const run: number[] = [];
    let r = r0 + dr, c = c0 + dc;
    while (r >= 0 && r < REVERSI && c >= 0 && c < REVERSI && board[r * REVERSI + c] === 3 - mark) {
      run.push(r * REVERSI + c);
      r += dr; c += dc;
    }
    if (run.length && r >= 0 && r < REVERSI && c >= 0 && c < REVERSI && board[r * REVERSI + c] === mark) out.push(...run);
  }
  return out;
}
export function reversiMoves(board: number[], mark: number) {
  return board.map((_, i) => i).filter((i) => reversiFlips(board, i, mark).length > 0);
}

const count = (values: number[], v: number) => values.filter((x) => x === v).length;

/** Lower-case word, letters only, 2-20 of them. */
export function chainWord(text: string | undefined) {
  const w = lower((text ?? '').trim());
  if (!/^\p{L}{2,20}$/u.test(w)) throw new GameRuleError('One word, letters only (2-20)');
  return w;
}
/** The letter the next word must start with. No Turkish word starts with "ğ", so the one before it counts. */
export function chainLetter(word: string) {
  const letters = [...word];
  const last = letters[letters.length - 1];
  return last === 'ğ' && letters.length > 1 ? letters[letters.length - 2] : last;
}

/** Turns three lines into statements: each written, at most LIE_MAX characters. */
function statements(text: string | undefined) {
  const lines = (text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length !== 3) throw new GameRuleError('Write three statements');
  return lines.map((l) => written(l, LIE_MAX));
}

/* -------------------------------------------------------------------------------------------- */
/* Moves                                                                                         */

const SIMULTANEOUS = new Set<ExtraKind>(['nhie', 'knowme']);

export function applyExtraMove(
  kind: ExtraKind, current: ExtraState, player: number, turn: number | null, move: GameMove, random: () => number,
): ExtraOutcome {
  const active = (state: ExtraState, next: number): ExtraOutcome => ({ state, next, status: 'active', winner: null });
  const finish = (state: ExtraState, scores: number[]): ExtraOutcome => {
    const w = leader(scores);
    return { state, next: null, status: w === null ? 'draw' : 'won', winner: w };
  };

  if (kind === 'nhie' || kind === 'knowme') {
    const state = structuredClone(current) as NhieState & Partial<KnowState>;
    const choice = move.choice;
    if (choice !== 'a' && choice !== 'b') throw new GameRuleError('Choose one of the two');
    if (state.picks[player]) throw new GameRuleError('You already answered this one');
    if (kind === 'knowme') {
      if (move.cell !== 0 && move.cell !== 1) throw new GameRuleError('Guess what they would pick');
      state.guesses![player] = move.cell === 0 ? 'a' : 'b';
    }
    state.picks[player] = choice;
    const [a, b] = state.picks;
    if (!a || !b) return { state, next: null, status: 'active', winner: null };
    const q = state.order[state.round];
    if (kind === 'knowme') {
      state.rounds.push({ q, answers: [a, b], guesses: [state.guesses![0]!, state.guesses![1]!] } as never);
      state.guesses = [null, null];
    } else state.rounds.push({ q, answers: [a, b] });
    state.round++;
    state.picks = [null, null];
    if (state.round < state.order.length) return { state, next: null, status: 'active', winner: null };
    if (kind === 'nhie') return { state, next: null, status: 'done', winner: null };
    return finish(state, knowScores(state as KnowState));
  }

  if (kind === 'bulls') {
    const state = structuredClone(current as BullsState);
    if (state.phase === 'set') {
      if (move.action !== 'set') throw new GameRuleError('Pick your secret number first');
      if (state.secrets[player]) throw new GameRuleError('You already picked your number');
      state.secrets[player] = bullsNumber(move.text);
      if (!state.secrets[1 - player]) return { state, next: null, status: 'active', winner: null };
      state.phase = 'guess';
      return active(state, 0);
    }
    if (turn !== player) throw new GameRuleError("It's not your turn");
    if (move.action !== 'guess') throw new GameRuleError('Guess their number');
    const guess = bullsNumber(move.text);
    state.guesses[player].push({ guess, ...bullsScore(state.secrets[1 - player]!, guess) });
    // Player 1 always gets the same number of guesses, so a round ends after their guess.
    if (player === 0) return active(state, 1);
    const solved = state.guesses.map((g) => g[g.length - 1]?.plus === BULLS_DIGITS);
    if (solved[0] && solved[1]) return { state, next: null, status: 'draw', winner: null };
    if (solved[0] || solved[1]) return { state, next: null, status: 'won', winner: solved[0] ? 0 : 1 };
    if (state.guesses[1].length >= BULLS_MAX) return { state, next: null, status: 'draw', winner: null };
    return active(state, 0);
  }

  if (SIMULTANEOUS.has(kind)) throw new GameRuleError('Unknown move');
  if (turn !== player) throw new GameRuleError("It's not your turn");
  const other = 1 - player;

  switch (kind) {
    case 'hangman': {
      const state = structuredClone(current as HangmanState);
      const round = state.rounds[state.rounds.length - 1];
      if (round.word === null) {
        if (move.action !== 'prompt') throw new GameRuleError('Choose a secret word');
        round.word = hangmanWord(move.text);
        return active(state, other);
      }
      if (move.action === 'guess') {
        const letter = upper((move.text ?? '').trim());
        if (!/^\p{L}$/u.test(letter)) throw new GameRuleError('Pick one letter');
        if (round.guessed.includes(letter)) throw new GameRuleError('You already tried that letter');
        round.guessed.push(letter);
        if (!round.word.includes(letter)) round.wrong++;
        else if (hangmanSolved(round)) round.solved = true;
      } else if (move.action === 'solve') {
        const guess = upper((move.text ?? '').trim().replace(/\s+/g, ' '));
        if (!guess) throw new GameRuleError('Write the word');
        if (guess === round.word) {
          round.solved = true;
          for (const ch of round.word) if (ch !== ' ' && !round.guessed.includes(ch)) round.guessed.push(ch);
        } else round.wrong = Math.min(HANGMAN_LIVES, round.wrong + 2);
      } else throw new GameRuleError('Guess a letter or the word');
      if (!round.solved && round.wrong < HANGMAN_LIVES) return active(state, player);
      if (!round.solved) round.solved = false;
      state.scores[round.solved ? player : round.setter]++;
      if (state.rounds.length >= state.total) return finish(state, state.scores);
      // Roles swap: whoever guessed picks the next word.
      state.rounds.push(hangmanRound(player));
      return active(state, player);
    }

    case 'dots': {
      const state = structuredClone(current as DotsState);
      const line = move.cell;
      if (!int(line) || line! < 0 || line! >= DOTS_LINES) throw new GameRuleError('Choose a line');
      if (state.lines[line!]) throw new GameRuleError('That line is taken');
      state.lines[line!] = player + 1;
      state.last = line!;
      let closed = 0;
      for (let r = 0; r < DOTS; r++) for (let c = 0; c < DOTS; c++) {
        const box = r * DOTS + c;
        if (!state.boxes[box] && boxLines(r, c).every((l) => state.lines[l])) {
          state.boxes[box] = player + 1;
          closed++;
        }
      }
      if (state.lines.every(Boolean)) return finish(state, [count(state.boxes, 1), count(state.boxes, 2)]);
      // Closing a box earns another line.
      return active(state, closed ? player : other);
    }

    case 'reversi': {
      const state = structuredClone(current as ReversiState);
      const cell = move.cell;
      const mark = player + 1;
      if (!int(cell) || cell! < 0 || cell! >= REVERSI * REVERSI) throw new GameRuleError('Choose a square');
      const flips = reversiFlips(state.board, cell!, mark);
      if (!flips.length) throw new GameRuleError('You have to turn over at least one disc');
      state.board[cell!] = mark;
      for (const f of flips) state.board[f] = mark;
      state.last = cell!;
      state.passed = null;
      const scores = [count(state.board, 1), count(state.board, 2)];
      if (reversiMoves(state.board, 3 - mark).length) return active(state, other);
      // The other player can't move: they pass, unless nobody can.
      if (reversiMoves(state.board, mark).length) {
        state.passed = other;
        return active(state, player);
      }
      return finish(state, scores);
    }

    case 'mangala': {
      const state = structuredClone(current as MangalaState);
      const pit = move.cell;
      if (!int(pit) || pit! < 0 || pit! > 5) throw new GameRuleError('Choose one of your pits');
      const p = state.pits;
      const start = player * 7 + pit!;
      const myStore = player * 7 + 6, theirStore = other * 7 + 6;
      const stones = p[start];
      if (!stones) throw new GameRuleError('That pit is empty');
      const step = (i: number) => {
        let n = (i + 1) % 14;
        if (n === theirStore) n = (n + 1) % 14;
        return n;
      };
      p[start] = 0;
      let pos = start;
      // Mangala: the first stone goes back into the pit it came from (a single stone moves on).
      if (stones === 1) { pos = step(start); p[pos]++; }
      else {
        p[start] = 1;
        for (let left = stones - 1; left > 0; left--) { pos = step(pos); p[pos]++; }
      }
      let captured = 0;
      const mine = (i: number) => i >= player * 7 && i < player * 7 + 6;
      const theirs = (i: number) => i >= other * 7 && i < other * 7 + 6;
      if (theirs(pos) && p[pos] % 2 === 0) {
        captured = p[pos];
        p[myStore] += p[pos];
        p[pos] = 0;
      } else if (mine(pos) && p[pos] === 1 && p[12 - pos] > 0) {
        captured = p[12 - pos] + 1;
        p[myStore] += captured;
        p[pos] = 0;
        p[12 - pos] = 0;
      }
      const extra = pos === myStore;
      state.last = { player, pit: start, extra, captured };
      const sideEmpty = (who: number) => p.slice(who * 7, who * 7 + 6).every((n) => n === 0);
      for (const who of [player, other]) {
        if (!sideEmpty(who)) continue;
        // Whoever runs out first also takes the stones left on the other side.
        const rest = 1 - who;
        for (let i = rest * 7; i < rest * 7 + 6; i++) { p[who * 7 + 6] += p[i]; p[i] = 0; }
        return finish(state, [p[6], p[13]]);
      }
      return active(state, extra ? player : other);
    }

    case 'battleship': {
      const state = structuredClone(current as BattleshipState);
      const cell = move.cell;
      if (!int(cell) || cell! < 0 || cell! >= SEA * SEA) throw new GameRuleError('Choose a square');
      if (state.shots[player].includes(cell!)) throw new GameRuleError('You already fired there');
      state.shots[player].push(cell!);
      const fleet = state.ships[other];
      const hit = fleet.some((ship) => ship.includes(cell!));
      const shots = new Set(state.shots[player]);
      if (fleet.every((ship) => ship.every((c) => shots.has(c)))) return { state, next: null, status: 'won', winner: player };
      // A hit earns another shot.
      return active(state, hit ? player : other);
    }

    case 'pig': {
      const state = structuredClone(current as PigState);
      const log = (bust: boolean, banked: number) => {
        state.log.push({ player, rolls: state.rolls, banked, bust });
        state.log = state.log.slice(-6);
        state.rolls = [];
      };
      if (move.action === 'roll') {
        const roll = 1 + Math.floor(random() * 6);
        state.rolls = [...state.rolls, roll];
        if (roll === 1) {
          log(true, 0);
          return active(state, other);
        }
        const total = state.rolls.reduce((s, r) => s + r, 0);
        if (state.scores[player] + total >= PIG_TARGET) {
          state.scores[player] += total;
          log(false, total);
          return { state, next: null, status: 'won', winner: player };
        }
        return active(state, player);
      }
      if (move.action === 'hold') {
        const total = state.rolls.reduce((s, r) => s + r, 0);
        if (!total) throw new GameRuleError('Roll at least once');
        state.scores[player] += total;
        log(false, total);
        return active(state, other);
      }
      throw new GameRuleError('Roll or hold');
    }

    case 'wordchain': {
      const state = structuredClone(current as ChainState);
      if (move.action === 'pass') {
        state.gaveUp = player;
        return { state, next: null, status: 'won', winner: other };
      }
      if (move.action !== 'word') throw new GameRuleError('Write a word');
      const word = chainWord(move.text);
      const prev = state.words[state.words.length - 1];
      if (prev && [...word][0] !== chainLetter(prev.word)) throw new GameRuleError(`It has to start with "${upper(chainLetter(prev.word))}"`);
      if (state.words.some((w) => w.word === word)) throw new GameRuleError('That word was already used');
      state.words.push({ by: player, word });
      if (state.words.length >= CHAIN_MAX) return { state, next: null, status: 'draw', winner: null };
      return active(state, other);
    }

    case 'lies': {
      const state = structuredClone(current as LiesState);
      const round = state.rounds[state.rounds.length - 1];
      if (!round.statements) {
        if (move.action !== 'prompt') throw new GameRuleError('Write two truths and a lie');
        const lines = statements(move.text);
        if (move.cell !== 0 && move.cell !== 1 && move.cell !== 2) throw new GameRuleError('Mark which one is the lie');
        round.statements = lines;
        round.lie = move.cell;
        return active(state, other);
      }
      if (move.action !== 'guess' || (move.cell !== 0 && move.cell !== 1 && move.cell !== 2)) throw new GameRuleError('Which one is the lie?');
      round.guess = move.cell;
      state.scores[round.guess === round.lie ? player : round.teller]++;
      if (state.rounds.length >= state.total) return finish(state, state.scores);
      // Whoever guessed tells next.
      state.rounds.push(liesRound(player));
      return active(state, player);
    }

    case 'story': {
      const state = structuredClone(current as StoryState);
      if (move.action !== 'reply') throw new GameRuleError('Write the next line');
      state.lines.push({ by: player, text: written(move.text, STORY_LINE_MAX) });
      if (state.lines.length >= state.total) return { state, next: null, status: 'done', winner: null };
      return active(state, other);
    }
  }
  throw new GameRuleError('Unknown game');
}

export function knowScores(state: KnowState) {
  // You score when you guessed what your partner picked.
  return [0, 1].map((p) => state.rounds.filter((r) => r.guesses[p] === r.answers[1 - p]).length);
}

/* -------------------------------------------------------------------------------------------- */
/* What one player sees                                                                          */

/**
 * The state as `me` may see it (`me` is -1 for someone outside the game). Secrets (the hangman
 * word, the number, the fleet, the lie, this round's picks) stay hidden until they're revealed.
 */
export function extraView(kind: ExtraKind, current: ExtraState, me: number, over: boolean): Record<string, unknown> {
  switch (kind) {
    case 'hangman': {
      const s = current as HangmanState;
      return {
        lives: HANGMAN_LIVES,
        scores: s.scores,
        total: s.total,
        rounds: s.rounds.map((r) => {
          const open = over || r.setter === me || r.solved !== null;
          return {
            setter: r.setter, guessed: r.guessed, wrong: r.wrong, solved: r.solved, ready: r.word !== null,
            word: open ? r.word : null,
            // Hidden letters are empty strings; spaces stay spaces.
            masked: r.word ? [...r.word].map((ch) => (ch === ' ' ? ' ' : open || r.guessed.includes(ch) ? ch : '')) : [],
          };
        }),
      };
    }
    case 'bulls': {
      const s = current as BullsState;
      return {
        phase: s.phase,
        max: BULLS_MAX,
        mySecret: me >= 0 ? s.secrets[me] : null,
        theirSecret: over && me >= 0 ? s.secrets[1 - me] : null,
        ready: s.secrets.map(Boolean),
        guesses: s.guesses,
      };
    }
    case 'dots': {
      const s = current as DotsState;
      return { size: DOTS, lines: s.lines, boxes: s.boxes, last: s.last, scores: [count(s.boxes, 1), count(s.boxes, 2)] };
    }
    case 'reversi': {
      const s = current as ReversiState;
      return { size: REVERSI, board: s.board, last: s.last, passed: s.passed, scores: [count(s.board, 1), count(s.board, 2)] };
    }
    case 'mangala': {
      const s = current as MangalaState;
      return { pits: s.pits, last: s.last, scores: [s.pits[6], s.pits[13]] };
    }
    case 'battleship': {
      const s = current as BattleshipState;
      /** 0 unknown/water, 1 ship, 2 hit, 3 miss, 4 sunk. */
      const sea = (owner: number, reveal: boolean) => {
        const shots = new Set(s.shots[1 - owner]);
        const cells = new Array(SEA * SEA).fill(0);
        for (const c of shots) cells[c] = 3;
        for (const ship of s.ships[owner]) {
          const sunk = ship.every((c) => shots.has(c));
          for (const c of ship) cells[c] = sunk ? 4 : shots.has(c) ? 2 : reveal ? 1 : 0;
        }
        return cells;
      };
      const afloat = (owner: number) => {
        const shots = new Set(s.shots[1 - owner]);
        return s.ships[owner].filter((ship) => !ship.every((c) => shots.has(c))).length;
      };
      const lastShot = (who: number) => s.shots[who][s.shots[who].length - 1] ?? null;
      return {
        size: SEA,
        fleet: FLEET,
        mine: me >= 0 ? sea(me, true) : [],
        theirs: me >= 0 ? sea(1 - me, over) : [],
        afloat: me >= 0 ? [afloat(me), afloat(1 - me)] : [],
        lastShots: me >= 0 ? [lastShot(me), lastShot(1 - me)] : [],
      };
    }
    case 'pig': {
      const s = current as PigState;
      return { target: PIG_TARGET, scores: s.scores, rolls: s.rolls, turnTotal: s.rolls.reduce((a, r) => a + r, 0), log: s.log };
    }
    case 'wordchain': {
      const s = current as ChainState;
      const prev = s.words[s.words.length - 1];
      return { words: s.words, letter: prev ? chainLetter(prev.word) : null, max: CHAIN_MAX, gaveUp: s.gaveUp };
    }
    case 'lies': {
      const s = current as LiesState;
      return {
        scores: s.scores,
        total: s.total,
        rounds: s.rounds.map((r) => ({
          teller: r.teller, statements: r.statements, guess: r.guess,
          lie: r.teller === me || r.guess !== null || over ? r.lie : null,
        })),
      };
    }
    case 'nhie': {
      const s = current as NhieState;
      return {
        round: s.round, total: s.order.length,
        prompt: s.round < s.order.length ? NEVER_HAVE_I_EVER[s.order[s.round]] : null,
        rounds: s.rounds.map((r) => ({ prompt: NEVER_HAVE_I_EVER[r.q], answers: r.answers })),
      };
    }
    case 'knowme': {
      const s = current as KnowState;
      const q = (i: number) => KNOW_ME[i] ?? ['', '', ''];
      return {
        round: s.round, total: s.order.length,
        question: s.round < s.order.length ? q(s.order[s.round]) : null,
        myGuess: me >= 0 ? s.guesses[me] : null,
        scores: knowScores(s),
        rounds: s.rounds.map((r) => ({ question: q(r.q), answers: r.answers, guesses: r.guesses })),
      };
    }
    case 'story': {
      const s = current as StoryState;
      return { starter: STORY_STARTERS[s.starter] ?? STORY_STARTERS[0], lines: s.lines, total: s.total, max: STORY_LINE_MAX };
    }
  }
}

/** This round's secret picks (the simultaneous games), for "you answered / they answered". */
export function extraPicks(kind: ExtraKind, current: ExtraState): (string | null)[] | null {
  if (kind === 'nhie' || kind === 'knowme') return (current as NhieState).picks;
  return null;
}
