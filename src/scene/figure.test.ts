import { readFileSync } from 'node:fs';
import { Box3, BoxGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, Vector3, type AnimationClip, type Material, type Object3D, type SkinnedMesh } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createProceduralAnimator } from './anim';
import { buildFigureKit, createFigureAnimator, FIGURE_CLIPS, finishFor, repairNormals, thrustAngle, type FigureKit } from './figure';

const FILE = 'public/models/pawn/Pawn.glb';
const TOP = 0.2;
const HEIGHT = 0.5;

/** Node has no Image/self: drop the (unused, materials are replaced) texture before parsing. */
function withoutTextures(b: Buffer): ArrayBuffer {
  const len = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + len).toString('utf8')) as {
    textures?: unknown; images?: unknown; materials: { pbrMetallicRoughness?: { baseColorTexture?: unknown } }[];
  };
  delete json.textures;
  delete json.images;
  for (const m of json.materials) delete m.pbrMetallicRoughness?.baseColorTexture;
  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const rest = b.subarray(20 + len);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + js.length + rest.length, 8);
  head.writeUInt32LE(js.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  const out = Buffer.concat([head, js, rest]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

let kit: FigureKit;
beforeAll(async () => {
  const gltf = await new GLTFLoader().parseAsync(withoutTextures(readFileSync(FILE)), '');
  kit = buildFigureKit(gltf.scene, gltf.animations as AnimationClip[]);
});

const piece = (type: string, color: 'white' | 'black', x = 0): Object3D => {
  const g = new Group();
  g.add(new Mesh(), new Mesh()); // procedural pawn parts
  g.position.set(x, 0, 0);
  g.userData = { type, color, restYaw: 0, phase: 0, height: 0.6 };
  return g;
};

const mats = { ivory: new MeshBasicMaterial(), ebony: new MeshBasicMaterial(), gold: new MeshBasicMaterial() };
function setup() {
  const root = new Group();
  const pawn = piece('pawn', 'white');
  const black = piece('pawn', 'black', 2);
  const rook = piece('rook', 'white', 1);
  root.add(pawn, black, rook);
  const anim = createFigureAnimator(createProceduralAnimator(), {
    type: 'pawn',
    materials: { body: (c) => (c === 'white' ? mats.ivory : mats.ebony), gold: () => mats.gold, dark: () => mats.ebony },
    pedestal: () => {
      const p = new Group();
      p.name = 'pedestal';
      return p;
    },
    pedestalTop: TOP,
    height: HEIGHT,
    weaponHand: 'RightHand',
  });
  anim.kit = kit;
  anim.attachAll(root);
  return { root, pawn, black, rook, anim };
}

/** Lowest / highest skinned body vertex in world space (weapon excluded). */
function bodyBounds(obj: Object3D): Box3 {
  obj.updateMatrixWorld(true);
  const box = new Box3();
  const v = new Vector3();
  obj.getObjectByName('character')!.traverse((o) => {
    const m = o as SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const pos = m.geometry.attributes.position!;
    for (let i = 0; i < pos.count; i++) box.expandByPoint(m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld));
  });
  return box;
}
const spearOf = (o: Object3D): Object3D => o.getObjectByName('WEAPON_SPEAR_DETACHABLE')!;
const grip = (o: Object3D): Object3D => o.getObjectByName('grip')!;

describe('rigged pawn figure (Step 5)', () => {
  it('has the four delivered clips', () => {
    expect([...kit.clips.keys()]).toEqual([...FIGURE_CLIPS]);
    expect(kit.soleY).toBeLessThan(0.01); // boots reach the origin; the armour alone ends 0.066 up
  });

  it('has no zero-length normals left (NaN shading blacks the bloomed frame)', () => {
    kit.template.traverse((o) => {
      if ((o as Mesh).isMesh) expect(repairNormals((o as Mesh).geometry)).toBe(0);
    });
    const g = new BoxGeometry();
    g.setAttribute('normal', new Float32BufferAttribute(new Array(g.attributes.position!.count * 3).fill(0), 3));
    expect(repairNormals(g)).toBe(g.attributes.position!.count);
    expect(g.attributes.normal!.getY(0)).toBe(1);
  });

  it('attaches only pawns, once, replacing the procedural piece with pedestal + figure', () => {
    const { root, pawn, rook, anim } = setup();
    anim.attachAll(root);
    expect(anim.count).toBe(2);
    expect(rook.getObjectByName('character')).toBeUndefined();
    expect(pawn.children.filter((c) => c.name === 'mount')).toHaveLength(1);
    expect(pawn.children[0]!.visible).toBe(false);
    expect(pawn.getObjectByName('pedestal')!.visible).toBe(true);
  });

  it('stands with its soles on the pedestal top, at the configured height, arms lowered', () => {
    const { pawn } = setup();
    const b = bodyBounds(pawn);
    expect(b.min.y).toBeCloseTo(TOP, 2);
    expect(b.max.y - b.min.y).toBeGreaterThan(HEIGHT * 0.95);
    expect(b.max.y - b.min.y).toBeLessThan(HEIGHT * 1.05);
    // T-pose spans ~1.0 model units (0.5 here); lowered arms keep the figure inside its square.
    expect(Math.max(b.max.x - b.min.x, b.max.z - b.min.z)).toBeLessThan(0.36);
  });

  it('keeps the spear in the right hand, upright at rest', () => {
    const { pawn } = setup();
    const spear = spearOf(pawn);
    let hand = false;
    for (let p: Object3D | null = spear; p; p = p.parent) hand ||= p.name === 'RightHand';
    expect(hand).toBe(true);
    pawn.updateMatrixWorld(true);
    const box = new Box3().setFromObject(spear);
    expect(box.max.y - box.min.y).toBeGreaterThan(0.35); // vertical shaft
  });

  it('recolours by side and keeps gold', () => {
    const { pawn, black } = setup();
    const used = (o: Object3D): Set<Material> => {
      const s = new Set<Material>();
      o.getObjectByName('character')!.traverse((m) => {
        if ((m as Mesh).isMesh) for (const x of [(m as Mesh).material].flat()) s.add(x);
      });
      return s;
    };
    expect(used(pawn)).toEqual(new Set([mats.ivory, mats.gold, mats.ebony]));
    expect(used(black)).toEqual(new Set([mats.ebony, mats.gold]));
    expect(finishFor('PAWN_GOLD_RECOLORABLE')).toBe('gold');
    expect(finishFor('PAWN_ARMOR_RECOLORABLE')).toBe('body');
    expect(finishFor('PAWN_EYES_RECOLORABLE')).toBe('dark');
  });

  it('approach plays move while the base glides it, then returns to idle', () => {
    const { pawn, anim } = setup();
    anim.play(pawn, 'move', { to: new Vector3(0, 0, -2), duration: 0.6 });
    expect(anim.moving).toBe(true);
    for (let i = 0; i < 20; i++) anim.update(0.05);
    expect(pawn.position.z).toBeCloseTo(-2);
    expect(anim.moving).toBe(false);
  });

  it('strike couches the spear forward and raises it again', () => {
    const { pawn, anim } = setup();
    anim.play(pawn, 'attack', { to: new Vector3(1, 0, -1), duration: 1 });
    anim.update(0.5);
    pawn.updateMatrixWorld(true);
    const box = new Box3().setFromObject(spearOf(pawn));
    expect(box.max.y - box.min.y).toBeLessThan(0.25); // lowered toward horizontal
    for (let i = 0; i < 12; i++) anim.update(0.05);
    expect(grip(pawn).quaternion.w).toBeCloseTo(1);
    expect(thrustAngle(0, 1)).toBe(0);
    expect(thrustAngle(0.5, 1)).toBe(1);
    expect(thrustAngle(1, 1)).toBe(0);
  });

  it('as the victim it plays hit, then shatters; cancel restores it upright', () => {
    const { pawn, anim } = setup();
    anim.play(pawn, 'shatter', { duration: 0.6 });
    anim.update(0.1);
    expect(pawn.visible).toBe(true);
    anim.update(0.3);
    expect(pawn.visible).toBe(false);
    anim.cancel();
    expect(pawn.visible).toBe(true);
    expect(anim.moving).toBe(false);
  });

  it('cancel mid-thrust puts the spear back and the piece home', () => {
    const { pawn, anim } = setup();
    anim.play(pawn, 'attack', { to: new Vector3(1, 0, -1), duration: 1 });
    anim.update(0.4);
    anim.cancel();
    expect(grip(pawn).quaternion.w).toBe(1);
    expect(pawn.position.length()).toBeCloseTo(0);
  });

  it('hands other pieces to the wrapped animator', () => {
    const { rook, anim } = setup();
    anim.play(rook, 'attack', { to: new Vector3(1, 0, -1), duration: 0.4 });
    for (let i = 0; i < 10; i++) anim.update(0.05);
    expect(rook.position.z).toBeCloseTo(-1);
  });
});
