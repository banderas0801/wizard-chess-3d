import { describe, expect, it } from 'vitest';
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Texture, Vector3, type Object3D } from 'three';
import { ATTACK_IMPACT, createProceduralAnimator } from './anim';
import { MAX_FOOTPRINT, TARGET_HEIGHT } from './assets';
import { buildStatueKit, createStatueAnimator, finishMaterial, fitStatue, glowPulse, obsidianShader, STATUE_FINISH, type StatueKit } from './statue';

const HEIGHT = TARGET_HEIGHT.rook;
const TOP = 0.2;
/** Stand-in pedestal: a 0.2-tall disc, tagged with its side. */
const pedestal = (c: 'white' | 'black'): Object3D => {
  const g = new Group();
  g.userData.side = c;
  g.add(new Mesh(new BoxGeometry(0.5, TOP, 0.5).translate(0, TOP / 2, 0), new MeshBasicMaterial()));
  return g;
};

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
  const a = createStatueAnimator(createProceduralAnimator(), { type: 'rook', pedestal, pedestalTop: TOP });
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

  it('replaces only rooks, idempotently, standing on its pedestal at the table height and centred', () => {
    const { root, a } = setup();
    a.attachAll(root);
    expect(a.count).toBe(2);
    const [w, , pawn] = root.children as [Object3D, Object3D, Object3D];
    expect(pawn.getObjectByName('statue')).toBeUndefined();
    expect(w.children[0]!.visible).toBe(false); // procedural rook hidden
    expect(w.getObjectByName('aura')).toBeDefined();
    expect(w.userData.wheels).toEqual([]);
    w.updateMatrixWorld(true);
    const ped = w.getObjectByName('pedestal')!;
    expect(ped.userData.side).toBe('white');
    expect((root.children[1] as Object3D).getObjectByName('pedestal')!.userData.side).toBe('black');
    const box = new Box3().setFromObject(w.getObjectByName('statue')!);
    expect(box.min.y).toBeCloseTo(TOP, 6); // feet on the pedestal top
    expect(box.max.y).toBeCloseTo(HEIGHT, 6);
    expect(w.userData.height).toBeCloseTo(HEIGHT, 6);
    const c = box.getCenter(new Vector3());
    expect(Math.hypot(c.x - w.position.x, c.z - w.position.z)).toBeLessThan(1e-6);
    expect(statueOf(w).castShadow).toBe(true);
  });

  it('the two sides face each other at rest, and turn to face their target mid-move or mid-strike', () => {
    // Meshy statues face +z in model space; white stands at +z (rank 1), black at -z (rank 8).
    const a = createStatueAnimator(createProceduralAnimator(), { type: 'rook', pedestal, pedestalTop: TOP });
    a.kit = buildStatueKit(template());
    const root = new Group();
    const w = piece('rook', 'white');
    const b = piece('rook', 'black');
    w.position.set(0, 0, 3.5);
    b.position.set(0, 0, -3.5);
    root.add(w, b);
    a.attachAll(root);
    const facing = (o: Object3D): Vector3 => {
      o.updateMatrixWorld(true);
      return o.getObjectByName('statue')!.getWorldDirection(new Vector3()).setY(0).normalize();
    };
    expect(facing(w).z).toBeLessThan(-0.9); // white looks toward black (-z)
    expect(facing(b).z).toBeGreaterThan(0.9); // black looks toward white (+z)
    expect(facing(w).dot(facing(b))).toBeLessThan(-0.75);

    // Black strikes down the board, white sideways: halfway through, each looks where it is going.
    a.play(b, 'attack', { to: new Vector3(0, 0, -2.5), duration: 1, motion: 'slam', contact: 0.45 });
    a.play(w, 'move', { to: new Vector3(2, 0, 3.5), duration: 1 });
    run(a, 0.5, 0.01);
    expect(facing(b).z).toBeGreaterThan(0.99);
    expect(facing(w).x).toBeGreaterThan(0.99);
    run(a, 1);
    expect(facing(b).z).toBeGreaterThan(0.9); // back to its rest facing
    expect(facing(w).z).toBeLessThan(-0.9);
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
    expect(wm.emissiveMap).toBe(wm.map);
    expect(finishMaterial(new MeshBasicMaterial(), 'white').map).toBeNull();
  });

  it('black glow ignores the baked colours: no emissive map, greyed albedo, crimson rim', () => {
    // The bug: emissiveMap = albedo map multiplied crimson by the red cloak, so black statues glowed red.
    const bm = finishMaterial(new MeshStandardMaterial({ map: new Texture() }), 'black');
    expect(bm.emissiveMap).toBeNull();
    expect(bm.map).not.toBeNull(); // carving detail kept, as luminance
    expect(bm.customProgramCacheKey()).toBe('statue-obsidian');
    const shader = { fragmentShader: 'a\n#include <map_fragment>\nb\n#include <emissivemap_fragment>\nc' };
    bm.onBeforeCompile(shader as never, null as never);
    expect(shader.fragmentShader).toMatch(/dot\( sampledDiffuseColor\.rgb, vec3\(0\.2126/);
    expect(shader.fragmentShader).toMatch(/totalEmissiveRadiance \*=.*vViewPosition/);
    const fs = { fragmentShader: '#include <map_fragment>' };
    obsidianShader(fs);
    expect(fs.fragmentShader.startsWith('#include <map_fragment>')).toBe(true);
    const wm = finishMaterial(new MeshStandardMaterial({ map: new Texture() }), 'white');
    expect(wm.userData.obsidian).toBeUndefined();
  });

  it('fits by height, or shrinks so the footprint stays inside the square', () => {
    const tall = new Box3(new Vector3(-0.5, 0, -0.5), new Vector3(0.5, 2, 0.5));
    const t = fitStatue(tall, 'pawn', TOP);
    expect(t.scale).toBeCloseTo((TARGET_HEIGHT.pawn - TOP) / 2, 6);
    expect(t.offset[1]).toBeCloseTo(TOP, 6); // min.y = 0: feet land on the top
    const wide = new Box3(new Vector3(-2, 0, -1), new Vector3(2, 1, 1));
    const w = fitStatue(wide, 'rook', TOP);
    expect(2 * Math.hypot(2, 1) * w.scale).toBeCloseTo(MAX_FOOTPRINT, 6);
    expect(w.scale).toBeLessThan((TARGET_HEIGHT.rook - TOP) / 1);
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
