import * as THREE from 'three';

export type PieceType = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';
export type PieceColor = 'w' | 'b';

export interface Piece3D {
  mesh: THREE.Group;
  type: PieceType;
  color: PieceColor;
  gridPos: { r: number; c: number };
  moveTo: (targetWorldPos: THREE.Vector3, renderer: THREE.WebGLRenderer, onComplete?: () => void) => void;
}

/**
 * Quản lý khởi tạo quân cờ bằng hình học cơ bản có viền hào quang và cơ chế cập nhật bóng tối ưu
 */
export class PieceManager {
  private whiteMat: THREE.MeshStandardMaterial;
  private blackMat: THREE.MeshStandardMaterial;
  private goldMat: THREE.MeshStandardMaterial;

  constructor() {
    // 1. Bạch Ngọc: Trắng tinh khiết, bóng bẩy
    this.whiteMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.15,
      metalness: 0.15,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.15
    });

    // 2. Hắc Thạch: Đen tuyền Obsidian, rãnh ma thuật tím
    this.blackMat = new THREE.MeshStandardMaterial({
      color: 0x0a0e17,
      roughness: 0.15,
      metalness: 0.45,
      emissive: 0xa855f7,
      emissiveIntensity: 0.65
    });

    // 3. Viền mạ kim loại vàng
    this.goldMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      roughness: 0.2,
      metalness: 0.85
    });
  }

  public createPiece(type: PieceType, color: PieceColor, r: number, c: number): Piece3D {
    const group = new THREE.Group();
    const mat = color === 'w' ? this.whiteMat : this.blackMat;

    // Chân đế 2 tầng có viền kim loại
    const baseGeo = new THREE.CylinderGeometry(0.42, 0.48, 0.14, 20);
    const baseMesh = new THREE.Mesh(baseGeo, mat);
    baseMesh.position.y = 0.07;
    group.add(baseMesh);

    const rimGeo = new THREE.CylinderGeometry(0.45, 0.5, 0.05, 20);
    const rimMesh = new THREE.Mesh(rimGeo, this.goldMat);
    rimMesh.position.y = 0.025;
    group.add(rimMesh);

    // Vòng hào quang ma thuật (Aura Ring) định vị trên sàn
    const haloGeo = new THREE.RingGeometry(0.35, 0.46, 24);
    haloGeo.rotateX(-Math.PI / 2);
    const haloMat = new THREE.MeshBasicMaterial({
      color: color === 'w' ? 0xf59e0b : 0xa855f7,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.y = 0.145;
    group.add(halo);

    // Dựng hình học thân và đầu theo loại quân
    switch (type) {
      case 'pawn': {
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.35, 0.65, 16), mat);
        body.position.y = 0.45;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 16), mat);
        head.position.y = 0.88;
        group.add(body, head);
        break;
      }
      case 'knight': {
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.38, 0.65, 16), mat);
        body.position.y = 0.45;
        const neck = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.45, 0.35), mat);
        neck.position.set(0, 0.82, 0.08);
        neck.rotation.x = -Math.PI / 8;
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.32, 0.45), mat);
        head.position.set(0, 1.05, 0.22);
        group.add(body, neck, head);
        break;
      }
      case 'bishop': {
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.36, 0.9, 16), mat);
        body.position.y = 0.58;
        const mitre = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.55, 12), mat);
        mitre.position.y = 1.25;
        const gem = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 12), this.goldMat);
        gem.position.y = 1.55;
        group.add(body, mitre, gem);
        break;
      }
      case 'rook': {
        const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 0.85, 16), mat);
        tower.position.y = 0.55;
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.3, 0.25, 16), mat);
        cap.position.y = 1.08;
        group.add(tower, cap);
        break;
      }
      case 'queen': {
        const gown = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.38, 1.1, 16), mat);
        gown.position.y = 0.68;
        const crown = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.38, 8), this.goldMat);
        crown.position.y = 1.35;
        crown.rotation.x = Math.PI;
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), this.goldMat);
        gem.position.y = 1.58;
        group.add(gown, crown, gem);
        break;
      }
      case 'king': {
        const mantle = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.42, 1.2, 16), mat);
        mantle.position.y = 0.72;
        const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.25, 0.35, 16), mat);
        crown.position.y = 1.45;
        const cross = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.32, 0.08), this.goldMat);
        cross.position.y = 1.75;
        group.add(mantle, crown, cross);
        break;
      }
    }

    // Đổ bóng & nhận bóng
    group.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    const piece: Piece3D = {
      mesh: group,
      type,
      color,
      gridPos: { r, c },
      moveTo: (targetWorldPos: THREE.Vector3, renderer: THREE.WebGLRenderer, onComplete?: () => void) => {
        // TỐI ƯU CỐT LÕI: shadowMap.needsUpdate = true CHỈ KHI QUÂN DI CHUYỂN
        renderer.shadowMap.needsUpdate = true;

        const startPos = group.position.clone();
        const startTime = performance.now();
        const duration = 280; // 280ms

        function animate(now: number) {
          const elapsed = now - startTime;
          const progress = Math.min(1, elapsed / duration);
          const easeOut = 1 - Math.pow(1 - progress, 3);

          group.position.lerpVectors(startPos, targetWorldPos, easeOut);
          // Nâng nhẹ lên khỏi mặt sàn khi di chuyển
          group.position.y = targetWorldPos.y + Math.sin(progress * Math.PI) * 0.25;

          // Trong suốt quá trình di chuyển, cập nhật bóng đổ
          renderer.shadowMap.needsUpdate = true;

          if (progress < 1) {
            requestAnimationFrame(animate);
          } else {
            group.position.copy(targetWorldPos);
            // Một frame cuối để cố định bóng đổ tĩnh
            renderer.shadowMap.needsUpdate = true;
            if (onComplete) onComplete();
          }
        }

        requestAnimationFrame(animate);
      }
    };

    return piece;
  }
}
