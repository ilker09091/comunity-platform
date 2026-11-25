/**
 * Chess rules: legal moves (castling, en passant, promotion), check, mate, stalemate, the
 * 50-move rule, threefold repetition and insufficient material. Squares are 0 (a8) … 63 (h1);
 * white pieces are upper case ("PNBRQK"), black lower case, empty squares "".
 */

export type Color = 0 | 1; // 0 white, 1 black
export type ChessState = {
  board: string[];
  toMove: Color;
  castling: string; // subset of "KQkq"
  ep: number | null; // square a pawn may capture onto en passant
  halfmove: number;
  history: string[]; // position keys, for repetition
  last: [number, number] | null;
  moves: string[]; // "e2e4", "e7e8q", for the move list
  end: 'mate' | 'stalemate' | 'fifty' | 'repetition' | 'material' | null;
};
export type ChessMove = { from: number; to: number; promo?: string };

const FILES = 'abcdefgh';
export const squareName = (sq: number) => `${FILES[sq % 8]}${8 - Math.floor(sq / 8)}`;
const colorOf = (p: string): Color | null => (!p ? null : p === p.toUpperCase() ? 0 : 1);
const row = (sq: number) => Math.floor(sq / 8);
const col = (sq: number) => sq % 8;
const on = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;

const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ROOK = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISHOP = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

export function fromFen(fen: string): ChessState {
  const [placement, side, castling, ep, half] = fen.split(' ');
  const board: string[] = [];
  for (const ch of placement.replace(/\//g, '')) {
    if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) board.push('');
    else board.push(ch);
  }
  const epSq = ep && ep !== '-' ? (8 - Number(ep[1])) * 8 + FILES.indexOf(ep[0]) : null;
  const state: ChessState = {
    board, toMove: side === 'b' ? 1 : 0, castling: castling === '-' ? '' : castling, ep: epSq,
    halfmove: Number(half ?? 0), history: [], last: null, moves: [], end: null,
  };
  state.history = [positionKey(state)];
  return state;
}
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const chessStart = () => fromFen(START_FEN);

function positionKey(s: ChessState) {
  return `${s.board.map((p) => p || '.').join('')}|${s.toMove}|${s.castling}|${s.ep ?? '-'}`;
}

/** Whether `sq` is attacked by a piece of `by`. */
export function attacked(board: string[], sq: number, by: Color) {
  const r = row(sq), c = col(sq);
  const is = (rr: number, cc: number, types: string) => {
    if (!on(rr, cc)) return false;
    const p = board[rr * 8 + cc];
    return !!p && colorOf(p) === by && types.includes(p.toLowerCase());
  };
  // Pawns attack diagonally forward (white pawns move up, towards row 0).
  const pr = by === 0 ? r + 1 : r - 1;
  if (is(pr, c - 1, 'p') || is(pr, c + 1, 'p')) return true;
  for (const [dr, dc] of KNIGHT) if (is(r + dr, c + dc, 'n')) return true;
  for (const [dr, dc] of KING) if (is(r + dr, c + dc, 'k')) return true;
  for (const [dirs, types] of [[ROOK, 'rq'], [BISHOP, 'bq']] as const) {
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      while (on(rr, cc)) {
        const p = board[rr * 8 + cc];
        if (p) {
          if (colorOf(p) === by && types.includes(p.toLowerCase())) return true;
          break;
        }
        rr += dr; cc += dc;
      }
    }
  }
  return false;
}

const kingSquare = (board: string[], color: Color) => board.indexOf(color === 0 ? 'K' : 'k');
export const inCheck = (s: ChessState, color: Color = s.toMove) => attacked(s.board, kingSquare(s.board, color), (1 - color) as Color);

