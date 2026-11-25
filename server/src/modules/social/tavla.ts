/**
 * Tavla (backgammon without the doubling cube). Points 0…23; `points[i]` > 0 are players[0]'s
 * checkers, < 0 players[1]'s. players[0] moves from 23 down to 0 (home 0-5) and bears off below
 * 0; players[1] moves from 0 up to 23 (home 18-23) and bears off above 23. The bar is "point" 24.
 * Checkers move one die at a time; every die that can be played must be (the most dice possible,
 * and the higher one when only one of two can be played).
 */

export const BAR = 24;
export const OFF = -1;

export type TavlaStep = { from: number; to: number; die: number };
export type TavlaSnapshot = { points: number[]; bar: number[]; off: number[]; dice: number[] };
export type TavlaState = TavlaSnapshot & {
  toMove: number;
  rolled: number[];
  turnStart: TavlaSnapshot;
  played: TavlaStep[];
  log: { player: number; rolled: number[]; steps: TavlaStep[]; blocked: boolean }[];
};

const snap = (s: TavlaSnapshot): TavlaSnapshot => ({ points: [...s.points], bar: [...s.bar], off: [...s.off], dice: [...s.dice] });
const sign = (player: number) => (player === 0 ? 1 : -1);
const mine = (v: number, player: number) => v * sign(player) > 0;

export function rollDice(random: () => number) {
  const a = 1 + Math.floor(random() * 6), b = 1 + Math.floor(random() * 6);
  return a === b ? [a, a, a, a] : [a, b];
}

export function tavlaStart(random: () => number): TavlaState {
  const points = new Array(24).fill(0);
  points[23] = 2; points[12] = 5; points[7] = 3; points[5] = 5;
  points[0] = -2; points[11] = -5; points[16] = -3; points[18] = -5;
  // Opening roll: one die each, the higher starts and plays both (no doubles).
  let a = 0, b = 0;
  while (a === b) { a = 1 + Math.floor(random() * 6); b = 1 + Math.floor(random() * 6); }
  const base: TavlaSnapshot = { points, bar: [0, 0], off: [0, 0], dice: [a, b] };
  return { ...snap(base), toMove: a > b ? 0 : 1, rolled: [a, b], turnStart: snap(base), played: [], log: [] };
}

const allHome = (s: TavlaSnapshot, player: number) => {
  if (s.bar[player]) return false;
  for (let i = 0; i < 24; i++) {
    const home = player === 0 ? i <= 5 : i >= 18;
    if (!home && mine(s.points[i], player)) return false;
  }
  return true;
};

/** Where one checker from `from` lands with `die`, or null if it can't move. */
export function destination(s: TavlaSnapshot, player: number, from: number, die: number): number | null {
  if (s.bar[player] && from !== BAR) return null;
  if (from === BAR) {
    if (!s.bar[player]) return null;
  } else if (from < 0 || from > 23 || !mine(s.points[from], player)) return null;
  const to = from === BAR ? (player === 0 ? 24 - die : die - 1) : player === 0 ? from - die : from + die;
  if (to >= 0 && to <= 23) return s.points[to] * sign(player) <= -2 ? null : to;
  // Bearing off: everyone home; an exact roll, or a higher one from the furthest checker.
  if (!allHome(s, player)) return null;
  const exact = player === 0 ? from - die === -1 : from + die === 24;
  if (exact) return OFF;
  const further = player === 0
    ? s.points.slice(from + 1, 6).some((v) => mine(v, 0))
    : s.points.slice(18, from).some((v) => mine(v, 1));
  return further ? null : OFF;
}

function applyStep(s: TavlaSnapshot, player: number, step: TavlaStep): TavlaSnapshot {
  const n = snap(s);
  if (step.from === BAR) n.bar[player]--;
  else n.points[step.from] -= sign(player);
  if (step.to === OFF) n.off[player]++;
  else {
    // A lone enemy checker is hit and goes to the bar.
    if (n.points[step.to] * sign(player) === -1) {
      n.points[step.to] = 0;
      n.bar[1 - player]++;
    }
    n.points[step.to] += sign(player);
  }
  n.dice.splice(n.dice.indexOf(step.die), 1);
  return n;
}

function candidates(s: TavlaSnapshot, player: number): TavlaStep[] {
  const out: TavlaStep[] = [];
  for (const die of new Set(s.dice)) {
    for (const from of [BAR, ...Array.from({ length: 24 }, (_, i) => i)]) {
      const to = destination(s, player, from, die);
      if (to !== null) out.push({ from, to, die });
    }
  }
  return out;
}

/** The most dice that can still be played from here. */
function maxUse(s: TavlaSnapshot, player: number): number {
  if (!s.dice.length || s.off[player] === 15) return 0;
  let best = 0;
  for (const step of candidates(s, player)) {
    best = Math.max(best, 1 + maxUse(applyStep(s, player, step), player));
    if (best === s.dice.length) break;
  }
  return best;
}

/** Steps the player may take now (each keeps the most dice playable). */
export function tavlaSteps(s: TavlaSnapshot, player: number): TavlaStep[] {
  const most = maxUse(s, player);
  if (!most) return [];
  let steps = candidates(s, player).filter((step) => 1 + maxUse(applyStep(s, player, step), player) === most);
  // Only one die playable out of two different ones: it has to be the higher one, if that one can move.
  if (most === 1 && s.dice.length === 2 && s.dice[0] !== s.dice[1]) {
    const high = Math.max(...s.dice);
    if (steps.some((step) => step.die === high)) steps = steps.filter((step) => step.die === high);
  }
  return steps;
}

export type TavlaOutcome = { state: TavlaState; winner: number | null };

/** Ends the turn: the other player rolls; a player who can't move passes automatically. */
function nextTurn(s: TavlaState, random: () => number): TavlaState {
  let state = s;
  for (let guard = 0; guard < 8; guard++) {
    const player = 1 - state.toMove;
    const dice = rollDice(random);
    const base: TavlaSnapshot = { points: state.points, bar: state.bar, off: state.off, dice };
    state = { ...state, ...snap(base), toMove: player, rolled: dice.length === 4 ? [dice[0], dice[0]] : dice, turnStart: snap(base), played: [] };
    if (tavlaSteps(state, player).length) return state;
    state = { ...state, log: [...state.log, { player, rolled: state.rolled, steps: [], blocked: true }].slice(-8) };
  }
  return state;
}

export function tavlaMove(s: TavlaState, player: number, from: number, die: number, random: () => number): TavlaOutcome | null {
  const step = tavlaSteps(s, player).find((st) => st.from === from && st.die === die);
  if (!step) return null;
  const after = applyStep(s, player, step);
  let state: TavlaState = { ...s, ...after, played: [...s.played, step] };
  if (state.off[player] === 15) {
    state = { ...state, log: [...state.log, { player, rolled: s.rolled, steps: state.played, blocked: false }].slice(-8) };
    return { state, winner: player };
  }
  if (!tavlaSteps(state, player).length) {
    state = { ...state, log: [...state.log, { player, rolled: s.rolled, steps: state.played, blocked: false }].slice(-8) };
    state = nextTurn(state, random);
  }
  return { state, winner: null };
}

/** Takes back this turn's moves. */
export function tavlaUndo(s: TavlaState): TavlaState | null {
  if (!s.played.length) return null;
  return { ...s, ...snap(s.turnStart), played: [] };
}

/** A win before the loser bore off a single checker is a "mars" (gammon). */
export const isMars = (s: TavlaState, winner: number) => s.off[1 - winner] === 0;
