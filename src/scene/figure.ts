// Step 5: rigged humanoid figures (first: the user-supplied pawn, see public/models/SOURCES.md).
//
// Same contract as the horse knight (character.ts): it wraps another animator instead of replacing
// it. The wrapped animator keeps owning the piece transform (glide, lunge, cancel/home poses,
// shatter debris); this layer only swaps the mesh for the figure on its pedestal and plays the
// matching skeleton clip. Choreography phases map to clips as:
//   approach -> `move`, strike -> `attack` (spear couched for the thrust), victim (shatter) -> `hit`.
// Animators chain: pieces of another type go straight to `base`, so the knight layer stays below.
import {
  AnimationMixer,
  Box3,
  Group,
  LoopOnce,
  LoopRepeat,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  type AnimationAction,
  type BufferGeometry,
  type AnimationClip,
  type Material,
  type Mesh,
  type Object3D,
  type SkinnedMesh,
} from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Color, PieceType } from '../game';
import { headingYaw, type Clip, type ClipParams, type PieceAnimator } from './anim';

/** The four clips every figure file must carry (names from the delivery spec). */
export const FIGURE_CLIPS = ['idle', 'move', 'attack', 'hit'] as const;
export type FigureClip = (typeof FIGURE_CLIPS)[number];

/** Recolourable material → finish. GOLD stays gold; dark details (eyes, shadow lines) take the dark inlay. */
export type Finish = 'body' | 'gold' | 'dark';
export function finishFor(materialName: string): Finish {
  const n = materialName.toUpperCase();
  if (n.includes('GOLD')) return 'gold';
  if (n.includes('EYES') || n.includes('SHADOW')) return 'dark';
  return 'body';
}

export interface FigureMaterials {
  /** Side colour: ivory for white, near-black for black. */
  body(color: Color): Material;
  gold(): Material;
  dark(color: Color): Material;
}

/**
 * The delivered clips are small deltas around a T-pose (idle doesn't touch the arms at all), so the
 * figure would idle with its arms straight out across the neighbouring squares. We lower the arms
 * once at load: every clip's arm rotation is layered on this rest rotation (local = rest · clip).
 * The right forearm turns forward so the hand holds the spear upright at the figure's side.
 */
const ARM_DOWN = 1.3; // radians below horizontal
const REST_POSE: Readonly<Record<string, Quaternion>> = (() => {
  const z = new Vector3(0, 0, 1);
  const y = new Vector3(0, 1, 0);
  const downR = new Quaternion().setFromAxisAngle(z, -ARM_DOWN);
  const downL = new Quaternion().setFromAxisAngle(z, ARM_DOWN);
  // World forearm rotation Ry(-90°) points it along +z (forward) and keeps the hand's +y (spear) up.
  const foreR = downR.clone().invert().multiply(new Quaternion().setFromAxisAngle(y, -Math.PI / 2));
  const foreL = new Quaternion().setFromAxisAngle(z, -0.5); // slight bend toward the belt
  return { RightUpperArm: downR, RightForeArm: foreR, LeftUpperArm: downL, LeftForeArm: foreL };
})();

/** Layer `rest` under a clip: premultiply its track for `bone`, or add a constant one. Mutates the clip. */
export function layerRestPose(clip: AnimationClip, rest: Readonly<Record<string, Quaternion>> = REST_POSE): void {
  const q = new Quaternion();
  for (const [bone, r] of Object.entries(rest)) {
    const name = `${bone}.quaternion`;
    const track = clip.tracks.find((t) => t.name === name);
    if (!track) {
      clip.tracks.push(new QuaternionKeyframeTrack(name, [0], [r.x, r.y, r.z, r.w]));
      continue;
    }
    const v = track.values;
    for (let i = 0; i < v.length; i += 4) {
      q.set(v[i]!, v[i + 1]!, v[i + 2]!, v[i + 3]!).premultiply(r);
      v[i] = q.x;
      v[i + 1] = q.y;
      v[i + 2] = q.z;
      v[i + 3] = q.w;
    }
  }
}

