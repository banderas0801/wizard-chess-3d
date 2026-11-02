// Strike effects. Particles run on three.quarks (MIT): one BatchedRenderer, short-lived
// ParticleSystems per cue. Solid shapes (beam, orb, blades, rings, slash arc) are plain additive
// meshes. Everything is driven by StrikeProfile fx cues; colours come from ./budget's palette and
// are HDR (above the bloom threshold) so they glow; counts scale with the quality tier.
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, CylinderGeometry, DataTexture, DodecahedronGeometry,
  DoubleSide, Group, LinearFilter, Mesh, MeshBasicMaterial, NormalBlending, PointLight, RingGeometry, SphereGeometry,
  Vector3, type Material,
} from 'three';
import {
  ApplyForce, BatchedRenderer, Bezier, CircleEmitter, ColorOverLife, ConeEmitter, ConstantColor, ConstantValue, Gradient, IntervalValue,
  ParticleSystem, PiecewiseBezier, RandomQuatGenerator, RenderMode, SizeOverLife, SphereEmitter, SpeedOverLife,
  Vector3 as QVector3, Vector4, type Behavior, type EmitterShape, type ValueGenerator,
} from 'three.quarks';
import type { QualityTier } from '../render/quality';
import type { FxCue, FxKind } from '../scene/strike';
import { AURA, GLOW, PALETTE, particleCount, type Side } from './budget';

/** Kinds this layer draws ('shake' goes to the camera, 'slowmo' to the app clock). */
export type DrawnFx = Exclude<FxKind, 'shake' | 'slowmo'>;

export interface FxContext {
  /** Live position of the attacker (read every frame for charge-ups and trails). */
  readonly from: () => Vector3;
  /** The victim's square (board-top height). */
  readonly to: Vector3;
  /** Side that strikes: sets the glow colour. */
  readonly side: Side;
  readonly tier: QualityTier;
  /** Seconds until the blow lands, for 'strike' cues (0 for impact cues). */
  readonly impactIn: number;
}

export interface StrikeFx {
  readonly group: Group;
  /** Fire one cue. Returns the particle budget it asked for (for tests and the HUD). */
  play(cue: FxCue, ctx: FxContext): number;
  update(dt: number): void;
  clear(): void;
  readonly active: boolean;
}

/** Height of the blow above the board (chest of a piece). */
const CHEST = 0.42;

interface Live {
  t: number;
  readonly duration: number;
  /** k in [0,1]; return false to end early. */
  step(dt: number, k: number, t: number): void;
  dispose(): void;
}

const lin = (hex: string): Color => new Color(hex); // Color.set converts sRGB hex to linear
const v4 = (c: Color, gain: number, a = 1): Vector4 => new Vector4(c.r * gain, c.g * gain, c.b * gain, a);
const qv = (x: number, y: number, z: number): QVector3 => new QVector3(x, y, z);
const fade = (pts: [number, number][]): Gradient =>
  new Gradient([[qv(1, 1, 1), 0], [qv(1, 1, 1), 1]], pts);
const curve = (a: number, b: number, c: number, d: number): PiecewiseBezier => new PiecewiseBezier([[new Bezier(a, b, c, d), 0]]);

/** Soft round sprite (no canvas, so it builds in tests too). */
function glowTexture(size = 64): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1;
      const dy = (y + 0.5) / size * 2 - 1;
      const r = Math.min(1, Math.hypot(dx, dy));
      const a = Math.max(0, 1 - r) ** 2 * (1 - r * 0.3) + (r < 0.25 ? (0.25 - r) * 2 : 0);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(255 * Math.min(1, a));
    }
  }
  const tex = new DataTexture(data, size, size);
  tex.magFilter = tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Flat tapered blade in the xz plane, pointing along +x. */
function bladeGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  const L = 0.42;
  const W = 0.07;
  g.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0, L * 0.35, 0, W, L, 0, 0,
    0, 0, 0, L, 0, 0, L * 0.35, 0, -W,
  ]), 3));
  g.computeVertexNormals();
  return g;
}

