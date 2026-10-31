import {
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  BoxGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import type { Board, Color, PieceType } from '../game';
import { squareToWorld } from './board';

type Profile = readonly (readonly [radius: number, height: number])[];

// Half-profiles (radius, y) revolved around Y. Hand-authored, unit = one square.
const BASE: Profile = [
  [0, 0], [0.34, 0], [0.34, 0.06], [0.3, 0.09], [0.27, 0.12], [0.2, 0.16],
];

const PROFILES: Record<Exclude<PieceType, 'knight'>, Profile> = {
  pawn: [...BASE, [0.13, 0.3], [0.1, 0.42], [0.16, 0.45], [0.1, 0.48], [0, 0.48]],
  rook: [...BASE, [0.18, 0.5], [0.24, 0.54], [0.24, 0.72], [0.16, 0.72], [0.16, 0.66], [0, 0.66]],
  bishop: [...BASE, [0.12, 0.45], [0.09, 0.55], [0.18, 0.58], [0.09, 0.61], [0.14, 0.72], [0.1, 0.84], [0.03, 0.9], [0, 0.92]],
  queen: [...BASE, [0.13, 0.5], [0.1, 0.68], [0.2, 0.72], [0.12, 0.76], [0.22, 0.92], [0.12, 0.94], [0.06, 1.0], [0, 1.0]],
  king: [...BASE, [0.14, 0.55], [0.11, 0.74], [0.21, 0.78], [0.13, 0.82], [0.19, 0.98], [0, 0.98]],
};

const LATHE_SEGMENTS = 40;

function lathe(profile: Profile): BufferGeometry {
  return new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), LATHE_SEGMENTS);
}

function addPart(group: Group, geo: BufferGeometry, mat: Material, pos?: Vector3, rotZ = 0, rotY = 0): void {
  const m = new Mesh(geo, mat);
  if (pos) m.position.copy(pos);
  m.rotation.set(0, rotY, rotZ);
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
}

function buildPiece(type: PieceType, color: Color, mat: Material): Group {
  const g = new Group();
  const facing = color === 'white' ? 0 : Math.PI;
  switch (type) {
    case 'knight': {
      addPart(g, lathe([...BASE, [0.17, 0.3], [0.17, 0.34], [0, 0.34]]), mat);
      // Blocky stylised head: neck + muzzle, turned to face the opponent.
      const head = new Group();
      addPart(head, new BoxGeometry(0.2, 0.42, 0.26), mat, new Vector3(0, 0.52, 0.02), 0);
      addPart(head, new BoxGeometry(0.18, 0.16, 0.3), mat, new Vector3(0, 0.66, -0.13), 0);
      addPart(head, new BoxGeometry(0.05, 0.1, 0.05), mat, new Vector3(0.06, 0.78, 0.06));
      addPart(head, new BoxGeometry(0.05, 0.1, 0.05), mat, new Vector3(-0.06, 0.78, 0.06));
      head.rotation.y = facing;
      g.add(head);
      break;
    }
    case 'king': {
      addPart(g, lathe(PROFILES.king), mat);
      addPart(g, new BoxGeometry(0.05, 0.2, 0.05), mat, new Vector3(0, 1.07, 0));
      addPart(g, new BoxGeometry(0.15, 0.05, 0.05), mat, new Vector3(0, 1.1, 0));
      break;
    }
    case 'queen': {
      addPart(g, lathe(PROFILES.queen), mat);
      addPart(g, new SphereGeometry(0.045, 16, 12), mat, new Vector3(0, 1.03, 0));
      break;
    }
    case 'rook': {
      addPart(g, lathe(PROFILES.rook), mat);
      // Crenellations.
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        addPart(g, new CylinderGeometry(0.05, 0.05, 0.08, 8), mat, new Vector3(Math.cos(a) * 0.2, 0.76, Math.sin(a) * 0.2));
      }
      break;
    }
    default:
      addPart(g, lathe(PROFILES[type]), mat);
  }
  return g;
}

export interface PieceLayer {
  readonly group: Group;
  /** Reconcile meshes to the board. Returns true if any piece moved, appeared or disappeared. */
  sync(board: Board): boolean;
}

export function createPieces(): PieceLayer {
  const group = new Group();
  group.name = 'pieces';
  const materials: Record<Color, MeshStandardMaterial> = {
    white: new MeshStandardMaterial({ color: '#f1ece2', roughness: 0.35, metalness: 0.0 }),
    black: new MeshStandardMaterial({ color: '#1d1b22', roughness: 0.25, metalness: 0.2 }),
  };
  const meshes = new Map<string, Group>();
  const tmp = new Vector3();

  return {
    group,
    sync(board) {
      let changed = false;
      const alive = new Set<string>();
      for (const [sq, piece] of board) {
        alive.add(piece.id);
        let obj = meshes.get(piece.id);
        if (!obj) {
          obj = buildPiece(piece.type, piece.color, materials[piece.color]);
          obj.name = piece.id;
          meshes.set(piece.id, obj);
          group.add(obj);
          changed = true;
        }
        squareToWorld(sq, tmp);
        if (!obj.position.equals(tmp)) {
          obj.position.copy(tmp);
          changed = true;
        }
      }
      for (const [id, obj] of meshes) {
        if (alive.has(id)) continue;
        group.remove(obj);
        obj.traverse((o) => {
          if (o instanceof Mesh) o.geometry.dispose();
        });
        meshes.delete(id);
        changed = true;
      }
      return changed;
    },
  };
}
