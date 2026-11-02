// Rigid sculpted pieces (first: the Meshy rook, an armoured knight with a war hammer and shield;
// see public/models/SOURCES.md). One mesh, no skeleton: the figure moves as a whole.
//
// Same contract as character.ts / figure.ts: it wraps another animator. The wrapped procedural
// animator keeps owning the piece transform (glide, the attack curve with its tilt / leap / squash,
// cancel/home poses, shatter debris); this layer only swaps the mesh for the statue, recolours it
// per side and pulses a faint aura at the base around the strike's impact.
import {
  AdditiveBlending,
  Box3,
  Color as ThreeColor,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  type Material,
  type Object3D,
} from 'three';
import type { Color, PieceType } from '../game';
import { MAX_FOOTPRINT, TARGET_HEIGHT } from './assets';
import { ATTACK_IMPACT, headingYaw, type Clip, type ClipParams, type PieceAnimator } from './anim';

export interface StatueKit {
  readonly template: Object3D;
  /** Model-space bounds of the template (meshes only). */
  readonly bounds: Box3;
}

export async function loadStatueKit(url: string): Promise<StatueKit> {
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/libs/meshopt_decoder.module.js'),
  ]);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  return buildStatueKit(gltf.scene);
}

/** Pure assembly of the loaded model (testable without fetch). */
export function buildStatueKit(scene: Object3D): StatueKit {
  scene.updateMatrixWorld(true);
  const bounds = new Box3();
  scene.traverse((o) => {
    if ((o as Mesh).isMesh) bounds.expandByObject(o, true);
  });
  if (bounds.isEmpty()) throw new Error('statue has no mesh');
  return { template: scene, bounds };
}

/**
 * Per-side finish of the baked texture. White keeps it, with a faint gold aura through the map.
 * Black is obsidian: the albedo is taken to grey (luminance only, so the red cloak can't show
 * through) and tinted near-black, and the crimson glow is a rim light, not the map: an emissive map
 * would multiply the crimson by the texture's own colours and make the red parts glow red.
 */
export interface StatueFinish {
  /** Multiplies the (white) or the greyed (black) baked albedo. */
  readonly tint: string;
  /** Added to roughness from the baked map (negative = glossier), clamped by the shader. */
  readonly roughness: number;
  readonly metalness: number;
  /** Aura colour and its intensity at rest. */
  readonly glow: string;
  readonly glowIntensity: number;
  /** Obsidian: grey albedo + fresnel rim glow instead of the baked colours. */
  readonly obsidian: boolean;
}

export const STATUE_FINISH: Readonly<Record<Color, StatueFinish>> = {
  white: { tint: '#ffffff', roughness: 1, metalness: 1, glow: '#F59E0B', glowIntensity: 0.06, obsidian: false },
  black: { tint: '#3a3742', roughness: 0.45, metalness: 0.35, glow: '#DC2626', glowIntensity: 0.4, obsidian: true },
};

/** Rec. 709 luminance weights: the obsidian keeps the carving's light and dark, none of its hue. */
const LUMA = 'vec3(0.2126, 0.7152, 0.0722)';
/** Rim glow: emissive weighted by (1 - N.V)^RIM_POWER, plus a small floor so the core isn't dead black. */
const RIM_POWER = '3.0';
const RIM_FLOOR = '0.0';

