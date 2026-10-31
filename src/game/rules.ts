/**
 * Pure Chess Rules & Move Validator (KHÔNG import Three.js)
 */

import { Board, GameState, Move, Piece, PieceColor, PieceType, Square } from './types';

export function createInitialBoard(): Board {
  const b: Board = Array(8).fill(null).map(() => Array(8).fill(null));
  const order: PieceType[] = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];

  for (let c = 0; c < 8; c++) {
    b[0]![c] = { type: order[c]!, color: 'b' };
    b[1]![c] = { type: 'pawn', color: 'b' };
    b[6]![c] = { type: 'pawn', color: 'w' };
    b[7]![c] = { type: order[c]!, color: 'w' };
  }
  return b;
}

export function createInitialGameState(): GameState {
  return {
    board: createInitialBoard(),
    turn: 'w',
    castling: {
      w: { k: true, q: true },
      b: { k: true, q: true }
    },
    enPassant: null,
    halfMoveClock: 0,
    fullMoveNumber: 1,
    isCheck: false,
    isCheckmate: false,
    isStalemate: false
  };
}

export function isInside(r: number, c: number): boolean {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

export function cloneBoard(b: Board): Board {
  return b.map(row => row.map(p => (p ? { ...p } : null)));
}

/**
 * Sinh các nước đi tiềm năng (Pseudo-legal moves)
 */
export function getPseudoMoves(board: Board, square: Square, enPassant: Square | null): Square[] {
  const p = board[square.r]?.[square.c];
  if (!p) return [];

  const moves: Square[] = [];
  const { r, c } = square;
  const oppColor = p.color === 'w' ? 'b' : 'w';

  const add = (nr: number, nc: number) => {
    if (!isInside(nr, nc)) return false;
    const target = board[nr]![nc];
    if (!target) {
      moves.push({ r: nr, c: nc });
      return true; // Tiếp tục đi thẳng/chéo
    }
    if (target.color === oppColor) {
      moves.push({ r: nr, c: nc });
    }
    return false; // Bị chặn
  };

  switch (p.type) {
    case 'pawn': {
      const dir = p.color === 'w' ? -1 : 1;
      const startRank = p.color === 'w' ? 6 : 1;

      // Đi thẳng 1 ô
      if (isInside(r + dir, c) && !board[r + dir]![c]) {
        moves.push({ r: r + dir, c });
        // Đi thẳng 2 ô
        if (r === startRank && isInside(r + dir * 2, c) && !board[r + dir * 2]![c]) {
          moves.push({ r: r + dir * 2, c });
        }
      }

      // Ăn chéo
      for (const dc of [-1, 1]) {
        const nr = r + dir;
        const nc = c + dc;
        if (isInside(nr, nc)) {
          const target = board[nr]![nc];
          if (target && target.color === oppColor) {
            moves.push({ r: nr, c: nc });
          } else if (enPassant && enPassant.r === nr && enPassant.c === nc) {
            moves.push({ r: nr, c: nc });
          }
        }
      }
      break;
    }
    case 'knight': {
      const deltas = [
        [-2, -1], [-2, 1], [-1, -2], [-1, 2],
        [1, -2], [1, 2], [2, -1], [2, 1]
      ];
      for (const [dr, dc] of deltas) {
        add(r + dr!, c + dc!);
      }
      break;
    }
    case 'bishop':
    case 'rook':
    case 'queen': {
      const dirs: [number, number][] = [];
      if (p.type === 'bishop' || p.type === 'queen') {
        dirs.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
      }
      if (p.type === 'rook' || p.type === 'queen') {
        dirs.push([-1, 0], [1, 0], [0, -1], [0, 1]);
      }
      for (const [dr, dc] of dirs) {
        let step = 1;
        while (add(r + dr * step, c + dc * step)) {
          step++;
        }
      }
      break;
    }
    case 'king': {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr !== 0 || dc !== 0) add(r + dr, c + dc);
        }
      }
      break;
    }
  }

  return moves;
}

export function isSquareAttacked(board: Board, target: Square, attackerColor: PieceColor): boolean {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r]![c];
      if (p && p.color === attackerColor) {
        const moves = getPseudoMoves(board, { r, c }, null);
        if (moves.some(m => m.r === target.r && m.c === target.c)) {
          return true;
        }
      }
    }
  }
  return false;
}

export function findKing(board: Board, color: PieceColor): Square | null {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r]![c];
      if (p && p.type === 'king' && p.color === color) {
        return { r, c };
      }
    }
  }
  return null;
}

export function isKingInCheck(board: Board, color: PieceColor): boolean {
  const king = findKing(board, color);
  if (!king) return false;
  return isSquareAttacked(board, king, color === 'w' ? 'b' : 'w');
}

/**
 * Lọc các nước đi an toàn không để Vua bị chiếu
 */
export function getLegalMoves(state: GameState, square: Square): Square[] {
  const p = state.board[square.r]?.[square.c];
  if (!p || p.color !== state.turn) return [];

  const pseudo = getPseudoMoves(state.board, square, state.enPassant);
  const legal: Square[] = [];

  for (const move of pseudo) {
    // Thử nước đi trên bàn cờ ảo
    const testB = cloneBoard(state.board);
    testB[move.r]![move.c] = testB[square.r]![square.c];
    testB[square.r]![square.c] = null;

    if (!isKingInCheck(testB, p.color)) {
      legal.push(move);
    }
  }

  return legal;
}

/**
 * Chuyển trạng thái bàn cờ sang chuẩn FEN (Forsyth-Edwards Notation)
 */
export function toFEN(state: GameState): string {
  const rows: string[] = [];

  for (let r = 0; r < 8; r++) {
    let emptyCount = 0;
    let rowStr = '';

    for (let c = 0; c < 8; c++) {
      const p = state.board[r]![c];
      if (!p) {
        emptyCount++;
      } else {
        if (emptyCount > 0) {
          rowStr += emptyCount;
          emptyCount = 0;
        }
        const sym = p.type === 'knight' ? 'n' : p.type[0]!;
        rowStr += p.color === 'w' ? sym.toUpperCase() : sym.toLowerCase();
      }
    }
    if (emptyCount > 0) rowStr += emptyCount;
    rows.push(rowStr);
  }

  const piecePlacement = rows.join('/');
  const activeColor = state.turn;
  let castling = '';
  if (state.castling.w.k) castling += 'K';
  if (state.castling.w.q) castling += 'Q';
  if (state.castling.b.k) castling += 'k';
  if (state.castling.b.q) castling += 'q';
  if (castling === '') castling = '-';

  const ep = state.enPassant
    ? `${String.fromCharCode(97 + state.enPassant.c)}${8 - state.enPassant.r}`
    : '-';

  return `${piecePlacement} ${activeColor} ${castling} ${ep} ${state.halfMoveClock} ${state.fullMoveNumber}`;
}