export interface FigureKit {
  readonly template: Object3D;
  readonly clips: ReadonlyMap<FigureClip, AnimationClip>;
  /** Lowest skinned vertex in the bind pose (the soles): lifted onto the pedestal top. */
  readonly soleY: number;
  /** Height of the figure (bind pose, without weapons). */
  readonly height: number;
}

export async function loadFigureKit(url: string): Promise<FigureKit> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(url);
  return buildFigureKit(gltf.scene, gltf.animations);
}

const isWeapon = (o: Object3D): boolean => {
  for (let p: Object3D | null = o; p; p = p.parent) if (/WEAPON/i.test(p.name)) return true;
  return false;
};

/** Pure assembly of the loaded model (testable without fetch). */
/**
 * Zero-length normals normalise to NaN in the shader, and bloom smears one NaN pixel over the
 * whole frame (the delivered pawn's cloth has 16). Point them up instead. Returns how many.
 */
export function repairNormals(geo: BufferGeometry): number {
  const n = geo.attributes.normal;
  if (!n) return 0;
  let fixed = 0;
  for (let i = 0; i < n.count; i++) {
    if (Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) > 1e-6) continue;
    n.setXYZ(i, 0, 1, 0);
    fixed++;
  }
  if (fixed) n.needsUpdate = true;
  return fixed;
}

export function buildFigureKit(scene: Object3D, animations: readonly AnimationClip[]): FigureKit {
  const clips = new Map<FigureClip, AnimationClip>();
  for (const name of FIGURE_CLIPS) {
    const c = animations.find((a) => a.name === name);
    if (!c) throw new Error(`figure clip missing: ${name}`);
    const own = c.clone();
    layerRestPose(own);
    clips.set(name, own);
  }
  scene.traverse((o) => {
    if ((o as Mesh).isMesh) repairNormals((o as Mesh).geometry);
  });
  scene.updateMatrixWorld(true);
  // Soles from the skinned vertices themselves (armour bounds alone end above the boots).
  let soleY = Infinity;
  const body = new Box3();
  const v = new Vector3();
  scene.traverse((o) => {
    const m = o as SkinnedMesh;
    if (!m.isMesh || isWeapon(m)) return;
    const pos = m.geometry.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      if (m.isSkinnedMesh) m.getVertexPosition(i, v);
      else v.fromBufferAttribute(pos, i);
      v.applyMatrix4(m.matrixWorld);
      soleY = Math.min(soleY, v.y);
      body.expandByPoint(v);
    }
  });
  if (!Number.isFinite(soleY)) throw new Error('figure has no body mesh');
  return { template: scene, clips, soleY, height: body.max.y - soleY };
}

export interface FigureOptions {
  readonly type: PieceType;
  readonly materials: FigureMaterials;
  /** Pedestal the figure stands on (replaces the procedural piece) and the height of its top. */
  readonly pedestal: (color: Color) => Object3D;
  readonly pedestalTop: number;
  /** Figure height on the board, soles to crown. */
  readonly height: number;
  /** Bone carrying the weapon, and how far the weapon tips forward at the thrust (radians). */
  readonly weaponHand?: string;
  readonly thrust?: number;
}

interface Rig {
  readonly mixer: AnimationMixer;
  readonly actions: ReadonlyMap<FigureClip, AnimationAction>;
  /** Pivot at the hand between the hand bone and the weapon. */
  readonly grip: Object3D | null;
  /** Hand-local axis that tips the weapon's top forward. */
  readonly gripAxis: Vector3;
  current: AnimationAction | null;
  hold: number;
  /** Thrust timeline (attack); duration 0 = not thrusting. */
  thrustT: number;
  thrustDur: number;
  shatterIn: number;
  shatterDuration: number;
  hit: boolean;
}

export interface FigureAnimator extends PieceAnimator {
  kit: FigureKit | null;
  /** Idempotent; also attaches the wrapped animator's characters. */
  attachAll(root: Object3D): void;
  readonly count: number;
}

/** Weapon tilt over attack progress k: couch in the wind-up, hold through the thrust, raise. */
export function thrustAngle(k: number, max: number): number {
  if (k <= 0 || k >= 1) return 0;
  const ease = (w: number): number => w * w * (3 - 2 * w);
  return max * (k < 0.3 ? ease(k / 0.3) : k < 0.72 ? 1 : 1 - ease((k - 0.72) / 0.28));
}

