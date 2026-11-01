import * as THREE from 'three';
import { QualityTier } from '../render/post';
import { GameState, Move, PieceType, toFEN } from '../game';
import { PieceAnimator } from './anim';

export type ChoreoState = 'idle' | 'approaching' | 'striking' | 'settling' | 'aborting';
export type StrikeFxType = 'shield_slam' | 'leap_slam' | 'arcane_beam' | 'titan_clap' | 'blade_vortex' | 'royal_cleave';

export interface StrikeProfile {
  pieceType: PieceType;
  approachDurationSec: number;
  strikeDurationSec: number;
  impactAtSec: number;
  fxType: StrikeFxType;
}

export const STRIKE_PROFILES: Record<PieceType, StrikeProfile> = {
  pawn: {
    pieceType: 'pawn',
    approachDurationSec: 0.28,
    strikeDurationSec: 0.40,
    impactAtSec: 0.16,
    fxType: 'shield_slam'
  },
  knight: {
    pieceType: 'knight',
    approachDurationSec: 0.35,
    strikeDurationSec: 0.45,
    impactAtSec: 0.22,
    fxType: 'leap_slam'
  },
  bishop: {
    pieceType: 'bishop',
    approachDurationSec: 0.24,
    strikeDurationSec: 0.50,
    impactAtSec: 0.14,
    fxType: 'arcane_beam'
  },
  rook: {
    pieceType: 'rook',
    approachDurationSec: 0.38,
    strikeDurationSec: 0.52,
    impactAtSec: 0.20,
    fxType: 'titan_clap'
  },
  queen: {
    pieceType: 'queen',
    approachDurationSec: 0.22,
    strikeDurationSec: 0.55,
    impactAtSec: 0.24,
    fxType: 'blade_vortex'
  },
  king: {
    pieceType: 'king',
    approachDurationSec: 0.45,
    strikeDurationSec: 0.60,
    impactAtSec: 0.28,
    fxType: 'royal_cleave'
  }
};

export interface ChoreoParticipant {
  mesh: THREE.Group;
  animator: PieceAnimator;
  originWorldPos: THREE.Vector3;
  targetWorldPos: THREE.Vector3;
}

export interface ChoreoConfig {
  renderer: THREE.WebGLRenderer;
  gameState: GameState;
  getTier: () => QualityTier;
  onFenChange: (newFen: string) => void;
  onLockSelection: (locked: boolean) => void; // Chỉ khóa chọn nước mới, không khóa Undo!
  onScreenShake?: ((intensity: number) => void) | undefined;
}

/**
 * Bộ điều phối trạng thái hoạt cảnh nước đi (Choreography Engine)
 * Tuân thủ nghiêm ngặt 4 Luật Bất Biến & Đóng gói StrikeProfile đa hình
 */
export class MoveChoreographer {
  public state: ChoreoState = 'idle';

  private config: ChoreoConfig;
  private currentMove: Move | null = null;
  private currentProfile: StrikeProfile | null = null;
  private attacker: ChoreoParticipant | null = null;
  private victim: ChoreoParticipant | null = null;

  private stateTimer = 0;
  private impactTriggered = false;

  constructor(config: ChoreoConfig) {
    this.config = config;
  }

  public executeMove(
    move: Move,
    attacker: ChoreoParticipant,
    victim?: ChoreoParticipant
  ): boolean {
    if (this.state !== 'idle') return false;

    this.currentMove = move;
    this.attacker = attacker;
    this.victim = victim || null;
    this.currentProfile = STRIKE_PROFILES[move.piece.type];
    this.stateTimer = 0;
    this.impactTriggered = false;

    // 1. Chuyển sang 'approaching'
    this.state = 'approaching';
    this.config.onLockSelection(true); // Chỉ khóa chọn nước mới

    // 2. Bật cập nhật bóng đổ khi quân bắt đầu chuyển động
    this.config.renderer.shadowMap.needsUpdate = true;

    // Định hướng đòn đánh theo vector nước đi thực tế
    const moveDir = new THREE.Vector3().subVectors(attacker.targetWorldPos, attacker.originWorldPos);
    attacker.animator.setAttackDirection(moveDir);
    attacker.animator.play('move');

    return true;
  }

