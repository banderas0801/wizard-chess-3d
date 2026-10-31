// Self-written strike effects: impact sparks, the queen's vortex and the bishop's beam.
// CPU-updated Points/Meshes with additive blending; particle counts scale with the quality tier.
// Camera shake is not drawn here; the app forwards 'shake' cues to the camera rig.
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial,
  Points, PointsMaterial, Vector3,
} from 'three';
import type { QualityTier } from '../render/quality';
import type { FxKind } from './strike';

/** Particle budget multiplier per tier (off still shows a hint of the effect). */
export const PARTICLE_SCALE: Readonly<Record<QualityTier, number>> = { high: 1, low: 0.5, off: 0.2 };
/** Camera shake multiplier per tier; 0 at off means no shake at all. */
export const SHAKE_SCALE: Readonly<Record<QualityTier, number>> = { high: 1, low: 0.7, off: 0 };

export const particleCount = (base: number, strength: number, tier: QualityTier): number =>
  Math.max(4, Math.round(base * strength * PARTICLE_SCALE[tier]));

interface Live {
  readonly obj: Mesh | Points | Group;
  t: number;
  readonly duration: number;
  step(dt: number, k: number): void;
}

export interface StrikeFx {
  readonly group: Group;
  play(kind: Exclude<FxKind, 'shake'>, from: Vector3, to: Vector3, strength: number, tier: QualityTier): void;
  update(dt: number): void;
  clear(): void;
  readonly active: boolean;
}

const GOLD = new Color('#ffcf73');
const WARM = new Color('#ff8a3a');
const VIOLET = new Color('#c9a6ff');

function points(n: number, color: Color, size: number): { pts: Points; pos: Float32Array; mat: PointsMaterial } {
  const pos = new Float32Array(n * 3);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  const mat = new PointsMaterial({ color, size, sizeAttenuation: true, transparent: true, blending: AdditiveBlending, depthWrite: false });
  const pts = new Points(geo, mat);
  pts.frustumCulled = false;
  return { pts, pos, mat };
}

