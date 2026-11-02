import { Mesh, Object3D, Scene, Vector3, type Material } from 'three';
import { describe, expect, it } from 'vitest';
import { STRIKE_PROFILES } from '../scene/strike';
import { AURA, PALETTE } from './budget';
import { createStrikeFx, type FxContext } from './strike-fx';

const ctx = (over: Partial<FxContext> = {}): FxContext => ({
  from: () => new Vector3(0, 0, 2),
  to: new Vector3(0, 0, 0),
  side: 'white',
  tier: 'high',
  impactIn: 0.9,
  ...over,
});

const setup = () => {
  const scene = new Scene();
  const fx = createStrikeFx();
  scene.add(fx.group);
  return { scene, fx };
};

const run = (fx: { update(dt: number): void }, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 30) fx.update(1 / 30);
};

describe('strike fx (three.quarks)', () => {
  it('plays every cue of every strike profile and cleans up afterwards', () => {
    const { fx } = setup();
    const base = fx.group.children.length;
    for (const [piece, prof] of Object.entries(STRIKE_PROFILES)) {
      for (const cue of prof.fx) fx.play(cue, ctx());
      run(fx, 0.3);
      expect(fx.active, piece).toBe(true);
      run(fx, 4);
      expect(fx.active, piece).toBe(false);
      expect(fx.group.children.length, piece).toBe(base);
    }
  });

  it('scales particle budgets with the tier', () => {
    const { fx } = setup();
    for (const kind of ['sparks', 'embers', 'burst', 'debris'] as const) {
      const high = fx.play({ kind, at: 'impact', strength: 1 }, ctx({ tier: 'high' }));
      const low = fx.play({ kind, at: 'impact', strength: 1 }, ctx({ tier: 'low' }));
      const off = fx.play({ kind, at: 'impact', strength: 1 }, ctx({ tier: 'off' }));
      expect(low / high).toBeCloseTo(0.5, 1);
      expect(off / high).toBeCloseTo(0.2, 1);
    }
    fx.clear();
    expect(fx.active).toBe(false);
  });

  it('holds delayed cues until their time', () => {
    const { fx } = setup();
    const before = fx.group.children.length;
    fx.play({ kind: 'beam', at: 'strike', strength: 1, delay: 0.5 }, ctx());
    run(fx, 0.4);
    expect(fx.group.children.length).toBe(before);
    run(fx, 0.2);
    expect(fx.group.children.length).toBeGreaterThan(before);
  });

  it('glows in the striker colour: gold for white, crimson for black', () => {
    const colours = (side: 'white' | 'black') => {
      const { fx } = setup();
      fx.play({ kind: 'beam', at: 'strike', strength: 1 }, ctx({ side }));
      run(fx, 0.1);
      const out: string[] = [];
      fx.group.traverse((o: Object3D) => {
        if (o instanceof Mesh && !Array.isArray(o.material)) {
          const m = o.material as Material & { color?: { clone(): { multiplyScalar(n: number): { getHexString(): string } } } };
          if (m.color) out.push(m.color.clone().multiplyScalar(1 / 7).getHexString());
        }
      });
      return out;
    };
    const gold = colours('white');
    const red = colours('black');
    expect(gold.length).toBeGreaterThan(0);
    expect(gold).not.toEqual(red);
    expect(AURA.white).not.toBe(AURA.black);
    expect(Object.values(PALETTE)).toContain(AURA.white);
  });

  it('ignores shake and slowmo (owned by camera and clock)', () => {
    const { fx } = setup();
    expect(fx.play({ kind: 'shake', at: 'impact', strength: 1 }, ctx())).toBe(0);
    expect(fx.play({ kind: 'slowmo', at: 'impact', strength: 1 }, ctx())).toBe(0);
    expect(fx.active).toBe(false);
  });
});
