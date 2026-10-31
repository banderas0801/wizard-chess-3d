// Pure chess position: FEN round-trip, legal move generation and move application.
// Kept deliberately simple (no perf tricks); good enough for a placeholder engine.
import { initialBoard, indexToSquare, squareToIndex, isSquare } from './board';
import type { Board, Color, Piece, PieceType, Square } from './types';

export interface CastlingRights {
  readonly K: boolean;
  readonly Q: boolean;
  readonly k: boolean;
  readonly q: boolean;
}

export interface GameState {
  readonly board: Board;
  readonly turn: Color;
  readonly castling: CastlingRights;
  readonly enPassant: Square | null;
  readonly halfmove: number;
  readonly fullmove: number;
}

export type Promotion = 'queen' | 'rook' | 'bishop' | 'knight';

export interface Move {
  readonly from: Square;
  readonly to: Square;
  readonly promotion?: Promotion;
}

export function initialState(): GameState {
  return {
    board: initialBoard(),
    turn: 'white',
    castling: { K: true, Q: true, k: true, q: true },
    enPassant: null,
    halfmove: 0,
    fullmove: 1,
  };
}

const TYPE_TO_CHAR: Record<PieceType, string> = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' };
const CHAR_TO_TYPE: Record<string, PieceType> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

const opposite = (c: Color): Color => (c === 'white' ? 'black' : 'white');

export function toFen(s: GameState): string {
  const rows: string[] = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const p = s.board.get(indexToSquare(file, rank));
      if (!p) {
        empty++;
        continue;
      }
      if (empty) row += String(empty);
      empty = 0;
      const ch = TYPE_TO_CHAR[p.type];
      row += p.color === 'white' ? ch.toUpperCase() : ch;
    }
    if (empty) row += String(empty);
    rows.push(row);
  }
  const c = s.castling;
  const castling = `${c.K ? 'K' : ''}${c.Q ? 'Q' : ''}${c.k ? 'k' : ''}${c.q ? 'q' : ''}` || '-';
  return `${rows.join('/')} ${s.turn === 'white' ? 'w' : 'b'} ${castling} ${s.enPassant ?? '-'} ${s.halfmove} ${s.fullmove}`;
}

/** Parses FEN. Piece ids are synthesised from the starting square (`fen-<color>-<type>-<sq>`). */
export function fromFen(fen: string): GameState {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) throw new Error(`Bad FEN: ${fen}`);
  const [placement, turn, castling, ep, half = '0', full = '1'] = parts as [string, string, string, string, string?, string?];
  const ranks = placement.split('/');
  if (ranks.length !== 8) throw new Error(`Bad FEN placement: ${placement}`);
  const board = new Map<Square, Piece>();
  ranks.forEach((row, i) => {
    const rank = 7 - i;
    let file = 0;
    for (const ch of row) {
      if (/[1-8]/.test(ch)) {
        file += Number(ch);
        continue;
      }
      const type = CHAR_TO_TYPE[ch.toLowerCase()];
      if (!type || file > 7) throw new Error(`Bad FEN row: ${row}`);
      const color: Color = ch === ch.toUpperCase() ? 'white' : 'black';
      const sq = indexToSquare(file, rank);
      board.set(sq, { id: `fen-${color}-${type}-${sq}`, type, color });
      file++;
    }
    if (file !== 8) throw new Error(`Bad FEN row width: ${row}`);
  });
  if (turn !== 'w' && turn !== 'b') throw new Error(`Bad FEN turn: ${turn}`);
  if (ep !== '-' && !isSquare(ep)) throw new Error(`Bad FEN en passant: ${ep}`);
  return {
    board,
    turn: turn === 'w' ? 'white' : 'black',
    castling: { K: castling.includes('K'), Q: castling.includes('Q'), k: castling.includes('k'), q: castling.includes('q') },
    enPassant: ep === '-' ? null : (ep as Square),
    halfmove: Number(half),
    fullmove: Number(full),
  };
}

const at = (file: number, rank: number): Square | null =>
  file >= 0 && file < 8 && rank >= 0 && rank < 8 ? indexToSquare(file, rank) : null;

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as const;
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