/** Shader patch for the obsidian finish (exported so tests can check it without a GL context). */
export function obsidianShader(shader: { fragmentShader: string }): void {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <map_fragment>', `#include <map_fragment>\n#ifdef USE_MAP\n\tdiffuseColor.rgb = vec3( dot( sampledDiffuseColor.rgb, ${LUMA} ) ) * diffuse;\n#endif`)
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= ${RIM_FLOOR} + pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), ${RIM_POWER} );`,
    );
}

export function finishMaterial(src: Material, color: Color): MeshStandardMaterial {
  const f = STATUE_FINISH[color];
  const base = src as Partial<MeshStandardMaterial>;
  const m = new MeshStandardMaterial({
    map: base.map ?? null,
    metalnessMap: base.metalnessMap ?? null,
    roughnessMap: base.roughnessMap ?? null,
    normalMap: base.normalMap ?? null,
    color: new ThreeColor(f.tint),
    roughness: f.roughness,
    metalness: f.metalness,
    emissive: new ThreeColor(f.glow),
    emissiveMap: f.obsidian ? null : (base.map ?? null),
    emissiveIntensity: f.glowIntensity,
  });
  if (f.obsidian) {
    m.onBeforeCompile = obsidianShader;
    m.customProgramCacheKey = () => 'statue-obsidian';
    m.userData.obsidian = true;
  }
  m.name = `statue-${color}`;
  return m;
}

export interface StatueOptions {
  readonly type: PieceType;
  /** The turned pedestal the figure stands on (same foot and gold rim as the other pieces). */
  readonly pedestal: (color: Color) => Object3D;
  /** Height of the pedestal's top face, where the figure's feet go. */
  readonly pedestalTop: number;
  /** Aura colours (defaults from STATUE_FINISH). */
  readonly glow?: Partial<Record<Color, string>>;
}

/**
 * Uniform scale and offset that stand a model of these bounds on the pedestal: the whole piece is
 * TARGET_HEIGHT[type] tall, unless its footprint (the circle around its x/z extent, so it holds at
 * any yaw) would spread wider than MAX_FOOTPRINT of the square, in which case it shrinks to fit.
 */
export function fitStatue(b: Box3, type: PieceType, pedestalTop: number): { scale: number; offset: [number, number, number] } {
  const figure = Math.max(1e-6, TARGET_HEIGHT[type] - pedestalTop);
  const byHeight = figure / Math.max(1e-6, b.max.y - b.min.y);
  const span = 2 * Math.hypot((b.max.x - b.min.x) / 2, (b.max.z - b.min.z) / 2);
  const byWidth = MAX_FOOTPRINT / Math.max(1e-6, span);
  const s = Math.min(byHeight, byWidth);
  return { scale: s, offset: [-((b.min.x + b.max.x) / 2) * s, pedestalTop - b.min.y * s, -((b.min.z + b.max.z) / 2) * s] };
}

interface Rig {
  readonly glow: ThreeColor;
  readonly mats: MeshStandardMaterial[];
  readonly ring: Mesh<RingGeometry, MeshBasicMaterial>;
  readonly rest: number;
  /** Attack pulse timeline; duration 0 = none. */
  t: number;
  dur: number;
}

export interface StatueAnimator extends PieceAnimator {
  kit: StatueKit | null;
  /** Idempotent; also attaches the wrapped animator's characters. */
  attachAll(root: Object3D): void;
  readonly count: number;
}

const RING_REST = 0.35;
const RING_PEAK = 2.2;

/** Aura pulse over attack progress k: swells through the wind-up, flares at impact, fades. */
export function glowPulse(k: number): number {
  if (k <= 0 || k >= 1) return 0;
  if (k < ATTACK_IMPACT) return 0.35 * (k / ATTACK_IMPACT) ** 2;
  const w = (k - ATTACK_IMPACT) / (1 - ATTACK_IMPACT);
  return Math.exp(-6 * w) * (1 - w);
}

export function createStatueAnimator(
  base: PieceAnimator & { attachAll?(root: Object3D): void },
  opts: StatueOptions,
): StatueAnimator {
  const rigs = new Map<Object3D, Rig>();
  let kit: StatueKit | null = null;
  // Facing the opponent, turned a little so the hammer side reads from the player's seat.
  const restYaw: Record<Color, number> = { white: headingYaw(0, -1) + 0.35, black: headingYaw(0, 1) + 0.35 };
  const glowOf = (c: Color): string => opts.glow?.[c] ?? STATUE_FINISH[c].glow;

  const attach = (obj: Object3D): void => {
    if (!kit || rigs.has(obj) || obj.userData.type !== opts.type) return;
    const color = obj.userData.color as Color;
    const fit = fitStatue(kit.bounds, opts.type, opts.pedestalTop);
    const statue = kit.template.clone(true); // geometry + textures shared; materials replaced per instance
    statue.name = 'statue';
    statue.scale.setScalar(fit.scale);
    statue.position.set(...fit.offset);
    const mats: MeshStandardMaterial[] = [];
    statue.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      const pick = (src: Material): Material => {
        const fm = finishMaterial(src, color);
        fm.emissive.set(glowOf(color));
        mats.push(fm);
        return fm;
      };
      m.material = Array.isArray(m.material) ? m.material.map(pick) : pick(m.material);
    });
    const mount = new Group();
    mount.name = 'mount';
    mount.rotation.y = Math.PI / 2; // the model faces +z; the animator's piece forward is +x
    mount.add(statue);
    const pedestal = opts.pedestal(color);
    pedestal.name = 'pedestal';

    const ring = new Mesh(
      new RingGeometry(0.26, 0.34, 48),
      new MeshBasicMaterial({ color: glowOf(color), transparent: true, opacity: 0.6, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false }),
    );
    ring.name = 'aura';
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.004;
    ring.renderOrder = 1;
    ring.castShadow = false;
    ring.receiveShadow = false;
    ring.userData.noDebris = true; // shatter shards take the statue's stone, not the additive glow

    for (const c of obj.children) c.visible = false; // procedural piece hidden; the statue replaces it
    obj.add(pedestal, mount, ring);
    obj.userData.restYaw = restYaw[color];
    obj.userData.wheels = []; // no chariot any more: nothing to roll
    obj.userData.height = opts.pedestalTop + (kit.bounds.max.y - kit.bounds.min.y) * fit.scale;
    obj.rotation.set(0, restYaw[color], 0);
    const rig: Rig = { glow: new ThreeColor(glowOf(color)), mats, ring, rest: STATUE_FINISH[color].glowIntensity, t: 0, dur: 0 };
    setGlow(rig, 0);
    rigs.set(obj, rig);
  };

  const setGlow = (rig: Rig, p: number): void => {
    for (const m of rig.mats) m.emissiveIntensity = rig.rest + p * 0.5;
    // Below the bloom threshold even at the flare: the strike FX own the bloom.
    rig.ring.material.color.copy(rig.glow).multiplyScalar(RING_REST + p * (RING_PEAK - RING_REST));
    rig.ring.scale.setScalar(1 + p * 0.25);
  };

  const stop = (rig: Rig): void => {
    rig.t = 0;
    rig.dur = 0;
    setGlow(rig, 0);
  };

  const animator: StatueAnimator = {
    get kit() {
      return kit;
    },
    set kit(k: StatueKit | null) {
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
      for (const r of rigs.values()) if (r.dur > 0) return true;
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
      if (rig && clip === 'attack') {
        rig.t = 0;
        rig.dur = params.duration ?? 0.5;
      } else if (rig && clip !== 'idle') stop(rig);
      base.play(obj, clip, params);
    },
    drag(obj, to, duration) {
      base.drag(obj, to, duration);
    },
    fall(obj, duration) {
      const rig = rigs.get(obj);
      if (rig) stop(rig);
      base.fall(obj, duration);
    },
    update(dt) {
      base.update(dt);
      for (const rig of rigs.values()) {
        if (rig.dur <= 0) continue;
        rig.t = Math.min(rig.dur, rig.t + dt);
        setGlow(rig, glowPulse(rig.t / rig.dur));
        if (rig.t >= rig.dur) stop(rig);
      }
    },
    cancel() {
      base.cancel();
      for (const rig of rigs.values()) stop(rig);
    },
    release() {
      base.release();
      for (const rig of rigs.values()) stop(rig);
    },
  };
  return animator;
}
