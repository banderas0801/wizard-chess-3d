// The knight's rider: a horned-helm lancer seated on the CC0 horse (see character.ts).
// Built from primitives in the horse's model space (+z forward, +y up, origin on the saddle) and
// merged into one mesh per finish, so every knight shares the geometry and costs a few draw calls.
import {
  BufferGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Armour takes the side's lacquer, trim is gold, dark is the visor slit and pennant. */
export type RiderFinish = 'armour' | 'trim' | 'dark';
export interface RiderMaterials {
  armour: Material;
  trim: Material;
  dark: Material;
}

/** Saddle point on the horse, in horse model units (measured from the GLB: back top at z ~0.2). */
export const SADDLE = new Vector3(0, 3.38, 0.15);
/** Lance pitch about the hand: held high at rest, couched level for the charge. */
export const LANCE_REST = -1.05;
export const LANCE_COUCHED = 0.45;
const HAND = new Vector3(-0.52, 0.82, 0.55);

type Parts = Map<RiderFinish, BufferGeometry[]>;
const add = (parts: Parts, f: RiderFinish, g: BufferGeometry, m: Matrix4): void => {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute('uv');
  geo.applyMatrix4(m);
  parts.get(f)!.push(geo);
};
const at = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): Matrix4 =>
  new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(rx, ry, rz)), new Vector3(sx, sy, sz));
/** A capsule from a to b. */
const limb = (parts: Parts, f: RiderFinish, a: Vector3, b: Vector3, r: number): void => {
  const d = b.clone().sub(a);
  const len = d.length();
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d.normalize());
  add(parts, f, new CapsuleGeometry(r, Math.max(len - 2 * r, 0.01), 4, 10), new Matrix4().compose(a.clone().lerp(b, 0.5), q, new Vector3(1, 1, 1)));
};

function buildBody(parts: Parts): void {
  // Saddle cloth with a gold hem.
  add(parts, 'armour', new CylinderGeometry(0.62, 0.66, 0.12, 20), at(0, 0.02, 0, 0, 0, 0, 1, 1, 1.15));
  add(parts, 'trim', new TorusGeometry(0.64, 0.035, 6, 28), at(0, -0.04, 0, Math.PI / 2, 0, 0, 1, 1.15, 1));
  // Legs astride the barrel, greaves down the flanks.
  for (const s of [1, -1]) {
    const hip = new Vector3(0.28 * s, 0.18, 0);
    const knee = new Vector3(0.66 * s, -0.25, 0.42);
    const ankle = new Vector3(0.68 * s, -0.95, 0.22);
    limb(parts, 'armour', hip, knee, 0.17);
    limb(parts, 'armour', knee, ankle, 0.13);
    add(parts, 'trim', new SphereGeometry(0.12, 10, 8), at(knee.x, knee.y, knee.z));
    add(parts, 'armour', new SphereGeometry(0.15, 10, 8), at(ankle.x, ankle.y - 0.05, ankle.z + 0.12, 0, 0, 0, 0.8, 0.6, 1.5));
  }
  // Breastplate: a turned torso, leaning into the ride.
  const torso = new LatheGeometry(
    [[0, 0.1], [0.3, 0.1], [0.36, 0.35], [0.46, 0.85], [0.44, 1.18], [0.3, 1.32], [0.17, 1.42], [0, 1.44]].map(([r, y]) => new Vector2(r, y)),
    18,
  );
  add(parts, 'armour', torso, at(0, 0, 0, 0.12, 0, 0, 1, 1, 0.85));
  add(parts, 'trim', new TorusGeometry(0.36, 0.045, 6, 24), at(0, 0.38, 0.04, Math.PI / 2 + 0.12, 0, 0, 1, 0.85, 1)); // belt
  add(parts, 'trim', new SphereGeometry(0.1, 10, 8), at(0, 0.9, 0.48, 0, 0, 0, 1, 1, 0.5)); // brooch
  // Pauldrons.
  for (const s of [1, -1]) {
    add(parts, 'armour', new SphereGeometry(0.25, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), at(0.47 * s, 1.18, 0.12, 0, 0, -0.35 * s));
    add(parts, 'trim', new TorusGeometry(0.24, 0.03, 6, 20), at(0.47 * s, 1.18, 0.12, Math.PI / 2, 0, -0.35 * s));
  }
  // Helm: dome, face guard, visor slit, gold brow band.
  const head = new Vector3(0, 1.78, 0.2);
  add(parts, 'armour', new SphereGeometry(0.3, 16, 12), at(head.x, head.y, head.z));
  add(parts, 'armour', new CylinderGeometry(0.3, 0.26, 0.38, 16), at(head.x, head.y - 0.2, head.z));
  add(parts, 'dark', new CylinderGeometry(0.04, 0.04, 0.4, 6), at(head.x, head.y - 0.06, head.z + 0.29, 0, 0, Math.PI / 2, 1, 1, 0.6));
  add(parts, 'trim', new TorusGeometry(0.3, 0.04, 6, 24), at(head.x, head.y - 0.02, head.z, Math.PI / 2));
  add(parts, 'trim', new ConeGeometry(0.07, 0.22, 8), at(head.x, head.y + 0.36, head.z)); // finial
  // Horns sweep out, then up (two cone segments each), gold-tipped.
  for (const s of [1, -1]) {
    add(parts, 'armour', new CylinderGeometry(0.075, 0.11, 0.42, 10), at(head.x + 0.4 * s, head.y + 0.1, head.z - 0.02, 0, 0, -1.25 * s));
    add(parts, 'armour', new CylinderGeometry(0.035, 0.075, 0.42, 10), at(head.x + 0.66 * s, head.y + 0.36, head.z - 0.04, 0, 0, -0.45 * s));
    add(parts, 'trim', new ConeGeometry(0.035, 0.16, 8), at(head.x + 0.74 * s, head.y + 0.62, head.z - 0.05, 0, 0, -0.3 * s));
  }
  // Shield arm (rider's left, +x): kite-ish round shield with gold rim and boss.
  limb(parts, 'armour', new Vector3(0.5, 1.12, 0.1), new Vector3(0.62, 0.7, 0.3), 0.11);
  const sh = at(0.78, 0.78, 0.3, 0, 0, Math.PI / 2, 1, 1, 1.25);
  add(parts, 'armour', new CylinderGeometry(0.46, 0.46, 0.07, 20), sh);
  add(parts, 'trim', new TorusGeometry(0.46, 0.045, 6, 24), at(0.8, 0.78, 0.3, 0, Math.PI / 2, 0, 1.25, 1, 1));
  add(parts, 'trim', new SphereGeometry(0.11, 10, 8), at(0.83, 0.78, 0.3));
  // Lance arm (right, -x) reaching to the hand.
  const elbow = new Vector3(-0.6, 0.72, 0.18);
  limb(parts, 'armour', new Vector3(-0.48, 1.12, 0.1), elbow, 0.11);
  limb(parts, 'armour', elbow, HAND, 0.1);
}

