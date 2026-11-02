// Step 4b: the knight is a rigged, animated horse (Quaternius "Ultimate Animated Animals" Horse,
// CC0 - see public/models/SOURCES.md) standing on the knight's own turned base, driven by an
// AnimationMixer, with our own horned-helm lancer (rider.ts) riding its spine bone.
//
// It wraps the procedural animator rather than replacing it: the base animator still owns the
// piece transform (hop arc, lunge, cancel/home poses, shatter debris), and the mixer only plays
// the skeleton clip that matches. Rearing is a pitch of the horse about its hind hooves, layered
// on top. So choreography, cancel and the FEN rules are unchanged, and pieces without a
// character keep working exactly as before.
import {
  AnimationMixer,
  Box3,
  Group,
  LoopOnce,
  LoopRepeat,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type Material,
  type Mesh,
  type Object3D,
  type SkinnedMesh,
} from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Color, PieceType } from '../game';
import { headingYaw, type Clip, type ClipParams, type PieceAnimator, type ProceduralAnimator } from './anim';
import { createRider, LANCE_COUCHED, LANCE_REST, SADDLE } from './rider';

/** Skeleton clip per animator verb (names from the glTF). */
export const CHARACTER_CLIPS = {
  idle: 'Idle',
  /** Knights always leap: one gallop-jump stretched over the hop. */
  move: 'Gallop_Jump',
  /** Same clip timed so the forelegs tuck at the top of the rear and land on the strike. */
  attack: 'Gallop_Jump',
  death: 'Death',
} as const;
type ClipKey = keyof typeof CHARACTER_CLIPS;

/** Which finish each source material takes (single-tone figurine: body colour, gold hooves). */
export type Finish = 'body' | 'accent' | 'eye';
const FINISH: Record<string, Finish> = {
  main: 'body', main_dark: 'body', main_light: 'body', muzzle: 'body', hair: 'body', eye_white: 'body',
  hooves: 'accent', eye_black: 'eye',
};
export const finishFor = (materialName: string): Finish => FINISH[materialName.toLowerCase()] ?? 'body';

/** Gallop_Jump: fraction of the clip where the forelegs are highest / where they land. */
const JUMP_PEAK = 0.4;
const JUMP_LAND = 0.75;

export interface CharacterKit {
  readonly template: Object3D;
  readonly clips: ReadonlyMap<ClipKey, AnimationClip>;
  /** Model-space bounds (bind pose): length along z, height along y. */
  readonly bounds: Box3;
}

export async function loadCharacterKit(url: string): Promise<CharacterKit> {
  // glTF parsing is a separate chunk: only fetched when characters are on.
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(url);
  return buildCharacterKit(gltf.scene, gltf.animations);
}

/** Pure assembly of the loaded model (testable without fetch). */
export function buildCharacterKit(scene: Object3D, animations: readonly AnimationClip[]): CharacterKit {
  const byName = new Map(animations.map((c) => [c.name, c]));
  const clips = new Map<ClipKey, AnimationClip>();
  for (const [k, name] of Object.entries(CHARACTER_CLIPS) as [ClipKey, string][]) {
    const c = byName.get(name);
    if (!c) throw new Error(`character clip missing: ${name}`);
    clips.set(k, c);
  }
  scene.updateMatrixWorld(true);
  return { template: scene, clips, bounds: new Box3().setFromObject(scene) };
}

export interface CharacterMaterials {
  /** Lacquer matching the piece's side. */
  body(color: Color): Material;
  /** Gold trim (hooves, like the gold foot rings on every base). */
  accent(): Material;
  /** Dark inlay for the eyes. */
  eye(): Material;
}

/** Length of the horse nose-to-tail on the board, in squares. */
const HORSE_LENGTH = 0.8;
/** Top of the knight's turned base (Profile in pieces.ts). */
const BASE_TOP = 0.255;
/** Rearing pitch at its peak (radians). */
const REAR = 0.62;

interface Rig {
  readonly mixer: AnimationMixer;
  readonly actions: ReadonlyMap<ClipKey, AnimationAction>;
  /** Rotates about the hind hooves to rear up. */
  readonly pivot: Object3D;
  /** Slides along the piece's forward axis while rearing so the hind hooves stay over the base. */
  readonly mount: Object3D;
  /** Hind leg bones (the hooves the horse rears on). */
  readonly hind: readonly Object3D[];
  /** The rider's lance: raised at rest, couched for the charge. */
  readonly lance: Object3D;
  current: AnimationAction | null;
  /** Seconds until the current one-shot/loop should hand back to idle (<= 0: none). */
  hold: number;
  /** Rear-up timeline (attack); duration 0 = not rearing. */
  rearT: number;
  rearDur: number;
  /** Pending base shatter (after the death clip has started). */
  shatterIn: number;
  shatterDuration: number;
  dead: boolean;
}