export function createStrikeFx(): StrikeFx {
  const group = new Group();
  group.name = 'strike-fx';
  const batch = new BatchedRenderer();
  batch.name = 'quarks';
  group.add(batch);
  // One light for flashes, always present (intensity 0 at rest) so no shader recompiles mid-game.
  const light = new PointLight('#ffffff', 0, 4.5, 2);
  light.castShadow = false;
  group.add(light);
  let lightLeft = 0;
  let lightTotal = 1;
  let lightPeak = 0;

  const tex = glowTexture();
  const glowMat = new MeshBasicMaterial({ map: tex, transparent: true, blending: AdditiveBlending, depthWrite: false });
  const dustMat = new MeshBasicMaterial({ map: tex, transparent: true, blending: NormalBlending, depthWrite: false });
  const stoneMat = new MeshBasicMaterial({ color: '#ffffff' });
  const stoneGeo = new DodecahedronGeometry(1, 0);

  const additive = (c: Color, gain: number): MeshBasicMaterial =>
    new MeshBasicMaterial({ color: c.clone().multiplyScalar(gain), transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: true });

  const live: Live[] = [];
  const systems = new Set<ParticleSystem>();
  const pending: { at: number; run: () => void }[] = [];
  let clock = 0;

  interface Emit {
    readonly at: Vector3;
    readonly count: number;
    readonly life: ValueGenerator;
    readonly speed: ValueGenerator;
    readonly size: ValueGenerator;
    readonly color: Vector4;
    readonly shape: EmitterShape;
    readonly behaviors: Behavior[];
    readonly material?: Material;
    readonly mode?: RenderMode;
    /** Continuous rate (per second) instead of one burst. */
    readonly rate?: number;
    readonly duration?: number;
    readonly lookAt?: Vector3;
    readonly rotateX?: number;
  }

  const emit = (e: Emit): ParticleSystem => {
    const mode = e.mode ?? RenderMode.BillBoard;
    const ps = new ParticleSystem({
      duration: e.duration ?? 0.1,
      looping: false,
      autoDestroy: true,
      worldSpace: true,
      startLife: e.life,
      startSpeed: e.speed,
      startSize: e.size,
      startColor: new ConstantColor(e.color),
      emissionOverTime: new ConstantValue(e.rate ?? 0),
      emissionBursts: e.rate ? [] : [{ time: 0, count: new ConstantValue(e.count), cycle: 1, interval: 0.01, probability: 1 }],
      shape: e.shape,
      material: e.material ?? glowMat,
      renderMode: mode,
      ...(mode === RenderMode.StretchedBillBoard ? { rendererEmitterSettings: { speedFactor: 0.045, lengthFactor: 0 } } : {}),
      ...(mode === RenderMode.Mesh ? { instancingGeometry: stoneGeo, startRotation: new RandomQuatGenerator() } : {}),
      behaviors: e.behaviors,
    });
    ps.emitter.position.copy(e.at);
    if (e.lookAt) ps.emitter.lookAt(e.lookAt);
    if (e.rotateX) ps.emitter.rotation.x = e.rotateX;
    group.add(ps.emitter);
    batch.addSystem(ps);
    systems.add(ps);
    ps.addEventListener('destroy', () => systems.delete(ps));
    return ps;
  };

  const gravity = (g = 9.8): ApplyForce => new ApplyForce(qv(0, -1, 0), new ConstantValue(g));
  const fadeOut = (): ColorOverLife => new ColorOverLife(fade([[1, 0], [1, 0.55], [0, 1]]));
  const coolTo = (to: Color): ColorOverLife => new ColorOverLife(new Gradient(
    [[qv(1, 1, 1), 0], [qv(to.r, to.g, to.b), 0.6], [qv(to.r * 0.6, to.g * 0.6, to.b * 0.6), 1]],
    [[1, 0], [1, 0.6], [0, 1]],
  ));

  const addLive = (l: Live, obj?: Mesh | Group): void => {
    if (obj) group.add(obj);
    live.push(l);
  };

  const flashLight = (at: Vector3, c: Color, peak: number, seconds: number): void => {
    light.position.copy(at).setY(at.y + 0.6);
    light.color.copy(c);
    lightPeak = Math.max(lightPeak * (lightLeft / lightTotal), peak);
    lightLeft = lightTotal = seconds;
  };

  // ---- the effects -----------------------------------------------------------------------------

  const hit = (ctx: FxContext): Vector3 => ctx.to.clone().setY(ctx.to.y + CHEST);
  const aura = (ctx: FxContext): Color => lin(AURA[ctx.side]);

  const draw: Record<DrawnFx, (s: number, ctx: FxContext) => number> = {
    sparks(s, ctx) {
      // Glowing metal: white-hot streaks that cool to ember orange tinged with the striker's aura.
      const n = particleCount(90, s, ctx.tier);
      const cool = lin(PALETTE.ember).lerp(aura(ctx), 0.35);
      emit({
        at: hit(ctx), count: n, life: new IntervalValue(0.25, 0.7), speed: new IntervalValue(2.5, 7 * Math.sqrt(s)),
        size: new IntervalValue(0.025, 0.05), color: v4(lin(PALETTE.hot), GLOW.spark), shape: new SphereEmitter({ radius: 0.08 }),
        mode: RenderMode.StretchedBillBoard, behaviors: [gravity(), coolTo(cool), new SpeedOverLife(curve(1, 0.8, 0.6, 0.4))],
      });
      return n;
    },

    flash(s, ctx) {
      const c = aura(ctx);
      const at = hit(ctx);
      const n = particleCount(3, 1, ctx.tier);
      emit({
        at, count: n, life: new IntervalValue(0.16, 0.24), speed: new ConstantValue(0), size: new IntervalValue(0.9 * s, 1.4 * s),
        color: v4(lin(PALETTE.hot).lerp(c, 0.5), GLOW.flash), shape: new SphereEmitter({ radius: 0.02 }),
        behaviors: [new SizeOverLife(curve(0.4, 1, 1.1, 1.2)), fadeOut()],
      });
      flashLight(at, c, 14 * s, 0.35);
      return n;
    },

    embers(s, ctx) {
      // Slow rising motes after the beam lands.
      const n = particleCount(60, s, ctx.tier);
      emit({
        at: hit(ctx), count: n, life: new IntervalValue(0.9, 1.9), speed: new IntervalValue(0.3, 1.3),
        size: new IntervalValue(0.02, 0.045), color: v4(aura(ctx).lerp(lin(PALETTE.hot), 0.25), GLOW.ember),
        shape: new SphereEmitter({ radius: 0.25 }),
        behaviors: [new ApplyForce(qv(0, 1, 0), new ConstantValue(0.9)), new SpeedOverLife(curve(1, 0.5, 0.3, 0.2)), fadeOut()],
      });
      return n;
    },

    orb(s, ctx) {
      // Charge orb at the bishop's mitre: a growing core, and motes converging into it.
      const c = aura(ctx);
      const dur = Math.max(0.2, ctx.impactIn);
      const core = new Mesh(new SphereGeometry(1, 20, 14), additive(lin(PALETTE.hot).lerp(c, 0.55), GLOW.orb));
      const halo = new Mesh(new SphereGeometry(1, 20, 14), additive(c, GLOW.orb * 0.35));
      const g = new Group();
      g.add(core, halo);
      const spot = (): Vector3 => {
        const from = ctx.from();
        const dir = ctx.to.clone().sub(from).setY(0).normalize();
        return from.clone().addScaledVector(dir, 0.22).setY(from.y + 1.12);
      };
      g.position.copy(spot());
      const n = particleCount(70, s, ctx.tier);
      const motes = emit({
        at: g.position.clone(), count: 0, rate: n / dur, duration: dur * 0.9, life: new ConstantValue(0.35),
        speed: new ConstantValue(-1.3), size: new IntervalValue(0.025, 0.05), color: v4(c, GLOW.orb),
        shape: new SphereEmitter({ radius: 0.45, thickness: 0.2 }), behaviors: [new ColorOverLife(fade([[0, 0], [1, 0.4], [1, 1]]))],
      });
      addLive({
        t: 0, duration: dur,
        step(_dt, k, t) {
          g.position.copy(spot());
          motes.emitter.position.copy(g.position);
          const r = 0.03 + 0.1 * Math.min(1, k * 1.3) * s;
          core.scale.setScalar(r * (1 + 0.12 * Math.sin(t * 40)));
          halo.scale.setScalar(r * 2.1);
        },
        dispose() {
          g.removeFromParent();
          core.geometry.dispose();
          halo.geometry.dispose();
          (core.material as Material).dispose();
          (halo.material as Material).dispose();
        },
      }, g);
      return n;
    },

    beam(s, ctx) {
      // Holy beam from the orb to the victim's chest; streaming motes along it.
      const c = aura(ctx);
      const dur = Math.max(0.15, ctx.impactIn); // ends as the blow lands
      const from = (): Vector3 => {
        const f = ctx.from();
        const dir = ctx.to.clone().sub(f).setY(0).normalize();
        return f.clone().addScaledVector(dir, 0.22).setY(f.y + 1.12);
      };
      const to = hit(ctx);
      const outer = new Mesh(new CylinderGeometry(1, 1, 1, 18, 1, true), additive(c, GLOW.beam * 0.45));
      const inner = new Mesh(new CylinderGeometry(1, 1, 1, 12, 1, true), additive(lin(PALETTE.hot).lerp(c, 0.3), GLOW.beam));
      const g = new Group();
      g.add(outer, inner);
      const place = (): number => {
        const a = from();
        const len = a.distanceTo(to);
        g.position.copy(a).add(to).multiplyScalar(0.5);
        g.lookAt(to);
        g.rotateX(Math.PI / 2); // cylinder axis (y) onto the beam
        g.scale.set(1, len, 1);
        return len;
      };
      const len = place();
      const n = particleCount(80, s, ctx.tier);
      const stream = emit({
        at: from(), lookAt: to, count: 0, rate: n / dur, duration: dur, life: new ConstantValue(len / 9),
        speed: new ConstantValue(9), size: new IntervalValue(0.03, 0.07), color: v4(c, GLOW.beam),
        shape: new ConeEmitter({ radius: 0.03, angle: 0.02 }), mode: RenderMode.StretchedBillBoard, behaviors: [],
      });
      addLive({
        t: 0, duration: dur + 0.18,
        step(_dt, k, t) {
          place();
          stream.emitter.position.copy(from());
          stream.emitter.lookAt(to);
          const grow = Math.min(1, t / 0.08);
          const end = t > dur ? 1 - (t - dur) / 0.18 : 1;
          const w = 0.05 * s * grow * Math.max(0, end) * (1 + 0.15 * Math.sin(t * 55));
          outer.scale.set(w * 2.2, 1, w * 2.2);
          inner.scale.set(w * 0.7, 1, w * 0.7);
          void k;
        },
        dispose() {
          g.removeFromParent();
          outer.geometry.dispose();
          inner.geometry.dispose();
          (outer.material as Material).dispose();
          (inner.material as Material).dispose();
        },
      }, g);
      return n;
    },

    shockwave(s, ctx) {
      // Ground ring racing out from the ram's impact, and a dust skirt.
      const c = aura(ctx);
      const ring = new Mesh(new RingGeometry(0.85, 1, 48), additive(c, GLOW.ring));
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(ctx.to).setY(ctx.to.y + 0.02);
      const n = particleCount(50, s, ctx.tier);
      emit({
        at: ctx.to.clone().setY(ctx.to.y + 0.05), rotateX: -Math.PI / 2, count: n, life: new IntervalValue(0.6, 1.1),
        speed: new IntervalValue(1.2, 2.6), size: new IntervalValue(0.18, 0.32), color: v4(lin(PALETTE.dust), 1, 0.55),
        shape: new CircleEmitter({ radius: 0.25 }), material: dustMat,
        behaviors: [new SizeOverLife(curve(0.5, 1.2, 1.7, 2)), new SpeedOverLife(curve(1, 0.4, 0.15, 0)), fadeOut()],
      });
      addLive({
        t: 0, duration: 0.55,
        step(_dt, k) {
          ring.scale.setScalar(0.2 + 1.6 * s * (1 - (1 - k) ** 2));
          (ring.material as MeshBasicMaterial).opacity = 1 - k;
        },
        dispose() {
          ring.removeFromParent();
          ring.geometry.dispose();
          (ring.material as Material).dispose();
        },
      }, ring as unknown as Mesh);
      return n;
    },

    debris(s, ctx) {
      // Flying stone chunks.
      const n = particleCount(28, s, ctx.tier);
      emit({
        at: ctx.to.clone().setY(ctx.to.y + 0.25), lookAt: ctx.to.clone().setY(ctx.to.y + 5), count: n,
        life: new IntervalValue(0.6, 1.0), speed: new IntervalValue(2.5, 5.5), size: new IntervalValue(0.03, 0.08),
        color: v4(lin(PALETTE.stone), 1), shape: new ConeEmitter({ radius: 0.2, angle: 0.9 }), material: stoneMat, mode: RenderMode.Mesh,
        behaviors: [gravity(12)],
      });
      return n;
    },

    dust(s, ctx) {
      // Kicked-up dust at the attacker's feet; follows it for a moment (the chariot's charge).
      const n = particleCount(36, s, ctx.tier);
      const ps = emit({
        at: ctx.from().clone().setY(ctx.to.y + 0.05), rotateX: -Math.PI / 2, count: 0, rate: n / 0.4, duration: 0.4,
        life: new IntervalValue(0.5, 0.9), speed: new IntervalValue(0.3, 0.9), size: new IntervalValue(0.12, 0.24),
        color: v4(lin(PALETTE.dust), 1, 0.45), shape: new CircleEmitter({ radius: 0.3 }), material: dustMat,
        behaviors: [new SizeOverLife(curve(0.6, 1.2, 1.6, 1.9)), fadeOut()],
      });
      addLive({
        t: 0, duration: 0.4,
        step() {
          ps.emitter.position.copy(ctx.from()).setY(ctx.to.y + 0.05);
        },
        dispose() {},
      });
      return n;
    },

    vortex(s, ctx) {
      // Blade storm around the queen: blades whirl faster and tighter until impact, then fly out.
      const c = aura(ctx);
      const dur = Math.max(0.3, ctx.impactIn);
      const count = Math.max(3, particleCount(12, s, ctx.tier));
      const geo = bladeGeometry();
      const mat = additive(lin(PALETTE.hot).lerp(c, 0.6), GLOW.blade);
      const g = new Group();
      const blades: Mesh[] = [];
      for (let i = 0; i < count; i++) {
        const b = new Mesh(geo, mat);
        b.scale.setScalar(1.15 * Math.sqrt(s));
        blades.push(b);
        g.add(b);
      }
      const n = particleCount(110, s, ctx.tier);
      // Motes sucked from the victim into the storm.
      const suck = emit({
        at: hit(ctx), lookAt: ctx.from().clone().setY(ctx.to.y + CHEST), count: 0, rate: n / dur, duration: dur * 0.95,
        life: new ConstantValue(0.4), speed: new IntervalValue(1.5, 2.6), size: new IntervalValue(0.025, 0.05),
        color: v4(c, GLOW.blade), shape: new ConeEmitter({ radius: 0.25, angle: 0.25 }), mode: RenderMode.StretchedBillBoard,
        behaviors: [new ColorOverLife(fade([[0, 0], [1, 0.3], [1, 0.8], [0, 1]]))],
      });
      let angle = 0;
      const BURST = 0.35;
      addLive({
        t: 0, duration: dur + BURST,
        step(dt, _k, t) {
          const centre = ctx.from();
          g.position.set(centre.x, centre.y, centre.z);
          suck.emitter.lookAt(centre.x, ctx.to.y + CHEST, centre.z);
          if (t < dur) {
            const p = t / dur;
            angle += dt * (6 + 16 * p * p);
            const radius = (0.85 - 0.25 * p) * Math.sqrt(s);
            blades.forEach((b, i) => {
              const a = angle + (i / count) * Math.PI * 2;
              const h = 0.15 + 0.75 * ((i * 0.618) % 1) + 0.08 * Math.sin(t * 9 + i);
              b.position.set(Math.cos(a) * radius, h, -Math.sin(a) * radius);
              b.rotation.set(0.25 * Math.sin(i), a + Math.PI / 2 + 0.5, 0.35);
            });
          } else {
            const q = (t - dur) / BURST;
            blades.forEach((b) => {
              const out = new Vector3(b.position.x, 0, b.position.z).normalize();
              b.position.addScaledVector(out, dt * 7);
              b.scale.setScalar(1.15 * Math.sqrt(s) * (1 - q));
            });
          }
        },
        dispose() {
          g.removeFromParent();
          geo.dispose();
          mat.dispose();
        },
      }, g);
      return n + count;
    },

    burst(s, ctx) {
      // The vortex detonates at the victim: a sphere of blade shards and a ring.
      const c = aura(ctx);
      const n = particleCount(120, s, ctx.tier);
      emit({
        at: hit(ctx), count: n, life: new IntervalValue(0.3, 0.7), speed: new IntervalValue(4, 9), size: new IntervalValue(0.03, 0.06),
        color: v4(lin(PALETTE.hot).lerp(c, 0.6), GLOW.blade), shape: new SphereEmitter({ radius: 0.15 }), mode: RenderMode.StretchedBillBoard,
        behaviors: [new SpeedOverLife(curve(1, 0.5, 0.25, 0.1)), coolTo(c)],
      });
      return n + draw.shockwave(0.7 * s, ctx);
    },

    slash(s, ctx) {
      // The king's finishing stroke: a bright crescent swept diagonally across the victim.
      const c = aura(ctx);
      const geo = new RingGeometry(0.42, 0.5, 40, 1, 0, 0.01);
      const mat = additive(lin(PALETTE.hot).lerp(c, 0.4), GLOW.slash);
      const arc = new Mesh(geo, mat);
      const from = ctx.from();
      const yaw = Math.atan2(ctx.to.x - from.x, ctx.to.z - from.z);
      arc.position.copy(hit(ctx));
      arc.rotation.set(0, yaw, 0);
      arc.rotateZ(-0.7); // diagonal
      arc.scale.setScalar(1.1 * s);
      const SWEEP = 0.12;
      addLive({
        t: 0, duration: 0.42,
        step(_dt, _k, t) {
          const sweep = Math.min(1, t / SWEEP);
          arc.geometry.dispose();
          arc.geometry = new RingGeometry(0.42, 0.5 + 0.04 * (1 - sweep), 40, 1, Math.PI * 0.15, Math.PI * 1.1 * sweep);
          mat.opacity = t < SWEEP ? 1 : 1 - (t - SWEEP) / (0.42 - SWEEP);
        },
        dispose() {
          arc.removeFromParent();
          arc.geometry.dispose();
          mat.dispose();
        },
      }, arc);
      return 1;
    },
  };

  const fire = (kind: DrawnFx, strength: number, ctx: FxContext): number => draw[kind](strength, ctx);

  const fx: StrikeFx = {
    group,
    get active() {
      return live.length > 0 || systems.size > 0 || pending.length > 0 || lightLeft > 0;
    },
    play(cue, ctx) {
      if (cue.kind === 'shake' || cue.kind === 'slowmo') return 0;
      const kind = cue.kind;
      const delay = cue.delay ?? 0;
      if (delay > 0) {
        pending.push({ at: clock + delay, run: () => void fire(kind, cue.strength, { ...ctx, impactIn: Math.max(0, ctx.impactIn - delay) }) });
        return 0;
      }
      return fire(kind, cue.strength, ctx);
    },
    update(dt) {
      clock += dt;
      for (let i = pending.length - 1; i >= 0; i--) {
        if (pending[i]!.at <= clock) pending.splice(i, 1)[0]!.run();
      }
      for (let i = live.length - 1; i >= 0; i--) {
        const l = live[i]!;
        l.t = Math.min(l.duration, l.t + dt);
        l.step(dt, l.duration > 0 ? l.t / l.duration : 1, l.t);
        if (l.t >= l.duration) {
          l.dispose();
          live.splice(i, 1);
        }
      }
      if (lightLeft > 0) {
        lightLeft = Math.max(0, lightLeft - dt);
        light.intensity = lightPeak * (lightLeft / lightTotal) ** 2;
      } else light.intensity = 0;
      batch.update(dt);
    },
    clear() {
      pending.length = 0;
      for (const l of live) l.dispose();
      live.length = 0;
      for (const ps of [...systems]) ps.dispose();
      systems.clear();
      lightLeft = 0;
      light.intensity = 0;
    },
  };
  return fx;
}
