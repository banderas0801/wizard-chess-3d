// Capture close-up lifetime: the zoom belongs to the move. It ends with the move, whether the move
// settles or is cancelled, the camera flies back to its pre-zoom pose, and nothing waits on it.
import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { createCameraRig, PRESETS } from '../render/camera';
import { fromFen, parseUci, toFen, type GameState } from '../game';
import { squareToWorld } from './board';
import { createChoreographer, type ChoreoStage, type Phase } from './choreo';
import { planMove } from './plan';

const DT = 1 / 60;
const CAPTURE_FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4';

// camera-controls allocates a DOMRect at construction; node has none.
(globalThis as { DOMRect?: unknown }).DOMRect ??= class {
  constructor(public x = 0, public y = 0, public width = 0, public height = 0) {}
};

/** Just enough of an HTMLElement for camera-controls in a node test. */
function fakeDom(): HTMLElement {
  const noop = (): void => {};
  const doc = { addEventListener: noop, removeEventListener: noop, pointerLockElement: null, exitPointerLock: noop };
  return {
    addEventListener: noop,
    removeEventListener: noop,
    removeAttribute: noop,
    setAttribute: noop,
    getAttribute: () => null,
    requestPointerLock: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 }),
    style: {},
    ownerDocument: doc,
  } as unknown as HTMLElement;
}

const stage: ChoreoStage = { move() {}, attack() {}, pull() {}, shatter() {}, fall() {}, cancel() {}, release() {} };

function setup() {
  const camera = new PerspectiveCamera(38, 4 / 3, 0.1, 120);
  const rig = createCameraRig(camera, fakeDom(), [], 'player');
  let game: GameState = fromFen(CAPTURE_FEN);
  const fens = [toFen(game)];
  const calls: string[] = [];
  const choreo = createChoreographer<GameState>({
    stage,
    commit(next) {
      game = next;
      fens.push(toFen(next));
    },
    toggles: () => ({ shake: false, closeUp: true }),
    effect() {},
    closeUp(sq) {
      calls.push('closeUp');
      void rig.focus(squareToWorld(sq, new Vector3()));
    },
    closeUpEnd() {
      calls.push('closeUpEnd');
      void rig.unfocus();
    },
  });
  const pose = () => ({ pos: rig.controls.getPosition(new Vector3()), target: rig.controls.getTarget(new Vector3()) });
  const step = (): void => {
    choreo.tick(DT);
    rig.update(DT);
  };
  const frames = (seconds: number): void => {
    for (let t = 0; t < seconds; t += DT) step();
  };
  const until = (p: Phase): void => {
    for (let i = 0; i < 600 && choreo.phase !== p; i++) step();
    expect(choreo.phase).toBe(p);
  };
  const play = (uci: string): boolean => choreo.begin(planMove(game, parseUci(uci)!)!);
  return { rig, choreo, calls, fens, pose, frames, until, play };
}

const home = new Vector3(...PRESETS.player.pos);

describe('capture close-up is cancelled with the move', () => {
  it.each(['approach', 'strike', 'shatter'] as const)('cancel in %s: zoom ends once, camera returns to its pre-zoom pose', (at) => {
    const s = setup();
    s.frames(0.5); // camera at rest on the player preset
    const before = s.pose();
    expect(before.pos.distanceTo(home)).toBeLessThan(1e-3);

    expect(s.play('c4f7')).toBe(true);
    s.until(at);
    s.frames(0.05);
    expect(s.calls).toEqual(['closeUp']);
    expect(s.pose().pos.distanceTo(before.pos)).toBeGreaterThan(1); // actually zoomed in

    expect(s.choreo.cancel()).toBe(true);
    expect(s.calls).toEqual(['closeUp', 'closeUpEnd']);
    // Undo is never locked: the choreographer is idle the same instant, while the camera still flies.
    expect(s.choreo.phase).toBe('idle');
    expect(s.choreo.inputLocked).toBe(false);
    expect(s.play('f3f7')).toBe(true); // a new move can start immediately
    s.choreo.cancel();
    expect(s.calls.filter((c) => c === 'closeUpEnd').length).toBe(2); // one end per close-up, never more

    s.frames(3);
    const after = s.pose();
    expect(after.pos.distanceTo(before.pos)).toBeLessThan(1e-2);
    expect(after.target.distanceTo(before.target)).toBeLessThan(1e-2);
    expect(s.fens).toEqual([CAPTURE_FEN]);
  });

  it('a settled capture also hands the camera back, exactly once, before the commit lands', () => {
    const s = setup();
    s.frames(0.5);
    const before = s.pose();
    s.play('c4f7');
    s.until('settle');
    expect(s.calls).toEqual(['closeUp', 'closeUpEnd']);
    s.choreo.cancel(); // cancel in settle: already committed, no second closeUpEnd
    expect(s.calls).toEqual(['closeUp', 'closeUpEnd']);
    s.frames(3);
    expect(s.pose().pos.distanceTo(before.pos)).toBeLessThan(1e-2);
    expect(s.fens.length).toBe(2);
  });

  it('unfocus without a focus is a no-op (undo when idle does not move the camera)', async () => {
    const s = setup();
    s.frames(0.5);
    const before = s.pose();
    await s.rig.unfocus();
    s.frames(1);
    expect(s.pose().pos.distanceTo(before.pos)).toBeLessThan(1e-6);
  });
});
