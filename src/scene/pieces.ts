import {
  Box3,
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  Quaternion,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  Euler,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Board, Color, PieceType } from '../game';
import { squareToWorld } from './board';
import { getMaterials, type Detail } from './materials';
import { Profile } from './profile';

/** Where a part's material comes from: the piece's own colour or gold trim. */
type Finish = 'body' | 'gold';
interface Part {
  readonly geo: BufferGeometry;
  readonly finish: Finish;
  readonly matrix?: Matrix4;
  /** Turned base (foot + rings): stays visible when a character stands on it. */
  readonly base?: true;
  /** Chariot wheel: its own mesh, spun about its local z (the axle) by the animator. */
  readonly wheel?: true;
}

interface Res {
  readonly lathe: number; // radial segments
  readonly curve: number; // extrude curve segments
  readonly torus: number;
  readonly sphere: number;
}
const RES: Record<Detail, Res> = {
  high: { lathe: 96, curve: 28, torus: 72, sphere: 24 },
  low: { lathe: 28, curve: 10, torus: 24, sphere: 10 },
};

const HALF_PI = Math.PI / 2;
const at = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s = 1): Matrix4 =>
  new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(rx, ry, rz)), new Vector3(s, s, s));

function lathe(p: Profile, r: Res): BufferGeometry {
  return new LatheGeometry(p.points, r.lathe);
}
/** Gold ring lying flat at height y. */
function ring(radius: number, y: number, tube: number, r: Res): Part {
  return { geo: new TorusGeometry(radius, tube, 12, r.torus), finish: 'gold', matrix: at(0, y, 0, HALF_PI) };
}
/** Gold sheath over the foot bead produced by Profile.foot(R, h, ...). */
const footRing = (R: number, h: number, r: Res): Part => ring(R * 0.8, h * 0.72, h * 0.105, r);
const ball = (radius: number, y: number, r: Res, x = 0, z = 0): Part => ({
  geo: new SphereGeometry(radius, r.sphere, Math.ceil(r.sphere * 0.75)),
  finish: 'gold',
  matrix: at(x, y, z),
});
/** Collar: a thin disc with a rounded edge, sheathed in gold. */
function collar(p: Profile, inR: number, outR: number, y: number, outR2 = inR + 0.015): Profile {
  return p.to(inR, y).corner().to(outR, y + 0.005).arc(outR, y + 0.02, 0.015, -HALF_PI, HALF_PI, 6).corner().to(outR2, y + 0.035).corner();
}

function pawn(r: Res): Part[] {
  const p = new Profile().foot(0.27, 0.14, 0.17).curve([[0.12, 0.24], [0.085, 0.33]]);
  collar(p, 0.085, 0.155, 0.345, 0.08);
  p.to(0.08, 0.41).arc(0, 0.47, 0.1, -Math.asin(0.6), HALF_PI, 18);
  return [{ geo: lathe(p, r), finish: 'body' }, footRing(0.27, 0.14, r), ring(0.157, 0.365, 0.014, r)];
}

export const ROOK_WHEEL_RADIUS = 0.165;
const ROOK_WHEEL_Z = 0.335;

/** Spoked wheel in the xy plane (axle = z): rim, six spokes, hub. One merged geometry so it spins as one. */
function wheelGeometry(r: Res): BufferGeometry {
  const R = ROOK_WHEEL_RADIUS;
  const parts: BufferGeometry[] = [new TorusGeometry(R - 0.02, 0.02, 10, r.torus)];
  for (let i = 0; i < 3; i++) parts.push(new BoxGeometry(2 * (R - 0.03), 0.018, 0.014).rotateZ((i * Math.PI) / 3));
  parts.push(new CylinderGeometry(0.042, 0.042, 0.06, 16).rotateX(HALF_PI));
  const geo = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  for (const g of parts) g.dispose();
  return geo;
}

