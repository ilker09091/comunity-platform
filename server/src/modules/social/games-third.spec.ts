import { describe, expect, it } from 'vitest';
import { damaMoves, damaPlay, damaResult, damaStart, type DamaState } from './dama.js';
import { applyMove, firstTurn, GameRuleError, initialState, SIMULTANEOUS_START, type GameState } from './games.js';
import {
  buildSearch, colorMarks, plain, pistiScores, searchLine, SEARCH_SIZE, SEARCH_WORDS, sudokuConflicts, sudokuSolution, sudokuValid, thirdView,
  type BucketState, type CoinState, type DailyState, type LoveState, type PistiState, type SudokuState, type WheelState, type WordSearchState,
} from './games-third.js';
import { BAR, destination, OFF, tavlaMove, tavlaStart, tavlaSteps, tavlaUndo, type TavlaState } from './tavla.js';

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}
const empty = () => Array.from({ length: 64 }, () => 0);

describe('russian draughts', () => {
  const sq = (r: number, c: number) => r * 8 + c;
  const state = (board: number[], toMove = 0): DamaState => ({ board, toMove, quiet: 0, last: null, captured: [0, 0] });

  it('starts with 12 men each on the dark squares; men step diagonally forward', () => {
    const s = damaStart();
    expect(s.board.filter((v) => v === 1).length).toBe(12);
    expect(s.board.filter((v) => v === 2).length).toBe(12);
    expect(s.board.every((v, i) => !v || (Math.floor(i / 8) + (i % 8)) % 2 === 1)).toBe(true);
    const moves = damaMoves(s);
    expect(moves.length).toBe(7);
    expect(moves.every(([from, to]) => Math.floor(to / 8) === Math.floor(from / 8) - 1 && Math.abs((to % 8) - (from % 8)) === 1)).toBe(true);
  });

  it('capturing is compulsory, men take backwards too, any sequence may be chosen', () => {
    const board = empty();
    board[sq(4, 3)] = 1;
    board[sq(5, 2)] = 2; // behind the man: a backward capture
    board[sq(3, 4)] = 2; board[sq(1, 4)] = 2; // forward: a double capture
    const s = state(board);
    const moves = damaMoves(s).map((m) => m.join('-')).sort();
    // Not only the longest: the single backward capture is allowed too.
    expect(moves).toEqual([[sq(4, 3), sq(2, 5), sq(0, 3)].join('-'), [sq(4, 3), sq(6, 1)].join('-')].sort());
    expect(damaPlay(s, [sq(4, 3), sq(3, 2)])).toBeNull();
    // A started sequence must be finished: stopping after one jump is not a move.
    expect(damaPlay(s, [sq(4, 3), sq(2, 5)])).toBeNull();
  });

  it('a man that reaches the far row mid-capture goes on as a flying king', () => {
    const board = empty();
    board[sq(2, 1)] = 1;
    board[sq(1, 2)] = 2; // taken, landing on row 0 → crowned
    board[sq(2, 5)] = 2; // then taken by the new king along the diagonal (0,3)→(3,6)
    const s = state(board);
    const moves = damaMoves(s);
    expect(moves.some((m) => m.length === 3 && m[1] === sq(0, 3))).toBe(true);
    const after = damaPlay(s, moves.find((m) => m.length === 3)!)!;
    expect(after.board[sq(1, 2)]).toBe(0);
    expect(after.board[sq(2, 5)]).toBe(0);
    expect(after.board[moves.find((m) => m.length === 3)!.at(-1)!]).toBe(3);
    expect(after.captured[0]).toBe(2);
  });

  it('kings fly and, if they can, must land where the capture goes on', () => {
    const board = empty();
    board[sq(7, 0)] = 3; board[sq(5, 2)] = 2; board[sq(2, 3)] = 2;
    // After taking (5,2) the king could land on (4,3)…(0,7), but only from (3,4) can it go on
    // (over (2,3) to (1,2) or (0,1)), so it has to land there.
    const moves = damaMoves(state(board)).map((m) => m.join('-')).sort();
    expect(moves).toEqual([
      [sq(7, 0), sq(3, 4), sq(1, 2)].join('-'),
      [sq(7, 0), sq(3, 4), sq(0, 1)].join('-'),
    ].sort());
    // With nothing to go on to, every landing square behind the piece is allowed.
    const single = empty();
    single[sq(7, 0)] = 3; single[sq(5, 2)] = 2;
    expect(damaMoves(state(single)).map((m) => m[1]).sort((a, b) => a - b)).toEqual([sq(0, 7), sq(1, 6), sq(2, 5), sq(3, 4), sq(4, 3)].sort((a, b) => a - b));
  });

  it('a taken piece stays until the move ends and is never taken twice', () => {
    const board = empty();
    board[sq(4, 3)] = 3;
    board[sq(3, 4)] = 2; board[sq(3, 2)] = 2; board[sq(5, 2)] = 2; board[sq(5, 4)] = 2;
    const s = state(board);
    const moves = damaMoves(s);
    expect(moves.length).toBeGreaterThan(0);
    // Every jump takes a different piece: the pieces taken equal the jumps made.
    for (const m of moves) expect(damaPlay(s, m)!.captured[0]).toBe(m.length - 1);
  });

  it('no pieces or no moves loses; lone kings draw', () => {
    const board = empty();
    board[sq(4, 3)] = 1; board[sq(3, 4)] = 2;
    const won = damaPlay(state(board), [sq(4, 3), sq(2, 5)])!;
    expect(damaResult(won)).toEqual({ winner: 0, draw: false });
    const kings = empty();
    kings[sq(7, 0)] = 3; kings[sq(0, 1)] = 4;
    expect(damaResult(state(kings, 1))).toEqual({ winner: null, draw: true });
  });
});

