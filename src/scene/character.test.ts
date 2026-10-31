import { readFileSync } from 'node:fs';
import { Group, Mesh, MeshBasicMaterial, Quaternion, Vector3, type AnimationClip, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createProceduralAnimator } from './anim';
import { buildCharacterKit, createCharacterAnimator, finishFor, lanceAngle, rearAngle, type CharacterKit } from './character';
import { LANCE_COUCHED, LANCE_REST } from './rider';

const FILE = 'public/models/quaternius-horse/Horse.glb';

let kit: CharacterKit;
beforeAll(async () => {
  const b = readFileSync(FILE);
  const gltf = await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, '');
  kit = buildCharacterKit(gltf.scene, gltf.animations as AnimationClip[]);
});

const piece = (type: string, color: 'white' | 'black', x = 0): Object3D => {
  const g = new Group();
  const foot = new Mesh();
  foot.userData.base = true; // the turned base stays
  g.add(foot, new Mesh()); // second child stands in for the procedural head
  g.position.set(x, 0, 0);
  g.userData = { type, color, restYaw: 0.45, phase: 0, height: 0.8 };
  return g;
};

function setup() {
  const root = new Group();
  const knight = piece('knight', 'white');
  const pawn = piece('pawn', 'black', 1);
  root.add(knight, pawn);
  const m = () => new MeshBasicMaterial();
  const anim = createCharacterAnimator(createProceduralAnimator(), 'knight', { body: m, accent: m, eye: m });
  return { root, knight, pawn, anim };
}
const pivotOf = (o: Object3D): Object3D => o.getObjectByName('rear-pivot')!;

describe('horse knight (Step 4b)', () => {
  it('keeps every piece procedural until the kit arrives, then attaches only knights, once, on the kept base', () => {
    const { root, knight, anim } = setup();
    anim.attachAll(root);
    expect(anim.count).toBe(0);
    anim.kit = kit;
    anim.attachAll(root);
    anim.attachAll(root);
    expect(anim.count).toBe(1);
    expect(knight.getObjectByName('character')).toBeDefined();
    expect(knight.children[0]!.visible).toBe(true); // base
    expect(knight.children[1]!.visible).toBe(false); // procedural head hidden
  });

  it('fits a square: about 0.8 long and standing on the base', () => {
    const { root, knight, anim } = setup();
    anim.kit = kit;
    anim.attachAll(root);
    knight.rotation.set(0, 0, 0);
    knight.updateMatrixWorld(true);
    const ch = knight.getObjectByName('mount')!;
    ch.updateMatrixWorld(true);
    const p = new Vector3();
    knight.getObjectByName('character')!.getWorldPosition(p);
    expect(Math.abs(p.z)).toBeLessThan(0.5);
    expect(kit.bounds.max.z - kit.bounds.min.z).toBeGreaterThan(0);
  });

  it('a leap moves the piece through the base animator, then settles back to idle', () => {
    const { root, knight, anim } = setup();
    anim.kit = kit;
    anim.attachAll(root);
    anim.play(knight, 'move', { to: new Vector3(2, 0, -1), duration: 0.5, hop: 0.85 });
    expect(anim.moving).toBe(true);
    for (let i = 0; i < 20; i++) anim.update(0.05);
    expect(knight.position.x).toBeCloseTo(2);
    expect(anim.moving).toBe(false);
  });

  it('attack rears up in the wind-up, strikes down, and ends level', () => {
    const { root, knight, anim } = setup();
    anim.kit = kit;
    anim.attachAll(root);
    anim.play(knight, 'attack', { to: new Vector3(1, 0, -2), duration: 1 });
    anim.update(0.3);
    expect(pivotOf(knight).rotation.x).toBeLessThan(-0.5); // forelegs up
    expect(knight.getObjectByName('mount')!.position.x).toBeGreaterThan(0.1); // hind hooves kept over the base
    anim.update(0.2);
    expect(pivotOf(knight).rotation.x).toBeGreaterThan(0); // hooves driven down
    for (let i = 0; i < 12; i++) anim.update(0.05);
    expect(pivotOf(knight).rotation.x).toBe(0);
    expect(knight.position.z).toBeCloseTo(-2);
  });

  it('cancel mid-rear puts the horse level and home', () => {
    const { root, knight, anim } = setup();
    anim.kit = kit;
    anim.attachAll(root);
    anim.play(knight, 'attack', { to: new Vector3(1, 0, -2), duration: 1 });
    anim.update(0.3);
    anim.cancel();
    expect(pivotOf(knight).rotation.x).toBe(0);
    expect(knight.getObjectByName('mount')!.position.x).toBe(0);
    expect(knight.position.length()).toBeCloseTo(0);
  });

  it('shatter plays the death clip first, then hides the piece; cancel restores it', () => {
    const { root, knight, anim } = setup();
    anim.kit = kit;
    anim.attachAll(root);
    anim.play(knight, 'shatter', { duration: 0.6 });
    anim.update(0.1);
    expect(knight.visible).toBe(true);
    anim.update(0.3);
    expect(knight.visible).toBe(false);
    anim.cancel();
    expect(knight.visible).toBe(true);
    expect(anim.moving).toBe(false);
  });

  it('pieces without a character are handed straight to the procedural animator', () => {
    const { root, pawn, anim } = setup();
    anim.kit = kit;
    anim.attachAll(root);
    anim.play(pawn, 'attack', { to: new Vector3(1, 0, -1), duration: 0.4 });
    for (let i = 0; i < 10; i++) anim.update(0.05);
    expect(pawn.position.z).toBeCloseTo(-1);
  });

  it('maps the model materials to a single-tone figurine with gold hooves', () => {
    expect(finishFor('Main')).toBe('body');
    expect(finishFor('Hair')).toBe('body');
    expect(finishFor('Hooves')).toBe('accent');
    expect(finishFor('Eye_Black')).toBe('eye');
    expect(rearAngle(0)).toBe(0);
    expect(rearAngle(1)).toBe(0);
    expect(lanceAngle(0)).toBe(LANCE_REST);
    expect(lanceAngle(0.5)).toBeCloseTo(LANCE_COUCHED);
    expect(lanceAngle(1)).toBe(LANCE_REST);
  });

  it('seats a rider on the saddle who rides the rear and couches the lance for the strike', () => {
    const { root, knight, anim } = setup();
    anim.kit = kit;
    anim.attachAll(root);
    const rider = knight.getObjectByName('rider')!;
    const lance = knight.getObjectByName('lance')!;
    const y = (): number => {
      knight.updateMatrixWorld(true);
      return rider.getWorldPosition(new Vector3()).y;
    };
    const seated = y();
    expect(seated).toBeGreaterThan(0.6); // on the horse's back, above the base
    expect(seated).toBeLessThan(0.9);
    expect(lance.rotation.x).toBe(LANCE_REST);
    anim.play(knight, 'attack', { to: new Vector3(1, 0, -2), duration: 1 });
    anim.update(0.3);
    const up = new Vector3(0, 1, 0).applyQuaternion(rider.getWorldQuaternion(new Quaternion()));
    expect(up.angleTo(new Vector3(0, 1, 0))).toBeGreaterThan(0.4); // tipped back with the rearing horse
    expect(lance.rotation.x).toBeCloseTo(LANCE_COUCHED);
    for (let i = 0; i < 16; i++) anim.update(0.05);
    expect(lance.rotation.x).toBe(LANCE_REST);
  });
});