  public update(deltaSec: number): void {
    if (this.state === 'idle') return;

    this.stateTimer += deltaSec;

    // Cập nhật animator của các quân tham gia
    if (this.attacker) this.attacker.animator.update(deltaSec);
    if (this.victim) this.victim.animator.update(deltaSec);

    // Bật bóng đổ khi có quân đang chuyển động
    if (this.state === 'approaching' || this.state === 'striking') {
      this.config.renderer.shadowMap.needsUpdate = true;
    }

    const profile = this.currentProfile || STRIKE_PROFILES.pawn;

    switch (this.state) {
      case 'approaching': {
        if (!this.attacker) return;

        const duration = profile.approachDurationSec;
        const progress = Math.min(1, this.stateTimer / duration);
        const ease = 1 - Math.pow(1 - progress, 2);

        this.attacker.mesh.position.lerpVectors(
          this.attacker.originWorldPos,
          this.attacker.targetWorldPos,
          ease
        );

        // Riêng quân Mã: Nâng độ cao theo hàm sin Parabol
        if (profile.pieceType === 'knight') {
          this.attacker.mesh.position.y = this.attacker.targetWorldPos.y + Math.sin(progress * Math.PI) * 0.45;
        }

        if (progress >= 1) {
          this.attacker.mesh.position.copy(this.attacker.targetWorldPos);

          if (this.victim) {
            // Có ăn quân -> Sang 'striking'
            this.state = 'striking';
            this.stateTimer = 0;
            this.impactTriggered = false;
            this.attacker.animator.play('attack');

            // Rung chấn theo tier
            const tier = this.config.getTier();
            if (tier !== 'off' && this.config.onScreenShake) {
              const intensity = profile.fxType === 'titan_clap' ? 0.65 : 0.35;
              this.config.onScreenShake(intensity);
            }
          } else {
            // Đi thường -> Sang 'settling'
            this._enterSettling();
          }
        }
        break;
      }

      case 'striking': {
        // Mốc thời gian va chạm (impactAtSec) khai báo trong StrikeProfile
        if (!this.impactTriggered && this.stateTimer >= profile.impactAtSec) {
          this.impactTriggered = true;
          if (this.victim) {
            this.victim.animator.play('shatter');
          }
        }

        if (this.stateTimer >= profile.strikeDurationSec) {
          this._enterSettling();
        }
        break;
      }

      case 'settling': {
        // LUẬT BẤT BIẾN SỐ 1: Áp dụng FEN đúng một lần duy nhất tại đây!
        this._commitMoveToDomainState();

        this.config.renderer.shadowMap.needsUpdate = true;
        this.state = 'idle';
        this.config.onLockSelection(false);
        this.currentMove = null;
        this.currentProfile = null;
        this.attacker = null;
        this.victim = null;
        break;
      }

      case 'aborting': {
        this.state = 'idle';
        this.config.onLockSelection(false);
        this.config.renderer.shadowMap.needsUpdate = true;
        this.currentMove = null;
        this.currentProfile = null;
        this.attacker = null;
        this.victim = null;
        break;
      }
    }
  }

  /**
   * BẢN SỬA CỦA APP REVIEWER (HỦY / UNDO AN TOÀN TUYỆT ĐỐI KỂ CẢ KHI QUÂN ĐÃ VỠ ĐÁ)
   */
  public cancel(): void {
    if (this.state === 'idle') return;

    this.state = 'aborting';

    // 1. Phục hồi quân tấn công
    if (this.attacker) {
      this.attacker.mesh.position.copy(this.attacker.originWorldPos);
      this.attacker.animator.resetTransforms();
      this.attacker.animator.play('idle');
    }

    // 2. Phục hồi quân bị ăn (dọn sạch mảnh vỡ đang bay và hiện lại mesh nguyên vẹn)
    if (this.victim) {
      this.victim.mesh.position.copy(this.victim.originWorldPos);
      this.victim.animator.resetTransforms();
      this.victim.animator.play('idle');
    }

    // 3. FEN TUYỆT ĐỐI KHÔNG BỊ THAY ĐỔI
  }

  private _enterSettling(): void {
    this.state = 'settling';
    if (this.attacker) {
      this.attacker.animator.play('idle');
    }
  }

  private _commitMoveToDomainState(): void {
    if (!this.currentMove) return;

    const { from, to, piece, isCastling, isEnPassant, promotion } = this.currentMove;
    const b = this.config.gameState.board;

    // Xử lý nước cờ đặc biệt:
    // 1. En Passant: Xóa tốt đối phương bị bắt
    if (isEnPassant) {
      const capR = piece.color === 'w' ? to.r + 1 : to.r - 1;
      b[capR]![to.c] = null;
    }

    // 2. Nhập thành: Di chuyển quân Xe tương ứng
    if (isCastling) {
      if (to.c === 6) { // Kingside
        b[to.r]![5] = b[to.r]![7];
        b[to.r]![7] = null;
      } else if (to.c === 2) { // Queenside
        b[to.r]![3] = b[to.r]![0];
        b[to.r]![0] = null;
      }
    }

    // 3. Phong cấp: Đổi quân tốt thành Hậu/Xe/Tượng/Mã
    const finalPiece = promotion ? { type: promotion, color: piece.color, hasMoved: true } : { ...piece, hasMoved: true };

    b[to.r]![to.c] = finalPiece;
    b[from.r]![from.c] = null;
    this.config.gameState.turn = this.config.gameState.turn === 'w' ? 'b' : 'w';

    const newFen = toFEN(this.config.gameState);
    this.config.onFenChange(newFen);
  }
}
