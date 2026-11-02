// One height table (TARGET_HEIGHT) sizes every piece: it keeps the chess ranking, covers every
// model listed in MODEL_ASSETS, gives every piece type a sculpted statue, and agrees with the turned
// procedural pieces that stand in when a statue fails to load.
import { describe, expect, it } from 'vitest';
import { Box3 } from 'three';
import type { PieceType } from '../src/game';
import { MAX_FOOTPRINT, MODEL_ASSETS, STATUE_ASSET, TARGET_HEIGHT, type ModelAsset } from '../src/scene/assets';
import { pieceParts } from '../src/scene/pieces';

const h = TARGET_HEIGHT;

/** Height of a turned procedural piece, from its parts. */
function proceduralHeight(type: PieceType): number {
  const box = new Box3();
  for (const p of pieceParts(type, 'low')) {
    const g = p.geo.clone();
    if (p.matrix) g.applyMatrix4(p.matrix);
    g.computeBoundingBox();
    box.union(g.boundingBox!);
  }
  return box.max.y;
}

describe('piece heights', () => {
  it('rank king > queen > rook, knight, bishop > pawn', () => {
    expect(h.king).toBeGreaterThan(h.queen);
    for (const minor of [h.rook, h.knight, h.bishop]) {
      expect(h.queen).toBeGreaterThan(minor);
      expect(minor).toBeGreaterThan(h.pawn);
    }
  });

  it('every piece model in MODEL_ASSETS names a piece with a target height', () => {
    for (const [name, a] of Object.entries(MODEL_ASSETS) as [string, ModelAsset][]) {
      if (a.kind !== 'piece') continue;
      expect(a.piece, name).toBeDefined();
      expect(h[a.piece!], name).toBeGreaterThan(0);
    }
  });

  it.each(['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'] as const)('the %s stands as a sculpted statue of its own type', (type) => {
    const a: ModelAsset = MODEL_ASSETS[STATUE_ASSET[type]];
    expect(a.kind).toBe('piece');
    expect(a.piece).toBe(type);
    expect(a.base).toMatch(/^models\/pieces\/[a-z]+_white\.glb$/);
  });

  // Fallback only (shown when the statue fails to load), but it must not break the ranking then.
  it.each(['king', 'queen', 'bishop', 'knight'] as const)('the turned %s fallback matches its table height', (type) => {
    expect(proceduralHeight(type)).toBeCloseTo(h[type], 1);
  });

  it('sculpted figures stay inside their square', () => {
    expect(MAX_FOOTPRINT).toBeGreaterThan(0.6);
    expect(MAX_FOOTPRINT).toBeLessThanOrEqual(0.8);
  });
});
