// One height table (TARGET_HEIGHT) sizes every piece: it keeps the chess ranking, covers every
// model listed in MODEL_ASSETS, gives every piece type a sculpted statue, and agrees with the turned
// procedural pieces that stand in when a statue fails to load.
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { Box3, Matrix4, Vector3 } from 'three';
import type { PieceType } from '../src/game';
import { MAX_FOOTPRINT, MODEL_ASSETS, PEDESTAL_DIAMETER, PEDESTAL_TOP, STATUE_ASSET, TARGET_HEIGHT, type ModelAsset } from '../src/scene/assets';
import { SQUARE_SIZE } from '../src/scene/board';
import { pieceParts } from '../src/scene/pieces';
import { fitStatue } from '../src/scene/statue';

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

/** Model-space bounds of a shipped .glb (each mesh's POSITION box through its node's world matrix). */
async function glbBounds(file: string): Promise<Box3> {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const root = (await io.read(join(import.meta.dirname, '..', 'public', file))).getRoot();
  const box = new Box3();
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const world = new Matrix4().fromArray(node.getWorldMatrix());
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION')!;
      const local = new Box3(new Vector3(...pos.getMinNormalized([])), new Vector3(...pos.getMaxNormalized([])));
      box.union(local.applyMatrix4(world));
    }
  }
  return box;
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

  it.each(['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'] as const)('the shipped %s statue reaches its table height (not shrunk by the footprint cap)', async (type) => {
    const b = await glbBounds(MODEL_ASSETS[STATUE_ASSET[type]].base);
    const fit = fitStatue(b, type, PEDESTAL_TOP);
    expect(PEDESTAL_TOP + (b.max.y - b.min.y) * fit.scale).toBeCloseTo(h[type], 2);
  });

  // Fallback only (shown when the statue fails to load), but it must not break the ranking then.
  it.each(['king', 'queen', 'bishop', 'knight'] as const)('the turned %s fallback matches its table height', (type) => {
    expect(proceduralHeight(type)).toBeCloseTo(h[type], 1);
  });

  it('sculpted figures stay inside their square: two neighbours never meet', () => {
    // Each figure stays inside a circle of MAX_FOOTPRINT / 2; neighbours stand one square apart.
    expect(MAX_FOOTPRINT).toBeGreaterThan(0.75);
    expect(MAX_FOOTPRINT).toBeLessThan(SQUARE_SIZE);
  });

  it.each(['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'] as const)('the %s pedestal covers about 75-80%% of its square, below the figure', (type) => {
    expect(PEDESTAL_DIAMETER[type]).toBeGreaterThanOrEqual(0.7);
    expect(PEDESTAL_DIAMETER[type]).toBeLessThanOrEqual(0.82);
    expect(PEDESTAL_TOP).toBeLessThan(h[type] / 3); // the figure, not the pedestal, carries the height
  });
});