function rook(r: Res): Part[] {
  const p = new Profile()
    .foot(0.3, 0.15, 0.21)
    .curve([[0.19, 0.3], [0.178, 0.46], [0.185, 0.6]])
    .curve([[0.22, 0.67], [0.25, 0.71]], 8)
    .to(0.25, 0.8)
    .corner()
    .to(0.185, 0.8)
    .corner()
    .to(0.185, 0.75)
    .corner()
    .to(0, 0.75);
  const parts: Part[] = [{ geo: lathe(p, r), finish: 'body' }, footRing(0.3, 0.15, r), ring(0.19, 0.6, 0.016, r), ring(0.25, 0.8, 0.012, r), ring(0.183, 0.3, 0.01, r)];
  // Merlons: bevelled ring sectors around the parapet.
  const n = 6;
  const span = ((Math.PI * 2) / n) * 0.6;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const s = new Shape();
    s.absarc(0, 0, 0.245, a0, a0 + span, false);
    s.absarc(0, 0, 0.19, a0 + span, a0, true);
    const geo = new ExtrudeGeometry(s, {
      depth: 0.08, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.006, bevelSegments: 3, curveSegments: Math.ceil(r.curve / 3),
    });
    parts.push({ geo, finish: 'body', matrix: at(0, 0.808, 0, -HALF_PI) });
  }
  // War-chariot wheels on the flanks (axle along local z; +x, the ram's forward, faces the enemy).
  const wheel = wheelGeometry(r);
  parts.push(
    { geo: wheel, finish: 'gold', matrix: at(0, ROOK_WHEEL_RADIUS, ROOK_WHEEL_Z), wheel: true },
    { geo: wheel, finish: 'gold', matrix: at(0, ROOK_WHEEL_RADIUS, -ROOK_WHEEL_Z), wheel: true },
    { geo: new CylinderGeometry(0.022, 0.022, ROOK_WHEEL_Z * 2, 12), finish: 'gold', matrix: at(0, ROOK_WHEEL_RADIUS, 0, HALF_PI) },
  );
  // Gold arrow-slit inlays.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const slit = new Shape();
    slit.moveTo(-0.012, -0.06);
    slit.lineTo(0.012, -0.06);
    slit.lineTo(0.012, 0.04);
    slit.absarc(0, 0.04, 0.012, 0, Math.PI, false);
    slit.lineTo(-0.012, -0.06);
    const geo = new ExtrudeGeometry(slit, { depth: 0.01, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 });
    parts.push({ geo, finish: 'gold', matrix: at(Math.sin(a) * 0.181, 0.46, Math.cos(a) * 0.181, 0, a) });
  }
  return parts;
}

function bishop(r: Res): Part[] {
  const p = new Profile().foot(0.29, 0.15, 0.19).curve([[0.12, 0.3], [0.085, 0.46]]);
  collar(p, 0.085, 0.17, 0.5, 0.1);
  p.curve([[0.13, 0.6], [0.142, 0.68], [0.115, 0.77], [0.055, 0.85], [0.012, 0.885]], 24).to(0, 0.89);
  return [
    { geo: lathe(p, r), finish: 'body' },
    footRing(0.29, 0.15, r),
    ring(0.172, 0.52, 0.015, r),
    // Diagonal band where a Staunton bishop has its mitre cut.
    { geo: new TorusGeometry(0.128, 0.011, 10, r.torus), finish: 'gold', matrix: new Matrix4().makeRotationZ(0.55).multiply(new Matrix4().makeRotationX(HALF_PI)).setPosition(0, 0.715, 0) },
    ball(0.034, 0.915, r),
  ];
}

function queen(r: Res): Part[] {
  const p = new Profile().foot(0.33, 0.16, 0.21).curve([[0.14, 0.35], [0.1, 0.55], [0.095, 0.62]]);
  collar(p, 0.095, 0.19, 0.64, 0.11);
  p.curve([[0.15, 0.78], [0.205, 0.89]], 14).to(0.205, 0.9).corner().to(0.15, 0.9).corner().curve([[0.13, 0.95], [0.06, 0.99], [0, 1.0]], 12);
  const parts: Part[] = [{ geo: lathe(p, r), finish: 'body' }, footRing(0.33, 0.16, r), ring(0.192, 0.66, 0.016, r), ring(0.2, 0.9, 0.013, r), ring(0.1, 0.6, 0.008, r)];
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    parts.push(ball(0.026, 0.928, r, Math.cos(a) * 0.195, Math.sin(a) * 0.195));
  }
  parts.push(ball(0.05, 1.04, r));
  return parts;
}

