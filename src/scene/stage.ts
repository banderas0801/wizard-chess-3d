// ChoreoStage over the procedural PieceAnimator + strike fx: the only bridge from choreography
// phases to meshes. Kept out of main.ts so tests can drive the real animator with a fake clock.
import { Vector3, type Object3D } from 'three';
import type { Square } from '../game';
import type { PieceAnimator } from './anim';
import type { ChoreoStage } from './choreo';
import { SQUARE_SIZE, squareToWorld } from './board';

export interface StageDeps {
  readonly animator: PieceAnimator;
  /** Live mesh for a piece id. */
  readonly get: (id: string) => Object3D | undefined;
  /** Strike fx layer (only clear() matters here; cues are fired by the host). */
  readonly fx: { clear(): void };
}

const world = (sq: Square): Vector3 => squareToWorld(sq, new Vector3());

export function createAnimatorStage({ animator, get, fx }: StageDeps): ChoreoStage {
  return {
    move(p, o) {
      const obj = get(p.id);
      if (!obj) return;
      // Travel along to - from; stop short of the victim by `stopShort` squares on that vector.
      const from = world(p.from);
      const to = world(p.to);
      if (o.stopShort > 0) to.addScaledVector(to.clone().sub(from).normalize(), -o.stopShort * SQUARE_SIZE);
      animator.play(obj, 'move', { to, duration: o.duration, hop: o.hop });
    },
    attack(id, to, o) {
      const obj = get(id);
      if (obj) animator.play(obj, 'attack', { to: world(to), duration: o.duration, motion: o.motion, contact: o.contact * SQUARE_SIZE });
    },
    pull(victimId, attackerId, distance, duration) {
      const victim = get(victimId);
      const attacker = get(attackerId);
      if (!victim || !attacker) return;
      const to = victim.position.clone();
      const dir = attacker.position.clone().sub(to).setY(0);
      if (dir.lengthSq() < 1e-9) return;
      animator.drag(victim, to.addScaledVector(dir.normalize(), distance * SQUARE_SIZE), duration);
    },
    shatter(id, duration) {
      const obj = get(id);
      if (obj) animator.play(obj, 'shatter', { duration });
    },
    fall(id, duration) {
      const obj = get(id);
      if (obj) animator.fall(obj, duration);
    },
    cancel() {
      animator.cancel(); // drops debris, restores every touched mesh (victim visible again)
      fx.clear();
    },
    release() {
      animator.release();
    },
  };
}