export interface CharacterAnimator extends PieceAnimator {
  /** Loaded asynchronously; until then every piece stays procedural. */
  kit: CharacterKit | null;
  /** Idempotent: give every piece of `type` under `root` a character (call after sync/setDetail). */
  attachAll(root: Object3D): void;
  readonly count: number;
}

/** Rest facing: three-quarter view toward the opponent, so the horse reads in profile like a figurine. */
const REST_YAW: Record<Color, number> = { white: headingYaw(0, -1) + 0.7, black: headingYaw(0, 1) + 0.7 };
const FADE = 0.18;

/** Lance pitch over attack progress k: lower into the couch during the rear, hold through the strike, raise. */
export function lanceAngle(k: number): number {
  if (k <= 0 || k >= 1) return LANCE_REST;
  const ease = (w: number): number => w * w * (3 - 2 * w);
  const couch = k < 0.25 ? ease(k / 0.25) : k < 0.7 ? 1 : 1 - ease((k - 0.7) / 0.3);
  return LANCE_REST + (LANCE_COUCHED - LANCE_REST) * couch;
}

/** The clip kicks the hind legs back at take-off; while rearing, slide the horse so they stay on the base. */
const HIND_BONES = ['BackLowerLegL', 'BackLowerLegR'];
const tmp = new Vector3();
function keepHindOverBase(obj: Object3D, rig: Rig, weight: number): void {
  if (rig.hind.length === 0) return;
  obj.updateMatrixWorld(true);
  let x = 0;
  for (const b of rig.hind) x += obj.worldToLocal(b.getWorldPosition(tmp)).x;
  x = x / rig.hind.length - rig.mount.position.x; // where the hooves are with the mount unshifted
  rig.mount.position.x = -x * weight;
}

/** Spine bone over the saddle that carries the rider. */
const RIDER_BONE = 'Torso2';

/** Rear angle over attack progress k: rise in the wind-up, slam down on the strike, settle. */
export function rearAngle(k: number): number {
  if (k <= 0 || k >= 1) return 0;
  if (k < 0.3) return REAR * Math.sin((Math.PI / 2) * (k / 0.3));
  if (k < 0.5) {
    const w = (k - 0.3) / 0.2;
    return REAR * (1 - w * w) - 0.06 * w; // hooves drive through the board line
  }
  const w = (k - 0.5) / 0.5;
  return -0.06 * (1 - w) * Math.cos(Math.PI * 1.5 * w);
}

