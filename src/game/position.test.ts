import { describe, expect, it } from 'vitest';
import { applyMove, fromFen, initialState, legalMoves, outcome, parseUci, toFen, toUci, type GameState } from './position';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function perft(s: GameState, depth: number): number {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of legalMoves(s)) {
    const r = applyMove(s, m);
    if (r.ok) n += perft(r.state, depth - 1);
  }
  return n;
}

describe('position', () => {
  it('round-trips FEN', () => {
    expect(toFen(initialState())).toBe(START);
    const fen = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
    expect(toFen(fromFen(fen))).toBe(fen);
  });

  it('perft from the start position', () => {
    expect(perft(initialState(), 1)).toBe(20);
    expect(perft(initialState(), 2)).toBe(400);
    expect(perft(initialState(), 3)).toBe(8902);
  });

  it('perft "kiwipete" (castling, en passant, promotions, pins)', () => {
    const s = fromFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
    expect(perft(s, 1)).toBe(48);
    expect(perft(s, 2)).toBe(2039);
  });

  it('applies castling, en passant and promotion', () => {
    const castle = applyMove(fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), { from: 'e1', to: 'g1' });
    expect(castle.ok && toFen(castle.state)).toBe('r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1');
    const ep = applyMove(fromFen('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1'), { from: 'e5', to: 'd6' });
    expect(ep.ok && toFen(ep.state)).toBe('4k3/8/3P4/8/8/8/8/4K3 b - - 0 1');
    const promo = applyMove(fromFen('4k3/P7/8/8/8/8/8/4K3 w - - 0 1'), { from: 'a7', to: 'a8', promotion: 'queen' });
    expect(promo.ok && toFen(promo.state)).toBe('Q3k3/8/8/8/8/8/8/4K3 b - - 0 1');
  });

  it('rejects illegal moves and detects mate', () => {
    expect(applyMove(initialState(), { from: 'e2', to: 'e5' })).toEqual({ ok: false, error: 'illegal' });
    expect(outcome(fromFen('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'))).toBe('checkmate');
    expect(outcome(fromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'))).toBe('stalemate');
  });

  it('uci round-trip', () => {
    expect(parseUci('e7e8q')).toEqual({ from: 'e7', to: 'e8', promotion: 'queen' });
    expect(toUci({ from: 'g1', to: 'f3' })).toBe('g1f3');
    expect(parseUci('z9a1')).toBeNull();
  });

  it('reports move effects: en passant square, castling rook, promotion', () => {
    const ep = applyMove(fromFen('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2'), parseUci('e5d6')!);
    expect(ep.ok && ep.effects.capture).toMatchObject({ square: 'd5', enPassant: true, piece: { type: 'pawn', color: 'black' } });
    const castle = applyMove(fromFen('r3k3/8/8/8/8/8/8/4K3 b q - 0 1'), parseUci('e8c8')!);
    expect(castle.ok && castle.effects.castle).toMatchObject({ from: 'a8', to: 'd8', rook: { type: 'rook' } });
    const promo = applyMove(fromFen('1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1'), parseUci('a7b8n')!);
    expect(promo.ok && promo.effects).toMatchObject({ promotion: 'knight', capture: { square: 'b8', enPassant: false } });
    const quiet = applyMove(initialState(), parseUci('g1f3')!);
    expect(quiet.ok && quiet.effects).toMatchObject({ capture: null, castle: null, promotion: null });
  });
});
