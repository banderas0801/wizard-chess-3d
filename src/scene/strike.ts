// Per-piece strike manifest. The choreographer reads a StrikeProfile and nothing else about the
// piece: adding a piece style (or a rigged model) means adding a row here, not a branch in code.
import type { PieceType } from '../game';

export type FxKind = 'shake' | 'vortex' | 'beam' | 'sparks';

export interface FxCue {
  readonly kind: FxKind;
  /** 'strike' = when the attack clip starts (charge-up), 'impact' = when the blow lands. */
  readonly at: 'strike' | 'impact';
  /** 0..1, scaled further by the quality tier in the fx layer. */
  readonly strength: number;
}

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
  readonly fx: readonly FxCue[];
}

const glide = (secondsPerSquare: number, stopShort = 0.55) => ({ secondsPerSquare, hop: 0, stopShort });

export const STRIKE_PROFILES: Readonly<Record<PieceType, StrikeProfile>> = {
  pawn: { approach: glide(0.45), strike: 1.5, impactAt: 0.6, fx: [{ kind: 'sparks', at: 'impact', strength: 0.4 }] },
  knight: {
    approach: { secondsPerSquare: 0.32, hop: 0.85, stopShort: 0.6 },
    strike: 1.5, impactAt: 0.6, fx: [{ kind: 'sparks', at: 'impact', strength: 0.6 }, { kind: 'shake', at: 'impact', strength: 0.3 }],
  },
  bishop: { approach: glide(0.18, 1.4), strike: 1.7, impactAt: 0.68, fx: [{ kind: 'beam', at: 'strike', strength: 1 }] },
  rook: { approach: glide(0.16), strike: 1.5, impactAt: 0.6, fx: [{ kind: 'shake', at: 'impact', strength: 1 }, { kind: 'sparks', at: 'impact', strength: 0.8 }] },
  queen: { approach: glide(0.16, 0.8), strike: 1.8, impactAt: 0.65, fx: [{ kind: 'vortex', at: 'strike', strength: 1 }, { kind: 'shake', at: 'impact', strength: 0.5 }] },
  king: { approach: glide(0.5), strike: 1.5, impactAt: 0.6, fx: [{ kind: 'sparks', at: 'impact', strength: 1 }, { kind: 'shake', at: 'impact', strength: 0.6 }] },
};
