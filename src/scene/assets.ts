// Every binary model the app loads, in one list. Pure data (no three), so the budget test can
// read it from node. Paths are relative to `public/` (and to Vite's BASE_URL at runtime).
//
// A piece may ship one file for both sides (`base`; the black side is recoloured at runtime) or
// a separate black file (`blackOverride`).
import type { Color, PieceType } from '../game';

export type AssetKind = 'piece' | 'prop';

export interface ModelAsset {
  readonly kind: AssetKind;
  readonly base: string;
  readonly blackOverride?: string;
  /** The board piece this model stands in for (its size comes from TARGET_HEIGHT). */
  readonly piece?: PieceType;
}

export const MODEL_ASSETS = {
  /** Rigged horse + rider: the knight's fallback when the Meshy knight statue fails to load. */
  horse: { kind: 'piece', piece: 'knight', base: 'models/quaternius-horse/Horse.glb' },
  pawn: { kind: 'piece', piece: 'pawn', base: 'models/pieces/pawn_white.glb' },
  /** Previous rigged spearman, now unused by the game (kept for scene/figure.ts and its test). */
  spearman: { kind: 'piece', piece: 'pawn', base: 'models/pawn/Pawn.glb' },
  rook: { kind: 'piece', piece: 'rook', base: 'models/pieces/rook_white.glb' },
  knight: { kind: 'piece', piece: 'knight', base: 'models/pieces/knight_white.glb' },
  bishop: { kind: 'piece', piece: 'bishop', base: 'models/pieces/bishop_white.glb' },
  queen: { kind: 'piece', piece: 'queen', base: 'models/pieces/queen_white.glb' },
  king: { kind: 'piece', piece: 'king', base: 'models/pieces/king_white.glb' },
} as const satisfies Readonly<Record<string, ModelAsset>>;

/** The sculpted (Meshy) statue each piece type stands as on the board; every type has one. */
export const STATUE_ASSET = {
  pawn: 'pawn',
  rook: 'rook',
  knight: 'knight',
  bishop: 'bishop',
  queen: 'queen',
  king: 'king',
} as const satisfies Readonly<Record<PieceType, AssetName>>;

export type AssetName = keyof typeof MODEL_ASSETS;

/**
 * Overall height of each piece on the board, foot of the pedestal to the crown, in board squares.
 * One table for every piece: sculpted models are scaled to it at load (scene/statue.ts), and the
 * turned procedural fallbacks are checked against it (tests/heights.test.ts), so a new Meshy file lands
 * at the right size. Order: king > queen > rook, knight, bishop > pawn.
 */
export const TARGET_HEIGHT: Readonly<Record<PieceType, number>> = {
  king: 1.3,
  queen: 1.09,
  bishop: 0.95,
  rook: 0.98,
  knight: 0.9,
  pawn: 0.8,
};

/** Widest a sculpted figure may spread across its square (fraction of the square), so it never overflows. */
export const MAX_FOOTPRINT = 0.78;

const MB = 1024 * 1024;
/** Download budgets (bytes): per file by kind, and for every listed file together. */
export const ASSET_BUDGET = {
  piece: 4 * MB,
  prop: 0.5 * MB,
  total: 25 * MB,
  /** Geometry/texture ceilings for one piece model. */
  pieceTriangles: 60_000,
  textureSize: 2048,
} as const;

/** Every file an asset may load (base first). */
export const assetFiles = (a: ModelAsset): readonly string[] => (a.blackOverride ? [a.base, a.blackOverride] : [a.base]);

/** The file for one side. */
export const assetPath = (a: ModelAsset, color: Color): string => (color === 'black' && a.blackOverride ? a.blackOverride : a.base);
