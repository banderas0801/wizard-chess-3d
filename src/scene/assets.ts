// Every binary model the app loads, in one list. Pure data (no three), so the budget test can
// read it from node. Paths are relative to `public/` (and to Vite's BASE_URL at runtime).
//
// A piece may ship one file for both sides (`base`; the black side is recoloured at runtime) or
// a separate black file (`blackOverride`).
import type { Color } from '../game';

export type AssetKind = 'piece' | 'prop';

export interface ModelAsset {
  readonly kind: AssetKind;
  readonly base: string;
  readonly blackOverride?: string;
}

export const MODEL_ASSETS = {
  horse: { kind: 'piece', base: 'models/quaternius-horse/Horse.glb' },
  pawn: { kind: 'piece', base: 'models/pieces/pawn_white.glb' },
  /** Previous rigged spearman, now unused by the game (kept for scene/figure.ts and its test). */
  spearman: { kind: 'piece', base: 'models/pawn/Pawn.glb' },
  rook: { kind: 'piece', base: 'models/pieces/rook_white.glb' },
} as const satisfies Readonly<Record<string, ModelAsset>>;

export type AssetName = keyof typeof MODEL_ASSETS;

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
