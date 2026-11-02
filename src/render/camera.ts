// Camera rig: camera-controls (yomotsu, MIT) does damping, clamps and eased preset flights.
// On top of it we add two post-update offsets that never feed back into the controls' state:
// anti-clip against a declared list of upright cylinders (analytic, no raycasts) and a
// decaying screen shake.
import CameraControls from 'camera-controls';
import {
  Box3, Matrix4, PerspectiveCamera, Quaternion, Raycaster, Sphere, Spherical, Vector2, Vector3, Vector4,
} from 'three';

CameraControls.install({ THREE: { Box3, Matrix4, Quaternion, Raycaster, Sphere, Spherical, Vector2, Vector3, Vector4 } });

export type Preset = 'player' | 'overhead' | 'side' | 'overview';
type V3 = readonly [number, number, number];
export const PRESETS: Readonly<Record<Preset, { readonly pos: V3; readonly target: V3 }>> = {
  player: { pos: [0, 7.6, 10.0], target: [0, -0.2, 0.7] },
  overhead: { pos: [0, 14, 2.2], target: [0, 0, 0.1] },
  side: { pos: [12.5, 5.8, 0], target: [0, -0.2, 0] },
  overview: { pos: [6.4, 8.2, 9.4], target: [0, -0.2, 0] },
};

export interface Cylinder {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly yMin: number;
  readonly yMax: number;
}

export const LIMITS = { minDistance: 4.5, maxDistance: 20, minPolar: 0.12, maxPolar: 1.25 } as const;
const CLIP_MARGIN = 0.45; // keeps the near plane out of the column surface

/**
 * Distance along the ray target -> camera at which it first enters any cylinder (minus a margin),
 * or `len` if the segment is clear. Pure math; exported for tests.
 */
export function clipDistance(target: Vector3, dir: Vector3, len: number, cylinders: readonly Cylinder[], margin = CLIP_MARGIN): number {
  let best = len;
  for (const c of cylinders) {
    const r = c.radius + margin;
    const ox = target.x - c.x;
    const oz = target.z - c.z;
    const a = dir.x * dir.x + dir.z * dir.z;
    if (a < 1e-9) continue; // vertical ray never hits an upright cylinder's side
    const b = 2 * (ox * dir.x + oz * dir.z);
    const cc = ox * ox + oz * oz - r * r;
    const disc = b * b - 4 * a * cc;
    if (disc < 0) continue;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t < 0 || t >= best) continue;
    const y = target.y + dir.y * t;
    if (y < c.yMin || y > c.yMax) continue;
    best = t;
  }
  return best;
}

/** How close a focus shot comes in: horizontal distance and height above the point, and the look-at lift. */
export interface FocusShot {
  readonly distance: number;
  readonly height: number;
  readonly lookAt: number;
}
export const CAPTURE_SHOT: FocusShot = { distance: 3.4, height: 2.6, lookAt: 0.35 };
/** Low and tight on the mated king as it falls. */
export const MATE_SHOT: FocusShot = { distance: 2.3, height: 1.15, lookAt: 0.25 };
export const SHAKE_MS = 300;

export interface CameraRig {
  readonly controls: CameraControls;
  /** Eased flight to a preset; resolves when it arrives. */
  flyTo(preset: Preset, ms?: number): Promise<void>;
  /** Eased flight to look at a world point from close by (capture or checkmate close-up). */
  focus(point: Vector3, ms?: number, shot?: FocusShot): Promise<void>;
  /** Fly back to where the camera was before `focus`. */
  unfocus(ms?: number): Promise<void>;
  /** Light decaying shake (default 0.3 s). A no-op while `shakeEnabled` is false. */
  shake(strength: number, ms?: number): void;
  /** Master switch for shake (default on). Off for Zen mode; the app also keeps it off at tier `off`. */
  shakeEnabled: boolean;
  /** Call once per frame after nothing else touches the camera. */
  update(dt: number): void;
  readonly preset: Preset | null;
}