describe('tavla', () => {
  const base = (): TavlaState => {
    const s = tavlaStart(seeded(1));
    return { ...s, toMove: 0, dice: [6, 5], rolled: [6, 5], turnStart: { points: s.points, bar: s.bar, off: s.off, dice: [6, 5] }, played: [] };
  };

  it('starts with 15 checkers each and the higher opening die moves first', () => {
    const s = tavlaStart(seeded(5));
    expect(s.points.filter((v) => v > 0).reduce((a, b) => a + b, 0)).toBe(15);
    expect(-s.points.filter((v) => v < 0).reduce((a, b) => a + b, 0)).toBe(15);
    expect(s.toMove).toBe(s.rolled[0] > s.rolled[1] ? 0 : 1);
    expect(firstTurn('tavla', s as unknown as GameState)).toBe(s.toMove);
  });

  it('a blocked point cannot be landed on; a lone checker gets hit', () => {
    const s = base();
    // 23 - 6 = 17: free. 12 - 5 = 7: own checkers. 23 - 5 = 18: five enemy checkers (blocked).
    expect(destination(s, 0, 23, 6)).toBe(17);
    expect(destination(s, 0, 23, 5)).toBeNull();
    const blot = { ...s, points: [...s.points] };
    blot.points[17] = -1;
    const out = tavlaMove(blot, 0, 23, 6, seeded(2))!;
    expect(out.state.bar[1]).toBe(1);
    expect(out.state.points[17]).toBe(1);
  });

  it('a checker on the bar must come in first', () => {
    const s = { ...base(), bar: [1, 0] };
    s.points = [...s.points];
    s.points[23] = 1;
    expect(tavlaSteps(s, 0).every((st) => st.from === BAR)).toBe(true);
  });

  it('bearing off needs everyone home; higher dice only from the furthest point', () => {
    const points = Array.from({ length: 24 }, () => 0);
    points[0] = 13; points[3] = 2; points[23] = -15;
    const s: TavlaState = { ...base(), points, dice: [6, 1], rolled: [6, 1] };
    expect(destination(s, 0, 3, 6)).toBe(OFF);
    expect(destination(s, 0, 0, 6)).toBeNull(); // a checker further back (on 3) must go first
    const away = { ...s, points: [...points] };
    away.points[3] = 1; away.points[10] = 1;
    expect(destination(away, 0, 0, 1)).toBeNull();
  });

  it('turns pass after both dice, undo takes the turn back, 15 off wins', () => {
    const s = base();
    const one = tavlaMove(s, 0, 23, 6, seeded(3))!;
    expect(one.state.toMove).toBe(0);
    expect(tavlaUndo(one.state)!.points).toEqual(s.points);
    const two = tavlaMove(one.state, 0, 12, 5, seeded(3))!;
    expect(two.state.toMove).toBe(1);
    expect(two.state.played).toEqual([]);
    const points = Array.from({ length: 24 }, () => 0);
    points[0] = 1; points[23] = -15;
    const last: TavlaState = { ...base(), points, off: [14, 0], dice: [1, 2], rolled: [1, 2] };
    expect(tavlaMove(last, 0, 0, 2, seeded(1))!.winner).toBe(0);
  });

  it('when only one die can be played, it must be the higher one', () => {
    const points = Array.from({ length: 24 }, () => 0);
    points[8] = 1;
    points[2] = -2; points[3] = -2; // 8-6=2 blocked, 8-5=3 blocked … only one die works
    points[23] = -11;
    const s: TavlaState = { ...base(), points, dice: [6, 4], rolled: [6, 4] };
    s.points[4] = -0;
    // 8-4 = 4 is free, then 4-6 = off? not all home → no second move. 8-6 = 2 blocked. Only the 4 can move.
    const steps = tavlaSteps(s, 0);
    expect(steps.map((st) => st.die)).toEqual([4]);
  });
});

