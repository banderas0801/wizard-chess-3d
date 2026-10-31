import {
  AdditiveBlending,
  BackSide,
  Color,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  type Texture,
} from 'three';
import { FLOOR_Y } from './board';
import { Profile } from './profile';

const TEX = `${import.meta.env.BASE_URL}textures/`;

function pbr(loader: TextureLoader, name: string, repeat: Vector2, anisotropy: number, tint = '#ffffff'): MeshStandardMaterial {
  const load = (suffix: string, srgb: boolean): Texture => {
    const t = loader.load(`${TEX}${name}_${suffix}_1k.jpg`);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.copy(repeat);
    t.anisotropy = anisotropy;
    if (srgb) t.colorSpace = SRGBColorSpace;
    return t;
  };
  return new MeshStandardMaterial({
    color: new Color(tint),
    map: load('diff', true),
    normalMap: load('nor_gl', false),
    roughnessMap: load('rough', false),
    roughness: 1,
  });
}

/** A column: square-ish plinth, torus mouldings, slightly tapered shaft, flared capital. */
function columnProfile(height: number): Profile {
  const r = 0.62;
  return new Profile()
    .to(r * 1.45, 0)
    .corner()
    .to(r * 1.45, 0.35)
    .corner()
    .to(r * 1.3, 0.38)
    .arc(r * 1.25, 0.5, 0.12, -Math.PI / 2, Math.PI / 2, 8)
    .corner()
    .to(r * 1.12, 0.66)
    .arc(r * 1.1, 0.74, 0.08, -Math.PI / 2, Math.PI / 2, 6)
    .corner()
    .to(r, 0.85)
    .curve([[r * 0.96, height * 0.5], [r * 0.9, height - 0.9]], 10)
    .arc(r * 0.92, height - 0.82, 0.08, -Math.PI / 2, Math.PI / 2, 6)
    .corner()
    .curve([[r * 1.1, height - 0.5], [r * 1.45, height - 0.3]], 8)
    .corner()
    .to(r * 1.55, height - 0.3)
    .corner()
    .to(r * 1.55, height)
    .corner()
    .to(0, height);
}

export interface Hall {
  readonly group: Group;
}

/** Warm stone hall: textured floor, a ring of columns with torches, curved back wall. Nothing here casts shadows. */
export function createHall(anisotropy: number, lowDetail = false): Hall {
  const group = new Group();
  group.name = 'hall';
  const loader = new TextureLoader();

  const floor = new Mesh(
    new PlaneGeometry(90, 90),
    pbr(loader, 'monastery_stone_floor', new Vector2(26, 26), anisotropy, '#8f877c'),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  floor.receiveShadow = true;
  group.add(floor);

  const stone = pbr(loader, 'large_sandstone_blocks_01', new Vector2(3, 5), anisotropy, '#d6c4a6');
  const H = 11;
  const colGeo = new LatheGeometry(columnProfile(H).points, lowDetail ? 20 : 48);
  const flameMat = new MeshBasicMaterial({ color: new Color(3, 1.3, 0.4), toneMapped: false });
  const glowMat = new MeshBasicMaterial({ color: new Color(1, 0.45, 0.12), transparent: true, opacity: 0.18, blending: AdditiveBlending, depthWrite: false });
  const bowl = new CylinderGeometry(0.28, 0.12, 0.22, 24, 1, true);
  const bowlMat = new MeshStandardMaterial({ color: '#3a2a1a', metalness: 0.8, roughness: 0.45, side: BackSide });
  const bowlOut = new MeshStandardMaterial({ color: '#b08440', metalness: 1, roughness: 0.35 });
  const N = 10;
  const R = 14;
  for (let i = 0; i < N; i++) {
    const a = ((i + 0.5) / N) * Math.PI * 2;
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    const col = new Mesh(colGeo, stone);
    col.position.set(x, FLOOR_Y, z);
    col.receiveShadow = true;
    group.add(col);
    // Torch on the inner face of each column.
    const tx = Math.cos(a) * (R - 1.0);
    const tz = Math.sin(a) * (R - 1.0);
    const ty = FLOOR_Y + 3.6;
    const b1 = new Mesh(bowl, bowlOut);
    const b2 = new Mesh(bowl, bowlMat);
    for (const b of [b1, b2]) {
      b.position.set(tx, ty, tz);
      group.add(b);
    }
    const flame = new Mesh(new SphereGeometry(0.17, 16, 12), flameMat);
    flame.scale.set(1, 1.7, 1);
    flame.position.set(tx, ty + 0.25, tz);
    group.add(flame);
    const glow = new Mesh(new SphereGeometry(0.32, 16, 12), glowMat);
    glow.position.copy(flame.position);
    group.add(glow);
    if (!lowDetail || i % 2 === 0) {
      const light = new PointLight('#ff9a4a', lowDetail ? 16 : 10, 26, 1.8);
      light.position.set(tx, ty + 0.5, tz);
      group.add(light);
    }
  }

  // Curved outer wall, plus a dark vault overhead.
  const wall = new Mesh(new CylinderGeometry(24, 24, 18, lowDetail ? 32 : 72, 1, true), pbr(loader, 'large_sandstone_blocks_01', new Vector2(26, 4), anisotropy, '#9c8466'));
  wall.material.side = BackSide;
  wall.position.y = FLOOR_Y + 9;
  group.add(wall);
  return { group };
}
