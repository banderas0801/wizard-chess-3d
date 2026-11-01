/**
 * Pure Chess Domain Types (Strict TypeScript, KHÔNG import Three.js)
 */

export type PieceType = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';
export type PieceColor = 'w' | 'b';

export interface Piece {
  type: PieceType;
  color: PieceColor;
  hasMoved?: boolean | undefined;
}

export type Board = (Piece | null)[][]; // 8x8 grid (0,0 = a8, 7,7 = h1)

export interface Square {
  r: number; // 0..7
  c: number; // 0..7
}

export interface Move {
  from: Square;
  to: Square;
  piece: Piece;
  captured: Piece | null;
  promotion?: PieceType | undefined;
  isCastling?: boolean | undefined;
  isEnPassant?: boolean | undefined;
}

export interface GameState {
  board: Board;
  turn: PieceColor;
  castling: {
    w: { k: boolean; q: boolean };
    b: { k: boolean; q: boolean };
  };
  enPassant: Square | null;
  halfMoveClock: number;
  fullMoveNumber: number;
  isCheck: boolean;
  isCheckmate: boolean;
  isStalemate: boolean;
}