function king(r: Res): Part[] {
  const p = new Profile().foot(0.34, 0.17, 0.22).curve([[0.15, 0.38], [0.105, 0.6], [0.1, 0.7]]);
  collar(p, 0.1, 0.2, 0.72, 0.12);
  p.curve([[0.16, 0.86], [0.205, 0.97]], 14).to(0.205, 0.99).corner().to(0.16, 0.99).corner().curve([[0.15, 1.04], [0.08, 1.08], [0, 1.1]], 12);
  const parts: Part[] = [{ geo: lathe(p, r), finish: 'body' }, footRing(0.34, 0.17, r), ring(0.202, 0.74, 0.016, r), ring(0.203, 0.99, 0.013, r), ring(0.105, 0.68, 0.008, r)];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    parts.push({ geo: new ConeGeometry(0.03, 0.07, Math.max(8, r.sphere)), finish: 'gold', matrix: at(Math.cos(a) * 0.195, 1.03, Math.sin(a) * 0.195) });
  }
  // Cross finial: bevelled extrusion, so the edges catch light.
  const w = 0.028;
  const c = new Shape();
  c.moveTo(-w, 0);
  c.lineTo(w, 0);
  c.lineTo(w, 0.1);
  c.lineTo(0.075, 0.1);
  c.lineTo(0.075, 0.1 + 2 * w);
  c.lineTo(w, 0.1 + 2 * w);
  c.lineTo(w, 0.21);
  c.lineTo(-w, 0.21);
  c.lineTo(-w, 0.1 + 2 * w);
  c.lineTo(-0.075, 0.1 + 2 * w);
  c.lineTo(-0.075, 0.1);
  c.lineTo(-w, 0.1);
  c.lineTo(-w, 0);
  const cross = new ExtrudeGeometry(c, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 3 });
  cross.translate(0, 0, -0.015);
  parts.push({ geo: cross, finish: 'gold', matrix: at(0, 1.08, 0) }, ball(0.04, 1.1, r));
  return parts;
}

function knight(r: Res): Part[] {
  const base = new Profile().foot(0.31, 0.15, 0.2).curve([[0.2, 0.2], [0.21, 0.24]], 6).to(0.21, 0.255).corner().to(0, 0.255);
  // Side silhouette of a horse's head and neck (x = toward the muzzle, y = up).
  const s = new Shape();
  const v = (x: number, y: number): Vector2 => new Vector2(x, y);
  s.moveTo(-0.16, 0.24);
  s.splineThru([v(-0.185, 0.33), v(-0.17, 0.46), v(-0.13, 0.58), v(-0.075, 0.69)]); // back of neck
  s.lineTo(-0.045, 0.86); // ear
  s.lineTo(0.0, 0.75);
  s.splineThru([v(0.05, 0.735), v(0.11, 0.69), v(0.18, 0.61), v(0.245, 0.525), v(0.295, 0.45)]); // forehead + face
  s.splineThru([v(0.315, 0.41), v(0.3, 0.37), v(0.262, 0.352)]); // muzzle
  s.lineTo(0.215, 0.36); // mouth
  s.splineThru([v(0.17, 0.352), v(0.12, 0.38), v(0.07, 0.425)]); // jaw up to the cheek
  s.splineThru([v(0.025, 0.4), v(0.0, 0.34), v(0.03, 0.285), v(0.09, 0.25), v(0.13, 0.24)]); // throat, chest
  s.lineTo(-0.16, 0.24);
  const depth = 0.1;
  const head = new ExtrudeGeometry(s, {
    depth, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.028, bevelSegments: 6, curveSegments: r.curve,
  });
  head.translate(0, 0, -depth / 2);
  // Taper: full cheeks, narrow muzzle and a slimmer crest, so it isn't a flat slab from the front.
  const taper = (x: number, y: number): number => {
    const muzzle = Math.min(1, Math.max(0, (x - 0.1) / 0.22));
    const crest = Math.min(1, Math.max(0, (-x - 0.06) / 0.12)) * Math.min(1, Math.max(0, (y - 0.4) / 0.2));
    return 1 - 0.38 * muzzle - 0.3 * crest;
  };
  const pos = head.attributes.position!;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) * taper(pos.getX(i), pos.getY(i)));
  head.computeVertexNormals();
  // Mane: a gold crest along the back of the neck, centred on it.
  const m = new Shape();
  m.moveTo(-0.15, 0.26);
  m.splineThru([v(-0.21, 0.35), v(-0.2, 0.48), v(-0.15, 0.61), v(-0.085, 0.71)]);
  m.splineThru([v(-0.07, 0.66), v(-0.11, 0.58), v(-0.14, 0.47), v(-0.15, 0.35), v(-0.12, 0.27)]);
  m.lineTo(-0.15, 0.26);
  const mane = new ExtrudeGeometry(m, {
    depth: 0.04, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.01, bevelSegments: 4, curveSegments: r.curve,
  });
  mane.translate(0, 0, -0.02);
  const eyeZ = (depth / 2 + 0.035) * taper(0.09, 0.62);
  const noseZ = (depth / 2 + 0.03) * taper(0.27, 0.41);
  return [
    { geo: lathe(base, r), finish: 'body', base: true },
    { ...footRing(0.31, 0.15, r), base: true },
    { ...ring(0.212, 0.25, 0.012, r), base: true },
    { geo: head, finish: 'body' },
    { geo: mane, finish: 'gold' },
    ball(0.022, 0.62, r, 0.09, eyeZ),
    ball(0.022, 0.62, r, 0.09, -eyeZ),
    { geo: new TorusGeometry(0.022, 0.006, 8, 24), finish: 'gold', matrix: at(0.27, 0.41, noseZ) }, // nostrils
    { geo: new TorusGeometry(0.022, 0.006, 8, 24), finish: 'gold', matrix: at(0.27, 0.41, -noseZ) },
  ];
}