/** Is `sq` attacked by any piece of colour `by`? */
export function isAttacked(board: Board, sq: Square, by: Color): boolean {
  const { file, rank } = squareToIndex(sq);
  const has = (f: number, r: number, types: readonly PieceType[]): boolean => {
    const s = at(f, r);
    const p = s ? board.get(s) : undefined;
    return !!p && p.color === by && types.includes(p.type);
  };
  const pawnDir = by === 'white' ? -1 : 1; // attacker pawn sits one rank "behind" the target
  if (has(file - 1, rank + pawnDir, ['pawn']) || has(file + 1, rank + pawnDir, ['pawn'])) return true;
  if (KNIGHT.some(([df, dr]) => has(file + df, rank + dr, ['knight']))) return true;
  if (KING.some(([df, dr]) => has(file + df, rank + dr, ['king']))) return true;
  const ray = (dirs: readonly (readonly [number, number])[], types: readonly PieceType[]): boolean =>
    dirs.some(([df, dr]) => {
      for (let f = file + df, r = rank + dr; ; f += df, r += dr) {
        const s = at(f, r);
        if (!s) return false;
        const p = board.get(s);
        if (p) return p.color === by && types.includes(p.type);
      }
    });
  return ray(ROOK_DIRS, ['rook', 'queen']) || ray(BISHOP_DIRS, ['bishop', 'queen']);
}

function kingSquare(board: Board, color: Color): Square | null {
  for (const [sq, p] of board) if (p.type === 'king' && p.color === color) return sq;
  return null;
}

export function inCheck(s: GameState, color: Color = s.turn): boolean {
  const k = kingSquare(s.board, color);
  return k !== null && isAttacked(s.board, k, opposite(color));
}

function pseudoMoves(s: GameState): Move[] {
  const out: Move[] = [];
  const me = s.turn;
  const push = (from: Square, to: Square, pawnPromo = false): void => {
    if (pawnPromo) for (const promotion of ['queen', 'rook', 'bishop', 'knight'] as const) out.push({ from, to, promotion });
    else out.push({ from, to });
  };
  for (const [from, p] of s.board) {
    if (p.color !== me) continue;
    const { file, rank } = squareToIndex(from);
    const target = (f: number, r: number): { sq: Square; occ: Piece | undefined } | null => {
      const sq = at(f, r);
      return sq ? { sq, occ: s.board.get(sq) } : null;
    };
    const slide = (dirs: readonly (readonly [number, number])[]): void => {
      for (const [df, dr] of dirs) {
        for (let f = file + df, r = rank + dr; ; f += df, r += dr) {
          const t = target(f, r);
          if (!t) break;
          if (t.occ) {
            if (t.occ.color !== me) push(from, t.sq);
            break;
          }
          push(from, t.sq);
        }
      }
    };
    switch (p.type) {
      case 'pawn': {
        const dir = me === 'white' ? 1 : -1;
        const startRank = me === 'white' ? 1 : 6;
        const lastRank = me === 'white' ? 7 : 0;
        const one = target(file, rank + dir);
        if (one && !one.occ) {
          push(from, one.sq, rank + dir === lastRank);
          const two = target(file, rank + 2 * dir);
          if (rank === startRank && two && !two.occ) push(from, two.sq);
        }
        for (const df of [-1, 1]) {
          const t = target(file + df, rank + dir);
          if (!t) continue;
          if ((t.occ && t.occ.color !== me) || (!t.occ && t.sq === s.enPassant)) push(from, t.sq, rank + dir === lastRank);
        }
        break;
      }
      case 'knight':
      case 'king': {
        for (const [df, dr] of p.type === 'knight' ? KNIGHT : KING) {
          const t = target(file + df, rank + dr);
          if (t && (!t.occ || t.occ.color !== me)) push(from, t.sq);
        }
        if (p.type === 'king') {
          const home = me === 'white' ? 'e1' : 'e8';
          const r = me === 'white' ? '1' : '8';
          const enemy = opposite(me);
          const [kRight, qRight] = me === 'white' ? [s.castling.K, s.castling.Q] : [s.castling.k, s.castling.q];
          if (from === home && !isAttacked(s.board, home, enemy)) {
            const empty = (...sqs: string[]) => sqs.every((x) => !s.board.get(x as Square));
            const safe = (...sqs: string[]) => sqs.every((x) => !isAttacked(s.board, x as Square, enemy));
            const rookAt = (sq: string) => {
              const rk = s.board.get(sq as Square);
              return rk?.type === 'rook' && rk.color === me;
            };
            if (kRight && rookAt(`h${r}`) && empty(`f${r}`, `g${r}`) && safe(`f${r}`, `g${r}`)) push(from, `g${r}` as Square);
            if (qRight && rookAt(`a${r}`) && empty(`b${r}`, `c${r}`, `d${r}`) && safe(`c${r}`, `d${r}`)) push(from, `c${r}` as Square);
          }
        }
        break;
      }
      case 'rook':
        slide(ROOK_DIRS);
        break;
      case 'bishop':
        slide(BISHOP_DIRS);
        break;
      case 'queen':
        slide([...ROOK_DIRS, ...BISHOP_DIRS]);
        break;
    }
  }
  return out;
}