const FADE = 0.15;
/** Share of the shatter phase spent on the hit reaction before the figure bursts. */
const HIT_SHARE = 0.55;

export function createFigureAnimator(
  base: PieceAnimator & { attachAll?(root: Object3D): void },
  opts: FigureOptions,
): FigureAnimator {
  const rigs = new Map<Object3D, Rig>();
  let kit: FigureKit | null = null;
  const thrust = opts.thrust ?? 1.35;
  // Facing the opponent, turned a little so the spear side reads from the player's seat.
  const restYaw: Record<Color, number> = { white: headingYaw(0, -1) + 0.35, black: headingYaw(0, 1) + 0.35 };

  const attach = (obj: Object3D): void => {
    if (!kit || rigs.has(obj) || obj.userData.type !== opts.type) return;
    const color = obj.userData.color as Color;
    const s = opts.height / kit.height;
    const ch = cloneSkinned(kit.template);
    ch.name = 'character';
    ch.scale.setScalar(s);
    ch.position.y = opts.pedestalTop - kit.soleY * s;
    ch.traverse((o) => {
      if (!(o as Mesh).isMesh) return;
      const m = o as SkinnedMesh;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false; // skinned bounds don't follow the clip
      const pick = (src: Material): Material => {
        const f = finishFor(src.name);
        return f === 'gold' ? opts.materials.gold() : f === 'dark' ? opts.materials.dark(color) : opts.materials.body(color);
      };
      m.material = Array.isArray(m.material) ? m.material.map(pick) : pick(m.material);
    });
    const mount = new Group();
    mount.name = 'mount';
    mount.rotation.y = Math.PI / 2; // the figure faces +z; the animator's piece forward is +x
    mount.add(ch);
    const pedestal = opts.pedestal(color);
    for (const c of obj.children) c.visible = false; // procedural piece hidden; pedestal + figure replace it
    obj.add(pedestal, mount);
    obj.userData.restYaw = restYaw[color];
    obj.rotation.set(0, restYaw[color], 0);

    const mixer = new AnimationMixer(ch);
    const actions = new Map<FigureClip, AnimationAction>();
    for (const [k, clip] of kit.clips) actions.set(k, mixer.clipAction(clip));
    const rig: Rig = {
      mixer, actions, grip: null, gripAxis: new Vector3(1, 0, 0), current: null, hold: 0, thrustT: 0, thrustDur: 0, shatterIn: -1, shatterDuration: 0, hit: false,
    };
    fade(rig, 'idle', 0, 1);
    mixer.update(0); // rest pose, so the grip axis is measured with the arm lowered
    const hand = opts.weaponHand ? ch.getObjectByName(opts.weaponHand) : undefined;
    const weapons = hand ? hand.children.filter((c) => /WEAPON/i.test(c.name)) : [];
    if (hand && weapons.length > 0) {
      const grip = new Group();
      grip.name = 'grip';
      hand.add(grip);
      for (const w of weapons) grip.add(w); // grip is identity at the hand: the weapon keeps its hold
      ch.updateMatrixWorld(true);
      const local = hand.getWorldQuaternion(new Quaternion()).premultiply(ch.getWorldQuaternion(new Quaternion()).invert());
      rig.gripAxis.set(1, 0, 0).applyQuaternion(local.invert()); // figure +x, in hand space: tips +y toward +z
      (rig as { grip: Object3D | null }).grip = grip;
    }
    rigs.set(obj, rig);
    mixer.setTime(((obj.userData.phase as number | undefined) ?? 0) % kit.clips.get('idle')!.duration);
  };

  const fade = (rig: Rig, key: FigureClip, fadeTime: number, timeScale: number, once = false): void => {
    const next = rig.actions.get(key)!;
    if (rig.current === next) next.stop();
    next.reset();
    next.setLoop(once ? LoopOnce : LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.timeScale = timeScale;
    next.play();
    if (rig.current && rig.current !== next && fadeTime > 0) rig.current.crossFadeTo(next, fadeTime, false);
    else if (rig.current && rig.current !== next) rig.current.stop();
    rig.current = next;
  };

  const settle = (rig: Rig): void => {
    rig.thrustT = 0;
    rig.thrustDur = 0;
    rig.grip?.quaternion.identity();
  };

  const toIdle = (rig: Rig, fadeTime = FADE): void => {
    rig.hold = 0;
    rig.shatterIn = -1;
    rig.hit = false;
    settle(rig);
    fade(rig, 'idle', fadeTime, 1);
  };

  const clipLen = (key: FigureClip): number => kit?.clips.get(key)?.duration ?? 1;

  const animator: FigureAnimator = {
    get kit() {
      return kit;
    },
    set kit(k: FigureKit | null) {
      kit = k;
    },
    get idleSway() {
      return base.idleSway;
    },
    set idleSway(v: boolean) {
      base.idleSway = v;
    },
    get moving() {
      if (base.moving) return true;
      for (const r of rigs.values()) if (r.hold > 0 || r.shatterIn >= 0) return true;
      return false;
    },
    get count() {
      return rigs.size;
    },
    attachAll(root) {
      base.attachAll?.(root);
      for (const obj of root.children) attach(obj);
      for (const obj of rigs.keys()) if (!obj.parent) rigs.delete(obj);
    },
    play(obj: Object3D, clip: Clip, params: ClipParams = {}) {
      const rig = rigs.get(obj);
      if (!rig) {
        base.play(obj, clip, params);
        return;
      }
      if (clip === 'idle') {
        base.play(obj, 'idle');
        if (rig.current !== rig.actions.get('idle') || rig.hit) toIdle(rig);
        return;
      }
      if (clip === 'move') {
        const duration = params.duration ?? 0.5;
        settle(rig);
        // March: whole steps of the walk cycle over the glide.
        const steps = Math.max(1, Math.round(duration / clipLen('move')));
        fade(rig, 'move', 0.1, (steps * clipLen('move')) / Math.max(duration, 1e-3));
        rig.hold = duration;
        base.play(obj, 'move', params);
        return;
      }
      if (clip === 'attack') {
        const duration = params.duration ?? 0.5;
        fade(rig, 'attack', 0.08, clipLen('attack') / Math.max(duration, 1e-3), true);
        rig.thrustT = 0;
        rig.thrustDur = duration;
        rig.hold = duration;
        base.play(obj, 'attack', params);
        return;
      }
      // shatter: the victim reels from the blow, then bursts into debris.
      const duration = params.duration ?? 0.6;
      settle(rig);
      fade(rig, 'hit', 0.05, clipLen('hit') / (duration * HIT_SHARE), true);
      rig.hit = true;
      rig.shatterIn = duration * HIT_SHARE;
      rig.shatterDuration = duration * (1 - HIT_SHARE);
      rig.hold = duration;
    },
    fall(obj, duration) {
      const rig = rigs.get(obj);
      if (rig) {
        settle(rig);
        fade(rig, 'hit', 0.1, clipLen('hit') / duration, true);
        rig.hit = true;
        rig.hold = duration;
      }
      base.fall(obj, duration);
    },
    update(dt) {
      base.update(dt);
      for (const [obj, rig] of rigs) {
        if (rig.shatterIn >= 0) {
          rig.shatterIn -= dt;
          if (rig.shatterIn < 0) base.play(obj, 'shatter', { duration: rig.shatterDuration });
        }
        if (rig.thrustDur > 0) {
          rig.thrustT = Math.min(rig.thrustDur, rig.thrustT + dt);
          rig.grip?.quaternion.setFromAxisAngle(rig.gripAxis, thrustAngle(rig.thrustT / rig.thrustDur, thrust));
          if (rig.thrustT >= rig.thrustDur) settle(rig);
        }
        if (rig.hold > 0) {
          rig.hold -= dt;
          if (rig.hold <= 0 && !rig.hit) toIdle(rig);
        }
        if (rig.hold > 0 || base.idleSway) rig.mixer.update(dt);
      }
    },
    cancel() {
      base.cancel();
      for (const rig of rigs.values()) toIdle(rig, 0);
    },
    release() {
      base.release();
      for (const rig of rigs.values()) {
        rig.shatterIn = -1;
        rig.hold = 0;
        settle(rig);
      }
    },
  };
  return animator;
}
