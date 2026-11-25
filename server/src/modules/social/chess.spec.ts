import { describe, expect, it } from 'vitest';
import { chessStart, fromFen, inCheck, legalMoves, perft, play } from './chess.js';

const sq = (name: string) => (8 - Number(name[1])) * 8 + 'abcdefgh'.indexOf(name[0]);
const mv = (from: string, to: string, promo?: string) => ({ from: sq(from), to: sq(to), promo });

describe('chess', () => {
  it('move generation matches the standard perft counts', () => {
    const start = chessStart();
    expect(perft(start, 1)).toBe(20);
    expect(perft(start, 2)).toBe(400);
    expect(perft(start, 3)).toBe(8902);
    // "Kiwipete": castling, en passant, promotions and pins all at once.
    const kiwi = fromFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
    expect(perft(kiwi, 1)).toBe(48);
    expect(perft(kiwi, 2)).toBe(2039);
    // En passant and promotion edge cases.
    const pos3 = fromFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
    expect(perft(pos3, 1)).toBe(14);
    expect(perft(pos3, 2)).toBe(191);
    expect(perft(pos3, 3)).toBe(2812);
  });

  it("fool's mate ends the game", () => {
    let s = chessStart();
    for (const [a, b] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) s = play(s, mv(a, b))!;
    expect(inCheck(s)).toBe(true);
    expect(s.end).toBe('mate');
  });

  it('rejects illegal moves and promotes to a queen by default', () => {
    expect(play(chessStart(), mv('e2', 'e5'))).toBeNull();
    const s = fromFen('8/P7/8/8/8/8/8/k6K w - - 0 1');
    const promoted = play(s, mv('a7', 'a8'))!;
    expect(promoted.board[sq('a8')]).toBe('Q');
    const knight = play(s, mv('a7', 'a8', 'n'))!;
    expect(knight.board[sq('a8')]).toBe('N');
  });

  it('castling moves the rook, en passant removes the pawn', () => {
    const castle = play(fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), mv('e1', 'g1'))!;
    expect(castle.board[sq('f1')]).toBe('R');
    expect(castle.board[sq('h1')]).toBe('');
    expect(castle.castling).toBe('kq');
    let s = fromFen('4k3/8/8/8/1p6/8/P7/4K3 w - - 0 1');
    s = play(s, mv('a2', 'a4'))!;
    s = play(s, mv('b4', 'a3'))!;
    expect(s.board[sq('a4')]).toBe('');
    expect(s.board[sq('a3')]).toBe('p');
  });

  it('stalemate, bare kings and repetition are draws', () => {
    const stale = play(fromFen('k7/8/1Q6/8/8/8/8/7K w - - 0 1'), mv('b6', 'c7'))!;
    expect(stale.end).toBe('stalemate');
    expect(legalMoves(stale)).toEqual([]);
    expect(play(fromFen('k7/8/8/8/8/8/1q6/K7 w - - 0 1'), mv('a1', 'b2'))!.end).toBe('material');
    let s = chessStart();
    for (let i = 0; i < 2; i++) for (const [a, b] of [['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8']]) s = play(s, mv(a, b))!;
    expect(s.end).toBe('repetition');
  });
});
