import * as THREE from 'three';
import { createRenderer } from './render/renderer';
import { loadEnvironment } from './render/env';
import { createPost, QualityTier } from './render/post';
import { createQualityGovernor } from './render/quality';
import { ChessCameraController } from './render/camera';
import { createChessBoard } from './scene/board';
import { PieceManager, Piece3D } from './scene/pieces';
import { ProceduralPieceAnimator } from './scene/anim';
import { MoveChoreographer, ChoreoParticipant } from './scene/choreo';
import { createInitialGameState, getLegalMoves, Square, Move } from './game';

const container = document.getElementById('canvas-container')!;
const tierBadge = document.getElementById('tier-badge')!;

// 1. Scene & Camera
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07090e);
scene.fog = new THREE.FogExp2(0x07090e, 0.02);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 80);
camera.position.set(0, 11, 14);

// 2. Renderer
const renderer = createRenderer({ container });

// 3. Camera Controller (OrbitControls + 4 Presets + Chống xuyên cột)
const cameraController = new ChessCameraController(camera, renderer.domElement);
// Khai báo 6 cây cột vòm đá của giáo đường làm chướng ngại vật chống xuyên
cameraController.addObstacles([
  { x: -5.5, z: -8, radius: 0.85, maxY: 14 },
  { x: 5.5, z: -8, radius: 0.85, maxY: 14 },
  { x: -5.5, z: 0, radius: 0.85, maxY: 14 },
  { x: 5.5, z: 0, radius: 0.85, maxY: 14 },
  { x: -5.5, z: 8, radius: 0.85, maxY: 14 },
  { x: 5.5, z: 8, radius: 0.85, maxY: 14 }
]);

// 4. Environment & Lighting
const sunLight = new THREE.DirectionalLight(0xfff0ba, 2.2);
sunLight.position.set(4, 12, 5);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(1024, 1024);
sunLight.shadow.camera.near = 1.0;
sunLight.shadow.camera.far = 28.0;
sunLight.shadow.camera.left = -6;
sunLight.shadow.camera.right = 6;
sunLight.shadow.camera.top = 6;
sunLight.shadow.camera.bottom = -6;
sunLight.shadow.bias = -0.0005;
scene.add(sunLight);

const ambientLight = new THREE.AmbientLight(0x1e293b, 0.8);
scene.add(ambientLight);

loadEnvironment(renderer, '/hdri/cathedral_atrium_1k.hdr').then(({ envMap }) => {
  scene.environment = envMap;
  renderer.shadowMap.needsUpdate = true;
});

// 5. Bàn cờ & Quản lý quân cờ
const board = createChessBoard();
scene.add(board.group);

const pieceManager = new PieceManager();
const gameState = createInitialGameState();

interface ExtendedPiece {
  piece3D: Piece3D;
  animator: ProceduralPieceAnimator;
}
const piecesMap = new Map<string, ExtendedPiece>();

for (let r = 0; r < 8; r++) {
  for (let c = 0; c < 8; c++) {
    const p = gameState.board[r]![c];
    if (p) {
      const piece3D = pieceManager.createPiece(p.type, p.color, r, c);
      const worldPos = board.getTileWorldPosition(r, c);
      piece3D.mesh.position.copy(worldPos);
      scene.add(piece3D.mesh);

      const animator = new ProceduralPieceAnimator(piece3D.mesh, scene);
      animator.play('idle');

      piecesMap.set(`${r},${c}`, { piece3D, animator });
    }
  }
}

// 6. Post-Processing & Quality Governor
const post = createPost(renderer, scene, camera);
const governor = createQualityGovernor({ budgetMs: 16.67, initialTier: post.getTier() });

function updateTierUI(tier: QualityTier) {
  tierBadge.textContent = tier.toUpperCase();
  tierBadge.style.color = tier === 'high' ? '#34d399' : tier === 'low' ? '#f59e0b' : '#94a3b8';
}
updateTierUI(post.getTier());

// 7. Move Choreographer (Bộ điều phối chuyển động & đòn đánh đặc trưng)
let isSelectionLocked = false;

