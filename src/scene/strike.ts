// Per-piece strike manifest. The choreographer reads a StrikeProfile and nothing else about the
// piece: adding a piece style (or a rigged model) means adding a row here, not a branch in code.
// The fx layer (src/fx) reads `fx` and the animator reads `motion`; neither is known to choreo.
import type { PieceType } from '../game';

/**
 * Effect cue kinds. 'shake' goes to the camera rig and 'slowmo' to the app clock; the rest are
 * particles/meshes drawn by the fx layer.
 */
export type FxKind =
  | 'shake' | 'slowmo'
  | 'orb' | 'beam' | 'flash' | 'embers' | 'sparks' | 'shockwave' | 'debris' | 'dust' | 'vortex' | 'burst' | 'slash';

export interface FxCue {
  readonly kind: FxKind;
  /** 'strike' = when the attack clip starts (charge-up), 'impact' = when the blow lands. */
  readonly at: 'strike' | 'impact';
  /** 0..1(+), scaled further by the quality tier in the fx layer. */
  readonly strength: number;
  /** Seconds after `at` before the cue starts (handled by the fx layer, not the choreographer). */
  readonly delay?: number;
}

/** Attack body motion, interpreted by the animator. */
export type StrikeMotion = 'lunge' | 'ram' | 'cast' | 'spin' | 'slash' | 'slam';

export interface StrikeProfile {
  readonly approach: {
    /** Seconds per square of travel, clamped by the choreographer. */
    readonly secondsPerSquare: number;
    /** Arc height for hops (0 = glide). Used for quiet moves too. */
    readonly hop: number;
    /** How far short of the victim the attacker stops before striking (squares). */
    readonly stopShort: number;
  };
  /** Attack clip length (wind-up + lunge + recoil), seconds. */
  readonly strike: number;
  /** Fraction of `strike` at which the blow lands and the victim shatters. */
  readonly impactAt: number;
  readonly motion: StrikeMotion;
  /** The blow lands this far short of the victim's centre (squares), so the attacker never passes through it. */
  readonly contact: number;
  /** Victim is drawn this many squares toward the attacker during the charge-up (0 = stays put). */
  readonly pull: number;
  readonly fx: readonly FxCue[];
}

const glide = (secondsPerSquare: number, stopShort = 0.55) => ({ secondsPerSquare, hop: 0, stopShort });

// Camera shake only for the rook's hammer slam and the queen's blade storm (blueprint invariant 4).
export const STRIKE_PROFILES: Readonly<Record<PieceType, StrikeProfile>> = {
  pawn: {
    approach: glide(0.45), strike: 1.5, impactAt: 0.6, motion: 'lunge', contact: 0.34, pull: 0,
    fx: [{ kind: 'sparks', at: 'impact', strength: 0.8 }, { kind: 'flash', at: 'impact', strength: 0.35 }],
  },
  knight: {
    approach: { secondsPerSquare: 0.32, hop: 0.85, stopShort: 0.75 },
    strike: 1.5, impactAt: 0.6, motion: 'lunge', contact: 0.5, pull: 0,
    fx: [{ kind: 'sparks', at: 'impact', strength: 1 }, { kind: 'flash', at: 'impact', strength: 0.5 }, { kind: 'dust', at: 'impact', strength: 0.5 }],
  },
  bishop: {
    approach: glide(0.18, 1.4), strike: 1.7, impactAt: 0.68, motion: 'cast', contact: 1.4, pull: 0,
    fx: [
      { kind: 'orb', at: 'strike', strength: 1 },
      { kind: 'beam', at: 'strike', strength: 1, delay: 0.55 },
      { kind: 'flash', at: 'impact', strength: 1 },
      { kind: 'embers', at: 'impact', strength: 1 },
    ],
  },
  // Armoured hammer knight: wind-up, leap (the take-off kicks dust), slam down on the victim.
  rook: {
    approach: glide(0.2, 1.1), strike: 1.6, impactAt: 0.6, motion: 'slam', contact: 0.45, pull: 0,
    fx: [
      { kind: 'dust', at: 'strike', strength: 0.5, delay: 0.46 },
      { kind: 'shockwave', at: 'impact', strength: 1 },
      { kind: 'debris', at: 'impact', strength: 1 },
      { kind: 'sparks', at: 'impact', strength: 0.7 },
      { kind: 'flash', at: 'impact', strength: 0.6 },
      { kind: 'shake', at: 'impact', strength: 1 },
    ],
  },
  queen: {
    approach: glide(0.16, 1.0), strike: 1.8, impactAt: 0.65, motion: 'spin', contact: 0.6, pull: 0.4,
    fx: [
      { kind: 'vortex', at: 'strike', strength: 1.3 },
      { kind: 'burst', at: 'impact', strength: 1 },
      { kind: 'flash', at: 'impact', strength: 0.9 },
      { kind: 'shake', at: 'impact', strength: 0.9 },
    ],
  },
  king: {
    approach: glide(0.5), strike: 1.5, impactAt: 0.6, motion: 'slash', contact: 0.4, pull: 0,
    fx: [
      { kind: 'slash', at: 'strike', strength: 1, delay: 0.78 },
      { kind: 'flash', at: 'impact', strength: 1.2 },
      { kind: 'sparks', at: 'impact', strength: 0.8 },
      { kind: 'slowmo', at: 'impact', strength: 1 },
    ],
  },
};
