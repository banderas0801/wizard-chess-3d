// Step 4b prototype: one piece type replaced by a rigged, animated character (Quaternius
// "Animated Knight Pack", CC0 - see public/models/SOURCES.md), driven by an AnimationMixer.
//
// It wraps the procedural animator rather than replacing it: the base animator still owns the
// piece transform (glide/hop path, lunge, cancel/home poses, shatter debris), and the mixer
// only plays the skeleton clip that matches. So choreography, cancel and the FEN rules are
// unchanged, and pieces without a character keep working exactly as before.
import {
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  Material,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type Group,
  type Object3D,
  type SkinnedMesh,
} from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Color, PieceType } from '../game';
import { headingYaw, type Clip, type ClipParams, type PieceAnimator, type ProceduralAnimator } from './anim';

/** Skeleton clip per animator verb (names from the FBX). */
export const CHARACTER_CLIPS = {
  idle: 'HumanArmature|Idle_swordRight',
  move: 'HumanArmature|Walking',
  run: 'HumanArmature|Run_swordRight',
  attack: 'HumanArmature|Run_swordAttack',
  death: 'HumanArmature|Death',
} as const;
type ClipKey = keyof typeof CHARACTER_CLIPS;

export interface CharacterKit {
  readonly template: Object3D;
  readonly clips: ReadonlyMap<ClipKey, AnimationClip>;
  /** Template height in its own units, for scaling to the piece it replaces. */
  readonly height: number;
}

export async function loadCharacterKit(baseUrl: string): Promise<CharacterKit> {
  // FBX parsing (and its inflate dependency) is a separate chunk: only fetched when characters are on.
  const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
  const loader = new FBXLoader();
  const [body, sword, helmet] = await Promise.all([
    loader.loadAsync(`${baseUrl}/KnightCharacter.fbx`),
    loader.loadAsync(`${baseUrl}/Sword.fbx`),
    loader.loadAsync(`${baseUrl}/Helmet1.fbx`),
  ]);
  return buildCharacterKit(body, sword, helmet);
}

/** Pure assembly of the loaded pack parts (testable without fetch). */
export function buildCharacterKit(body: Group, sword: Object3D, helmet: Object3D): CharacterKit {
  const byName = new Map(body.animations.map((c) => [c.name, c]));
  const clips = new Map<ClipKey, AnimationClip>();
  for (const [k, name] of Object.entries(CHARACTER_CLIPS) as [ClipKey, string][]) {
    const c = byName.get(name);
    if (!c) throw new Error(`character clip missing: ${name}`);
    clips.set(k, c);
  }
  // Sword in the right palm (pack readme: "parent the weapon to the Palm.R bone").
  const palm = body.getObjectByName('PalmR');
  if (palm) {
    sword.scale.setScalar(0.01); // bones live inside the x100 armature
    sword.rotation.set(0, 0, Math.PI / 2);
    palm.add(sword);
  }
  // Helmet on the head bone (same readme), so the figure reads as a knight from across the board.
  const head = body.getObjectByName('Head');
  if (head) {
    // The helmet is modelled around its own origin: place it in bind pose at the head centre,
    // upright in model space, then express that in the bone's frame.
    body.updateMatrixWorld(true);
    const local = head.worldToLocal(new Vector3(0, 492, 4));
    helmet.position.copy(local);
    helmet.quaternion.copy(head.getWorldQuaternion(new Quaternion()).invert());
    helmet.scale.setScalar(0.01);
    head.add(helmet);
  }
  return { template: body, clips, height: 558 };
}

export interface CharacterMaterials {
  /** Lacquer for the armour, matching the piece's side. */
  body(color: Color): Material;
  accent(): Material;
}

