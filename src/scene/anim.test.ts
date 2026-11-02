import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { ATTACK_ENTER, ATTACK_IMPACT, attackCurve, SLAM_LEAN, SLAM_LEAP, createProceduralAnimator, headingYaw } from './anim';
import type { StrikeMotion } from './strike';

const piece = (restYaw = 0): { root: Group; obj: Group } => {
  const root = new Group();
  const obj = new Group();
  obj.add(new Mesh(new BoxGeometry(0.3, 0.6, 0.3), new MeshBasicMaterial()));
  obj.userData = { restYaw, phase: 0, height: 0.6 };
  obj.rotation.y = restYaw;
  root.add(obj);
  return { root, obj };
};
const run = (a: ReturnType<typeof createProceduralAnimator>, seconds: number, step = 1 / 60): void => {
  for (let t = 0; t < seconds; t += step) a.update(step);
};

describe('PieceAnimator (procedural)', () => {
  it('move glides to the target, faces travel mid-way and ends in the rest pose', () => {
    const a = createProceduralAnimator();
    const { obj } = piece(0.45);
    a.play(obj, 'move', { to: new Vector3(0, 0, -3), duration: 0.6 });
    expect(a.moving).toBe(true);
    run(a, 0.3);
    const yaw = Math.atan2(2 * (obj.quaternion.w * obj.quaternion.y), 1 - 2 * obj.quaternion.y ** 2);
    expect(yaw).toBeCloseTo(headingYaw(0, -3), 1); // facing -z at the midpoint
    run(a, 0.4);
    expect(a.moving).toBe(false);
    expect(obj.position.distanceTo(new Vector3(0, 0, -3))).toBeLessThan(1e-6);
    expect(obj.rotation.y).toBeCloseTo(0.45, 6);
    expect(Math.abs(obj.rotation.x) + Math.abs(obj.rotation.z)).toBeLessThan(1e-6);
  });

  it('knight hop arcs above the board', () => {
    const a = createProceduralAnimator();
    const { obj } = piece();
    a.play(obj, 'move', { to: new Vector3(1, 0, -2), duration: 0.6, hop: 0.8 });
    run(a, 0.3);
    expect(obj.position.y).toBeGreaterThan(0.6);
  });

  it('attack winds up backwards, lunges and settles on the target', () => {
    const a = createProceduralAnimator();
    const { obj } = piece();
    a.play(obj, 'attack', { to: new Vector3(0, 0, -1), duration: 0.5 });
    run(a, 0.12);
    expect(obj.position.z).toBeGreaterThan(0); // reared back, away from the target
    run(a, 0.5);
    expect(obj.position.distanceTo(new Vector3(0, 0, -1))).toBeLessThan(1e-6);
  });

  it('shatter hides the piece, throws fragments, then cleans them up', () => {
    const a = createProceduralAnimator({ fragments: 12 });
    const { root, obj } = piece();
    a.play(obj, 'shatter', { duration: 0.5 });
    expect(obj.visible).toBe(false);
    expect(root.children.length).toBe(1 + 12);
    run(a, 0.6);
    expect(root.children.length).toBe(1);
    expect(a.moving).toBe(false);
  });

  it('cancel restores every touched piece and removes fragments', () => {
    const a = createProceduralAnimator();
    const p1 = piece(0.3);
    const p2 = piece();
    p2.root.remove(p2.obj);
    p1.root.add(p2.obj);
    p2.obj.position.set(0, 0, -1);
    a.play(p1.obj, 'attack', { to: new Vector3(0, 0, -1), duration: 0.5 });
    run(a, 0.3);
    a.play(p2.obj, 'shatter');
    run(a, 0.1);
    a.cancel();
    expect(p1.obj.position.lengthSq()).toBe(0);
    expect(p1.obj.rotation.y).toBeCloseTo(0.3, 6);
    expect(p2.obj.visible).toBe(true);
    expect(p1.root.children.length).toBe(2);
    expect(a.moving).toBe(false);
  });

  it.each<StrikeMotion>(['lunge', 'ram', 'cast', 'spin', 'slash', 'slam'])('%s never goes past the contact point before stepping on, and ends on the square', (motion) => {
    const dist = 1;
    const peak = 0.55;
    const curve = attackCurve(motion, peak, dist);
    for (let k = 0; k < ATTACK_ENTER; k += 0.005) expect(curve(k).x).toBeLessThanOrEqual(peak + 1e-9);
    for (let k = 0; k < 1; k += 0.002) expect(Math.abs(curve(k + 0.002).x - curve(k).x)).toBeLessThan(0.05); // no teleports
    const end = curve(1);
    expect(end.x).toBeCloseTo(dist, 9);
    expect(end.y).toBeCloseTo(0, 9);
    expect(end.lean).toBeCloseTo(0, 9);
    expect(Math.cos(end.yaw)).toBeCloseTo(1, 9); // facing the target again
    if (motion === 'lunge' || motion === 'ram' || motion === 'slash' || motion === 'slam') expect(curve(ATTACK_IMPACT).x).toBeCloseTo(peak, 6);
  });

  it('slam: rears back, leaps clear of the board, lands with the hammer forward and a squash, then settles', () => {
    const curve = attackCurve('slam', 0.6, 1);
    const windup = curve(SLAM_LEAP - 0.01);
    expect(windup.lean).toBeLessThan(-0.2); // hammer raised behind
    expect(windup.x).toBeLessThan(0);
    expect(curve((SLAM_LEAP + ATTACK_IMPACT) / 2).y).toBeGreaterThan(0.3); // airborne
    const land = curve(ATTACK_IMPACT);
    expect(land.y).toBeCloseTo(0, 6);
    expect(land.lean).toBeCloseTo(SLAM_LEAN, 6);
    expect(land.squash).toBeGreaterThan(0.1);
    expect(curve(ATTACK_ENTER).squash ?? 0).toBeCloseTo(0, 3);
  });

  it('slam squash is applied to the piece scale and gone when the attack ends', () => {
    const a = createProceduralAnimator();
    const { obj } = piece();
    a.play(obj, 'attack', { to: new Vector3(1, 0, 0), duration: 1, motion: 'slam', contact: 0.4 });
    run(a, ATTACK_IMPACT + 0.01, 0.01);
    expect(obj.scale.y).toBeLessThan(0.92); // landed: squashed
    expect(obj.scale.x).toBeGreaterThan(1.03);
    run(a, 0.5);
    expect(obj.scale.y).toBeCloseTo(1, 6);
    expect(obj.position.x).toBeCloseTo(1, 6);
  });

  it('drag pulls a victim toward a point, and cancel puts it back', () => {
    const a = createProceduralAnimator();
    const { obj } = piece();
    a.drag(obj, new Vector3(-0.4, 0, 0), 0.5);
    run(a, 0.25);
    expect(obj.position.x).toBeLessThan(0);
    expect(obj.position.x).toBeGreaterThan(-0.2); // slow start: sucked in, accelerating
    run(a, 0.3);
    expect(obj.position.x).toBeCloseTo(-0.4, 6);
    a.cancel();
    expect(obj.position.length()).toBeLessThan(1e-9);
  });

  it('rolls chariot wheels with the distance travelled', () => {
    const a = createProceduralAnimator();
    const { obj } = piece();
    const wheel = new Group();
    obj.add(wheel);
    obj.userData.wheels = [wheel];
    obj.userData.wheelRadius = 0.2;
    a.play(obj, 'move', { to: new Vector3(2, 0, 0), duration: 0.6 });
    run(a, 0.7);
    expect(wheel.rotation.z).toBeCloseTo(-2 / 0.2, 1); // rolled forward 2 units
  });
});
