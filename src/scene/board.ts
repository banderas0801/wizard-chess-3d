import {
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import { indexToSquare, squareToIndex, type Square } from '../game';

export const SQUARE_SIZE = 1;
export const BOARD_TOP_Y = 0;
const TILE_H = 0.12;

/** World-space centre of a square's top face. White's a1 is at (-3.5, 0, 3.5). */
export function squareToWorld(sq: Square, out = new Vector3()): Vector3 {
  const { file, rank } = squareToIndex(sq);
  return out.set((file - 3.5) * SQUARE_SIZE, BOARD_TOP_Y, (3.5 - rank) * SQUARE_SIZE);
}

export function createBoard(): Group {
  const group = new Group();
  group.name = 'board';

  // Light squares: polished pale stone. Dark squares: glossy near-black volcanic glass.
  const light = new MeshStandardMaterial({ color: new Color('#e9e4da'), roughness: 0.28, metalness: 0.0 });
  const dark = new MeshStandardMaterial({ color: new Color('#16141a'), roughness: 0.12, metalness: 0.35 });
  const tile = new BoxGeometry(SQUARE_SIZE, TILE_H, SQUARE_SIZE);

  const lights = new InstancedMesh(tile, light, 32);
  const darks = new InstancedMesh(tile, dark, 32);
  let li = 0;
  let di = 0;
  const m = new Matrix4();
  const p = new Vector3();
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      squareToWorld(indexToSquare(file, rank), p);
      m.makeTranslation(p.x, BOARD_TOP_Y - TILE_H / 2, p.z);
      // a1 is dark.
      if ((file + rank) % 2 === 0) darks.setMatrixAt(di++, m);
      else lights.setMatrixAt(li++, m);
    }
  }
  for (const mesh of [lights, darks]) {
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    group.add(mesh);
  }

  const frame = new Mesh(
    new BoxGeometry(8 * SQUARE_SIZE + 0.8, 0.3, 8 * SQUARE_SIZE + 0.8),
    new MeshStandardMaterial({ color: '#3b2a1e', roughness: 0.55, metalness: 0.05 }),
  );
  frame.position.y = BOARD_TOP_Y - TILE_H - 0.15 + 0.001;
  frame.receiveShadow = true;
  frame.castShadow = true;
  group.add(frame);

  return group;
}
