// PieceAnimator: procedural tweens on piece Object3Ds. It only moves meshes; it never touches
// game state. The `play(obj, clip)` surface is what a rigged-model backend (AnimationMixer)
// implements too, so the choreographer does not care which one is behind it.
import {
  BufferGeometry, IcosahedronGeometry, Mesh, Object3D, Quaternion, Vector3, type Material,
} from 'three';
import { BOARD_TOP_Y } from './board';
import type { StrikeMotion } from './strike';

export type Clip = 'idle' | 'move' | 'attack' | 'shatter';

export interface ClipParams {
  /** World destination (move/attack). */
  readonly to?: Vector3;
  readonly duration?: number;
  /** Arc height for a hop (knight); 0 = glide. */
  readonly hop?: number;
  /** Attack body motion (default 'lunge'). */
  readonly motion?: StrikeMotion;
  /** Attack: the blow lands this far (world units) short of `to`; the piece steps on only after. */
  readonly contact?: number;
}

/**
 * Attack timeline, as fractions of the clip: the blow lands at IMPACT (the profile's impactAt is
 * 0.6 for lunges; casts and spins hold still until then anyway) and the attacker only steps onto
 * the victim's square from ENTER on, after the victim has collapsed (victim rigs hide by then).
 */
export const ATTACK_IMPACT = 0.6;
export const ATTACK_ENTER = 0.82;

/** Slam: wind-up ends (take-off) at this fraction; leap apex height and the hammer's forward lean at impact. */
export const SLAM_LEAP = 0.3;
export const SLAM_HEIGHT = 0.38;
export const SLAM_LEAN = 0.45;

export interface PieceAnimator {
  play(obj: Object3D, clip: Clip, params?: ClipParams): void;
  /** Victim is drawn toward `to` (world) over `duration` (the queen's vortex). */
  drag(obj: Object3D, to: Vector3, duration: number): void;
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

interface AttackPose {
  /** Signed distance along from->to (world units). */
  readonly x: number;
  /** Extra height. */
  readonly y: number;
  /** Lean toward the target (+) or back (-), radians. */
  readonly lean: number;
  /** Extra yaw on top of facing the target. */
  readonly yaw: number;
  /** Squash (+) / stretch (-) of the whole piece, volume-preserving-ish; 0 or absent = none. */
  readonly squash?: number;
}

/**
 * Body curve of one attack style. `peak` is where the blow lands (dist - contact): nothing but
 * the final step-in, after ATTACK_ENTER, goes past it, so an attacker never passes through a
 * victim that is still standing. Exported for tests.
 */
export function attackCurve(motion: StrikeMotion, peak: number, dist: number): (k: number) => AttackPose {
  const I = ATTACK_IMPACT;
  const E = ATTACK_ENTER;
  const enter = (k: number, from = peak): number => from + (dist - from) * easeInOut((k - E) / (1 - E));
  const seg = (k: number, a: number, b: number): number => Math.min(1, Math.max(0, (k - a) / (b - a)));
  switch (motion) {
    case 'ram':
      // Back up, charge (rattling), crunch and jolt back, then roll on.
      return (k) => {
        if (k >= E) return { x: enter(k), y: 0, lean: 0, yaw: 0 };
        if (k < 0.33) { const w = easeOut(k / 0.33); return { x: -0.3 * w, y: 0, lean: -0.1 * w, yaw: 0 }; }
        if (k < I) {
          const w = easeIn(seg(k, 0.33, I));
          return { x: -0.3 + (peak + 0.3) * w, y: 0.012 * Math.abs(Math.sin(k * 60)), lean: -0.1 + 0.25 * w, yaw: 0 };
        }
        const w = seg(k, I, 0.72);
        return { x: peak - 0.12 * Math.sin(Math.PI * w), y: 0, lean: 0.15 * (1 - w) - 0.12 * Math.sin(Math.PI * w), yaw: 0 };
      };
    case 'slam':
      // Hammer slam (rigid figure): rear back with the hammer raised and crouch, leap onto the
      // contact point, drive the hammer down on landing (forward lean + squash), hold, recover.
      return (k) => {
        if (k >= E) return { x: enter(k), y: 0, lean: 0, yaw: 0 };
        if (k < SLAM_LEAP) {
          const w = easeOut(k / SLAM_LEAP);
          return { x: -0.1 * w, y: 0, lean: -0.3 * w, yaw: 0, squash: 0.1 * smooth(0.6 * SLAM_LEAP, SLAM_LEAP, k) };
        }
        if (k < I) {
          const w = seg(k, SLAM_LEAP, I);
          return {
            x: -0.1 + (peak + 0.1) * easeInOut(w),
            y: SLAM_HEIGHT * Math.sin(Math.PI * w),
            lean: -0.3 + (0.3 + SLAM_LEAN) * easeIn(w),
            yaw: 0,
            squash: 0.1 * (1 - smooth(0, 0.15, w)) - 0.08 * Math.sin(Math.PI * w),
          };
        }
        const w = seg(k, I, E);
        return { x: peak, y: 0, lean: SLAM_LEAN * (1 - smooth(0.25, 1, w)), yaw: 0, squash: 0.14 * Math.exp(-5 * w) * Math.cos(3 * Math.PI * w) * (1 - w) };
      };
    case 'cast':
      // Levitate and lean back while the orb charges, recoil at the release, then glide in.
      return (k) => {
        const lift = 0.14 * smooth(0, 0.3, k) * (1 - smooth(I + 0.05, E + 0.08, k));
        const recoil = k >= I ? -0.22 * Math.exp(-(k - I) * 14) * (1 - smooth(E, 1, k)) : 0;
        const x = k >= E ? enter(k, 0) : 0;
        return { x, y: lift, lean: -0.12 * smooth(0.05, 0.4, k) * (1 - smooth(I, E, k)) + recoil, yaw: 0 };
      };
    case 'spin':
      // Rise and whirl (two full turns, ends facing the target), then glide onto the square.
      return (k) => {
        const lift = 0.12 * smooth(0, 0.25, k) * (1 - smooth(I + 0.05, E + 0.1, k));
        return { x: k >= E ? enter(k, 0) : 0, y: lift, lean: 0.08 * Math.sin(Math.PI * seg(k, 0, I)), yaw: 4 * Math.PI * easeInOut(seg(k, 0.05, I)) };
      };
    case 'slash':
      // Coil (turn away), step in with a fast cross-body swing, hold the follow-through.
      return (k) => {
        if (k >= E) return { x: enter(k), y: 0, lean: 0, yaw: 0.7 * (1 - seg(k, E, 1)) };
        if (k < 0.35) { const w = easeOut(k / 0.35); return { x: -0.08 * w, y: 0, lean: -0.15 * w, yaw: -0.6 * w }; }
        if (k < I) {
          const w = easeIn(seg(k, 0.35, I));
          return { x: -0.08 + (peak + 0.08) * w, y: 0.04 * Math.sin(Math.PI * w), lean: -0.15 + 0.45 * w, yaw: -0.6 + 1.5 * easeIn(seg(k, 0.48, I)) };
        }
        return { x: peak, y: 0, lean: 0.3 * (1 - seg(k, I, E)), yaw: 0.9 - 0.2 * seg(k, I, E) };
      };
    case 'lunge':
    default:
      // Wind-up (rear back), lunge to the contact point, bounce off it, then step on.
      return (k) => {
        if (k >= E) return { x: enter(k), y: 0, lean: 0, yaw: 0 };
        if (k < 0.3) { const w = easeOut(k / 0.3); return { x: -0.18 * w, y: 0, lean: -0.22 * w, yaw: 0 }; }
        if (k < I) {
          const w = seg(k, 0.3, I);
          return { x: -0.18 + (peak + 0.18) * easeIn(w), y: 0.08 * Math.sin(Math.PI * w), lean: -0.22 + 0.55 * easeIn(w), yaw: 0 };
        }
        const w = seg(k, I, E);
        return { x: peak - 0.07 * Math.sin(Math.PI * w), y: 0, lean: 0.33 * (1 - easeOut(w)) * Math.cos(Math.PI * 2 * w), yaw: 0 };
      };
  }
}

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

