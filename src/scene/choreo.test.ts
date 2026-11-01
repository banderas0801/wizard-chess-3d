import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { MoveChoreographer, ChoreoParticipant } from './choreo';
import { createInitialGameState, toFEN, Move } from '../game';
import { PieceAnimator } from './anim';

describe('MoveChoreographer (Choreography Engine & Reviewer Invariants)', () => {
  let mockRenderer: THREE.WebGLRenderer;
  let mockAnimator: PieceAnimator;
  let fenChanges: string[] = [];
  let lockSelections: boolean[] = [];

  function createMockParticipant(x1: number, z1: number, x2: number, z2: number): ChoreoParticipant {
    const mesh = new THREE.Group();
    mesh.position.set(x1, 0.5, z1);
    return {
      mesh,
      animator: mockAnimator,
      originWorldPos: new THREE.Vector3(x1, 0.5, z1),
      targetWorldPos: new THREE.Vector3(x2, 0.5, z2)
    };
  }

  beforeEach(() => {
    fenChanges = [];
    lockSelections = [];
    mockRenderer = {
      shadowMap: {
        autoUpdate: false,
        needsUpdate: false
      }
    } as unknown as THREE.WebGLRenderer;

    mockAnimator = {
      play: vi.fn(),
      setAttackDirection: vi.fn(),
      resetTransforms: vi.fn(),
      update: vi.fn(),
      dispose: vi.fn()
    };
  });

  it('Luật 1: Nước đi thường -> FEN chỉ đổi duy nhất một lần tại settling', () => {
    const gameState = createInitialGameState();
    const initialFen = toFEN(gameState);

    const choreo = new MoveChoreographer({
      renderer: mockRenderer,
      gameState,
      getTier: () => 'high',
      onFenChange: (fen) => fenChanges.push(fen),
      onLockSelection: (locked) => lockSelections.push(locked)
    });

    const move: Move = {
      from: { r: 6, c: 4 },
      to: { r: 4, c: 4 },
      piece: { type: 'pawn', color: 'w' },
      captured: null
    };

    const attacker = createMockParticipant(0, 2, 0, 0);

    expect(choreo.executeMove(move, attacker)).toBe(true);
    expect(choreo.state).toBe('approaching');
    expect(fenChanges.length).toBe(0);
    expect(lockSelections).toContain(true);

    // Chạy qua giai đoạn approaching
    choreo.update(0.15);
    expect(fenChanges.length).toBe(0);

    choreo.update(0.2);
    expect(choreo.state).toBe('settling');

    // Chạy frame settling -> Áp FEN và về idle
    choreo.update(0.016);
    expect(choreo.state).toBe('idle');
    expect(fenChanges.length).toBe(1); // FEN ĐỔI ĐÚNG 1 LẦN!
    expect(fenChanges[0]).not.toBe(initialFen);
    expect(lockSelections[lockSelections.length - 1]).toBe(false);
  });

  it('Luật 2: Nước ăn quân -> đi qua approaching -> striking -> settling -> FEN đổi 1 lần', () => {
    const gameState = createInitialGameState();

    const choreo = new MoveChoreographer({
      renderer: mockRenderer,
      gameState,
      getTier: () => 'high',
      onFenChange: (fen) => fenChanges.push(fen),
      onLockSelection: (locked) => lockSelections.push(locked)
    });

    const move: Move = {
      from: { r: 4, c: 4 },
      to: { r: 3, c: 3 },
      piece: { type: 'bishop', color: 'w' },
      captured: { type: 'pawn', color: 'b' }
    };

    const attacker = createMockParticipant(0, 0, 1, 1);
    const victim = createMockParticipant(1, 1, 1, 1);

    choreo.executeMove(move, attacker, victim);
    expect(choreo.state).toBe('approaching');

    // Hết approaching -> sang striking
    choreo.update(0.3);
    expect(choreo.state).toBe('striking');
    expect(fenChanges.length).toBe(0);

    // Hết striking -> sang settling
    choreo.update(0.55);
    expect(choreo.state).toBe('settling');

    choreo.update(0.016);
    expect(choreo.state).toBe('idle');
    expect(fenChanges.length).toBe(1);
  });

  it('Luật 3 (Reviewer Test): Hủy giữa lúc đang striking -> FEN TUYỆT ĐỐI KHÔNG ĐỔI', () => {
    const gameState = createInitialGameState();
    const originalFen = toFEN(gameState);

    const choreo = new MoveChoreographer({
      renderer: mockRenderer,
      gameState,
      getTier: () => 'high',
      onFenChange: (fen) => fenChanges.push(fen),
      onLockSelection: (locked) => lockSelections.push(locked)
    });

    const move: Move = {
      from: { r: 6, c: 4 },
      to: { r: 1, c: 4 },
      piece: { type: 'queen', color: 'w' },
      captured: { type: 'pawn', color: 'b' }
    };

    const attacker = createMockParticipant(0, 3, 0, -2);
    const victim = createMockParticipant(0, -2, 0, -2);

    choreo.executeMove(move, attacker, victim);

    choreo.update(0.25);
    expect(choreo.state).toBe('striking');

    // USER BẤM UNDO GIỮA CHỪNG KHI ĐANG TUNG ĐÒN
    choreo.cancel();

    expect(choreo.state).toBe('aborting');
    expect(attacker.animator.resetTransforms).toHaveBeenCalled();

    choreo.update(0.016);
    expect(choreo.state).toBe('idle');

    // BẢO VỆ BẤT BIẾN FEN: Không đổi lần nào
    expect(fenChanges.length).toBe(0);
    expect(toFEN(gameState)).toBe(originalFen);
  });

  it('Luật 4 (Reviewer Test Mới): Hủy SAU KHI QUÂN ĐÃ VỠ ĐÁ -> Dọn sạch mảnh vỡ, hồi sinh mesh, FEN không đổi', () => {
    const gameState = createInitialGameState();
    const originalFen = toFEN(gameState);

    const choreo = new MoveChoreographer({
      renderer: mockRenderer,
      gameState,
      getTier: () => 'high',
      onFenChange: (fen) => fenChanges.push(fen),
      onLockSelection: (locked) => lockSelections.push(locked)
    });

    const move: Move = {
      from: { r: 7, c: 0 },
      to: { r: 0, c: 0 },
      piece: { type: 'rook', color: 'w' },
      captured: { type: 'rook', color: 'b' }
    };

    const attacker = createMockParticipant(0, 3, 0, -3);
    const victim = createMockParticipant(0, -3, 0, -3);

    choreo.executeMove(move, attacker, victim);

    // Qua approaching (0.38s) -> vào striking
    choreo.update(0.40);
    expect(choreo.state).toBe('striking');

    // Chạy qua mốc va chạm (0.20s của rook) -> quân bị ăn vỡ đá (shatter được gọi)
    choreo.update(0.22);
    expect(victim.animator.play).toHaveBeenCalledWith('shatter');

    // NGAY LÚC MẢNH ĐÁ ĐANG BAY (chưa tới settling), USER BẤM UNDO!
    choreo.cancel();

    expect(choreo.state).toBe('aborting');
    // Bắt buộc gọi resetTransforms để dọn mảnh vỡ và hồi sinh quân bị ăn
    expect(victim.animator.resetTransforms).toHaveBeenCalled();
    expect(victim.mesh.position.x).toBe(victim.originWorldPos.x);

    choreo.update(0.016);
    expect(choreo.state).toBe('idle');

    // FEN PHẢI NGUYÊN VẸN KHÔNG ĐỔI!
    expect(fenChanges.length).toBe(0);
    expect(toFEN(gameState)).toBe(originalFen);
  });
});