describe('word, card and party games', () => {
  it('Color Word marks repeated letters once', () => {
    expect(colorMarks('KALEM', 'KALEM')).toEqual([2, 2, 2, 2, 2]);
    expect(colorMarks('KALEM', 'MELEK')).toEqual([1, 0, 2, 2, 1]);
    expect(colorMarks('ABBEY', 'BBBBB')).toEqual([0, 2, 2, 0, 0]);
    let out = applyMove('colorword', initialState('colorword'), 0, 0, { action: 'prompt', text: 'kalem' });
    expect(() => applyMove('colorword', out.state, 1, 1, { action: 'guess', text: 'abc' })).toThrow(GameRuleError);
    out = applyMove('colorword', out.state, 1, 1, { action: 'guess', text: 'kalem' });
    expect(out.next).toBe(1);
    expect((thirdView('colorword', out.state as never, 1, false).scores as number[])[1]).toBe(6);
  });

  it('Love Map: the asker judges a guess, a word-for-word answer counts by itself', () => {
    let out = applyMove('lovemap', initialState('lovemap'), 0, 0, { action: 'prompt', text: 'Where did we meet?\nAt the café' });
    const hidden = thirdView('lovemap', out.state as never, 1, false) as { rounds: { answer: string | null }[] };
    expect(hidden.rounds[0].answer).toBeNull();
    out = applyMove('lovemap', out.state, 1, 1, { action: 'reply', text: 'at the cafe' });
    // "cafe" vs "café" isn't the same word for word: the asker decides.
    expect(out.next).toBe(0);
    out = applyMove('lovemap', out.state, 0, 0, { action: 'judge', cell: 1 });
    expect((out.state as LoveState).scores).toEqual([0, 1]);
    expect(out.next).toBe(1);
    out = applyMove('lovemap', out.state, 1, 1, { action: 'prompt', text: 'My favorite color?\nBlue' });
    out = applyMove('lovemap', out.state, 0, 0, { action: 'reply', text: 'blue!' });
    expect((out.state as LoveState).scores).toEqual([1, 1]);
    expect(plain('Aşkım!')).toBe('aşkım');
  });

  it('Emoji riddle: only emojis as the clue, three tries', () => {
    expect(() => applyMove('emoji', initialState('emoji'), 0, 0, { action: 'prompt', text: 'lion king\nThe Lion King' })).toThrow(GameRuleError);
    let out = applyMove('emoji', initialState('emoji'), 0, 0, { action: 'prompt', text: '🦁👑\nThe Lion King' });
    for (const g of ['Madagascar', 'Simba']) out = applyMove('emoji', out.state, 1, 1, { action: 'guess', text: g });
    expect(out.next).toBe(1);
    out = applyMove('emoji', out.state, 1, 1, { action: 'guess', text: 'the lion king' });
    expect((out.state as { scores: number[] }).scores).toEqual([0, 1]);
  });

  it('Question of the day: answers stay hidden until both answered', () => {
    let out = { state: initialState('daily'), next: null as number | null, status: 'active', winner: null as number | null };
    out = applyMove('daily', out.state, 0, null, { action: 'answer', text: 'You did' });
    expect(thirdView('daily', out.state as DailyState, 1, false).theirs).toBeNull();
    out = applyMove('daily', out.state, 1, null, { action: 'answer', text: 'Pizza' });
    expect(out.status).toBe('done');
    expect(thirdView('daily', out.state as DailyState, 1, true).theirs).toBe('You did');
  });

  it("Who's more likely: picks point at people", () => {
    let out = { state: initialState('whomore', seeded(2)), next: null as number | null, status: 'active', winner: null as number | null };
    out = applyMove('whomore', out.state, 0, null, { choice: 'a' }); // "me"
    out = applyMove('whomore', out.state, 1, null, { choice: 'b' }); // "them" → also player 0
    const view = thirdView('whomore', out.state as never, 0, false) as { rounds: { picked: number[] }[] };
    expect(view.rounds[0].picked).toEqual([0, 0]);
    expect(SIMULTANEOUS_START.includes('whomore')).toBe(true);
  });

  it('Bucket list: add, tick and close from either side', () => {
    let out = applyMove('bucket', initialState('bucket'), 1, null, { action: 'add', text: 'See the northern lights' });
    expect(() => applyMove('bucket', out.state, 0, null, { action: 'add', text: 'see the northern lights' })).toThrow(GameRuleError);
    out = applyMove('bucket', out.state, 0, null, { action: 'toggle', cell: 0 });
    expect((out.state as BucketState).items[0]).toMatchObject({ done: true, doneBy: 0 });
    out = applyMove('bucket', out.state, 0, null, { action: 'close' });
    expect(out.status).toBe('done');
  });

  it('Sudoku: a full valid grid wins, given numbers are locked', () => {
    const solution = sudokuSolution(seeded(4));
    expect(sudokuValid(solution)).toBe(true);
    const state = initialState('sudoku', seeded(4)) as SudokuState;
    const given = state.puzzle.findIndex(Boolean);
    expect(() => applyMove('sudoku', state, 0, null, { action: 'set', cell: given, text: '1' })).toThrow(GameRuleError);
    // Fill player 1's board from a valid solution of the same puzzle.
    const holes = state.puzzle.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
    let out = { state: state as GameState, next: null as number | null, status: 'active', winner: null as number | null };
    // The generator's solution is the puzzle's solution.
    const full = sudokuSolution(seeded(4));
    for (const cell of holes) out = applyMove('sudoku', out.state, 1, null, { action: 'set', cell, text: String(full[cell]) });
    expect(out.status).toBe('won');
    expect(out.winner).toBe(1);
    const clash = [...full];
    clash[1] = clash[0];
    expect(sudokuConflicts(clash)).toContain(0);
  });

  it('Word search: words are placed and found by dragging start to end', () => {
    const s = buildSearch('tr', seeded(9));
    expect(s.words.length).toBe(SEARCH_WORDS);
    for (const w of s.words) expect(w.cells.map((c) => s.grid[c]).join('')).toBe(w.word);
    expect(searchLine(0, 2)).toEqual([0, 1, 2]);
    expect(searchLine(0, SEARCH_SIZE + 2)).toBeNull();
    const w = s.words[0];
    const first = w.cells[0], last = w.cells[w.cells.length - 1];
    let out = applyMove('wordsearch', s, 0, null, { cell: last * 100 + first }); // backwards counts too
    expect((out.state as WordSearchState).words[0].by).toBe(0);
    expect(() => applyMove('wordsearch', out.state, 1, null, { cell: first * 100 + last })).toThrow(GameRuleError);
    for (const x of s.words.slice(1)) out = applyMove('wordsearch', out.state, 1, null, { cell: x.cells[0] * 100 + x.cells[x.cells.length - 1] });
    expect(out.status).toBe('won');
    expect(out.winner).toBe(1);
  });

  it('Pişti: matching rank or a jack takes the pile, a single matching card is a pişti', () => {
    const s = initialState('pisti', seeded(6)) as PistiState;
    expect(s.hands[0].length).toBe(4);
    expect(s.deck.length).toBe(52 - 12);
    expect(s.pile[3].startsWith('J')).toBe(false);
    const rigged: PistiState = { ...s, pile: ['7♠'], hands: [['7♥', '2♣', '3♣', '4♣'], ['J♠', '9♦', '8♦', '5♦']] };
    let out = applyMove('pisti', rigged, 0, 0, { cell: 0 });
    expect((out.state as PistiState).pistis[0]).toEqual([10]);
    out = applyMove('pisti', out.state, 1, 1, { cell: 1 });
    out = applyMove('pisti', out.state, 0, 0, { cell: 0 }); // 2♣ on 9♦: no take
    out = applyMove('pisti', out.state, 1, 1, { cell: 0 }); // jack takes two cards: not a pişti
    expect((out.state as PistiState).pistis[1]).toEqual([]);
    expect((out.state as PistiState).captured[1].length).toBe(3);
    expect(pistiScores({ ...rigged, captured: [['10♦', 'A♠'], []], pistis: [[10], []] })).toEqual([3 + 1 + 10 + 3, 0]);
  });

  it('Pişti: playing out the whole deck ends the game', () => {
    let out = { state: initialState('pisti', seeded(8)), next: 0 as number | null, status: 'active', winner: null as number | null };
    for (let i = 0; i < 48 && out.status === 'active'; i++) out = applyMove('pisti', out.state, out.next!, out.next, { cell: 0 });
    expect(out.status === 'won' || out.status === 'draw').toBe(true);
    const total = (out.state as PistiState).captured.flat().length + (out.state as PistiState).pile.length;
    expect(total).toBe(52);
  });

  it('Coin toss and spin the wheel', () => {
    let out = applyMove('coin', initialState('coin'), 0, 0, { action: 'prompt', text: 'Who does the dishes?' });
    out = applyMove('coin', out.state, 1, 1, { choice: 'a' }, () => 0.1);
    expect((out.state as CoinState).result).toBe('a');
    expect(out.winner).toBe(1);
    expect(() => applyMove('wheel', initialState('wheel'), 0, 0, { action: 'prompt', text: 'Only one' })).toThrow(GameRuleError);
    out = applyMove('wheel', initialState('wheel'), 0, 0, { action: 'prompt', text: 'Pizza\nSushi\nKebab' });
    out = applyMove('wheel', out.state, 1, 1, { action: 'roll' }, () => 0.99);
    expect((out.state as WheelState).result).toBe(2);
    expect(out.status).toBe('done');
  });

  it('Chess and Dama through the game engine', () => {
    const out = applyMove('chess', initialState('chess'), 0, 0, { action: 'move', text: '52-36' });
    expect(out.next).toBe(1);
    expect(() => applyMove('chess', out.state, 1, 1, { action: 'move', text: '52-36' })).toThrow(GameRuleError);
    const d = applyMove('dama', initialState('dama'), 0, 0, { action: 'move', text: '40-33' });
    expect(d.next).toBe(1);
    expect(() => applyMove('dama', d.state, 1, 1, { action: 'move', text: '17-33' })).toThrow(GameRuleError);
  });
});
