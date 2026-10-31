import {
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  RGBAFormat,
  type Material,
} from 'three';

/** Scene detail follows the post tier: 'high' = clearcoat physical materials + dense geometry. */
export type Detail = 'high' | 'low';

export interface MaterialSet {
  readonly ivory: Material;
  readonly ebony: Material;
  readonly gold: Material;
  readonly ivoryTile: Material;
  readonly ebonyTile: Material;
  readonly lacquer: Material;
}

/** Deterministic tiling value noise (0..1), so roughness varies subtly instead of looking like plastic. */
export function noiseTexture(size = 256, seed = 7): DataTexture {
  let s = seed >>> 0;
  const rnd = (): number => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
  const data = new Uint8Array(size * size * 4);
  const octave = (cells: number): Float32Array => {
    const grid = new Float32Array(cells * cells).map(() => rnd());
    const out = new Float32Array(size * size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * cells;
        const gy = (y / size) * cells;
        const x0 = Math.floor(gx);
        const y0 = Math.floor(gy);
        const fx = gx - x0;
        const fy = gy - y0;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const g = (i: number, j: number): number => grid[((j % cells) * cells + (i % cells))]!;
        const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * sx;
        const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * sx;
        out[y * size + x] = a + (b - a) * sy;
      }
    return out;
  };
  const o1 = octave(4);
  const o2 = octave(16);
  const o3 = octave(64);
  for (let i = 0; i < size * size; i++) {
    const v = 0.5 * o1[i]! + 0.3 * o2[i]! + 0.2 * o3[i]!;
    const b = Math.round((0.72 + 0.28 * v) * 255); // multiplier for material.roughness
    data.set([b, b, b, 255], i * 4);
  }
  const tex = new DataTexture(data, size, size, RGBAFormat);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const IVORY = new Color('#efe2c8');
const EBONY = new Color('#0c0b0e');
const GOLD = new Color('#e3ad4f');

function build(detail: Detail): MaterialSet {
  if (detail === 'low') {
    return {
      ivory: new MeshStandardMaterial({ color: IVORY, roughness: 0.3 }),
      ebony: new MeshStandardMaterial({ color: EBONY, roughness: 0.25 }),
      gold: new MeshStandardMaterial({ color: GOLD, metalness: 1, roughness: 0.3 }),
      ivoryTile: new MeshStandardMaterial({ color: '#e9dcc0', roughness: 0.35 }),
      ebonyTile: new MeshStandardMaterial({ color: '#111014', roughness: 0.3 }),
      lacquer: new MeshStandardMaterial({ color: '#0a090b', roughness: 0.3 }),
    };
  }
  const rough = noiseTexture();
  const tileRough = rough.clone();
  tileRough.repeat.set(0.35, 0.35);
  return {
    ivory: new MeshPhysicalMaterial({
      color: IVORY, roughness: 0.38, roughnessMap: rough, clearcoat: 1, clearcoatRoughness: 0.07,
      sheen: 0.25, sheenColor: new Color('#fff4e0'), sheenRoughness: 0.5,
    }),
    ebony: new MeshPhysicalMaterial({
      color: EBONY, roughness: 0.32, roughnessMap: rough, clearcoat: 1, clearcoatRoughness: 0.05,
    }),
    gold: new MeshPhysicalMaterial({
      color: GOLD, metalness: 1, roughness: 0.26, roughnessMap: rough, clearcoat: 0.4, clearcoatRoughness: 0.1,
    }),
    ivoryTile: new MeshPhysicalMaterial({
      color: '#e9dcc0', roughness: 0.45, roughnessMap: tileRough, clearcoat: 0.7, clearcoatRoughness: 0.22,
    }),
    ebonyTile: new MeshPhysicalMaterial({
      color: '#111014', roughness: 0.4, roughnessMap: tileRough, clearcoat: 0.85, clearcoatRoughness: 0.18,
    }),
    lacquer: new MeshPhysicalMaterial({
      color: '#0a090b', roughness: 0.3, roughnessMap: tileRough, clearcoat: 1, clearcoatRoughness: 0.06,
    }),
  };
}

const cache = new Map<Detail, MaterialSet>();
export function getMaterials(detail: Detail): MaterialSet {
  let m = cache.get(detail);
  if (!m) cache.set(detail, (m = build(detail)));
  return m;
}

export const detailForTier = (tier: 'off' | 'low' | 'high'): Detail => (tier === 'high' ? 'high' : 'low');
