import {
  BoxGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  Path,
  Quaternion,
  Shape,
  Vector3,
  type BufferGeometry,
} from 'three';
import { indexToSquare, squareToIndex, type Square } from '../game';
import { getMaterials, type Detail, type MaterialSet } from './materials';

export const SQUARE_SIZE = 1;
export const BOARD_TOP_Y = 0;
/** Height of the hall floor the board stands on. */
export const FLOOR_Y = -0.62;
const TILE_H = 0.06;
const FRAME_IN = 4;
const FRAME_OUT = 5;
const FRAME_TOP = 0.035;

/** World-space centre of a square's top face. White's a1 is at (-3.5, 0, 3.5). */
export function squareToWorld(sq: Square, out = new Vector3()): Vector3 {
  const { file, rank } = squareToIndex(sq);
  return out.set((file - 3.5) * SQUARE_SIZE, BOARD_TOP_Y, (3.5 - rank) * SQUARE_SIZE);
}

type MatKey = keyof MaterialSet;

function rectRing(outer: number, inner: number): Shape {
  const s = new Shape();
  s.moveTo(-outer, -outer);
  s.lineTo(outer, -outer);
  s.lineTo(outer, outer);
  s.lineTo(-outer, outer);
  s.lineTo(-outer, -outer);
  const h = new Path();
  h.moveTo(-inner, -inner);
  h.lineTo(-inner, inner);
  h.lineTo(inner, inner);
  h.lineTo(inner, -inner);
  h.lineTo(-inner, -inner);
  s.holes.push(h);
  return s;
}

/** Extrude a flat shape upward so it spans world y in [bottom, top] (bevel included). */
function slab(shape: Shape, bottom: number, top: number, bevel: number): BufferGeometry {
  const depth = top - bottom - 2 * bevel;
  const g = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 4,
    curveSegments: 4,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bottom + bevel, 0);
  return g;
}

/** Deterministic pseudo-runes: 3-4 strokes between nodes of a 3x3 lattice, as gold inlay bars. */
function runeMatrices(seed = 1337): Matrix4[] {
  let s = seed;
  const rnd = (): number => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const out: Matrix4[] = [];
  const mid = (FRAME_IN + FRAME_OUT) / 2;
  const cellW = 0.16; // glyph extent along the side
  const cellH = 0.26; // glyph extent across the band
  const pitch = 0.3;
  const half = FRAME_OUT - 0.45;
  const n = Math.floor((2 * half) / pitch);
  const y = FRAME_TOP + 0.002;
  const thick = 0.018;
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  for (let side = 0; side < 4; side++) {
    const sideAngle = (side * Math.PI) / 2;
    for (let i = 0; i < n; i++) {
      const along = -half + pitch * (i + 0.5);
      const strokes = 3 + Math.floor(rnd() * 2);
      const used = new Set<string>();
      for (let k = 0; k < strokes; k++) {
        // Pick an edge of the 3x3 lattice (incl. diagonals), avoiding repeats.
        let ax = 0, ay = 0, bx = 0, by = 0;
        for (let tries = 0; tries < 8; tries++) {
          ax = Math.floor(rnd() * 3);
          ay = Math.floor(rnd() * 3);
          const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]] as const;
          const [dx, dy] = dirs[Math.floor(rnd() * 4)]!;
          bx = ax + dx;
          by = ay + dy;
          const key = `${ax}${ay}${bx}${by}`;
          if (bx <= 2 && by >= 0 && by <= 2 && !used.has(key)) {
            used.add(key);
            break;
          }
          bx = ax;
          by = ay;
        }
        if (bx === ax && by === ay) continue;
        // Local glyph coords: u along the side, v across the band (toward the board centre).
        const u0 = along + (ax - 1) * (cellW / 2);
        const u1 = along + (bx - 1) * (cellW / 2);
        const v0 = mid + (ay - 1) * (cellH / 2);
        const v1 = mid + (by - 1) * (cellH / 2);
        const len = Math.hypot(u1 - u0, v1 - v0) + thick;
        // Side 0 runs along +x at z = +mid; rotate the others about y.
        const local = new Vector3((u0 + u1) / 2, y, (v0 + v1) / 2).applyAxisAngle(up, sideAngle);
        const yaw = -Math.atan2(v1 - v0, u1 - u0) + sideAngle;
        q.setFromAxisAngle(up, yaw);
        out.push(new Matrix4().compose(local, q, new Vector3(len, 0.006, thick)));
      }
    }
  }
  return out;
}

