import * as THREE from 'three';

export type PieceAnimationClip = 'idle' | 'move' | 'attack' | 'shatter';

export interface PieceAnimator {
  play(clip: PieceAnimationClip, onComplete?: () => void): void;
  setAttackDirection(dir: THREE.Vector3): void;
  resetTransforms(): void;
  update(deltaSec: number): void;
  dispose(): void;
}

interface ShatterDebris {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  rotVelocity: THREE.Vector3;
  lifeSec: number;
  maxLifeSec: number;
}

/**
 * Bộ tạo chuyển động thủ tục (Procedural Piece Animator)
 * 100% tự sinh bằng mã toán học, định hướng lunge theo đúng vector nước đi.
 */
export class ProceduralPieceAnimator implements PieceAnimator {
  public mesh: THREE.Group;
  public scene: THREE.Scene;
  public currentClip: PieceAnimationClip = 'idle';

  private activeDebris: ShatterDebris[] = [];
  private actionTimer = 0;
  private actionDuration = 0;
  private onActionComplete?: (() => void) | undefined;
  private baseScale = new THREE.Vector3(1, 1, 1);
  private attackDirection = new THREE.Vector3(0, 0, 1);

  constructor(mesh: THREE.Group, scene: THREE.Scene) {
    this.mesh = mesh;
    this.scene = scene;
    this.baseScale.copy(mesh.scale);
  }

  public setAttackDirection(dir: THREE.Vector3): void {
    if (dir.lengthSq() > 0.0001) {
      this.attackDirection.copy(dir).normalize();
    }
  }

  public play(clip: PieceAnimationClip, onComplete?: () => void): void {
    this.currentClip = clip;
    this.actionTimer = 0;
    this.onActionComplete = onComplete || undefined;

    switch (clip) {
      case 'idle':
        this.actionDuration = Infinity;
        this.mesh.visible = true;
        break;

      case 'move':
        this.actionDuration = 0.35;
        this.mesh.visible = true;
        break;

      case 'attack':
        this.actionDuration = 0.45;
        this.mesh.visible = true;
        break;

      case 'shatter':
        this.actionDuration = 1.8;
        this._spawnShatterParticles();
        this.mesh.visible = false;
        break;
    }
  }

  public resetTransforms(): void {
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.scale.copy(this.baseScale);
    this.mesh.visible = true;
    this.dispose(); // Dọn dẹp sạch mọi mảnh vỡ đang bay nếu bị Undo/Cancel
  }

  public update(deltaSec: number): void {
    this.actionTimer += deltaSec;

    switch (this.currentClip) {
      case 'idle': {
        const breath = Math.sin(this.actionTimer * 2.5) * 0.02;
        this.mesh.scale.set(
          this.baseScale.x * (1 - breath * 0.5),
          this.baseScale.y * (1 + breath),
          this.baseScale.z * (1 - breath * 0.5)
        );
        break;
      }

      case 'move': {
        const progress = Math.min(1, this.actionTimer / this.actionDuration);
        const tilt = Math.sin(progress * Math.PI) * 0.12;
        this.mesh.rotation.x = tilt;

        if (progress >= 1 && this.onActionComplete) {
          this.mesh.rotation.x = 0;
          const cb = this.onActionComplete;
          this.onActionComplete = undefined;
          cb();
        }
        break;
      }

      case 'attack': {
        const progress = Math.min(1, this.actionTimer / this.actionDuration);
        let lungeOffset = 0;

        if (progress < 0.6) {
          const lungeProgress = progress / 0.6;
          lungeOffset = Math.sin(lungeProgress * Math.PI * 0.5) * 0.15;
        } else {
          const recoilProgress = (progress - 0.6) / 0.4;
          lungeOffset = Math.cos(recoilProgress * Math.PI * 0.5) * 0.15;
        }

        // Lao tới theo đúng vector hướng tấn công (attackDirection) chứ không mặc định trục Z
        this.mesh.position.addScaledVector(this.attackDirection, lungeOffset * deltaSec * 8);

        if (progress >= 1 && this.onActionComplete) {
          const cb = this.onActionComplete;
          this.onActionComplete = undefined;
          cb();
        }
        break;
      }

      case 'shatter': {
        this._updateDebris(deltaSec);
        if (this.actionTimer >= this.actionDuration && this.onActionComplete) {
          const cb = this.onActionComplete;
          this.onActionComplete = undefined;
          cb();
        }
        break;
      }
    }
  }

  private _spawnShatterParticles(): void {
    const origin = this.mesh.position.clone();
    const fragmentCount = 20;

    const fragGeo = new THREE.DodecahedronGeometry(0.12, 0);
    const fragMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.4,
      metalness: 0.2,
      transparent: true,
      opacity: 1.0
    });

    for (let i = 0; i < fragmentCount; i++) {
      const fragMesh = new THREE.Mesh(fragGeo, fragMat.clone());
      fragMesh.position.copy(origin);
      fragMesh.position.y += Math.random() * 0.6 + 0.1;

      const theta = Math.random() * Math.PI * 2;
      const speed = Math.random() * 4.5 + 1.5;
      const upVelocity = Math.random() * 5.0 + 3.0;

      const velocity = new THREE.Vector3(
        Math.cos(theta) * speed,
        upVelocity,
        Math.sin(theta) * speed
      );

      const rotVelocity = new THREE.Vector3(
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 12
      );

      this.scene.add(fragMesh);
      this.activeDebris.push({
        mesh: fragMesh,
        velocity,
        rotVelocity,
        lifeSec: 1.6,
        maxLifeSec: 1.6
      });
    }
  }

  private _updateDebris(deltaSec: number): void {
    for (let i = this.activeDebris.length - 1; i >= 0; i--) {
      const d = this.activeDebris[i]!;
      d.lifeSec -= deltaSec;

      if (d.lifeSec <= 0) {
        this.scene.remove(d.mesh);
        d.mesh.geometry.dispose();
        (d.mesh.material as THREE.Material).dispose();
        this.activeDebris.splice(i, 1);
        continue;
      }

      d.mesh.position.addScaledVector(d.velocity, deltaSec);
      d.velocity.y -= 9.8 * deltaSec;

      d.mesh.rotation.x += d.rotVelocity.x * deltaSec;
      d.mesh.rotation.y += d.rotVelocity.y * deltaSec;

      if (d.mesh.position.y < 0.1) {
        d.mesh.position.y = 0.1;
        d.velocity.y = -d.velocity.y * 0.35;
        d.velocity.x *= 0.7;
        d.velocity.z *= 0.7;
      }

      const mat = d.mesh.material as THREE.MeshStandardMaterial;
      mat.opacity = Math.max(0, d.lifeSec / d.maxLifeSec);
    }
  }

  public dispose(): void {
    for (const d of this.activeDebris) {
      this.scene.remove(d.mesh);
      d.mesh.geometry.dispose();
      (d.mesh.material as THREE.Material).dispose();
    }
    this.activeDebris.length = 0;
  }
}
