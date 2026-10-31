import { describe, expect, it } from 'vitest';
import { initialBoard, isSquare, movePiece, squareToIndex, indexToSquare } from './board';

describe('initialBoard', () => {
  it('has 32 pieces with unique ids in standard places', () => {
    const b = initialBoard();
    expect(b.size).toBe(32);
    expect(new Set([...b.values()].map((p) => p.id)).size).toBe(32);
    expect(b.get('e1')).toMatchObject({ type: 'king', color: 'white' });
    expect(b.get('d8')).toMatchObject({ type: 'queen', color: 'black' });
    expect(b.get('a7')).toMatchObject({ type: 'pawn', color: 'black' });
    expect(b.get('e4')).toBeUndefined();
  });
});

describe('squares', () => {
  it('validates and round-trips', () => {
    expect(isSquare('h8')).toBe(true);
    expect(isSquare('i1')).toBe(false);
    expect(isSquare('a9')).toBe(false);
    expect(isSquare('a10')).toBe(false);
    expect(squareToIndex('c5')).toEqual({ file: 2, rank: 4 });
    expect(indexToSquare(2, 4)).toBe('c5');
    expect(() => indexToSquare(8, 0)).toThrow();
  });
});

describe('movePiece', () => {
  it('moves a piece and leaves the input board untouched', () => {
    const b = initialBoard();
    const r = movePiece(b, 'e2', 'e4');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.board.get('e4')?.id).toBe('white-pawn-e2');
    expect(r.board.get('e2')).toBeUndefined();
    expect(r.captured).toBeNull();
    expect(r.board.size).toBe(32);
    expect(b.get('e2')?.id).toBe('white-pawn-e2');
    expect(b.get('e4')).toBeUndefined();
  });

  it('captures an enemy piece', () => {
    const r = movePiece(initialBoard(), 'd1', 'd7');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.captured?.id).toBe('black-pawn-d7');
    expect(r.board.get('d7')?.type).toBe('queen');
    expect(r.board.size).toBe(31);
  });

  it('rejects empty source, same square and own-piece targets', () => {
    const b = initialBoard();
    expect(movePiece(b, 'e4', 'e5')).toEqual({ ok: false, error: 'empty-source' });
    expect(movePiece(b, 'e2', 'e2')).toEqual({ ok: false, error: 'same-square' });
    expect(movePiece(b, 'e1', 'e2')).toEqual({ ok: false, error: 'own-piece' });
  });
});
