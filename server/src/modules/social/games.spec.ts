import { describe, expect, it } from 'vitest';
import { applyMove, C4_COLS, GameRuleError, GOMOKU_SIZE, initialState, TOT_ROUNDS, type BoardState, type MemoryState, type RpsState, type TotState } from './games.js';

describe('mini games', () => {
  it('XOX: a row wins and turns alternate', () => {
    let state = initialState('xox');
    let turn: number | null = 0;
    for (const [player, cell] of [[0, 0], [1, 3], [0, 1], [1, 4]] as const) {
      const out = applyMove('xox', state, player, turn, { cell });
      expect(out.status).toBe('active');
      state = out.state; turn = out.next;
    }
    const win = applyMove('xox', state, 0, turn, { cell: 2 });
    expect(win.status).toBe('won');
    expect(win.winner).toBe(0);
    expect((win.state as BoardState).line).toEqual([0, 1, 2]);
  });

  it('XOX: rejects playing out of turn or on a taken square', () => {
    const state = applyMove('xox', initialState('xox'), 0, 0, { cell: 4 }).state;
    expect(() => applyMove('xox', state, 0, 1, { cell: 0 })).toThrow(GameRuleError);
    expect(() => applyMove('xox', state, 1, 1, { cell: 4 })).toThrow(GameRuleError);
  });

  it('XOX: a full board without a line is a draw', () => {
    let state = initialState('xox');
    let turn: number | null = 0;
    let last;
    for (const cell of [0, 1, 2, 4, 3, 5, 7, 6, 8]) {
      last = applyMove('xox', state, turn!, turn, { cell });
      state = last.state; turn = last.next;
    }
    expect(last!.status).toBe('draw');
  });

  it('Connect Four: pieces fall and four in a column wins', () => {
    let state = initialState('connect4');
    let turn: number | null = 0;
    let out;
    for (const col of [3, 0, 3, 0, 3, 0, 3]) {
      out = applyMove('connect4', state, turn!, turn, { cell: col });
      state = out.state; turn = out.next;
    }
    expect(out!.status).toBe('won');
    expect(out!.winner).toBe(0);
    const board = (state as BoardState).board;
    expect(board[5 * C4_COLS + 3]).toBe(1);
    expect(board[5 * C4_COLS + 0]).toBe(2);
  });

  it('Connect Four: diagonal win and full column', () => {
    let state = initialState('connect4');
    let turn: number | null = 0;
    let out;
    // Builds a rising diagonal for player 0 on columns 0..3.
    for (const col of [0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]) {
      out = applyMove('connect4', state, turn!, turn, { cell: col });
      state = out.state; turn = out.next;
    }
    expect(out!.status).toBe('won');
    expect(out!.winner).toBe(0);
    let full = initialState('connect4');
    let t: number | null = 0;
    for (let i = 0; i < 6; i++) { const o = applyMove('connect4', full, t!, t, { cell: 5 }); full = o.state; t = o.next; }
    expect(() => applyMove('connect4', full, t!, t, { cell: 5 })).toThrow(GameRuleError);
  });

  it('Rock-paper-scissors: hidden picks, ties replay, first to two wins', () => {
    let state = initialState('rps');
    const play = (player: number, choice: 'rock' | 'paper' | 'scissors') => {
      const out = applyMove('rps', state, player, null, { choice });
      state = out.state;
      return out;
    };
    play(0, 'rock');
    expect((state as RpsState).picks).toEqual(['rock', null]);
    expect(() => play(0, 'paper')).toThrow(GameRuleError);
    play(1, 'rock');
    expect((state as RpsState).rounds.at(-1)?.winner).toBeNull();
    play(1, 'paper'); play(0, 'rock');
    expect((state as RpsState).scores).toEqual([0, 1]);
    play(0, 'scissors');
    const end = play(1, 'paper');
    expect((state as RpsState).scores).toEqual([1, 1]);
    expect(end.status).toBe('active');
    play(0, 'paper');
    const final = play(1, 'scissors');
    expect(final.status).toBe('won');
    expect(final.winner).toBe(1);
  });

  it('Memory: a pair scores and keeps the turn, a miss stays visible then passes the turn', () => {
    // Deterministic deck: pairs sit next to each other.
    const state = { ...(initialState('memory') as MemoryState) };
    state.cards = ['A', 'A', 'B', 'B', 'C', 'C', 'D', 'D', 'E', 'E', 'F', 'F', 'G', 'G', 'H', 'H'];
    let s: MemoryState = state;
    let out = applyMove('memory', s, 0, 0, { cell: 0 });
    expect(out.next).toBe(0);
    s = out.state as MemoryState;
    expect(() => applyMove('memory', s, 0, 0, { cell: 0 })).toThrow(GameRuleError);
    out = applyMove('memory', s, 0, 0, { cell: 1 });
    s = out.state as MemoryState;
    expect(s.owners.slice(0, 2)).toEqual([1, 1]);
    expect(s.scores).toEqual([1, 0]);
    expect(out.next).toBe(0);
    s = applyMove('memory', s, 0, 0, { cell: 2 }).state as MemoryState;
    out = applyMove('memory', s, 0, 0, { cell: 4 });
    s = out.state as MemoryState;
    expect(s.shown).toEqual([2, 4]);
    expect(out.next).toBe(1);
    expect(() => applyMove('memory', s, 0, 1, { cell: 3 })).toThrow(GameRuleError);
    s = applyMove('memory', s, 1, 1, { cell: 2 }).state as MemoryState;
    expect(s.shown).toEqual([]);
  });

  it('Memory: the player with more pairs wins when the board is cleared', () => {
    let s = { ...(initialState('memory') as MemoryState) };
    s.cards = ['A', 'A', 'B', 'B', 'C', 'C', 'D', 'D', 'E', 'E', 'F', 'F', 'G', 'G', 'H', 'H'];
    let out;
    for (let i = 0; i < 16; i++) { out = applyMove('memory', s, 0, 0, { cell: i }); s = out.state as MemoryState; }
    expect(out!.status).toBe('won');
    expect(out!.winner).toBe(0);
    expect(s.scores).toEqual([8, 0]);
  });

  it('Memory: a new deck holds every face exactly twice', () => {
    const s = initialState('memory') as MemoryState;
    const counts = new Map<string, number>();
    for (const c of s.cards) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect(s.cards).toHaveLength(16);
    expect([...counts.values()].every((n) => n === 2)).toBe(true);
  });

  it('This or That: secret answers, revealed together, done after the last question', () => {
    let s = initialState('thisorthat') as TotState;
    expect(s.order).toHaveLength(TOT_ROUNDS);
    expect(new Set(s.order).size).toBe(TOT_ROUNDS);
    expect(() => applyMove('thisorthat', s, 0, null, { choice: 'rock' })).toThrow(GameRuleError);
    let out = applyMove('thisorthat', s, 0, null, { choice: 'a' });
    s = out.state as TotState;
    expect(s.rounds).toHaveLength(0);
    expect(() => applyMove('thisorthat', s, 0, null, { choice: 'b' })).toThrow(GameRuleError);
    for (let r = 0; r < TOT_ROUNDS; r++) {
      if (r > 0) s = applyMove('thisorthat', s, 0, null, { choice: 'a' }).state as TotState;
      out = applyMove('thisorthat', s, 1, null, { choice: r % 2 ? 'a' : 'b' });
      s = out.state as TotState;
    }
    expect(out.status).toBe('done');
    expect(s.rounds).toHaveLength(TOT_ROUNDS);
    expect(s.rounds[0].answers).toEqual(['a', 'b']);
  });

  it('Five in a Row: five diagonal stones win, four do not', () => {
    let state = initialState('gomoku');
    let turn: number | null = 0;
    let out;
    const n = GOMOKU_SIZE;
    const moves = [0, 8, n + 1, 17, 2 * n + 2, 26, 3 * n + 3, 35];
    for (const cell of moves) {
      out = applyMove('gomoku', state, turn!, turn, { cell });
      expect(out.status).toBe('active');
      state = out.state; turn = out.next;
    }
    out = applyMove('gomoku', state, turn!, turn, { cell: 4 * n + 4 });
    expect(out.status).toBe('won');
    expect((out.state as BoardState).line).toEqual([0, n + 1, 2 * n + 2, 3 * n + 3, 4 * n + 4]);
  });
});