const BUILDERS: Record<PieceType, (r: Res) => Part[]> = { pawn, rook, bishop, queen, king, knight };

/**
 * The turned pieces are modelled at their original size and scaled up uniformly (from the board) to
 * match TARGET_HEIGHT in scene/assets, so a fallback stands as tall as the statue it replaces.
 */
export const TURNED_SCALE = 1.3;

/** Height of the pawn's character pedestal top (where a rigged figure's soles stand). */
export const PAWN_PEDESTAL_TOP = 0.2;
/** Radius of that pedestal's foot (main.ts widens it per piece to PEDESTAL_DIAMETER). */
export const PAWN_PEDESTAL_FOOT = 0.27;

/** Low turned pedestal for a rigged pawn figure: the pawn's own foot, a flat top and a gold rim. */
function pawnPedestal(r: Res): Part[] {
  const top = PAWN_PEDESTAL_TOP;
  const p = new Profile().foot(PAWN_PEDESTAL_FOOT, 0.14, 0.17).curve([[0.18, 0.17], [0.19, top - 0.015]], 6).to(0.19, top).corner().to(0, top);
  return [{ geo: lathe(p, r), finish: 'body' }, footRing(PAWN_PEDESTAL_FOOT, 0.14, r), ring(0.192, top - 0.006, 0.011, r)];
}

