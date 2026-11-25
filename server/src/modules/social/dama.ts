/**
 * Russian draughts (shashki). 8×8, played on the dark squares (row + column odd); squares 0…63
 * row by row from the top. players[0] starts on rows 5-7 and moves up, players[1] on rows 0-2.
 *
 * - Men move one square diagonally forward and capture diagonally forward and backward.
 * - Kings fly: any distance diagonally, and capture a piece any distance away, landing on any
 *   empty square behind it.
 * - Capturing is compulsory, but any capture sequence may be chosen (not necessarily the
 *   longest). A started sequence must be finished: when a jump can be continued, it must be.
 * - Captured pieces stay on the board until the move ends ("Turkish strike"): they can't be
 *   jumped twice and they block the way.
 * - A man reaching the far row becomes a king at once and goes on capturing as a king.
 */

/** 0 empty, 1/2 man of players[0]/players[1], 3/4 their kings. */
export type DamaState = { board: number[]; toMove: number; quiet: number; last: number[] | null; captured: number[] };

/** Plies with only kings moving and nothing taken before it's a draw (15 moves each). */
export const DAMA_QUIET_LIMIT = 30;

const dark = (sq: number) => (Math.floor(sq / 8) + (sq % 8)) % 2 === 1;

export function damaStart(): DamaState {
  const board = new Array(64).fill(0);
  for (let sq = 0; sq < 64; sq++) {
    if (!dark(sq)) continue;
    const r = Math.floor(sq / 8);
    if (r <= 2) board[sq] = 2;
    if (r >= 5) board[sq] = 1;
  }
  return { board, toMove: 0, quiet: 0, last: null, captured: [0, 0] };
}

const owner = (v: number) => (v <= 0 ? -1 : v % 2 === 1 ? 0 : 1);
const isKing = (v: number) => v >= 3;
const on = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const lastRow = (player: number) => (player === 0 ? 0 : 7);
/** A piece already taken in this move: still on the board, can't be passed or taken again. */
const DEAD = -1;

/** Every complete capture sequence starting at `from`, as paths of squares. */
function captures(board: number[], from: number, player: number): number[][] {
  const out: number[][] = [];
  /** The jumps available from `at` for a piece that is (or isn't) a king. */
  const jumps = (b: number[], at: number, king: boolean) => {
    const list: { enemy: number; lands: number[] }[] = [];
    const r = Math.floor(at / 8), c = at % 8;
    for (const [dr, dc] of DIAG) {
      let rr = r + dr, cc = c + dc;
      if (king) while (on(rr, cc) && b[rr * 8 + cc] === 0) { rr += dr; cc += dc; }
      if (!on(rr, cc) || owner(b[rr * 8 + cc]) !== 1 - player) continue;
      const lands: number[] = [];
      let lr = rr + dr, lc = cc + dc;
      while (on(lr, lc) && b[lr * 8 + lc] === 0) {
        lands.push(lr * 8 + lc);
        if (!king) break; // a man lands right behind the piece it takes
        lr += dr; lc += dc;
      }
      if (lands.length) list.push({ enemy: rr * 8 + cc, lands });
    }
    return list;
  };
  const walk = (b: number[], at: number, king: boolean, path: number[]) => {
    const options = jumps(b, at, king);
    if (!options.length) {
      if (path.length > 1) out.push(path);
      return;
    }
    for (const { enemy, lands } of options) {
      const after = (land: number) => {
        const next = [...b];
        next[at] = 0;
        next[enemy] = DEAD;
        next[land] = player + 1;
        return next;
      };
      const crowned = (land: number) => king || Math.floor(land / 8) === lastRow(player);
      // A king that can go on capturing from some landing squares must land on one of those.
      const going = lands.filter((land) => jumps(after(land), land, crowned(land)).length > 0);
      for (const land of going.length ? going : lands) walk(after(land), land, crowned(land), [...path, land]);
    }
  };
  walk([...board], from, isKing(board[from]), [from]);
  return out;
}

/** All legal moves for the player to move, as paths of squares (start first). */
export function damaMoves(s: DamaState): number[][] {
  const player = s.toMove;
  const caps: number[][] = [];
  for (let sq = 0; sq < 64; sq++) if (owner(s.board[sq]) === player) caps.push(...captures(s.board, sq, player));
  if (caps.length) return caps;
  const moves: number[][] = [];
  const forward = player === 0 ? -1 : 1;
  for (let sq = 0; sq < 64; sq++) {
    const v = s.board[sq];
    if (owner(v) !== player) continue;
    const r = Math.floor(sq / 8), c = sq % 8;
    for (const [dr, dc] of DIAG) {
      if (!isKing(v) && dr !== forward) continue;
      let rr = r + dr, cc = c + dc;
      while (on(rr, cc) && s.board[rr * 8 + cc] === 0) {
        moves.push([sq, rr * 8 + cc]);
        if (!isKing(v)) break;
        rr += dr; cc += dc;
      }
    }
  }
  return moves;
}

/** Whether the player to move has to capture. */
export function damaMustCapture(s: DamaState) {
  for (let sq = 0; sq < 64; sq++) if (owner(s.board[sq]) === s.toMove && captures(s.board, sq, s.toMove).length) return true;
  return false;
}

/** Plays a path if it's one of the legal moves; null otherwise. */
export function damaPlay(s: DamaState, path: number[]): DamaState | null {
  const legal = damaMoves(s).some((m) => m.length === path.length && m.every((c, i) => c === path[i]));
  if (!legal) return null;
  const board = [...s.board];
  let v = board[path[0]];
  const wasKing = isKing(v);
  let taken = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const step = Math.sign(Math.floor(b / 8) - Math.floor(a / 8)) * 8 + Math.sign((b % 8) - (a % 8));
    // The enemy piece between two squares of the path is taken (all leave once the move is over).
    for (let x = a + step; x !== b; x += step) if (owner(board[x]) === 1 - s.toMove) { board[x] = 0; taken++; }
    if (!isKing(v) && Math.floor(b / 8) === lastRow(s.toMove)) v += 2;
  }
  board[path[0]] = 0;
  board[path[path.length - 1]] = v;
  const captured = [...s.captured];
  captured[s.toMove] += taken;
  // The draw count only runs while kings move without taking anything.
  const quiet = taken || !wasKing ? 0 : s.quiet + 1;
  return { board, toMove: 1 - s.toMove, quiet, last: path, captured };
}

export type DamaResult = { winner: number | null; draw: boolean } | null;

/** After a move: the player to move has no pieces or no moves (they lose), or it's a draw. */
export function damaResult(s: DamaState): DamaResult {
  const pieces = [0, 1].map((p) => s.board.filter((v) => owner(v) === p));
  if (!pieces[s.toMove].length || !damaMoves(s).length) return { winner: 1 - s.toMove, draw: false };
  const lone = pieces.every((list) => list.length === 1 && isKing(list[0]));
  if (lone || s.quiet >= DAMA_QUIET_LIMIT) return { winner: null, draw: true };
  return null;
}
