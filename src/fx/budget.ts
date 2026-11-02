// Fx budget and palette: plain numbers, no three. The particle layer (./strike-fx) and the app
// both read these, and the invariants (tier scaling, shake gating, no purple) are tested here.
import type { QualityTier } from '../render/quality';

/** Particle budget multiplier per tier (off still shows a hint of the effect). */
export const PARTICLE_SCALE: Readonly<Record<QualityTier, number>> = { high: 1, low: 0.5, off: 0.2 };
/** Camera shake multiplier per tier; 0 at off means no shake at all. */
export const SHAKE_SCALE: Readonly<Record<QualityTier, number>> = { high: 1, low: 0.7, off: 0 };

export const particleCount = (base: number, strength: number, tier: QualityTier): number =>
  Math.max(2, Math.round(base * strength * PARTICLE_SCALE[tier]));

/**
 * Blueprint invariant 4: the 0.3 s shake never runs in Zen mode or at tier off, whatever the
 * shake toggle says. (Which strikes carry a shake cue at all is fixed in scene/strike.ts.)
 */
export const shakeAllowed = (t: { readonly shake: boolean; readonly zen: boolean }, tier: QualityTier): boolean =>
  t.shake && !t.zen && tier !== 'off';

export type Side = 'white' | 'black';

/** Glow colour of the side that strikes: gold for white, crimson for black. */
export const AURA: Readonly<Record<Side, string>> = { white: '#F59E0B', black: '#DC2626' };

/** Every colour the fx layer may draw with. No purple anywhere (tested). */
export const PALETTE = {
  ...AURA,
  /** White-hot core of flashes and sparks. */
  hot: '#FFF1C9',
  /** Glowing metal sparks cool toward this. */
  ember: '#FF7A1A',
  /** Stone dust and debris. */
  dust: '#8A7B68',
  stone: '#5B524A',
} as const;

/** Linear HDR multiplier per element: the bloom pass only picks up values above its threshold (4). */
export const GLOW = { flash: 9, beam: 7, orb: 8, blade: 6, slash: 9, spark: 7, ember: 5, ring: 5 } as const;