  // Chariot wheels (rook) roll with the distance travelled along the piece's own forward (+x).
  const lastPos = new WeakMap<Object3D, Vector3>();
  const fwd = new Vector3();
  const rollWheels = (obj: Object3D): void => {
    const wheels = obj.userData.wheels as Object3D[] | undefined;
    if (!wheels || wheels.length === 0) return;
    const last = lastPos.get(obj);
    if (!last) {
      lastPos.set(obj, obj.position.clone());
      return;
    }
    {
      fwd.set(1, 0, 0).applyQuaternion(obj.quaternion).setY(0).normalize(); // ignore lean
      const d = (obj.position.x - last.x) * fwd.x + (obj.position.z - last.z) * fwd.z;
      const r = (obj.userData.wheelRadius as number | undefined) ?? 0.15;
      for (const w of wheels) w.rotation.z -= d / r;
      last.copy(obj.position);
    }
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
        const duration = params.duration ?? 0.5;
        const ux = dist > 1e-6 ? dx / dist : 0;
        const uz = dist > 1e-6 ? dz / dist : 0;
        const peak = Math.max(0, dist - Math.max(0, params.contact ?? 0));
        const tw = attackCurve(params.motion ?? 'lunge', peak, dist);
        const home = homes.get(obj)!.scale;
        tweens.set(obj, {
          obj, duration, t: 0,
          apply(k) {
            const c = tw(k);
            const f = dist > 1e-6 ? Math.min(1, Math.max(0, c.x / dist)) : 1;
            obj.position.set(from.x + ux * c.x, from.y + (to.y - from.y) * f + c.y, from.z + uz * c.x);
            pose(obj, yawAt(Math.min(k * 1.6, 0.5)) + c.yaw, dx, dz, c.lean);
            const sq = c.squash ?? 0;
            obj.scale.set(home.x * (1 + sq / 2), home.y * (1 - sq), home.z * (1 + sq / 2));
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

    drag(obj, target, duration) {
      remember(obj);
      const from = obj.position.clone();
      const to = new Vector3(target.x, from.y, target.z);
      const yaw = restYaw(obj);
      tweens.set(obj, {
        obj, duration, t: 0,
        apply(k) {
          // Sucked in: slow start, accelerating, wobbling and lifting off the board.
          const e = easeIn(k);
          obj.position.lerpVectors(from, to, e);
          obj.position.y = from.y + 0.12 * e + 0.015 * Math.sin(k * 40) * k;
          pose(obj, yaw + 2.5 * e * e, to.x - from.x, to.z - from.z, 0.25 * e);
        },
      });
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
        rollWheels(tw.obj); // first call only records the start
        tw.apply(tw.duration > 0 ? tw.t / tw.duration : 1);
        rollWheels(tw.obj);
        if (tw.t >= tw.duration) {
          tweens.delete(tw.obj);
          lastPos.delete(tw.obj);
        }
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
