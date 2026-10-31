// Per-move choreography statechart. Pure: no three, no DOM; time comes in through tick(dt).
//
//   quiet:   idle --begin--> approach -------------------------> settle --> idle
//   capture: idle --begin--> approach --> strike --> shatter --> settle --> idle
//   mate:                                                        settle --> kingFall --> idle
//   approach | strike | shatter --cancel()--> cancelled --> idle   (never via settle; FEN untouched)
//   settle | kingFall --cancel()--> idle                          (already committed; animation stops, state kept)
//
// Cancel rules:
// - Before settle (approach | strike | shatter) the move is not in the state yet: cancel goes through
//   `cancelled`, the stage clears debris and fx, restores the victim and sends attacker (and rook) home.
// - In settle | kingFall the move is already committed: cancel only stops the animation and returns
//   to idle; there is no `cancelled` phase and no second commit. Taking the move back is the app's
//   history undo (pop the previous GameState), never the choreographer.
// - The capture close-up belongs to the move: it ends (closeUpEnd, camera flies back to its pre-zoom
//   pose) on entering settle or on cancel, at most once per close-up. Cancel returns synchronously and
//   never waits for the camera, so undo is never locked.
//
// Invariants: host.commit() runs exactly once per completed move, on entering settle; the stage
// only moves meshes; begin() is refused unless idle, cancel() is always accepted. Special-move
// data (capture square, castling rook, promotion) arrives in the plan from the engine.
import type { Promotion, Square } from '../game';
import type { FxCue, StrikeProfile } from './strike';

export type Phase = 'idle' | 'approach' | 'strike' | 'shatter' | 'settle' | 'kingFall' | 'cancelled';

export interface PieceMove {
  readonly id: string;
  readonly from: Square;
  readonly to: Square;
}

export interface MovePlan<S> {
  readonly mover: PieceMove;
  readonly profile: StrikeProfile;
  /** Victim and the square it actually stands on (differs from mover.to for en passant). */
  readonly capture: { readonly id: string; readonly square: Square } | null;
  /** Pieces that move alongside (the castling rook). */
  readonly companions: readonly PieceMove[];
  /** Promotion: the mover's mesh is swapped for this type when the state is committed. */
  readonly promotion: Promotion | null;
  /** Losing king when the move mates. */
  readonly mate: { readonly kingId: string } | null;
  /** The state to commit at settle. */
  readonly next: S;
}

/** Mesh-side operations. Implemented over a PieceAnimator in the app, by a fake in tests. */
export interface ChoreoStage {
  move(p: PieceMove, opts: { readonly duration: number; readonly hop: number; readonly stopShort: number }): void;
  attack(id: string, to: Square, duration: number): void;
  shatter(id: string, duration: number): void;
  fall(id: string, duration: number): void;
  /** Abort and restore every touched mesh to its start pose. */
  cancel(): void;
  /** State was committed; placement belongs to sync() again. */
  release(): void;
}

export interface ChoreoHost<S> {
  readonly stage: ChoreoStage;
  /** The single game-state mutation per move. */
  commit(next: S): void;
  /** Visual toggles, re-read each time they matter (both false at quality tier off). */
  toggles(): { readonly shake: boolean; readonly closeUp: boolean };
  /** Fire a profile fx cue; `moverId` lets the app start it at the attacker's live position. */
  effect(cue: FxCue, moverId: string, at: Square): void;
  closeUp(at: Square): void;
  closeUpEnd(): void;
  onPhase?(next: Phase, prev: Phase): void;
  onIdle?(reason: 'settled' | 'cancelled'): void;
}

export const TIMING = {
  minMove: 0.32,
  maxMove: 0.95,
  shatter: 0.6,
  settle: 0.14,
  kingFall: 1.2,
} as const;

const squareDist = (a: Square, b: Square): number =>
  Math.hypot(a.charCodeAt(0) - b.charCodeAt(0), a.charCodeAt(1) - b.charCodeAt(1));

export function travelTime(profile: StrikeProfile, from: Square, to: Square, stopShort = 0): number {
  const d = Math.max(0, squareDist(from, to) - stopShort);
  return Math.min(TIMING.maxMove, Math.max(TIMING.minMove, 0.15 + d * profile.approach.secondsPerSquare));
}

