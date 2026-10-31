import * as THREE from 'three';

export interface Board3D {
  group: THREE.Group;
  getTileWorldPosition: (r: number, c: number) => THREE.Vector3;
  tileSize: number;
}

/**
 * Xây dựng bàn cờ 8x8 với hình học hình khối chuẩn xác và vật liệu PBR tương phản
 */
export function createChessBoard(): Board3D {
  const group = new THREE.Group();
  const tileSize = 1.2;
  const tileHeight = 0.15;

  // 1. Khung viền bàn cờ
  const borderGeo = new THREE.BoxGeometry(tileSize * 8 + 0.8, 0.4, tileSize * 8 + 0.8);
  const borderMat = new THREE.MeshStandardMaterial({
    color: 0x0f141f,
    roughness: 0.35,
    metalness: 0.4
  });
  const border = new THREE.Mesh(borderGeo, borderMat);
  border.position.y = 0.2;
  border.receiveShadow = true;
  group.add(border);

  // 2. Viền kim loại mạ vàng
  const goldTrimGeo = new THREE.BoxGeometry(tileSize * 8 + 0.95, 0.06, tileSize * 8 + 0.95);
  const goldTrimMat = new THREE.MeshStandardMaterial({
    color: 0xd4af37,
    roughness: 0.2,
    metalness: 0.85
  });
  const goldTrim = new THREE.Mesh(goldTrimGeo, goldTrimMat);
  goldTrim.position.y = 0.42;
  group.add(goldTrim);

  // 3. 64 Ô cờ (White Marble vs Dark Obsidian)
  const whiteTileMat = new THREE.MeshStandardMaterial({
    color: 0xf1f5f9,
    roughness: 0.15,
    metalness: 0.1
  });

  const blackTileMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.2,
    metalness: 0.35
  });

  const tileGeo = new THREE.BoxGeometry(tileSize * 0.98, tileHeight, tileSize * 0.98);

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const isWhite = (r + c) % 2 === 0;
      const tile = new THREE.Mesh(tileGeo, isWhite ? whiteTileMat : blackTileMat);
      const x = (c - 3.5) * tileSize;
      const z = (r - 3.5) * tileSize;
      tile.position.set(x, 0.46, z);
      tile.receiveShadow = true;
      tile.userData = { r, c, isTile: true };
      group.add(tile);
    }
  }

  function getTileWorldPosition(r: number, c: number): THREE.Vector3 {
    return new THREE.Vector3((c - 3.5) * tileSize, 0.54, (r - 3.5) * tileSize);
  }

  return {
    group,
    getTileWorldPosition,
    tileSize
  };
}