function pseudoMoves(s: ChessState): ChessMove[] {
  const out: ChessMove[] = [];
  const me = s.toMove;
  const b = s.board;
  for (let sq = 0; sq < 64; sq++) {
    const p = b[sq];
    if (!p || colorOf(p) !== me) continue;
    const r = row(sq), c = col(sq), t = p.toLowerCase();
    const add = (to: number) => {
      // A pawn reaching the last row promotes (to any of four pieces).
      if (t === 'p' && (row(to) === 0 || row(to) === 7)) for (const promo of 'qrbn') out.push({ from: sq, to, promo });
      else out.push({ from: sq, to });
    };
    if (t === 'p') {
      const dir = me === 0 ? -1 : 1;
      const start = me === 0 ? 6 : 1;
      if (on(r + dir, c) && !b[(r + dir) * 8 + c]) {
        add((r + dir) * 8 + c);
        if (r === start && !b[(r + 2 * dir) * 8 + c]) add((r + 2 * dir) * 8 + c);
      }
      for (const dc of [-1, 1]) {
        if (!on(r + dir, c + dc)) continue;
        const to = (r + dir) * 8 + c + dc;
        if ((b[to] && colorOf(b[to]) !== me) || to === s.ep) add(to);
      }
    } else if (t === 'n' || t === 'k') {
      for (const [dr, dc] of t === 'n' ? KNIGHT : KING) {
        if (!on(r + dr, c + dc)) continue;
        const to = (r + dr) * 8 + c + dc;
        if (!b[to] || colorOf(b[to]) !== me) add(to);
      }
      if (t === 'k') {
        // Castling: rights kept, squares between empty, king not in check nor passing an attacked square.
        const home = me === 0 ? 60 : 4;
        const them = (1 - me) as Color;
        if (sq === home && !attacked(b, home, them)) {
          const [kSide, qSide] = me === 0 ? ['K', 'Q'] : ['k', 'q'];
          if (s.castling.includes(kSide) && !b[home + 1] && !b[home + 2] && b[home + 3] === (me === 0 ? 'R' : 'r')
            && !attacked(b, home + 1, them) && !attacked(b, home + 2, them)) out.push({ from: home, to: home + 2 });
          if (s.castling.includes(qSide) && !b[home - 1] && !b[home - 2] && !b[home - 3] && b[home - 4] === (me === 0 ? 'R' : 'r')
            && !attacked(b, home - 1, them) && !attacked(b, home - 2, them)) out.push({ from: home, to: home - 2 });
        }
      }
    } else {
      const dirs = t === 'r' ? ROOK : t === 'b' ? BISHOP : [...ROOK, ...BISHOP];
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc;
        while (on(rr, cc)) {
          const to = rr * 8 + cc;
          if (b[to]) {
            if (colorOf(b[to]) !== me) add(to);
            break;
          }
          add(to);
          rr += dr; cc += dc;
        }
      }
    }
  }
  return out;
}

/** The board after a move (no legality checks; `play` does those). */
function apply(s: ChessState, m: ChessMove): ChessState {
  const b = [...s.board];
  const p = b[m.from];
  const t = p.toLowerCase();
  const me = s.toMove;
  const captured = b[m.to] || (t === 'p' && m.to === s.ep ? 'p' : '');
  if (t === 'p' && m.to === s.ep) b[m.to + (me === 0 ? 8 : -8)] = '';
  b[m.to] = m.promo ? (me === 0 ? m.promo.toUpperCase() : m.promo.toLowerCase()) : p;
  b[m.from] = '';
  if (t === 'k' && Math.abs(m.to - m.from) === 2) {
    // Castling moves the rook too.
    if (m.to > m.from) { b[m.from + 1] = b[m.from + 3]; b[m.from + 3] = ''; }
    else { b[m.from - 1] = b[m.from - 4]; b[m.from - 4] = ''; }
  }
  let castling = s.castling;
  const drop = (chars: string) => { for (const ch of chars) castling = castling.replace(ch, ''); };
  if (p === 'K') drop('KQ');
  if (p === 'k') drop('kq');
  for (const sq of [m.from, m.to]) {
    if (sq === 63) drop('K');
    if (sq === 56) drop('Q');
    if (sq === 7) drop('k');
    if (sq === 0) drop('q');
  }
  return {
    ...s,
    board: b,
    toMove: (1 - me) as Color,
    castling,
    ep: t === 'p' && Math.abs(m.to - m.from) === 16 ? (m.from + m.to) / 2 : null,
    halfmove: t === 'p' || captured ? 0 : s.halfmove + 1,
    last: [m.from, m.to],
  };
}

export function legalMoves(s: ChessState): ChessMove[] {
  return pseudoMoves(s).filter((m) => !inCheck(apply(s, m), s.toMove));
}

/** Only kings, or a king with one bishop or knight against a lone king: nobody can mate. */
function insufficient(board: string[]) {
  const pieces = board.filter(Boolean).map((p) => p.toLowerCase()).filter((p) => p !== 'k');
  return pieces.length === 0 || (pieces.length === 1 && (pieces[0] === 'b' || pieces[0] === 'n'));
}

export const moveText = (m: ChessMove) => `${squareName(m.from)}${squareName(m.to)}${m.promo ?? ''}`;

/** Plays a move if it's legal; returns the new state, or null for an illegal move. */
export function play(s: ChessState, m: ChessMove): ChessState | null {
  const legal = legalMoves(s).find((l) => l.from === m.from && l.to === m.to && (l.promo ?? '') === (l.promo ? (m.promo ?? 'q') : ''));
  if (!legal) return null;
  const next = apply(s, legal);
  next.moves = [...s.moves, moveText(legal)];
  const key = positionKey(next);
  // A pawn move or capture makes earlier positions unreachable.
  next.history = next.halfmove === 0 ? [key] : [...s.history, key];
  if (!legalMoves(next).length) next.end = inCheck(next) ? 'mate' : 'stalemate';
  else if (insufficient(next.board)) next.end = 'material';
  else if (next.halfmove >= 100) next.end = 'fifty';
  else if (next.history.filter((k) => k === key).length >= 3) next.end = 'repetition';
  return next;
}

/** Counts leaf positions to `depth` (a standard check of move generation). */
export function perft(s: ChessState, depth: number): number {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of legalMoves(s)) n += depth === 1 ? 1 : perft(apply(s, m), depth - 1);
  return n;
}