interface Rig {
  readonly mixer: AnimationMixer;
  readonly actions: ReadonlyMap<ClipKey, AnimationAction>;
  current: AnimationAction | null;
  /** Seconds until the current one-shot/loop should hand back to idle (<= 0: none). */
  hold: number;
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

const OPPONENT_YAW: Record<Color, number> = { white: headingYaw(0, -1), black: headingYaw(0, 1) };
const FADE = 0.18;

export function createCharacterAnimator(
  base: ProceduralAnimator,
  type: PieceType,
  mats: CharacterMaterials,
): CharacterAnimator {
  const rigs = new Map<Object3D, Rig>();
  const skin = new MeshStandardMaterial({ color: 0xc89670, roughness: 0.7 });

  let kit: CharacterKit | null = null;

  const attach = (obj: Object3D): void => {
    if (!kit || rigs.has(obj) || obj.userData.type !== type) return;
    const color = obj.userData.color as Color;
    const height = (obj.userData.height as number | undefined) ?? 0.8;
    const ch = cloneSkinned(kit.template);
    ch.name = 'character';
    ch.scale.setScalar((height * 1.08) / kit.height);
    ch.rotation.y = Math.PI / 2; // character faces +z; the animator's piece forward is +x
    ch.traverse((o) => {
      if (!(o as Mesh).isMesh) return;
      const m = o as SkinnedMesh;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false; // skinned bounds don't follow the clip
      const pick = (src: Material): Material => {
        const n = src.name.toLowerCase();
        if (n === 'skin') return skin;
        if (n === 'armor' || n === 'metal' || n === 'darkgrey') return mats.body(color);
        return mats.accent(); // boots, sword hilt/guard
      };
      m.material = Array.isArray(m.material) ? m.material.map(pick) : pick(m.material);
    });
    // Hide the procedural knight but keep it as the object the base animator moves.
    for (const c of obj.children) c.visible = false;
    obj.add(ch);
    // Rest facing: toward the opponent (sync() resets rotation to restYaw).
    obj.userData.restYaw = OPPONENT_YAW[color];
    obj.rotation.set(0, OPPONENT_YAW[color], 0);
    const mixer = new AnimationMixer(ch);
    const actions = new Map<ClipKey, AnimationAction>();
    for (const [k, clip] of kit.clips) actions.set(k, mixer.clipAction(clip));
    const rig: Rig = { mixer, actions, current: null, hold: 0, shatterIn: -1, shatterDuration: 0, dead: false };
    rigs.set(obj, rig);
    // Desynchronise idles like the procedural breathing does.
    fade(rig, 'idle', 0, 1);
    rig.mixer.setTime(((obj.userData.phase as number | undefined) ?? 0) % 3);
  };

  const fade = (rig: Rig, key: ClipKey, fadeTime: number, timeScale: number, once = false): void => {
    const next = rig.actions.get(key)!;
    next.reset();
    next.setLoop(once ? LoopOnce : LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.timeScale = timeScale;
    next.play();
    if (rig.current && rig.current !== next && fadeTime > 0) rig.current.crossFadeTo(next, fadeTime, false);
    else if (rig.current && rig.current !== next) rig.current.stop();
    rig.current = next;
  };

  const toIdle = (rig: Rig, fadeTime = FADE): void => {
    rig.hold = 0;
    rig.shatterIn = -1;
    rig.dead = false;
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
        const dist = params.to ? obj.position.distanceTo(params.to) : 0;
        const run = dist / Math.max(duration, 1e-3) > 2.2;
        const key: ClipKey = run ? 'run' : 'move';
        // Match the stride to ground speed (the clips are authored for roughly these speeds).
        const strideSpeed = run ? 3.4 : 1.6;
        fade(rig, key, FADE, Math.min(2.5, Math.max(0.7, dist / Math.max(duration, 1e-3) / strideSpeed)));
        rig.hold = duration;
        base.play(obj, 'move', { ...params, hop: (params.hop ?? 0) * 0.35 }); // a leap, not a cartwheel
        return;
      }
      if (clip === 'attack') {
        const duration = params.duration ?? 0.5;
        fade(rig, 'attack', 0.08, clipLen('attack') / duration, true);
        rig.hold = duration;
        base.play(obj, 'attack', params);
        return;
      }
      // shatter: fall over first, then burst into debris.
      const duration = params.duration ?? 0.6;
      fade(rig, 'death', 0.06, clipLen('death') / (duration * 0.7), true);
      rig.dead = true;
      rig.shatterIn = duration * 0.55;
      rig.shatterDuration = duration * 0.45;
      rig.hold = duration;
    },
    fall(obj, duration) {
      const rig = rigs.get(obj);
      if (!rig) {
        base.fall(obj, duration);
        return;
      }
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
        if (rig.hold > 0) {
          rig.hold -= dt;
          if (rig.hold <= 0 && !rig.dead) toIdle(rig);
        }
        // Idle loops only breathe when the tier allows idle motion (tier off stays still).
        if (rig.hold > 0 || base.idleSway) rig.mixer.update(dt);
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
      }
    },
  };
  return animator;
}
