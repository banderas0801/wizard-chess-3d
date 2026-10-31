import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { createProceduralAnimator, headingYaw } from './anim';

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
});
