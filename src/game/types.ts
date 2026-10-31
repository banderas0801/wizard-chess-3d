export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
export const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;

export type File = (typeof FILES)[number];
export type Rank = (typeof RANKS)[number];
/** Algebraic square name, e.g. "e4". Only the 64 real squares are representable. */
export type Square = `${File}${Rank}`;

export type Color = 'white' | 'black';
export type PieceType = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';

/** A piece keeps a stable id for its whole life so the renderer can track it across moves. */
export interface Piece {
  readonly id: string;
  readonly type: PieceType;
  readonly color: Color;
}

/** Immutable mapping of occupied squares to pieces. Empty squares are absent. */
export type Board = ReadonlyMap<Square, Piece>;
