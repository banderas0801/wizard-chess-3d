import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { clipDistance, createCameraRig, LIMITS, PRESETS, type Cylinder } from './camera';

const col: Cylinder = { x: 0, z: 10, radius: 1, yMin: -1, yMax: 10 };

describe('camera anti-clip (declared cylinders, analytic)', () => {
  it('returns the full length when the segment is clear', () => {
    expect(clipDistance(new Vector3(), new Vector3(1, 0, 0), 15, [col], 0)).toBe(15);
  });
  it('stops short of a column in the way, minus the margin', () => {
    const d = clipDistance(new Vector3(), new Vector3(0, 0, 1), 15, [col], 0.5);
    expect(d).toBeCloseTo(10 - 1.5, 6);
  });
  it('ignores columns the ray passes over', () => {
    const dir = new Vector3(0, 2, 1).normalize();
    expect(clipDistance(new Vector3(), dir, 20, [col], 0)).toBe(20);
  });
  it('ignores columns behind the camera segment', () => {
    expect(clipDistance(new Vector3(), new Vector3(0, 0, 1), 5, [col], 0)).toBe(5);
  });
});

describe('presets respect the clamps', () => {
  for (const [name, p] of Object.entries(PRESETS)) {
    it(name, () => {
      const off = new Vector3(...p.pos).sub(new Vector3(...p.target));
      const polar = Math.acos(off.y / off.length());
      expect(off.length()).toBeGreaterThanOrEqual(LIMITS.minDistance);
      expect(off.length()).toBeLessThanOrEqual(LIMITS.maxDistance);
      expect(polar).toBeGreaterThanOrEqual(LIMITS.minPolar);
      expect(polar).toBeLessThanOrEqual(LIMITS.maxPolar);
    });
  }
});

// camera-controls allocates a DOMRect at construction; node has none.
(globalThis as { DOMRect?: unknown }).DOMRect ??= class {
  constructor(public x = 0, public y = 0, public width = 0, public height = 0) {}
};
function fakeDom(): HTMLElement {
  const noop = (): void => {};
  const doc = { addEventListener: noop, removeEventListener: noop, pointerLockElement: null, exitPointerLock: noop };
  return {
    addEventListener: noop, removeEventListener: noop, removeAttribute: noop, setAttribute: noop,
    getAttribute: () => null, requestPointerLock: noop, style: {}, ownerDocument: doc,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 }),
  } as unknown as HTMLElement;
}

describe('camera rig flights and shake', () => {
  const DT = 1 / 60;
  const setup = () => {
    const camera = new PerspectiveCamera(38, 4 / 3, 0.1, 120);
    const rig = createCameraRig(camera, fakeDom(), [], 'player');
    for (let i = 0; i < 30; i++) rig.update(DT);
    return { camera, rig };
  };

  it('an eased preset flight moves the camera gradually, never snapping to the end pose', () => {
    const { camera, rig } = setup();
    const start = camera.position.clone();
    const end = new Vector3(...PRESETS.overhead.pos);
    void rig.flyTo('overhead', 900);
    rig.update(DT);
    const first = camera.position.distanceTo(start);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.5 * start.distanceTo(end)); // one frame covers only a little of the way
    for (let i = 0; i < 180; i++) rig.update(DT);
    expect(camera.position.distanceTo(end)).toBeLessThan(0.05);
  });

  it('shake offsets the camera for ~0.3 s, and does nothing when disabled (Zen)', () => {
    const { camera, rig } = setup();
    const rest = camera.position.clone();
    rig.shake(0.2);
    rig.update(DT);
    expect(camera.position.distanceTo(rest)).toBeGreaterThan(1e-4);
    for (let i = 0; i < 20; i++) rig.update(DT); // > 0.3 s
    expect(camera.position.distanceTo(rest)).toBeLessThan(1e-6);

    rig.shakeEnabled = false;
    rig.shake(0.2);
    rig.update(DT);
    expect(camera.position.distanceTo(rest)).toBeLessThan(1e-6);
  });
});