export function createCameraRig(camera: PerspectiveCamera, dom: HTMLElement, colliders: readonly Cylinder[], start: Preset | V3 = 'player'): CameraRig {
  const controls = new CameraControls(camera, dom);
  controls.smoothTime = 0.22;
  controls.draggingSmoothTime = 0.1;
  controls.minDistance = LIMITS.minDistance;
  controls.maxDistance = LIMITS.maxDistance;
  controls.minPolarAngle = LIMITS.minPolar;
  controls.maxPolarAngle = LIMITS.maxPolar;
  controls.mouseButtons.right = CameraControls.ACTION.NONE; // no truck/pan
  controls.mouseButtons.middle = CameraControls.ACTION.DOLLY;
  controls.touches.two = CameraControls.ACTION.TOUCH_DOLLY_ROTATE;
  controls.touches.three = CameraControls.ACTION.NONE;

  let preset: Preset | null = typeof start === 'string' ? start : null;
  const p0 = typeof start === 'string' ? PRESETS[start].pos : start;
  const t0 = PRESETS.player.target;
  void controls.setLookAt(...p0, ...t0, false);

  const baseSmooth = controls.smoothTime;
  let flight = 0;
  const fly = async (pos: V3, target: V3, ms: number): Promise<void> => {
    const id = ++flight;
    // camera-controls eases with a critically damped spring; ~4 smoothTimes to settle.
    controls.smoothTime = Math.max(0.05, ms / 4000);
    await controls.setLookAt(...pos, ...target, true);
    if (id === flight) controls.smoothTime = baseSmooth;
  };

  let saved: { pos: V3; target: V3; preset: Preset | null } | null = null;
  const tmpP = new Vector3();
  const tmpT = new Vector3();
  const dir = new Vector3();
  let shakeLeft = 0;
  let shakeTotal = 1;
  let shakeStrength = 0;
  let time = 0;

  const v3 = (v: Vector3): V3 => [v.x, v.y, v.z];

  return {
    controls,
    get preset() {
      return preset;
    },
    flyTo(p, ms = 900) {
      preset = p;
      saved = null;
      return fly(PRESETS[p].pos, PRESETS[p].target, ms);
    },
    shakeEnabled: true,
    focus(point, ms = 450, shot = CAPTURE_SHOT) {
      controls.getPosition(tmpP, true);
      controls.getTarget(tmpT, true);
      saved ??= { pos: v3(tmpP), target: v3(tmpT), preset };
      // Come in along the current viewing direction, low and close.
      dir.copy(tmpP).sub(tmpT).setY(0).normalize();
      const pos: V3 = [point.x + dir.x * shot.distance, point.y + shot.height, point.z + dir.z * shot.distance];
      return fly(pos, [point.x, point.y + shot.lookAt, point.z], ms);
    },
    unfocus(ms = 600) {
      if (!saved) return Promise.resolve();
      const s = saved;
      saved = null;
      preset = s.preset;
      return fly(s.pos, s.target, ms);
    },
    shake(strength, ms = SHAKE_MS) {
      if (!this.shakeEnabled) return;
      shakeStrength = Math.max(shakeStrength * (shakeLeft / shakeTotal), strength);
      shakeLeft = shakeTotal = ms / 1000;
    },
    update(dt) {
      time += dt;
      controls.update(dt);
      if (controls.currentAction !== CameraControls.ACTION.NONE) preset = null;
      // Rebuild the pose from the controls' own state every frame so our offsets never accumulate.
      // `false` = the current (eased) pose; the default would read the flight's END pose and snap.
      controls.getPosition(tmpP, false);
      controls.getTarget(tmpT, false);
      dir.copy(tmpP).sub(tmpT);
      const len = dir.length();
      dir.divideScalar(len || 1);
      camera.position.copy(tmpT).addScaledVector(dir, clipDistance(tmpT, dir, len, colliders));
      if (!this.shakeEnabled) shakeLeft = 0;
      if (shakeLeft > 0) {
        shakeLeft = Math.max(0, shakeLeft - dt);
        const k = shakeStrength * (shakeLeft / shakeTotal) ** 2;
        camera.position.x += k * Math.sin(time * 71.3);
        camera.position.y += k * 0.6 * Math.sin(time * 53.9 + 1.3);
        camera.position.z += k * Math.sin(time * 61.7 + 2.1);
      }
      camera.lookAt(tmpT);
    },
  };
}