export function createStrikeFx(): StrikeFx {
  const group = new Group();
  group.name = 'strike-fx';
  const live: Live[] = [];

  const sparks = (at: Vector3, strength: number, tier: QualityTier): Live => {
    const n = particleCount(60, strength, tier);
    const { pts, pos, mat } = points(n, GOLD, 0.06);
    const vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1.5 + Math.random() * 2.5;
      vel.set([Math.cos(a) * s, 1 + Math.random() * 3, Math.sin(a) * s], i * 3);
      pos.set([at.x, at.y + 0.3, at.z], i * 3);
    }
    return {
      obj: pts, t: 0, duration: 0.6,
      step(dt, k) {
        for (let i = 0; i < n; i++) {
          vel[i * 3 + 1]! -= 9 * dt;
          pos[i * 3]! += vel[i * 3]! * dt;
          pos[i * 3 + 1]! += vel[i * 3 + 1]! * dt;
          pos[i * 3 + 2]! += vel[i * 3 + 2]! * dt;
        }
        pts.geometry.attributes.position!.needsUpdate = true;
        mat.opacity = 1 - k;
        mat.color.copy(GOLD).lerp(WARM, k);
      },
    };
  };

  const vortex = (from: Vector3, to: Vector3, strength: number, tier: QualityTier): Live => {
    // A rising spiral of motes around the queen that then streams to the victim.
    const n = particleCount(140, strength, tier);
    const { pts, pos, mat } = points(n, VIOLET, 0.05);
    const seed = Float32Array.from({ length: n }, () => Math.random());
    const p = new Vector3();
    return {
      obj: pts, t: 0, duration: 1.1,
      step(_dt, k) {
        for (let i = 0; i < n; i++) {
          const s = seed[i]!;
          const swirl = Math.min(1, k / 0.55);
          const flow = Math.max(0, (k - 0.45) / 0.55) ** 2 * (0.6 + 0.4 * s);
          const a = s * 40 + k * 14 * (1 + s);
          const r = (0.55 - 0.3 * swirl) * (1 - flow) + 0.05;
          p.set(from.x + Math.cos(a) * r, from.y + 0.1 + swirl * (0.2 + s * 0.9), from.z + Math.sin(a) * r);
          p.lerp(to, Math.min(1, flow));
          if (flow > 0) p.y += 0.6 * Math.sin(Math.PI * Math.min(1, flow));
          pos.set([p.x, p.y, p.z], i * 3);
        }
        pts.geometry.attributes.position!.needsUpdate = true;
        mat.opacity = Math.min(1, k * 6) * (1 - Math.max(0, (k - 0.85) / 0.15));
      },
    };
  };

  const beam = (from: Vector3, to: Vector3, strength: number, tier: QualityTier): Live => {
    // A thin core + soft sheath of light from the bishop's mitre to the victim, then a flare.
    const g = new Group();
    const a = from.clone().setY(from.y + 0.75);
    const b = to.clone().setY(to.y + 0.35);
    const len = a.distanceTo(b);
    const mk = (r: number, color: Color, opacity: number): Mesh => {
      const m = new Mesh(
        new CylinderGeometry(r, r, 1, tier === 'high' ? 16 : 8, 1, true),
        new MeshBasicMaterial({ color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
      );
      return m;
    };
    const core = mk(0.018, new Color(3, 2.6, 1.6), 1);
    const sheath = mk(0.07, new Color(1.2, 0.8, 0.35), 0.35);
    g.add(core, sheath);
    g.position.copy(a);
    g.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize());
    const motes = points(particleCount(50, strength, tier), GOLD, 0.045);
    const n = motes.pos.length / 3;
    const seed = Float32Array.from({ length: n }, () => Math.random());
    group.add(motes.pts);
    const p = new Vector3();
    return {
      obj: g, t: 0, duration: 0.7,
      step(_dt, k) {
        // Extend from the bishop over the first 40%, hold, then fade.
        const reach = Math.min(1, k / 0.4);
        for (const m of [core, sheath]) {
          m.scale.set(1, len * reach, 1);
          m.position.set(0, (len * reach) / 2, 0);
          (m.material as MeshBasicMaterial).opacity = (m === core ? 1 : 0.35) * (1 - Math.max(0, (k - 0.7) / 0.3));
        }
        sheath.scale.x = sheath.scale.z = 1 + 0.25 * Math.sin(k * 40);
        for (let i = 0; i < n; i++) {
          const s = (seed[i]! + k * 1.8) % 1;
          p.lerpVectors(a, b, s * reach);
          p.x += Math.sin(s * 30 + i) * 0.05;
          p.z += Math.cos(s * 27 + i) * 0.05;
          motes.pos.set([p.x, p.y, p.z], i * 3);
        }
        motes.pts.geometry.attributes.position!.needsUpdate = true;
        motes.mat.opacity = 1 - k;
        if (k >= 1) {
          motes.pts.removeFromParent();
          motes.pts.geometry.dispose();
          motes.mat.dispose();
        }
      },
    };
  };

  const dispose = (o: Live['obj']): void => {
    o.removeFromParent();
    o.traverse((c) => {
      const m = c as Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as MeshBasicMaterial | undefined;
      mat?.dispose();
    });
  };

  return {
    group,
    get active() {
      return live.length > 0;
    },
    play(kind, from, to, strength, tier) {
      const fx = kind === 'sparks' ? sparks(to, strength, tier) : kind === 'vortex' ? vortex(from, to, strength, tier) : beam(from, to, strength, tier);
      group.add(fx.obj);
      fx.step(0, 0);
      live.push(fx);
    },
    update(dt) {
      for (let i = live.length - 1; i >= 0; i--) {
        const fx = live[i]!;
        fx.t = Math.min(fx.duration, fx.t + dt);
        fx.step(dt, fx.t / fx.duration);
        if (fx.t >= fx.duration) {
          dispose(fx.obj);
          live.splice(i, 1);
        }
      }
    },
    clear() {
      for (const fx of live) dispose(fx.obj);
      live.length = 0;
      for (const c of [...group.children]) c.removeFromParent();
    },
  };
}