export interface Choreographer<S> {
  readonly phase: Phase;
  /** New move selection is locked unless idle. Undo/cancel are never locked. */
  readonly inputLocked: boolean;
  /** True while meshes move (per-frame shadow updates). */
  readonly animating: boolean;
  /** How many times commit() has run (for tests and the HUD). */
  readonly commits: number;
  begin(plan: MovePlan<S>): boolean;
  tick(dt: number): void;
  /** Abort the current move. Returns false if already idle. */
  cancel(): boolean;
}

export function createChoreographer<S>(host: ChoreoHost<S>): Choreographer<S> {
  let phase: Phase = 'idle';
  let plan: MovePlan<S> | null = null;
  let left = 0; // seconds remaining in the timed phase
  let committed = false;
  let commits = 0;
  let closeUp = false;

  const go = (next: Phase, duration = 0): void => {
    const prev = phase;
    phase = next;
    left = duration;
    host.onPhase?.(next, prev);
  };

  const cues = (at: 'strike' | 'impact'): void => {
    if (!plan) return;
    for (const cue of plan.profile.fx) {
      if (cue.at !== at) continue;
      if (cue.kind === 'shake' && !host.toggles().shake) continue;
      host.effect(cue, plan.mover.id, plan.capture?.square ?? plan.mover.to);
    }
  };

  const endCloseUp = (): void => {
    if (closeUp) host.closeUpEnd();
    closeUp = false;
  };

  const toIdle = (reason: 'settled' | 'cancelled'): void => {
    plan = null;
    go('idle');
    host.onIdle?.(reason);
  };

  /** Leave the current phase (its timer ran out). */
  const advance = (): void => {
    const p = plan!;
    const prof = p.profile;
    switch (phase) {
      case 'approach':
        if (!p.capture) return enterSettle();
        go('strike', prof.strike * prof.impactAt);
        host.stage.attack(p.mover.id, p.mover.to, prof.strike);
        cues('strike');
        return;
      case 'strike':
        go('shatter', Math.max(TIMING.shatter, prof.strike * (1 - prof.impactAt)));
        host.stage.shatter(p.capture!.id, TIMING.shatter);
        cues('impact');
        return;
      case 'shatter':
        return enterSettle();
      case 'settle':
        if (p.mate) {
          go('kingFall', TIMING.kingFall);
          host.stage.fall(p.mate.kingId, TIMING.kingFall);
          return;
        }
        return toIdle('settled');
      case 'kingFall':
        return toIdle('settled');
      default:
        return;
    }
  };

  const enterSettle = (): void => {
    const p = plan!;
    go('settle', TIMING.settle);
    endCloseUp();
    if (!committed) {
      committed = true;
      commits += 1;
      host.stage.release();
      host.commit(p.next);
    }
  };

  return {
    get phase() {
      return phase;
    },
    get inputLocked() {
      return phase !== 'idle';
    },
    get animating() {
      return phase !== 'idle' && phase !== 'cancelled';
    },
    get commits() {
      return commits;
    },
    begin(next) {
      if (phase !== 'idle') return false;
      plan = next;
      committed = false;
      const a = next.profile.approach;
      if (next.capture) {
        const stop = Math.min(a.stopShort, squareDist(next.mover.from, next.mover.to) - 0.35);
        go('approach', travelTime(next.profile, next.mover.from, next.mover.to, stop));
        if (host.toggles().closeUp) {
          closeUp = true;
          host.closeUp(next.mover.to);
        }
        host.stage.move(next.mover, { duration: left, hop: a.hop, stopShort: Math.max(0, stop) });
      } else {
        go('approach', travelTime(next.profile, next.mover.from, next.mover.to));
        host.stage.move(next.mover, { duration: left, hop: a.hop, stopShort: 0 });
      }
      for (const c of next.companions) host.stage.move(c, { duration: left, hop: 0, stopShort: 0 });
      return true;
    },
    tick(dt) {
      let budget = dt;
      // Several phases may end inside one large dt; carry the remainder forward.
      while (plan && phase !== 'idle' && budget >= left) {
        budget -= left;
        left = 0;
        advance();
      }
      if (plan && phase !== 'idle') left -= budget;
    },
    cancel() {
      if (phase === 'idle') return false;
      endCloseUp();
      if (committed) {
        // settle / kingFall: the move is already in the state; stop animating, keep it.
        host.stage.release();
        toIdle('cancelled');
        return true;
      }
      go('cancelled');
      host.stage.cancel(); // debris gone, victim visible on its square, attacker (and rook) home
      toIdle('cancelled');
      return true;
    },
  };
}
