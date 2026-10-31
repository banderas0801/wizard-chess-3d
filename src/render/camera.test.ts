import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { clipDistance, LIMITS, PRESETS, type Cylinder } from './camera';

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