const pedestalCache = new Map<Detail, Part[]>();
/** A pawn character's pedestal (separate from the procedural pawn, which keeps its own silhouette). */
export function buildPawnPedestal(color: Color, detail: Detail): Group {
  let parts = pedestalCache.get(detail);
  if (!parts) pedestalCache.set(detail, (parts = pawnPedestal(RES[detail])));
  const mats = getMaterials(detail);
  const g = new Group();
  g.name = 'pedestal';
  for (const part of parts) {
    const mesh = new Mesh(part.geo, part.finish === 'gold' ? mats.gold : color === 'white' ? mats.ivory : mats.ebony);
    if (part.matrix) mesh.applyMatrix4(part.matrix);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  return g;
}

const partCache = new Map<string, Part[]>();
/** Geometry is shared by every piece of a type at a given detail; never disposed per piece. */
export function pieceParts(type: PieceType, detail: Detail): readonly Part[] {
  const key = `${type}:${detail}`;
  let parts = partCache.get(key);
  if (!parts) {
    const scale = new Matrix4().makeScale(TURNED_SCALE, TURNED_SCALE, TURNED_SCALE);
    parts = BUILDERS[type](RES[detail]).map((p) => ({ ...p, matrix: p.matrix ? scale.clone().multiply(p.matrix) : scale }));
    partCache.set(key, parts);
  }
  return parts;
}

function buildPiece(type: PieceType, color: Color, detail: Detail): Group {
  const mats = getMaterials(detail);
  const body = color === 'white' ? mats.ivory : mats.ebony;
  const g = new Group();
  for (const part of pieceParts(type, detail)) {
    const mesh = new Mesh(part.geo, part.finish === 'gold' ? mats.gold : body);
    if (part.matrix) mesh.applyMatrix4(part.matrix);
    if (part.base) mesh.userData.base = true;
    if (part.wheel) mesh.userData.wheel = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  if (type === 'knight') {
    // Head in profile, turned ~25 degrees toward the opponent so it reads from either side.
    g.rotation.y = color === 'white' ? 0.45 : Math.PI - 0.45;
  } else if (type === 'rook') {
    // Ram (+x) toward the opponent, so the wheels read side-on from either player's seat.
    g.rotation.y = color === 'white' ? Math.PI / 2 : -Math.PI / 2;
  }
  return g;
}

export interface PieceLayer {
  readonly group: Group;
  /** Reconcile meshes to the board. Returns true if any piece moved, appeared or disappeared. */
  sync(board: Board): boolean;
  /** Live mesh for a piece id (for the animator). */
  get(id: string): Group | undefined;
  /** Swap geometry density + materials for a quality tier. Positions are unchanged. */
  setDetail(detail: Detail): void;
}

export function createPieces(initialDetail: Detail = 'high'): PieceLayer {
  const group = new Group();
  group.name = 'pieces';
  let detail = initialDetail;
  const meshes = new Map<string, Group>();
  const tmp = new Vector3();

  const make = (id: string, type: PieceType, color: Color): Group => {
    const obj = buildPiece(type, color, detail);
    obj.name = id;
    let phase = 0;
    for (let i = 0; i < id.length; i++) phase = (phase * 31 + id.charCodeAt(i)) % 6283;
    obj.userData = {
      type, color,
      restYaw: obj.rotation.y, // the animator's neutral facing
      phase: phase / 1000, // idle-sway offset so pieces don't breathe in lockstep
      height: new Box3().setFromObject(obj).max.y,
      wheels: obj.children.filter((c) => c.userData.wheel === true),
      wheelRadius: ROOK_WHEEL_RADIUS * TURNED_SCALE,
    };
    return obj;
  };

  return {
    group,
    get: (id) => meshes.get(id),
    sync(board) {
      let changed = false;
      const alive = new Set<string>();
      for (const [sq, piece] of board) {
        alive.add(piece.id);
        let obj = meshes.get(piece.id);
        if (obj && obj.userData.type !== piece.type) {
          // Promotion: same id, new shape.
          group.remove(obj);
          meshes.delete(piece.id);
          obj = undefined;
        }
        if (!obj) {
          obj = make(piece.id, piece.type, piece.color);
          meshes.set(piece.id, obj);
          group.add(obj);
          changed = true;
        }
        // Back to the rest pose (an animation or a toppled king may have left it otherwise).
        obj.visible = true;
        obj.scale.set(1, 1, 1);
        obj.rotation.set(0, obj.userData.restYaw as number, 0);
        squareToWorld(sq, tmp);
        if (!obj.position.equals(tmp)) {
          obj.position.copy(tmp);
          changed = true;
        }
      }
      for (const [id, obj] of meshes) {
        if (alive.has(id)) continue;
        group.remove(obj);
        meshes.delete(id);
        changed = true;
      }
      return changed;
    },
    setDetail(next) {
      if (next === detail) return;
      detail = next;
      for (const [id, old] of meshes) {
        const obj = make(id, old.userData.type as PieceType, old.userData.color as Color);
        obj.position.copy(old.position);
        obj.quaternion.copy(old.quaternion);
        obj.visible = old.visible;
        group.remove(old);
        group.add(obj);
        meshes.set(id, obj);
      }
    },
  };
}