function buildLance(parts: Parts): void {
  // Along +z from the hand: grip behind, vamplate, shaft, gold head, dark pennant.
  add(parts, 'armour', new CylinderGeometry(0.05, 0.06, 3.3, 8), at(0, 0, 0.75, Math.PI / 2));
  add(parts, 'trim', new ConeGeometry(0.2, 0.32, 12, 1, true), at(0, 0, 0.32, Math.PI / 2));
  add(parts, 'trim', new ConeGeometry(0.09, 0.5, 8), at(0, 0, 2.62, Math.PI / 2));
  add(parts, 'trim', new SphereGeometry(0.08, 8, 6), at(0, 0, -0.92));
  add(parts, 'dark', new ConeGeometry(0.22, 0.6, 3), at(0, 0.2, 2.05, Math.PI / 2, 0, 0, 0.12, 1, 1));
}

interface RiderGeometry {
  body: Map<RiderFinish, BufferGeometry>;
  lance: Map<RiderFinish, BufferGeometry>;
}
let shared: RiderGeometry | null = null;
const merged = (build: (p: Parts) => void): Map<RiderFinish, BufferGeometry> => {
  const parts: Parts = new Map([['armour', []], ['trim', []], ['dark', []]]);
  build(parts);
  const out = new Map<RiderFinish, BufferGeometry>();
  for (const [f, list] of parts) if (list.length) out.set(f, mergeGeometries(list)!);
  return out;
};
const riderGeometry = (): RiderGeometry => (shared ??= { body: merged(buildBody), lance: merged(buildLance) });

export interface Rider {
  /** Rider, in horse model units with its origin on the saddle. */
  readonly root: Group;
  /** Pitch this about x to raise (LANCE_REST) or couch (LANCE_COUCHED) the lance. */
  readonly lance: Group;
}

export function createRider(mats: RiderMaterials): Rider {
  const geo = riderGeometry();
  const meshes = (m: Map<RiderFinish, BufferGeometry>, into: Group): void => {
    for (const [f, g] of m) {
      const mesh = new Mesh(g, mats[f]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      into.add(mesh);
    }
  };
  const root = new Group();
  root.name = 'rider';
  meshes(geo.body, root);
  const lance = new Group();
  lance.name = 'lance';
  lance.position.copy(HAND);
  lance.rotation.x = LANCE_REST;
  meshes(geo.lance, lance);
  root.add(lance);
  return { root, lance };
}
