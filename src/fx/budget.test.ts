import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import type { QualityTier } from '../render/quality';
import { AURA, PALETTE, PARTICLE_SCALE, SHAKE_SCALE, particleCount, shakeAllowed } from './budget';

const QUALITY_TIERS: readonly QualityTier[] = ['off', 'low', 'high'];

describe('fx budget', () => {
  it('scales particle counts by tier: high 1, low 0.5, off 0.2', () => {
    expect(PARTICLE_SCALE).toEqual({ high: 1, low: 0.5, off: 0.2 });
    expect(particleCount(100, 1, 'high')).toBe(100);
    expect(particleCount(100, 1, 'low')).toBe(50);
    expect(particleCount(100, 1, 'off')).toBe(20);
    expect(particleCount(1, 0.1, 'off')).toBeGreaterThan(0);
  });

  // Invariant 4 (zen/tier half; the "only rook and queen shake" half is in scene/strike.test.ts).
  it('never shakes in Zen mode or at tier off', () => {
    for (const tier of QUALITY_TIERS) {
      expect(shakeAllowed({ shake: true, zen: true }, tier)).toBe(false);
      expect(shakeAllowed({ shake: false, zen: false }, tier)).toBe(false);
    }
    expect(shakeAllowed({ shake: true, zen: false }, 'off')).toBe(false);
    expect(SHAKE_SCALE.off).toBe(0);
    expect(shakeAllowed({ shake: true, zen: false }, 'high')).toBe(true);
    expect(shakeAllowed({ shake: true, zen: false }, 'low')).toBe(true);
  });

  it('glows gold for white and crimson for black', () => {
    expect(AURA).toEqual({ white: '#F59E0B', black: '#DC2626' });
  });

  it('has no purple anywhere in the palette', () => {
    for (const [name, hex] of Object.entries(PALETTE)) {
      const hsl = { h: 0, s: 0, l: 0 };
      new Color(hex).getHSL(hsl);
      const hue = hsl.h * 360;
      expect(hue >= 250 && hue <= 330 && hsl.s > 0.15, `${name} ${hex} hue ${hue.toFixed(0)}`).toBe(false);
    }
  });
});
