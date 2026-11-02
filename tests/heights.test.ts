// One height table (TARGET_HEIGHT) sizes every piece: it keeps the chess ranking, covers every
// model listed in MODEL_ASSETS, and agrees with the turned procedural pieces it stands beside.
import { describe, expect, it } from 'vitest';
import { Box3 } from 'three';
import type { PieceType } from '../src/game';
import { MAX_FOOTPRINT, MODEL_ASSETS, TARGET_HEIGHT, type ModelAsset } from '../src/scene/assets';
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

  it.each(['king', 'queen', 'bishop', 'knight'] as const)('the turned %s matches its table height', (type) => {
    expect(proceduralHeight(type)).toBeCloseTo(h[type], 1);
  });

  it('sculpted figures stay inside their square', () => {
    expect(MAX_FOOTPRINT).toBeGreaterThan(0.6);
    expect(MAX_FOOTPRINT).toBeLessThanOrEqual(0.8);
  });
});
