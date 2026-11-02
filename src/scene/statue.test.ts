import { describe, expect, it } from 'vitest';
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Texture, Vector3, type Object3D } from 'three';
import { ATTACK_IMPACT, createProceduralAnimator } from './anim';
import { buildStatueKit, createStatueAnimator, finishMaterial, glowPulse, STATUE_FINISH, type StatueKit } from './statue';

const HEIGHT = 0.95;

/** Stand-in for the Meshy rook: 1.9 tall, centred on the origin, off-centre in x/z like a shield arm. */
const template = (): Object3D => {
  const scene = new Group();
  const node = new Group();
  node.scale.setScalar(0.95);
  const mat = new MeshStandardMaterial({ map: new Texture() });
  mat.name = 'BakedMaterial';
  const body = new Mesh(new BoxGeometry(1.2, 2, 0.9), mat);
  body.position.set(0.1, 0, -0.05);
  node.add(body);
  scene.add(node);
  return scene;
};

const piece = (type: string, color: 'white' | 'black', x = 0): Object3D => {
  const g = new Group();
  g.userData = { type, color, restYaw: 0, phase: 0 };
  g.add(new Mesh(new BoxGeometry(0.4, 0.88, 0.4), new MeshBasicMaterial()));
  g.position.x = x;
  return g;
};

const setup = (): { kit: StatueKit; root: Group; a: ReturnType<typeof createStatueAnimator> } => {
  const kit = buildStatueKit(template());
  const a = createStatueAnimator(createProceduralAnimator(), { type: 'rook', height: HEIGHT });
  a.kit = kit;
  const root = new Group();
  root.add(piece('rook', 'white'), piece('rook', 'black', 2), piece('pawn', 'white', 4));
  a.attachAll(root);
  return { kit, root, a };
};
const run = (a: { update(dt: number): void }, seconds: number, step = 1 / 60): void => {
  for (let t = 0; t < seconds; t += step) a.update(step);
};
const statueOf = (o: Object3D): Mesh => o.getObjectByName('statue')!.children[0]!.children[0] as Mesh;

describe('statue (rigid Meshy rook)', () => {
  it('kit bounds cover the meshes in model space', () => {
    const { kit } = setup();
    expect(kit.bounds.max.y - kit.bounds.min.y).toBeCloseTo(1.9, 6);
    expect(() => buildStatueKit(new Group())).toThrow();
  });

  it('replaces only rooks, idempotently, standing on the board at the requested height and centred', () => {
    const { root, a } = setup();
    a.attachAll(root);
    expect(a.count).toBe(2);
    const [w, , pawn] = root.children as [Object3D, Object3D, Object3D];
    expect(pawn.getObjectByName('statue')).toBeUndefined();
    expect(w.children[0]!.visible).toBe(false); // procedural rook hidden
    expect(w.getObjectByName('aura')).toBeDefined();
    expect(w.userData.wheels).toEqual([]);
    w.updateMatrixWorld(true);
    const box = new Box3().setFromObject(w.getObjectByName('statue')!);
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.max.y).toBeCloseTo(HEIGHT, 6);
    const c = box.getCenter(new Vector3());
    expect(Math.hypot(c.x - w.position.x, c.z - w.position.z)).toBeLessThan(1e-6);
    expect(statueOf(w).castShadow).toBe(true);
  });

  it('white keeps the baked texture with a gold aura; black is obsidian with a crimson one, per instance', () => {
    const { root } = setup();
    const [w, b] = root.children as [Object3D, Object3D];
    const wm = statueOf(w).material as MeshStandardMaterial;
    const bm = statueOf(b).material as MeshStandardMaterial;
    expect(wm).not.toBe(bm);
    expect(wm.map).not.toBeNull();
    expect(wm.color.getHexString()).toBe('ffffff');
    expect(`#${wm.emissive.getHexString()}`).toBe('#f59e0b');
    expect(`#${bm.emissive.getHexString()}`).toBe('#dc2626');
    expect(bm.color.r).toBeLessThan(0.1); // near-black albedo multiplier
    expect(bm.roughness).toBeLessThan(wm.roughness);
    expect(bm.emissiveMap).toBe(bm.map);
    expect(finishMaterial(new MeshBasicMaterial(), 'white').map).toBeNull();
  });

  it('attack flares the aura at impact and settles back; the procedural animator still moves the piece', () => {
    const { root, a } = setup();
    const w = root.children[0]!;
    const mat = statueOf(w).material as MeshStandardMaterial;
    a.play(w, 'attack', { to: new Vector3(1, 0, 0), duration: 1, motion: 'slam', contact: 0.45 });
    expect(a.moving).toBe(true);
    run(a, ATTACK_IMPACT + 0.02, 0.01);
    expect(mat.emissiveIntensity).toBeGreaterThan(STATUE_FINISH.white.glowIntensity + 0.3);
    expect(w.scale.y).toBeLessThan(0.95); // the slam squash reaches the statue's piece
    run(a, 0.6);
    expect(a.moving).toBe(false);
    expect(mat.emissiveIntensity).toBeCloseTo(STATUE_FINISH.white.glowIntensity, 6);
    expect(w.position.x).toBeCloseTo(1, 6);
    expect(w.scale.y).toBeCloseTo(1, 6);
  });

  it('shatter debris never uses the additive aura', () => {
    const { root, a } = setup();
    const w = root.children[0]!;
    a.play(w, 'shatter', { duration: 0.6 });
    const shards = root.children.filter((o) => !(o as Object3D).userData.type) as Mesh[];
    expect(shards.length).toBeGreaterThan(0);
    for (const s of shards) expect(s.material).not.toBe((w.getObjectByName('aura') as Mesh).material);
  });

  it('glow pulse: zero at rest, peaks at impact', () => {
    expect(glowPulse(0)).toBe(0);
    expect(glowPulse(1)).toBe(0);
    expect(glowPulse(ATTACK_IMPACT)).toBeCloseTo(1, 6);
    expect(glowPulse(ATTACK_IMPACT - 0.1)).toBeLessThan(0.35);
  });
});
