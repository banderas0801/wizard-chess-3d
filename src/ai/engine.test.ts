import { describe, expect, it } from 'vitest';
import { search } from './engine';
import { applyMove, fromFen, parseUci } from '../game';

describe('placeholder engine', () => {
  it('returns a legal move for the given FEN', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    const r = search(fen);
    expect(r.ok).toBe(true);
    if (r.ok) expect(applyMove(fromFen(fen), parseUci(r.uci)!).ok).toBe(true);
  });
  it('takes a free queen and finds mate in one', () => {
    const r = search('4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1');
    expect(r.ok && r.uci).toBe('e4d5');
    const mate = search('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
    expect(mate.ok && mate.uci).toBe('a1a8');
  });
  it('errors on bad FEN or no legal moves', () => {
    expect(search('garbage').ok).toBe(false);
    expect(search('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).toEqual({ ok: false, message: 'no legal moves (stalemate)' });
  });
});
