import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type CameraPreset = 'player' | 'top' | 'side' | 'cathedral';

export interface ObstacleCylinder {
  x: number;
  z: number;
  radius: number;
  maxY: number;
}

export interface CameraTransition {
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  startTarget: THREE.Vector3;
  endTarget: THREE.Vector3;
  durationMs: number;
  elapsedMs: number;
  onComplete?: (() => void) | undefined;
}

/**
 * Bộ điều khiển Camera hoàn chỉnh:
 * 1. Tích hợp OrbitControls có damping mượt mà
 * 2. Chuyển đổi giữa 4 góc nhìn Preset bằng hàm nội suy mượt
 * 3. Chống xuyên vật thể (Cylinder Collision Sliding) thuần giải tích, không raycast
 */
export class ChessCameraController {
  public camera: THREE.PerspectiveCamera;
  public controls: OrbitControls;
  public obstacles: ObstacleCylinder[] = [];

  private activeTransition: CameraTransition | null = null;
  private presets: Record<CameraPreset, { pos: THREE.Vector3; target: THREE.Vector3 }>;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera;
    this.controls = new OrbitControls(this.camera, domElement);

    // Cấu hình OrbitControls tối ưu cho game bàn cờ
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 3.5;
    this.controls.maxDistance = 26.0;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05; // Không cho camera chúc xuống dưới sàn
    this.controls.minPolarAngle = 0.05;

    // 4 Góc nhìn mẫu chuẩn xác
    this.presets = {
      player: {
        pos: new THREE.Vector3(0, 11, 14),
        target: new THREE.Vector3(0, 0, 0)
      },
      top: {
        pos: new THREE.Vector3(0, 18, 0.01),
        target: new THREE.Vector3(0, 0, 0)
      },
      side: {
        pos: new THREE.Vector3(14, 9, 0),
        target: new THREE.Vector3(0, 0, 0)
      },
      cathedral: {
        pos: new THREE.Vector3(-12, 14, 16),
        target: new THREE.Vector3(0, 0, -2)
      }
    };
  }

  public addObstacles(cylinders: ObstacleCylinder[]): void {
    this.obstacles.push(...cylinders);
  }

  public flyTo(preset: CameraPreset, durationMs = 800, onComplete?: () => void): void {
    const targetConfig = this.presets[preset];
    if (!targetConfig) return;

    this.activeTransition = {
      startPos: this.camera.position.clone(),
      endPos: targetConfig.pos.clone(),
      startTarget: this.controls.target.clone(),
      endTarget: targetConfig.target.clone(),
      durationMs: Math.max(50, durationMs),
      elapsedMs: 0,
      onComplete: onComplete || undefined
    };
  }

  public update(deltaSec: number): void {
    const deltaMs = deltaSec * 1000;

    if (this.activeTransition) {
      this.activeTransition.elapsedMs += deltaMs;
      const progress = Math.min(1, this.activeTransition.elapsedMs / this.activeTransition.durationMs);
      const ease = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      this.camera.position.lerpVectors(this.activeTransition.startPos, this.activeTransition.endPos, ease);
      this.controls.target.lerpVectors(this.activeTransition.startTarget, this.activeTransition.endTarget, ease);
      this.camera.lookAt(this.controls.target);

      if (progress >= 1) {
        const cb = this.activeTransition.onComplete;
        this.activeTransition = null;
        if (cb) cb();
      }
    } else {
      this.controls.update();
    }

    this._resolveCylinderCollisions();
  }

  private _resolveCylinderCollisions(): void {
    const camPos = this.camera.position;

    for (const obs of this.obstacles) {
      if (camPos.y > obs.maxY) continue;

      const dx = camPos.x - obs.x;
      const dz = camPos.z - obs.z;
      const distSq = dx * dx + dz * dz;
      const minRadius = obs.radius + 0.35;

      if (distSq < minRadius * minRadius) {
        const dist = Math.sqrt(distSq) || 0.001;
        camPos.x = obs.x + (dx / dist) * minRadius;
        camPos.z = obs.z + (dz / dist) * minRadius;
      }
    }
  }

  public dispose(): void {
    this.controls.dispose();
  }
}
