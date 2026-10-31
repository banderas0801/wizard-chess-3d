import { FILES, RANKS, type Board, type Color, type Piece, type PieceType, type Square } from './types';

export function isSquare(s: string): s is Square {
  return s.length === 2 && (FILES as readonly string[]).includes(s[0]!) && (RANKS as readonly string[]).includes(s[1]!);
}

export function parseSquare(s: string): Square {
  if (!isSquare(s)) throw new Error(`Not a square: ${s}`);
  return s;
}

/** 0-based file/rank indices (a1 = {file:0, rank:0}). */
export function squareToIndex(sq: Square): { file: number; rank: number } {
  return { file: FILES.indexOf(sq[0] as (typeof FILES)[number]), rank: RANKS.indexOf(sq[1] as (typeof RANKS)[number]) };
}

export function indexToSquare(file: number, rank: number): Square {
  const f = FILES[file];
  const r = RANKS[rank];
  if (f === undefined || r === undefined) throw new Error(`Off board: ${file},${rank}`);
  return `${f}${r}`;
}

const BACK_RANK: readonly PieceType[] = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];

export function initialBoard(): Board {
  const board = new Map<Square, Piece>();
  const place = (color: Color, type: PieceType, sq: Square): void => {
    board.set(sq, { id: `${color}-${type}-${sq}`, type, color });
  };
  FILES.forEach((f, i) => {
    place('white', BACK_RANK[i]!, `${f}1`);
    place('white', 'pawn', `${f}2`);
    place('black', 'pawn', `${f}7`);
    place('black', BACK_RANK[i]!, `${f}8`);
  });
  return board;
}

export type MoveResult =
  | { readonly ok: true; readonly board: Board; readonly moved: Piece; readonly captured: Piece | null }
  | { readonly ok: false; readonly error: 'empty-source' | 'same-square' | 'own-piece' };

/**
 * Relocates a piece. Returns a NEW board; the input is never mutated.
 * Steps 1-2 deliberately do not check chess legality (that arrives with the rules engine);
 * it only rejects moves that are structurally impossible.
 */
export function movePiece(board: Board, from: Square, to: Square): MoveResult {
  if (from === to) return { ok: false, error: 'same-square' };
  const moved = board.get(from);
  if (!moved) return { ok: false, error: 'empty-source' };
  const target = board.get(to) ?? null;
  if (target && target.color === moved.color) return { ok: false, error: 'own-piece' };
  const next = new Map(board);
  next.delete(from);
  next.set(to, moved);
  return { ok: true, board: next, moved, captured: target };
}
