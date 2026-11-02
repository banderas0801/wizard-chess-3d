// Blueprint invariant 4 (profile half): the 0.3 s camera shake belongs to the rook's hammer slam and the
// queen's blade vortex only. The other half (never in Zen or at tier off) is in src/fx/budget.test.ts.
import { describe, expect, it } from 'vitest';
import type { PieceType } from '../game';
import { STRIKE_PROFILES } from './strike';

const TYPES = Object.keys(STRIKE_PROFILES) as PieceType[];

describe('strike profiles', () => {
  it('only the rook slam and the queen vortex shake the camera', () => {
    const shakers = TYPES.filter((t) => STRIKE_PROFILES[t].fx.some((c) => c.kind === 'shake'));
    expect(shakers.sort()).toEqual(['queen', 'rook']);
    expect(STRIKE_PROFILES.rook.motion).toBe('slam');
    expect(STRIKE_PROFILES.rook.fx.map((c) => c.kind)).toEqual(expect.arrayContaining(['shockwave', 'debris']));
    expect(STRIKE_PROFILES.queen.fx.some((c) => c.kind === 'vortex')).toBe(true);
  });

  it('gives every piece its own strike', () => {
    const sig = TYPES.map((t) => `${STRIKE_PROFILES[t].motion}:${STRIKE_PROFILES[t].fx.map((c) => c.kind).join(',')}`);
    expect(new Set(sig).size).toBe(TYPES.length);
  });

  it('lands the blow before the attacker reaches the victim (contact within the approach gap)', () => {
    for (const t of TYPES) {
      const p = STRIKE_PROFILES[t];
      expect(p.contact).toBeGreaterThan(0);
      expect(p.contact).toBeLessThanOrEqual(p.approach.stopShort + 1e-9);
      expect(p.impactAt).toBeGreaterThan(0.5);
      expect(p.impactAt).toBeLessThan(0.82); // the animator's step-in (ATTACK_ENTER) comes after impact
    }
  });

  it('pulls the victim only for the queen, and less than the gap between them', () => {
    for (const t of TYPES) {
      const p = STRIKE_PROFILES[t];
      if (t === 'queen') expect(p.pull).toBeGreaterThan(0);
      else expect(p.pull).toBe(0);
      expect(p.pull).toBeLessThan(p.approach.stopShort);
    }
  });
});