export function legalMoves(s: GameState): Move[] {
  return pseudoMoves(s).filter((m) => !inCheck(applyMoveUnchecked(s, m), s.turn));
}

function applyMoveUnchecked(s: GameState, m: Move): GameState {
  const piece = s.board.get(m.from);
  if (!piece) throw new Error(`No piece on ${m.from}`);
  const next = new Map(s.board);
  const captured = next.get(m.to);
  next.delete(m.from);
  const { file: ff, rank: fr } = squareToIndex(m.from);
  const { file: tf, rank: tr } = squareToIndex(m.to);
  let epCapture = false;
  if (piece.type === 'pawn' && m.to === s.enPassant && !captured) {
    next.delete(indexToSquare(tf, fr));
    epCapture = true;
  }
  if (piece.type === 'king' && Math.abs(tf - ff) === 2) {
    const [rf, rt] = tf === 6 ? [7, 5] : [0, 3];
    const rookFrom = indexToSquare(rf, fr);
    const rook = next.get(rookFrom);
    if (rook) {
      next.delete(rookFrom);
      next.set(indexToSquare(rt, fr), rook);
    }
  }
  next.set(m.to, m.promotion && piece.type === 'pawn' ? { ...piece, type: m.promotion } : piece);

  const c = { ...s.castling };
  const touch = (sq: Square): void => {
    if (sq === 'e1') c.K = c.Q = false;
    if (sq === 'e8') c.k = c.q = false;
    if (sq === 'h1') c.K = false;
    if (sq === 'a1') c.Q = false;
    if (sq === 'h8') c.k = false;
    if (sq === 'a8') c.q = false;
  };
  touch(m.from);
  touch(m.to);

  return {
    board: next,
    turn: opposite(s.turn),
    castling: c,
    enPassant: piece.type === 'pawn' && Math.abs(tr - fr) === 2 ? indexToSquare(ff, (fr + tr) / 2) : null,
    halfmove: piece.type === 'pawn' || captured || epCapture ? 0 : s.halfmove + 1,
    fullmove: s.turn === 'black' ? s.fullmove + 1 : s.fullmove,
  };
}

export type ApplyResult = { readonly ok: true; readonly state: GameState } | { readonly ok: false; readonly error: 'illegal' };

/** Applies a move only if it is legal in `s`. */
export function applyMove(s: GameState, m: Move): ApplyResult {
  const legal = legalMoves(s).some((x) => x.from === m.from && x.to === m.to && x.promotion === m.promotion);
  return legal ? { ok: true, state: applyMoveUnchecked(s, m) } : { ok: false, error: 'illegal' };
}

const PROMO_CHAR: Record<Promotion, string> = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' };
const CHAR_PROMO: Record<string, Promotion> = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' };

export function toUci(m: Move): string {
  return `${m.from}${m.to}${m.promotion ? PROMO_CHAR[m.promotion] : ''}`;
}

export function parseUci(uci: string): Move | null {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promo = uci.slice(4);
  if (!isSquare(from) || !isSquare(to) || uci.length > 5) return null;
  if (promo) {
    const p = CHAR_PROMO[promo];
    return p ? { from, to, promotion: p } : null;
  }
  return { from, to };
}

export type Outcome = 'checkmate' | 'stalemate' | null;
export function outcome(s: GameState): Outcome {
  if (legalMoves(s).length > 0) return null;
  return inCheck(s) ? 'checkmate' : 'stalemate';
}
