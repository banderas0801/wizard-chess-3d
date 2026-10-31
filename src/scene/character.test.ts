import { readFileSync } from 'node:fs';
import { Group, MeshBasicMaterial, Vector3, type Object3D } from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createProceduralAnimator } from './anim';
import { buildCharacterKit, createCharacterAnimator, type CharacterKit } from './character';

const DIR = 'public/models/quaternius-knight';
const parse = (file: string): Group => {
  const b = readFileSync(`${DIR}/${file}`);
  return new FBXLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, '');
};

let kit: CharacterKit;
beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {}); // ">4 skinning weights" notice from the pack
  kit = buildCharacterKit(parse('KnightCharacter.fbx'), parse('Sword.fbx'), parse('Helmet1.fbx'));
});

const piece = (type: string, color: 'white' | 'black', x = 0): Object3D => {
  const g = new Group();
  g.add(new Group()); // stands in for the procedural meshes
  g.position.set(x, 0, 0);
  g.userData = { type, color, restYaw: 0.45, phase: 0, height: 0.8 };
  return g;
};

function setup() {
  const root = new Group();
  const knight = piece('knight', 'white');
  const pawn = piece('pawn', 'black', 1);
  root.add(knight, pawn);
  const mats = { body: () => new MeshBasicMaterial(), accent: () => new MeshBasicMaterial() };
  const anim = createCharacterAnimator(createProceduralAnimator(), 'knight', mats);
  return { root, knight, pawn, anim };
}

describe('character animator (Step 4b)', () => {
  it('keeps every piece procedural until the kit arrives, then attaches only the chosen type, once', () => {
    const { root, knight, anim } = setup();
    anim.attachAll(root);
    expect(anim.count).toBe(0);
    anim.kit = kit;
    anim.attachAll(root);
    anim.attachAll(root);
    expect(anim.count).toBe(1);
    expect(knight.getObjectByName('character')).toBeDefined();
    expect(knight.children[0]!.visible).toBe(false); // procedural knight hidden, object kept
    expect(knight.userData.restYaw).toBeCloseTo(Math.PI / 2); // white faces rank 8 (-z)
  });

  it('moves the piece through the base animator while the mixer plays, then settles back to idle', () => {
    const { root, knight, anim } = setup();
    anim.kit = kit;
    anim.attachAll(root);
    anim.play(knight, 'move', { to: new Vector3(2, 0, -1), duration: 0.5 });
    expect(anim.moving).toBe(true);
    for (let i = 0; i < 20; i++) anim.update(0.05);
    expect(knight.position.x).toBeCloseTo(2);
    expect(anim.moving).toBe(false);
  });

  it('shatter plays the death clip first, then hides the piece; cancel restores it', () => {
    const { root, knight, anim } = setup();
    anim.kit = kit;
    anim.attachAll(root);
    anim.play(knight, 'shatter', { duration: 0.6 });
    anim.update(0.1);
    expect(knight.visible).toBe(true); // still falling over
    anim.update(0.3);
    expect(knight.visible).toBe(false); // burst into debris
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
});