export interface BoardLayer {
  readonly group: Group;
  setDetail(detail: Detail): void;
}

export function createBoard(detail: Detail = 'high'): BoardLayer {
  const group = new Group();
  group.name = 'board';
  const tag = <T extends Object3D>(o: T, mat: MatKey, cast = false): T => {
    o.userData.mat = mat;
    o.receiveShadow = true;
    o.castShadow = cast;
    group.add(o);
    return o;
  };
  const mats = getMaterials(detail);

  // Inlaid squares: slightly undersized tiles over a gold bed, so fine gold lines separate them.
  const tile = new BoxGeometry(SQUARE_SIZE * 0.972, TILE_H, SQUARE_SIZE * 0.972);
  const lights = tag(new InstancedMesh(tile, mats.ivoryTile, 32), 'ivoryTile');
  const darks = tag(new InstancedMesh(tile, mats.ebonyTile, 32), 'ebonyTile');
  let li = 0;
  let di = 0;
  const m = new Matrix4();
  const p = new Vector3();
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      squareToWorld(indexToSquare(file, rank), p);
      m.makeTranslation(p.x, BOARD_TOP_Y - TILE_H / 2, p.z);
      if ((file + rank) % 2 === 0) darks.setMatrixAt(di++, m); // a1 is dark
      else lights.setMatrixAt(li++, m);
    }
  }
  const bed = tag(new Mesh(new BoxGeometry(8, 0.05, 8), mats.gold), 'gold');
  bed.position.y = BOARD_TOP_Y - 0.035;

  // Wide black lacquer frame with bevelled edges, gold border lines, rune band and corner medallions.
  tag(new Mesh(slab(rectRing(FRAME_OUT, FRAME_IN + 0.012), -0.29, FRAME_TOP, 0.03), mats.lacquer), 'lacquer', true);
  for (const [o, i] of [[FRAME_IN + 0.13, FRAME_IN + 0.1], [FRAME_OUT - 0.1, FRAME_OUT - 0.13]] as const)
    tag(new Mesh(slab(rectRing(o, i), FRAME_TOP - 0.01, FRAME_TOP + 0.004, 0), mats.gold), 'gold');
  const runes = runeMatrices();
  const runeMesh = tag(new InstancedMesh(new BoxGeometry(1, 1, 1), mats.gold, runes.length), 'gold');
  runes.forEach((rm, i) => runeMesh.setMatrixAt(i, rm));
  const medallion = new CylinderGeometry(0.2, 0.2, 0.02, 48);
  const mid = (FRAME_IN + FRAME_OUT) / 2;
  for (const [x, z] of [[mid, mid], [-mid, mid], [mid, -mid], [-mid, -mid]] as const) {
    const md = tag(new Mesh(medallion, mats.gold), 'gold');
    md.position.set(x, FRAME_TOP + 0.002, z);
    const gem = tag(new Mesh(new CylinderGeometry(0.11, 0.13, 0.03, 32), mats.lacquer), 'lacquer');
    gem.position.set(x, FRAME_TOP + 0.012, z);
  }

  // Plinth the board stands on, down to the hall floor, with a gold lip.
  const plinth = new Shape();
  const P = FRAME_OUT + 0.3;
  plinth.moveTo(-P, -P);
  plinth.lineTo(P, -P);
  plinth.lineTo(P, P);
  plinth.lineTo(-P, P);
  plinth.lineTo(-P, -P);
  tag(new Mesh(slab(plinth, FLOOR_Y, -0.29, 0.04), mats.lacquer), 'lacquer', true);
  tag(new Mesh(slab(rectRing(P + 0.012, P - 0.2), -0.31, -0.288, 0), mats.gold), 'gold');

  return {
    group,
    setDetail(d) {
      const next = getMaterials(d);
      group.traverse((o) => {
        if (o instanceof Mesh && typeof o.userData.mat === 'string') o.material = next[o.userData.mat as MatKey];
      });
    },
  };
}
