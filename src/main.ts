import { DirectionalLight, PerspectiveCamera, Scene, Timer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createRenderer } from './render/renderer';
import { loadEnvironment } from './render/env';
import { createPost } from './render/post';
import { createQualityGovernor, parseTier } from './render/quality';
import { createBoard } from './scene/board';
import { createPieces } from './scene/pieces';
import { initialBoard, movePiece, type Board, type Square } from './game';

const HDRI_URL = `${import.meta.env.BASE_URL}hdri/studio_small_08_1k.hdr`;
const BUDGET_MS = 1000 / 60;

// Demo: each click / keypress plays the next scripted move to exercise the shadow update path.
const DEMO_MOVES: readonly (readonly [Square, Square])[] = [
  ['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6'], ['f1', 'c4'], ['g8', 'f6'],
];

async function main(): Promise<void> {
  const hud = document.getElementById('hud')!;
  const { renderer, markShadowsDirty, shadowUpdates } = createRenderer(document.body);

  const scene = new Scene();
  const camera = new PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 9.5, 10.5);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.47;

  const env = await loadEnvironment(renderer, HDRI_URL);
  scene.environment = env;
  scene.environmentIntensity = 0.55; // let the key light's shadows read against the soft studio fill
  scene.background = env;
  scene.backgroundBlurriness = 0.6;
  scene.backgroundIntensity = 0.35;

  const sun = new DirectionalLight('#fff4e6', 2.2);
  sun.position.set(5, 10, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -6;
  sun.shadow.camera.right = 6;
  sun.shadow.camera.top = 6;
  sun.shadow.camera.bottom = -6;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 30;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3; // PCF blur (PCFSoftShadowMap was removed in three r18x)
  scene.add(sun);

  scene.add(createBoard());
  const pieces = createPieces();
  scene.add(pieces.group);

  let board: Board = initialBoard();
  pieces.sync(board);
  markShadowsDirty('init');

  const params = new URLSearchParams(location.search);
  const forced = parseTier(params.get('tier'));
  const post = createPost(renderer, scene, camera, forced ?? 'high');
  const governor = forced ? null : createQualityGovernor({ budgetMs: BUDGET_MS });

  let demoIdx = 0;
  const playNext = (): void => {
    if (demoIdx >= DEMO_MOVES.length) {
      board = initialBoard();
      demoIdx = 0;
    } else {
      const [from, to] = DEMO_MOVES[demoIdx++]!;
      const r = movePiece(board, from, to);
      if (!r.ok) return;
      board = r.board;
    }
    if (pieces.sync(board)) markShadowsDirty('piece-move');
  };
  let downAt: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }));
  renderer.domElement.addEventListener('pointerup', (e) => {
    // Treat as a click only if the pointer barely moved (so orbiting doesn't trigger moves).
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 5) playNext();
    downAt = null;
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'm' || e.key === 'Enter') playNext();
  });

  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    post.resize(w, h);
  });

  const timer = new Timer();
  timer.connect(document);
  let hudAcc = 0;
  const frame = (ts: number): void => {
    timer.update(ts);
    const dt = timer.getDelta();
    controls.update();
    if (governor) {
      const next = governor.sample(dt * 1000);
      if (next) post.setTier(next);
    }
    post.render(dt);
    hudAcc += dt;
    if (hudAcc > 0.25) {
      hudAcc = 0;
      hud.textContent =
        `tier: ${post.tier}${forced ? ' (forced)' : ''} · ${(dt * 1000).toFixed(1)} ms · ` +
        `shadow updates: init ${shadowUpdates.init}, moves ${shadowUpdates['piece-move']} · click / space = next move`;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main().catch((err: unknown) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88">${String(err)}</pre>`);
});
