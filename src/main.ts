import * as THREE from 'three';
import { createRenderer } from './render/renderer';
import { loadEnvironment } from './render/env';
import { createPost, QualityTier } from './render/post';
import { createQualityGovernor } from './render/quality';
import { createChessBoard } from './scene/board';
import { PieceManager, Piece3D } from './scene/pieces';
import { createInitialGameState, getLegalMoves, Square } from './game';

const container = document.getElementById('canvas-container')!;
const tierBadge = document.getElementById('tier-badge')!;

// 1. Scene & Camera
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07090e);
scene.fog = new THREE.FogExp2(0x07090e, 0.02);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 80);
camera.position.set(0, 13, 14);
camera.lookAt(0, 0, 0);

// 2. Renderer
const renderer = createRenderer({ container });

// 3. Environment & Lighting
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

// Nạp HDRI CC0 Poly Haven (chạy 1 lần duy nhất lúc khởi động)
loadEnvironment(renderer, '/hdri/cathedral_atrium_1k.hdr').then(({ envMap }) => {
  scene.environment = envMap;
  renderer.shadowMap.needsUpdate = true;
});

// 4. Bàn cờ & Quân cờ
const board = createChessBoard();
scene.add(board.group);

const pieceManager = new PieceManager();
const gameState = createInitialGameState();
const piecesMap = new Map<string, Piece3D>();

for (let r = 0; r < 8; r++) {
  for (let c = 0; c < 8; c++) {
    const p = gameState.board[r]![c];
    if (p) {
      const piece3D = pieceManager.createPiece(p.type, p.color, r, c);
      const worldPos = board.getTileWorldPosition(r, c);
      piece3D.mesh.position.copy(worldPos);
      scene.add(piece3D.mesh);
      piecesMap.set(`${r},${c}`, piece3D);
    }
  }
}

// 5. Post-Processing Pipeline & Quality Governor
const post = createPost(renderer, scene, camera);
const governor = createQualityGovernor({ budgetMs: 16.67, initialTier: post.getTier() });

function updateTierUI(tier: QualityTier) {
  tierBadge.textContent = tier.toUpperCase();
  tierBadge.style.color = tier === 'high' ? '#34d399' : tier === 'low' ? '#f59e0b' : '#94a3b8';
}
updateTierUI(post.getTier());

// 6. Tương tác click chọn quân & di chuyển
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let selectedSquare: Square | null = null;

window.addEventListener('click', (event) => {
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
      const movingPiece = piecesMap.get(fromKey);

      if (movingPiece) {
        // Nếu có quân bị ăn -> xóa mesh
        const capturedPiece = piecesMap.get(toKey);
        if (capturedPiece) {
          scene.remove(capturedPiece.mesh);
          piecesMap.delete(toKey);
        }

        piecesMap.delete(fromKey);
        piecesMap.set(toKey, movingPiece);

        // Cập nhật logic state
        gameState.board[r]![c] = gameState.board[selectedSquare.r]![selectedSquare.c];
        gameState.board[selectedSquare.r]![selectedSquare.c] = null;
        gameState.turn = gameState.turn === 'w' ? 'b' : 'w';

        // Di chuyển 3D mượt mà kèm shadow.needsUpdate = true
        const targetPos = board.getTileWorldPosition(r, c);
        movingPiece.moveTo(targetPos, renderer);
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

// 7. Vòng lặp requestAnimationFrame với Quality Governor
let lastTime = performance.now();

function animate(currentTime: number) {
  requestAnimationFrame(animate);

  const deltaMs = currentTime - lastTime;
  lastTime = currentTime;

  // Điều tiết chất lượng dựa trên frame time
  const newTier = governor.sample(deltaMs);
  if (newTier) {
    post.setTier(newTier);
    updateTierUI(newTier);
  }

  // Render qua Pipeline
  post.render(deltaMs / 1000);
}

requestAnimationFrame(animate);

// 8. Resize Handler
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  post.resize(w, h);
  renderer.shadowMap.needsUpdate = true;
});
