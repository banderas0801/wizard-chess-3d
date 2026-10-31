// PieceAnimator: procedural tweens on piece Object3Ds. It only moves meshes; it never touches
// game state. The `play(obj, clip)` surface is what a rigged-model backend (AnimationMixer)
// implements too, so the choreographer does not care which one is behind it.
import {
  BufferGeometry, IcosahedronGeometry, Mesh, Object3D, Quaternion, Vector3, type Material,
} from 'three';
import { BOARD_TOP_Y } from './board';

export type Clip = 'idle' | 'move' | 'attack' | 'shatter';

export interface ClipParams {
  /** World destination (move/attack). */
  readonly to?: Vector3;
  readonly duration?: number;
  /** Arc height for a hop (knight); 0 = glide. */
  readonly hop?: number;
}

export interface PieceAnimator {
  play(obj: Object3D, clip: Clip, params?: ClipParams): void;
  /** Mated king topples over. */
  fall(obj: Object3D, duration: number): void;
  /** Advance all tweens. */
  update(dt: number): void;
  /** True while any piece or fragment is moving (drives per-frame shadow updates). */
  readonly moving: boolean;
  /** Abort everything and put every touched piece back exactly where it started. */
  cancel(): void;
  /** Forget start poses: the game state was committed and `sync` owns placement again. */
  release(): void;
  /** Idle breathing sway on/off (off at quality tier `off`). */
  idleSway: boolean;
}

interface Home {
  readonly pos: Vector3;
  readonly quat: Quaternion;
  readonly scale: Vector3;
  readonly visible: boolean;
}

interface Tween {
  readonly obj: Object3D;
  readonly duration: number;
  t: number;
  /** k in [0,1]. */
  apply(k: number): void;
}

interface Fragment {
  readonly mesh: Mesh;
  readonly vel: Vector3;
  readonly spin: Vector3;
  readonly size: number;
}

const UP = new Vector3(0, 1, 0);
const easeInOut = (k: number): number => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const easeIn = (k: number): number => k * k * k;
const easeOut = (k: number): number => 1 - (1 - k) ** 3;
const smooth = (a: number, b: number, x: number): number => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Yaw that turns a piece's +x (its "forward", e.g. the knight's muzzle) toward (dx, dz). */
export const headingYaw = (dx: number, dz: number): number => Math.atan2(-dz, dx);

/** Deterministic PRNG so tests (and replays) shatter the same way. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ProceduralOptions {
  readonly fragments?: number;
  readonly seed?: number;
}

export interface ProceduralAnimator extends PieceAnimator {
  /** Fragments per shatter (scaled by quality tier). */
  fragments: number;
}

