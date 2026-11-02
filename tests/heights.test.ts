// Two height tables size the pieces: STATUE_HEIGHT for the sculpted statues (standing straight on
// the square, no pedestal) and TARGET_HEIGHT for the turned procedural pieces that stand in when a
// statue fails to load. Both keep the chess ranking; every model in MODEL_ASSETS has a height, every
// piece type a sculpted statue, and each shipped statue reaches its height inside its square.
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { Box3, Matrix4, Vector3 } from 'three';
import type { PieceType } from '../src/game';
import { MAX_FOOTPRINT, MODEL_ASSETS, STATUE_ASSET, STATUE_HEIGHT, TARGET_HEIGHT, type ModelAsset } from '../src/scene/assets';
import { SQUARE_SIZE } from '../src/scene/board';
import { pieceParts } from '../src/scene/pieces';
import { fitStatue, STATUE_REST_YAW, type StatueKit } from '../src/scene/statue';

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

/** Model-space bounds and x/z footprint of a shipped .glb (every vertex through its node's world matrix). */
async function glbShape(file: string): Promise<Pick<StatueKit, 'bounds' | 'footprint'>> {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const root = (await io.read(join(import.meta.dirname, '..', 'public', file))).getRoot();
  const bounds = new Box3();
  const xz: number[] = [];
  const v = new Vector3();
  const el: number[] = [];
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const world = new Matrix4().fromArray(node.getWorldMatrix());
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION')!;
      for (let i = 0; i < pos.getCount(); i++) {
        v.fromArray(pos.getElement(i, el)).applyMatrix4(world);
        bounds.expandByPoint(v);
        xz.push(v.x, v.z);
      }
    }
  }
  return { bounds, footprint: Float32Array.from(xz) };
}

const TYPES = ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'] as const;

/** Rank order: king > queen > rook, knight, bishop > pawn. */
function expectRanked(t: Readonly<Record<PieceType, number>>): void {
  expect(t.king).toBeGreaterThan(t.queen);
  for (const minor of [t.rook, t.knight, t.bishop]) {
    expect(t.queen).toBeGreaterThan(minor);
    expect(minor).toBeGreaterThan(t.pawn);
  }
}

describe('piece heights', () => {
  it('statues and turned fallbacks both rank king > queen > rook, knight, bishop > pawn', () => {
    expectRanked(STATUE_HEIGHT);
    expectRanked(h);
  });

  it('statues stand tall: at least as tall as the turned set, the pawn over a square', () => {
    for (const type of TYPES) expect(STATUE_HEIGHT[type]).toBeGreaterThanOrEqual(h[type]);
    expect(STATUE_HEIGHT.pawn).toBeGreaterThanOrEqual(1.2);
  });

  it('every piece model in MODEL_ASSETS names a piece with a target height', () => {
    for (const [name, a] of Object.entries(MODEL_ASSETS) as [string, ModelAsset][]) {
      if (a.kind !== 'piece') continue;
      expect(a.piece, name).toBeDefined();
      expect(h[a.piece!], name).toBeGreaterThan(0);
      expect(STATUE_HEIGHT[a.piece!], name).toBeGreaterThan(0);
    }
  });

  it.each(TYPES)('the %s stands as a sculpted statue of its own type', (type) => {
    const a: ModelAsset = MODEL_ASSETS[STATUE_ASSET[type]];
    expect(a.kind).toBe('piece');
    expect(a.piece).toBe(type);
    expect(a.base).toMatch(/^models\/pieces\/[a-z]+_white\.glb$/);
  });

  it.each(TYPES)('the shipped %s statue stands on the board at its table height, inside its square', async (type) => {
    const shape = await glbShape(MODEL_ASSETS[STATUE_ASSET[type]].base);
    const fit = fitStatue(shape, type);
    const b = shape.bounds;
    expect(b.min.y * fit.scale + fit.offset[1]).toBeCloseTo(0, 6); // feet on the board, no pedestal
    expect((b.max.y - b.min.y) * fit.scale).toBeCloseTo(STATUE_HEIGHT[type], 2); // not shrunk by the cap
    // At its rest facing, centred: the footprint spans at most MAX_FOOTPRINT each way.
    const c = Math.cos(STATUE_REST_YAW);
    const s = Math.sin(STATUE_REST_YAW);
    let maxX = 0;
    let maxZ = 0;
    const f = shape.footprint;
    for (let i = 0; i < f.length; i += 2) {
      const x = f[i]! * fit.scale + fit.offset[0];
      const z = f[i + 1]! * fit.scale + fit.offset[2];
      maxX = Math.max(maxX, Math.abs(x * c + z * s));
      maxZ = Math.max(maxZ, Math.abs(-x * s + z * c));
    }
    expect(maxX).toBeLessThanOrEqual(MAX_FOOTPRINT / 2 + 1e-6);
    expect(maxZ).toBeLessThanOrEqual(MAX_FOOTPRINT / 2 + 1e-6);
  });

  // Fallback only (shown when the statue fails to load), but it must not break the ranking then.
  it.each(['king', 'queen', 'bishop', 'knight'] as const)('the turned %s fallback matches its table height', (type) => {
    expect(proceduralHeight(type)).toBeCloseTo(h[type], 1);
  });

  it('sculpted figures stay inside their square: two neighbours never meet', () => {
    // Each figure stays inside a centred box MAX_FOOTPRINT wide; neighbours stand one square apart.
    expect(MAX_FOOTPRINT).toBeGreaterThan(0.75);
    expect(MAX_FOOTPRINT).toBeLessThan(SQUARE_SIZE);
  });
});
