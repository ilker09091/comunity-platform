import { describe, expect, it } from 'vitest';
import { applyMove, GameRuleError, initialState, SIMULTANEOUS_START, type GameMove, type GameState } from './games.js';
import {
  boxLines, bullsScore, chainLetter, DOTS, DOTS_LINES, extraView, FLEET, HANGMAN_LIVES, KNOW_ROUNDS, NHIE_ROUNDS, PIG_TARGET, placeFleet,
  reversiMoves, SEA, STORY_LINES, type BattleshipState, type BullsState, type DotsState, type HangmanState, type MangalaState,
  type ReversiState,
} from './games-extra.js';
import type { GameKind } from '../../database/migrations/1760193700000-EvenMoreGames.js';

/** Plays moves in order ([player, move]); each must be legal. Returns the last outcome. */
function play(kind: GameKind, moves: [number, GameMove][], state: GameState = initialState(kind, seeded(1)), turn: number | null = SIMULTANEOUS_START.includes(kind) ? null : 0) {
  let out = { state, next: turn, status: 'active' as string, winner: null as number | null };
  for (const [player, move] of moves) {
    out = applyMove(kind, out.state, player, out.next, move);
  }
  return out;
}

/** A small deterministic random source. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

describe('more chat games', () => {
  it('Hangman: the setter picks a word, the guesser finds it, then roles swap', () => {
    let out = play('hangman', [[0, { action: 'prompt', text: 'kedi' }]]);
    expect(out.next).toBe(1);
    // The guesser can't see the word yet.
    const hidden = extraView('hangman', out.state as HangmanState, 1, false) as { rounds: { word: string | null; masked: string[] }[] };
    expect(hidden.rounds[0].word).toBeNull();
    expect(hidden.rounds[0].masked).toEqual(['', '', '', '']);
    for (const letter of ['k', 'e', 'd']) out = applyMove('hangman', out.state, 1, out.next, { action: 'guess', text: letter });
    expect(out.next).toBe(1);
    out = applyMove('hangman', out.state, 1, out.next, { action: 'guess', text: 'i' });
    // Turkish casing: "i" is "İ".
    expect((out.state as HangmanState).rounds[0].solved).toBe(true);
    expect((out.state as HangmanState).scores).toEqual([0, 1]);
    expect(out.next).toBe(1);
    expect((out.state as HangmanState).rounds[1].setter).toBe(1);
  });

  it('Hangman: six wrong letters hang the guesser and the game ends after two rounds', () => {
    let out = play('hangman', [[0, { action: 'prompt', text: 'AŞK' }]]);
    for (const letter of ['B', 'C', 'D', 'E', 'F', 'G']) out = applyMove('hangman', out.state, 1, out.next, { action: 'guess', text: letter });
    expect((out.state as HangmanState).rounds[0].wrong).toBe(HANGMAN_LIVES);
    expect((out.state as HangmanState).scores).toEqual([1, 0]);
    out = applyMove('hangman', out.state, 1, out.next, { action: 'prompt', text: 'su' });
    out = applyMove('hangman', out.state, 0, out.next, { action: 'solve', text: 'SU' });
    expect(out.status).toBe('won');
    expect(out.winner).toBe(0);
    expect(() => applyMove('hangman', initialState('hangman'), 0, 0, { action: 'prompt', text: 'a1' })).toThrow(GameRuleError);
  });

  it('Number puzzle: secrets are hidden, scores are + and -, the second player gets an equal turn', () => {
    expect(bullsScore('1234', '1243')).toEqual({ plus: 2, minus: 2 });
    expect(bullsScore('1234', '5678')).toEqual({ plus: 0, minus: 0 });
    let out = play('bulls', [[0, { action: 'set', text: '1234' }]]);
    expect(out.next).toBeNull();
    expect(() => applyMove('bulls', out.state, 1, null, { action: 'set', text: '1123' })).toThrow(GameRuleError);
    out = applyMove('bulls', out.state, 1, null, { action: 'set', text: '5678' });
    expect((out.state as BullsState).phase).toBe('guess');
    const view = extraView('bulls', out.state as BullsState, 0, false);
    expect(view.mySecret).toBe('1234');
    expect(view.theirSecret).toBeNull();
    out = applyMove('bulls', out.state, 0, out.next, { action: 'guess', text: '5678' });
    expect(out.status).toBe('active');
    out = applyMove('bulls', out.state, 1, out.next, { action: 'guess', text: '1234' });
    expect(out.status).toBe('draw');
  });

  it('Dots and boxes: closing a box scores and keeps the turn', () => {
    const [top, bottom, left, right] = boxLines(0, 0);
    const out = play('dots', [[0, { cell: top }], [1, { cell: bottom }], [0, { cell: left }], [1, { cell: right }]]);
    expect((out.state as DotsState).boxes[0]).toBe(2);
    expect(out.next).toBe(1);
    expect(() => applyMove('dots', out.state, 1, 1, { cell: top })).toThrow(GameRuleError);
  });

  it('Dots and boxes: filling every line ends the game', () => {
    let out = { state: initialState('dots'), next: 0 as number | null, status: 'active', winner: null as number | null };
    for (let line = 0; line < DOTS_LINES; line++) out = applyMove('dots', out.state, out.next!, out.next, { cell: line });
    expect(out.status === 'won' || out.status === 'draw').toBe(true);
    const boxes = (out.state as DotsState).boxes;
    expect(boxes.every(Boolean)).toBe(true);
    expect(boxes.length).toBe(DOTS * DOTS);
  });

  it('Reversi: only flanking moves are legal and they turn discs over', () => {
    const start = initialState('reversi') as ReversiState;
    expect(reversiMoves(start.board, 1).sort((a, b) => a - b)).toEqual([19, 26, 37, 44]);
    expect(() => applyMove('reversi', start, 0, 0, { cell: 0 })).toThrow(GameRuleError);
    const out = applyMove('reversi', start, 0, 0, { cell: 19 });
    expect((out.state as ReversiState).board[27]).toBe(1);
    expect(out.next).toBe(1);
  });

  it('Mangala: the first stone stays, the last one in your store plays again, an even pit is captured', () => {
    // Pit 2 (4 stones): one stays, then 3, 4, 5 get one each. Pit 3 (5 stones): ends in the store.
    let out = play('mangala', [[0, { cell: 3 }]]);
    const pits = (out.state as MangalaState).pits;
    expect(pits.slice(0, 7)).toEqual([4, 4, 4, 1, 5, 5, 1]);
    expect(out.next).toBe(0);
    out = applyMove('mangala', out.state, 0, out.next, { cell: 5 });
    // 5 stones from pit 5: one stays, then store, then 7, 8, 9: pit 9 has 5 (odd), no capture.
    expect((out.state as MangalaState).pits[6]).toBe(2);
    expect(out.next).toBe(1);
    const even: MangalaState = { pits: [0, 0, 0, 0, 0, 2, 0, 3, 0, 0, 0, 0, 0, 0], last: null };
    const cap = applyMove('mangala', even, 0, 0, { cell: 5 });
    // 2 stones: one stays in 5, one lands in the store: play again.
    expect(cap.next).toBe(0);
    const capture: MangalaState = { pits: [0, 0, 0, 0, 0, 3, 0, 1, 1, 0, 0, 0, 0, 0], last: null };
    const taken = applyMove('mangala', capture, 0, 0, { cell: 5 });
    // 3 stones: 5, store, 7 (1 → 2, even): captured.
    expect((taken.state as MangalaState).pits[7]).toBe(0);
    expect((taken.state as MangalaState).pits[6]).toBe(3);
  });

  it('Mangala: whoever runs out first takes the stones left on the other side', () => {
    const end: MangalaState = { pits: [0, 0, 0, 0, 0, 1, 10, 2, 0, 0, 0, 0, 3, 5], last: null };
    const out = applyMove('mangala', end, 0, 0, { cell: 5 });
    expect(out.status).toBe('won');
    expect((out.state as MangalaState).pits[6]).toBe(16);
    expect(out.winner).toBe(0);
  });

  it('Battleship: fleets never touch, hits shoot again, sinking everything wins', () => {
    const ships = placeFleet(seeded(7));
    expect(ships.map((s) => s.length)).toEqual(FLEET);
    const cells = new Set(ships.flat());
    for (const ship of ships) for (const c of ship) {
      for (const other of ships) if (other !== ship) {
        for (const o of other) expect(Math.max(Math.abs(Math.floor(c / SEA) - Math.floor(o / SEA)), Math.abs((c % SEA) - (o % SEA)))).toBeGreaterThan(1);
      }
    }
    expect(cells.size).toBe(FLEET.reduce((a, b) => a + b, 0));
    let state = initialState('battleship', seeded(3)) as BattleshipState;
    const water = Array.from({ length: SEA * SEA }, (_, i) => i).find((i) => !state.ships[1].flat().includes(i))!;
    let out = applyMove('battleship', state, 0, 0, { cell: water });
    expect(out.next).toBe(1);
    state = out.state as BattleshipState;
    const view = extraView('battleship', state, 1, false) as { theirs: number[]; mine: number[] };
    expect(view.theirs.filter((c) => c === 1)).toEqual([]);
    expect(view.mine[water]).toBe(3);
    let next: number | null = 1;
    out = applyMove('battleship', state, 1, next, { cell: state.ships[0][0][0] });
    expect(out.next).toBe(1);
    next = out.next;
    for (const c of state.ships[0].flat().slice(1)) {
      out = applyMove('battleship', out.state, 1, next, { cell: c });
      next = out.next;
    }
    expect(out.status).toBe('won');
    expect(out.winner).toBe(1);
  });

  it('Dice duel: a one loses the turn, holding banks, reaching the target wins', () => {
    const rolls = [5 / 6, 0, 3 / 6];
    let i = 0;
    const dice = () => rolls[i++ % rolls.length];
    let out = applyMove('pig', initialState('pig'), 0, 0, { action: 'roll' }, dice);
    expect(out.next).toBe(0);
    out = applyMove('pig', out.state, 0, 0, { action: 'roll' }, dice);
    expect(out.next).toBe(1);
    expect((out.state as { scores: number[] }).scores).toEqual([0, 0]);
    expect(() => applyMove('pig', out.state, 1, 1, { action: 'hold' })).toThrow(GameRuleError);
    out = applyMove('pig', out.state, 1, 1, { action: 'roll' }, dice);
    out = applyMove('pig', out.state, 1, 1, { action: 'hold' });
    expect((out.state as { scores: number[] }).scores).toEqual([0, 4]);
    const near = { scores: [PIG_TARGET - 2, 0], rolls: [], log: [] };
    expect(applyMove('pig', near, 0, 0, { action: 'roll' }, () => 0.9).status).toBe('won');
  });

  it('Word chain: words follow the last letter, no repeats, giving up loses', () => {
    expect(chainLetter('dağ')).toBe('a');
    let out = play('wordchain', [[0, { action: 'word', text: 'Elma' }], [1, { action: 'word', text: 'armut' }]]);
    expect(() => applyMove('wordchain', out.state, 0, 0, { action: 'word', text: 'kiraz' })).toThrow(GameRuleError);
    expect(() => applyMove('wordchain', out.state, 0, 0, { action: 'word', text: 'Elma' })).toThrow(GameRuleError);
    out = applyMove('wordchain', out.state, 0, 0, { action: 'word', text: 'tavşan' });
    out = applyMove('wordchain', out.state, 1, 1, { action: 'pass' });
    expect(out.status).toBe('won');
    expect(out.winner).toBe(0);
  });

  it('Two truths and a lie: the lie stays hidden until the guess', () => {
    let out = play('lies', [[0, { action: 'prompt', text: 'I can swim\nI have been to Paris\nI hate chocolate', cell: 2 }]]);
    expect((extraView('lies', out.state as never, 1, false) as { rounds: { lie: number | null }[] }).rounds[0].lie).toBeNull();
    expect((extraView('lies', out.state as never, 0, false) as { rounds: { lie: number | null }[] }).rounds[0].lie).toBe(2);
    expect(() => applyMove('lies', initialState('lies'), 0, 0, { action: 'prompt', text: 'one\ntwo', cell: 0 })).toThrow(GameRuleError);
    out = applyMove('lies', out.state, 1, out.next, { action: 'guess', cell: 2 });
    expect((out.state as { scores: number[] }).scores).toEqual([0, 1]);
    expect(out.next).toBe(1);
  });

  it('Never have I ever and How well do you know me run on secret picks', () => {
    let out = play('nhie', []);
    for (let r = 0; r < NHIE_ROUNDS; r++) {
      out = applyMove('nhie', out.state, 0, null, { choice: 'a' });
      out = applyMove('nhie', out.state, 1, null, { choice: r % 2 ? 'a' : 'b' });
    }
    expect(out.status).toBe('done');
    out = play('knowme', []);
    expect(() => applyMove('knowme', out.state, 0, null, { choice: 'a' })).toThrow(GameRuleError);
    for (let r = 0; r < KNOW_ROUNDS; r++) {
      out = applyMove('knowme', out.state, 0, null, { choice: 'a', cell: 0 });
      // Player 1 always guesses right ("a"), player 0 guesses "a" but player 1 picks "b".
      out = applyMove('knowme', out.state, 1, null, { choice: 'b', cell: 0 });
    }
    expect(out.status).toBe('won');
    expect(out.winner).toBe(1);
  });

  it('Story: lines alternate until the story is done', () => {
    let out = play('story', []);
    for (let i = 0; i < STORY_LINES; i++) out = applyMove('story', out.state, i % 2, i % 2, { action: 'reply', text: `Line ${i}` });
    expect(out.status).toBe('done');
    expect(() => applyMove('story', initialState('story'), 1, 0, { action: 'reply', text: 'x' })).toThrow(GameRuleError);
  });
});