const choreo = new MoveChoreographer({
  renderer,
  gameState,
  getTier: () => post.getTier(),
  onFenChange: (newFen) => {
    console.log('[FEN Updated]:', newFen);
  },
  onLockSelection: (locked) => {
    isSelectionLocked = locked;
  },
  onScreenShake: (intensity) => {
    const origY = camera.position.y;
    let count = 4;
    const interval = setInterval(() => {
      if (count <= 0) {
        clearInterval(interval);
        camera.position.y = origY;
      } else {
        camera.position.y = origY + (Math.random() - 0.5) * intensity;
        count--;
      }
    }, 30);
  }
});

// 8. Tương tác click chuột
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let selectedSquare: Square | null = null;

window.addEventListener('click', (event) => {
  if (isSelectionLocked) return; // Chỉ khóa chọn nước mới, không khóa Undo

  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(scene.children, true);
  if (intersects.length === 0) return;

  for (const hit of intersects) {
    let obj: THREE.Object3D | null = hit.object;
    while (obj && obj !== scene) {
      if (obj.userData?.['isTile']) {
        const r = obj.userData['r'] as number;
        const c = obj.userData['c'] as number;
        handleTileClick(r, c);
        return;
      }
      obj = obj.parent;
    }
  }
});

function handleTileClick(r: number, c: number) {
  if (selectedSquare) {
    const legalMoves = getLegalMoves(gameState, selectedSquare);
    const isMove = legalMoves.some(m => m.r === r && m.c === c);

    if (isMove) {
      const fromKey = `${selectedSquare.r},${selectedSquare.c}`;
      const toKey = `${r},${c}`;

      const attackerExt = piecesMap.get(fromKey);
      const victimExt = piecesMap.get(toKey);

      if (attackerExt) {
        const p = gameState.board[selectedSquare.r]![selectedSquare.c]!;
        const capturedP = gameState.board[r]![c] || null;

        const move: Move = {
          from: { r: selectedSquare.r, c: selectedSquare.c },
          to: { r, c },
          piece: p,
          captured: capturedP
        };

        const targetWorldPos = board.getTileWorldPosition(r, c);

        const attackerPart: ChoreoParticipant = {
          mesh: attackerExt.piece3D.mesh,
          animator: attackerExt.animator,
          originWorldPos: attackerExt.piece3D.mesh.position.clone(),
          targetWorldPos
        };

        let victimPart: ChoreoParticipant | undefined;
        if (victimExt) {
          victimPart = {
            mesh: victimExt.piece3D.mesh,
            animator: victimExt.animator,
            originWorldPos: victimExt.piece3D.mesh.position.clone(),
            targetWorldPos: victimExt.piece3D.mesh.position.clone()
          };
        }

        // Bắt đầu chuỗi hoạt cảnh qua Choreo
        choreo.executeMove(move, attackerPart, victimPart);

        // Cập nhật vị trí trong map
        piecesMap.delete(fromKey);
        piecesMap.set(toKey, attackerExt);
      }

      selectedSquare = null;
      return;
    }
  }

  const p = gameState.board[r]?.[c];
  if (p && p.color === gameState.turn) {
    selectedSquare = { r, c };
  } else {
    selectedSquare = null;
  }
}

// 9. Vòng lặp Render với Choreo, CameraController & Quality Governor
let lastTime = performance.now();

function animate(currentTime: number) {
  requestAnimationFrame(animate);

  const deltaMs = currentTime - lastTime;
  const deltaSec = deltaMs / 1000;
  lastTime = currentTime;

  // Cập nhật chuyển động bay & chống xuyên cột
  cameraController.update(deltaSec);

  // Cập nhật chuỗi hoạt cảnh di chuyển & giao chiến
  choreo.update(deltaSec);

  // Cập nhật nhịp thở idle của toàn bộ quân cờ
  for (const ext of piecesMap.values()) {
    if (choreo.state === 'idle') {
      ext.animator.update(deltaSec);
    }
  }

  // Điều tiết chất lượng
  const newTier = governor.sample(deltaMs);
  if (newTier) {
    post.setTier(newTier);
    updateTierUI(newTier);
  }

  // Render hậu kỳ
  post.render(deltaSec);
}

requestAnimationFrame(animate);

// 10. Resize
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  post.resize(w, h);
  renderer.shadowMap.needsUpdate = true;
});