export function createProceduralAnimator(opts: ProceduralOptions = {}): ProceduralAnimator {
  const rand = mulberry32(opts.seed ?? 7);
  const homes = new Map<Object3D, Home>();
  const tweens = new Map<Object3D, Tween>();
  const idlers = new Set<Object3D>();
  const fragments: Fragment[] = [];
  const fragGeo: BufferGeometry = new IcosahedronGeometry(1, 0);
  let clock = 0;
  let fragT = 0;
  let fragDur = 0;

  const remember = (obj: Object3D): Home => {
    let h = homes.get(obj);
    if (!h) {
      h = { pos: obj.position.clone(), quat: obj.quaternion.clone(), scale: obj.scale.clone(), visible: obj.visible };
      homes.set(obj, h);
    }
    idlers.delete(obj); // no breathing while acting
    return h;
  };

  const restYaw = (obj: Object3D): number => (obj.userData.restYaw as number | undefined) ?? 0;
  const qYaw = new Quaternion();
  const qLean = new Quaternion();
  const axis = new Vector3();

  /** Orientation = lean about a horizontal axis (perpendicular to `dir`) applied on top of a yaw. */
  const pose = (obj: Object3D, yaw: number, dirX: number, dirZ: number, lean: number): void => {
    qYaw.setFromAxisAngle(UP, yaw);
    axis.set(dirZ, 0, -dirX);
    if (axis.lengthSq() < 1e-9 || lean === 0) obj.quaternion.copy(qYaw);
    else obj.quaternion.copy(qLean.setFromAxisAngle(axis.normalize(), lean).multiply(qYaw));
  };

  const clearFragments = (): void => {
    for (const f of fragments) f.mesh.removeFromParent();
    fragments.length = 0;
  };

  const spawnFragments = (obj: Object3D, duration: number): void => {
    const parent = obj.parent;
    if (!parent) return;
    const meshes: Mesh[] = [];
    obj.traverse((o) => {
      if ((o as Mesh).isMesh) meshes.push(o as Mesh);
    });
    if (meshes.length === 0) return;
    const height = (obj.userData.height as number | undefined) ?? 0.6;
    fragDur = Math.max(fragDur - fragT, duration);
    fragT = 0;
    for (let i = 0; i < animator.fragments; i++) {
      const src = meshes[Math.floor(rand() * meshes.length)]!;
      const m = new Mesh(fragGeo, src.material as Material);
      const size = 0.03 + rand() * 0.05;
      m.scale.setScalar(size);
      const a = rand() * Math.PI * 2;
      const r = rand() * 0.16;
      m.position.set(obj.position.x + Math.cos(a) * r, obj.position.y + 0.05 + rand() * height, obj.position.z + Math.sin(a) * r);
      m.rotation.set(rand() * 6, rand() * 6, rand() * 6);
      m.castShadow = true;
      parent.add(m);
      const out = 0.9 + rand() * 1.8;
      fragments.push({
        mesh: m,
        size,
        vel: new Vector3(Math.cos(a) * out, 1.2 + rand() * 2.4, Math.sin(a) * out),
        spin: new Vector3(rand() * 14 - 7, rand() * 14 - 7, rand() * 14 - 7),
      });
    }
  };

  const animator: ProceduralAnimator = {
    idleSway: true,
    fragments: opts.fragments ?? 18,
    get moving() {
      return tweens.size > 0 || fragments.length > 0;
    },
    play(obj, clip, params = {}) {
      if (clip === 'idle') {
        tweens.delete(obj);
        idlers.add(obj);
        return;
      }
      remember(obj);
      const from = obj.position.clone();
      const to = params.to?.clone() ?? from.clone();
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const dist = Math.hypot(dx, dz);
      const rest = restYaw(obj);
      const face = dist > 1e-6 ? wrapAngle(headingYaw(dx, dz) - rest) : 0;
      const yawAt = (k: number): number => rest + face * Math.min(smooth(0, 0.2, k), 1 - smooth(0.8, 1, k));

      if (clip === 'move') {
        const hop = params.hop ?? 0;
        const steps = Math.max(1, Math.round(dist * 1.6));
        const duration = params.duration ?? 0.5;
        tweens.set(obj, {
          obj, duration, t: 0,
          apply(k) {
            const e = easeInOut(k);
            obj.position.lerpVectors(from, to, e);
            if (hop > 0) {
              obj.position.y = from.y + (to.y - from.y) * e + hop * 4 * e * (1 - e);
            } else {
              // Gliding gait: little bobs per square and a lean into the direction of travel.
              obj.position.y = from.y + (to.y - from.y) * e + 0.035 * Math.abs(Math.sin(Math.PI * steps * e)) * Math.sin(Math.PI * k);
            }
            const lean = (hop > 0 ? 0.1 : 0.16) * Math.sin(Math.PI * k) * (1 - 0.6 * k);
            pose(obj, yawAt(k), dx, dz, lean);
          },
        });
        return;
      }

      if (clip === 'attack') {
        // Wind-up (rear back), lunge (through the target), recoil (bounce back and settle on it).
        const duration = params.duration ?? 0.5;
        const ux = dist > 1e-6 ? dx / dist : 0;
        const uz = dist > 1e-6 ? dz / dist : 0;
        tweens.set(obj, {
          obj, duration, t: 0,
          apply(k) {
            let s: number; // signed progress along from->to (can overshoot / go negative)
            let lean: number;
            if (k < 0.3) {
              const w = easeOut(k / 0.3);
              s = -0.18 * w / Math.max(dist, 0.2);
              lean = -0.22 * w;
            } else if (k < 0.6) {
              const w = easeIn((k - 0.3) / 0.3);
              s = -0.18 / Math.max(dist, 0.2) + (1.12 + 0.18 / Math.max(dist, 0.2)) * w;
              lean = -0.22 + 0.55 * w;
            } else {
              const w = (k - 0.6) / 0.4;
              s = 1 + 0.12 * Math.cos(Math.PI * 1.5 * w) * (1 - w);
              lean = 0.33 * (1 - easeOut(w)) * Math.cos(Math.PI * 2 * w);
            }
            obj.position.set(from.x + ux * dist * s, from.y + (to.y - from.y) * Math.min(1, Math.max(0, s)), from.z + uz * dist * s);
            if (k >= 0.3 && k < 0.6) obj.position.y += 0.08 * Math.sin(Math.PI * (k - 0.3) / 0.3);
            pose(obj, yawAt(Math.min(k * 1.6, 0.5)) , dx, dz, lean);
          },
        });
        return;
      }

      // shatter
      const duration = params.duration ?? 0.6;
      tweens.delete(obj);
      obj.visible = false;
      spawnFragments(obj, duration);
    },

    fall(obj, duration) {
      remember(obj);
      const yaw = restYaw(obj);
      const start = obj.position.clone();
      tweens.set(obj, {
        obj, duration, t: 0,
        apply(k) {
          // Teeter, then topple with a small bounce on landing.
          const teeter = 0.08 * Math.sin(Math.PI * 3 * Math.min(k / 0.3, 1)) * (1 - Math.min(k / 0.3, 1));
          const drop = k < 0.3 ? 0 : 1 - Math.abs(Math.cos(Math.PI * 0.5 * easeIn((k - 0.3) / 0.7) * 1.0)) ;
          const bounce = k > 0.85 ? 0.06 * Math.sin(Math.PI * (k - 0.85) / 0.15) : 0;
          const angle = teeter + 1.45 * drop - bounce;
          pose(obj, yaw, 1, 0.35, -angle);
          obj.position.set(start.x, start.y, start.z);
        },
      });
    },

    update(dt) {
      clock += dt;
      for (const tw of [...tweens.values()]) {
        tw.t = Math.min(tw.duration, tw.t + dt);
        tw.apply(tw.duration > 0 ? tw.t / tw.duration : 1);
        if (tw.t >= tw.duration) tweens.delete(tw.obj);
      }
      if (fragments.length > 0) {
        fragT += dt;
        const fade = 1 - smooth(fragDur * 0.55, fragDur, fragT);
        for (const f of fragments) {
          f.vel.y -= 9.8 * dt;
          f.mesh.position.addScaledVector(f.vel, dt);
          if (f.mesh.position.y < BOARD_TOP_Y + f.size) {
            f.mesh.position.y = BOARD_TOP_Y + f.size;
            f.vel.y *= -0.35;
            f.vel.x *= 0.6;
            f.vel.z *= 0.6;
          }
          f.mesh.rotation.x += f.spin.x * dt;
          f.mesh.rotation.y += f.spin.y * dt;
          f.mesh.rotation.z += f.spin.z * dt;
          f.mesh.scale.setScalar(f.size * fade);
        }
        if (fragT >= fragDur) clearFragments();
      }
      if (animator.idleSway) {
        for (const obj of idlers) {
          if (!obj.parent) {
            idlers.delete(obj);
            continue;
          }
          // Breathing: tiny phase-shifted swell and sway; well below shadow-map resolution.
          const ph = (obj.userData.phase as number | undefined) ?? 0;
          const b = Math.sin(clock * 1.6 + ph);
          obj.scale.set(1 - 0.004 * b, 1 + 0.008 * b, 1 - 0.004 * b);
          obj.rotation.set(0.01 * Math.sin(clock * 0.9 + ph * 1.7), restYaw(obj), 0.01 * Math.sin(clock * 0.7 + ph));
        }
      }
    },

    cancel() {
      tweens.clear();
      clearFragments();
      for (const [obj, h] of homes) {
        obj.position.copy(h.pos);
        obj.quaternion.copy(h.quat);
        obj.scale.copy(h.scale);
        obj.visible = h.visible;
        idlers.add(obj);
      }
      homes.clear();
    },

    release() {
      tweens.clear();
      for (const obj of homes.keys()) idlers.add(obj);
      homes.clear();
    },
  };
  return animator;
}
