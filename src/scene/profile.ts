import { SplineCurve, Vector2 } from 'three';

/**
 * Builds a lathe half-profile (x = radius, y = height). `corner()` duplicates the last point:
 * LatheGeometry averages adjacent segment normals, so a zero-length segment yields a crisp edge.
 */
export class Profile {
  readonly points: Vector2[] = [new Vector2(0, 0)];

  private get last(): Vector2 {
    return this.points[this.points.length - 1]!;
  }

  to(r: number, y: number): this {
    this.points.push(new Vector2(r, y));
    return this;
  }

  corner(): this {
    this.points.push(this.last.clone());
    return this;
  }

  /** Smooth Catmull-Rom-ish curve through the given points, starting at the current point. */
  curve(pts: readonly (readonly [number, number])[], samples = 12): this {
    const c = new SplineCurve([this.last.clone(), ...pts.map(([r, y]) => new Vector2(r, y))]);
    this.points.push(...c.getPoints(samples).slice(1));
    return this;
  }

  /** Circular arc around (cr, cy) from angle a0 to a1 (radians, 0 = +r direction). */
  arc(cr: number, cy: number, radius: number, a0: number, a1: number, samples = 10): this {
    for (let i = 1; i <= samples; i++) {
      const a = a0 + ((a1 - a0) * i) / samples;
      this.points.push(new Vector2(Math.max(0, cr + Math.cos(a) * radius), cy + Math.sin(a) * radius));
    }
    return this;
  }

  /** Standard foot: flat bottom, rounded rim, cove up into a collar of radius `top` at height `h`. */
  foot(R: number, h: number, top: number): this {
    return this.to(R, 0)
      .corner()
      .to(R, h * 0.22)
      .arc(R - h * 0.12, h * 0.22, h * 0.12, 0, Math.PI / 2, 6)
      .corner()
      .curve([[R * 0.86, h * 0.48], [R * 0.8, h * 0.62]], 8)
      .arc(R * 0.8, h * 0.72, h * 0.1, -Math.PI / 2, Math.PI / 2, 8)
      .corner()
      .curve([[top * 1.15, h * 0.9], [top, h]], 8);
  }
}