export function createCharacterAnimator(
  base: ProceduralAnimator,
  type: PieceType,
  mats: CharacterMaterials,
): CharacterAnimator {
  const rigs = new Map<Object3D, Rig>();
  let kit: CharacterKit | null = null;

  const attach = (obj: Object3D): void => {
    if (!kit || rigs.has(obj) || obj.userData.type !== type) return;
    const color = obj.userData.color as Color;
    const b = kit.bounds;
    const s = HORSE_LENGTH / (b.max.z - b.min.z);
    const hindZ = b.min.z + 0.22 * (b.max.z - b.min.z); // hind hooves, a little in from the tail tip
    const centreZ = (b.min.z + b.max.z) / 2;

    const ch = cloneSkinned(kit.template);
    ch.name = 'character';
    ch.position.set(0, -b.min.y, -hindZ);
    const pivot = new Group();
    pivot.name = 'rear-pivot';
    pivot.position.set(0, 0, (hindZ - centreZ) * s);
    pivot.scale.setScalar(s);
    pivot.add(ch);
    const mount = new Group();
    mount.name = 'mount';
    mount.position.y = BASE_TOP;
    mount.rotation.y = Math.PI / 2; // the horse faces +z; the animator's piece forward is +x
    mount.add(pivot);
    ch.traverse((o) => {
      if (!(o as Mesh).isMesh) return;
      const m = o as SkinnedMesh;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false; // skinned bounds don't follow the clip
      const pick = (src: Material): Material => {
        const f = finishFor(src.name);
        return f === 'accent' ? mats.accent() : f === 'eye' ? mats.eye() : mats.body(color);
      };
      m.material = Array.isArray(m.material) ? m.material.map(pick) : pick(m.material);
    });
    // The rider sits on the saddle and rides the spine bone, so it follows every gallop and rear.
    const rider = createRider({ armour: mats.body(color), trim: mats.accent(), dark: mats.eye() });
    rider.root.position.copy(SADDLE);
    ch.add(rider.root);
    obj.add(mount);
    obj.updateMatrixWorld(true);
    (ch.getObjectByName(RIDER_BONE) ?? ch).attach(rider.root);
    // Keep the knight's turned base and gold rings; hide the procedural head.
    for (const c of obj.children) c.visible = c === mount || c.userData.base === true;
    obj.userData.restYaw = REST_YAW[color];
    obj.rotation.set(0, REST_YAW[color], 0);
    const mixer = new AnimationMixer(ch);
    const actions = new Map<ClipKey, AnimationAction>();
    for (const [k, clip] of kit.clips) actions.set(k, mixer.clipAction(clip));
    const rig: Rig = {
      mixer, actions, pivot, mount, hind: HIND_BONES.map((n) => ch.getObjectByName(n)).filter((b) => b !== undefined), lance: rider.lance, current: null, hold: 0, rearT: 0, rearDur: 0, shatterIn: -1, shatterDuration: 0, dead: false,
    };
    rigs.set(obj, rig);
    fade(rig, 'idle', 0, 1);
    rig.mixer.setTime(((obj.userData.phase as number | undefined) ?? 0) % 3); // desynchronise idles
  };

  const fade = (rig: Rig, key: ClipKey, fadeTime: number, timeScale: number, once = false): void => {
    const next = rig.actions.get(key)!;
    // move and attack share a clip: restart it rather than cross-fading into itself.
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
    rig.rearT = 0;
    rig.rearDur = 0;
    rig.pivot.rotation.x = 0;
    rig.mount.position.x = 0;
    rig.lance.rotation.x = LANCE_REST;
  };

  const toIdle = (rig: Rig, fadeTime = FADE): void => {
    rig.hold = 0;
    rig.shatterIn = -1;
    rig.dead = false;
    settle(rig);
    fade(rig, 'idle', fadeTime, 1);
  };

  const clipLen = (key: ClipKey): number => kit?.clips.get(key)?.duration ?? 1;

  const animator: CharacterAnimator = {
    get kit() {
      return kit;
    },
    set kit(k: CharacterKit | null) {
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
        if (rig.current !== rig.actions.get('idle') || rig.dead) toIdle(rig);
        return;
      }
      if (clip === 'move') {
        const duration = params.duration ?? 0.5;
        settle(rig);
        // Take off at the start, land at the end of the hop.
        fade(rig, 'move', 0.1, (clipLen('move') * JUMP_LAND) / Math.max(duration, 1e-3), true);
        rig.hold = duration;
        base.play(obj, 'move', { ...params, hop: (params.hop ?? 0) * 0.55 });
        return;
      }
      if (clip === 'attack') {
        const duration = params.duration ?? 0.5;
        // Forelegs tuck at the top of the rear (k = 0.3) and come down on the strike.
        fade(rig, 'attack', 0.08, (clipLen('attack') * JUMP_PEAK) / Math.max(0.3 * duration, 1e-3), true);
        rig.rearT = 0;
        rig.rearDur = duration;
        rig.hold = duration;
        base.play(obj, 'attack', params);
        return;
      }
      // shatter: collapse first, then burst into debris.
      const duration = params.duration ?? 0.6;
      settle(rig);
      // Collapse fast: the attacker steps onto this square soon after impact (ATTACK_ENTER).
      fade(rig, 'death', 0.06, clipLen('death') / (duration * 0.4), true);
      rig.dead = true;
      rig.shatterIn = duration * 0.35;
      rig.shatterDuration = duration * 0.65;
      rig.hold = duration;
    },
    drag(obj, to, duration) {
      base.drag(obj, to, duration);
    },
    fall(obj, duration) {
      const rig = rigs.get(obj);
      if (!rig) {
        base.fall(obj, duration);
        return;
      }
      settle(rig);
      fade(rig, 'death', 0.1, clipLen('death') / duration, true);
      rig.dead = true;
      rig.hold = duration;
    },
    update(dt) {
      base.update(dt);
      for (const [obj, rig] of rigs) {
        if (rig.shatterIn >= 0) {
          rig.shatterIn -= dt;
          if (rig.shatterIn < 0) base.play(obj, 'shatter', { duration: rig.shatterDuration });
        }
        if (rig.rearDur > 0) {
          rig.rearT = Math.min(rig.rearDur, rig.rearT + dt);
          const rear = rearAngle(rig.rearT / rig.rearDur);
          rig.pivot.rotation.x = -rear;
          rig.lance.rotation.x = lanceAngle(rig.rearT / rig.rearDur);
          if (rig.rearT >= rig.rearDur) settle(rig);
        }
        if (rig.hold > 0) {
          rig.hold -= dt;
          if (rig.hold <= 0 && !rig.dead) toIdle(rig);
        }
        // Idle loops only breathe when the tier allows idle motion (tier off stays still).
        if (rig.hold > 0 || base.idleSway) rig.mixer.update(dt);
        if (rig.rearDur > 0) keepHindOverBase(obj, rig, Math.max(0, rearAngle(rig.rearT / rig.rearDur) / REAR));
      }
    },
    cancel() {
      base.cancel(); // restores transforms/visibility, drops debris
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
