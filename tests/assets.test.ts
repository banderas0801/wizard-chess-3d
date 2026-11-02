// Every model listed in src/scene/assets.ts exists under public/ and fits the download budget
// (piece < 4 MB, prop < 0.5 MB, all together < 25 MB), and piece models stay within the
// triangle and texture-size ceilings. Masters (the 30+ MB exports) never belong in public/.
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { ASSET_BUDGET, assetFiles, MODEL_ASSETS, type ModelAsset } from '../src/scene/assets';

const PUBLIC = join(import.meta.dirname, '..', 'public');
const ASSETS = Object.entries(MODEL_ASSETS) as [string, ModelAsset][];
const files = ASSETS.flatMap(([name, a]) => assetFiles(a).map((f) => ({ name, kind: a.kind, file: f, path: join(PUBLIC, f) })));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('model assets', () => {
  it.each(files)('$file exists', ({ path }) => {
    expect(existsSync(path)).toBe(true);
  });

  it.each(files)('$file is within its $kind budget', ({ kind, path }) => {
    expect(statSync(path).size).toBeLessThan(ASSET_BUDGET[kind]);
  });

  it('all listed files together are under the total budget', () => {
    const total = files.reduce((n, f) => n + statSync(f.path).size, 0);
    expect(total).toBeLessThan(ASSET_BUDGET.total);
  });

  it('every .glb under public/models is listed (nothing ships unbudgeted)', () => {
    const listed = new Set(files.map((f) => f.file));
    const shipped = walk(join(PUBLIC, 'models')).filter((p) => p.endsWith('.glb')).map((p) => relative(PUBLIC, p));
    expect(shipped.filter((f) => !listed.has(f))).toEqual([]);
  });

  it.each(files.filter((f) => f.kind === 'piece'))('$file: triangles and texture sizes within the piece ceilings', async ({ path }) => {
    await MeshoptDecoder.ready;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const root = (await io.read(path)).getRoot();
    let tris = 0;
    for (const mesh of root.listMeshes()) {
      for (const p of mesh.listPrimitives()) {
        const n = p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0;
        tris += p.getMode() === 4 ? n / 3 : 0; // TRIANGLES only
      }
    }
    expect(tris).toBeGreaterThan(0);
    expect(tris).toBeLessThanOrEqual(ASSET_BUDGET.pieceTriangles);
    for (const t of root.listTextures()) {
      const size = t.getSize();
      if (!size) continue; // unknown encoding: size budget above still applies
      expect(Math.max(...size)).toBeLessThanOrEqual(ASSET_BUDGET.textureSize);
    }
  });
});
