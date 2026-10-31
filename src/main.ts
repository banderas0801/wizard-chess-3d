import { Color, DirectionalLight, Fog, HemisphereLight, PerspectiveCamera, Scene, Timer, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createRenderer } from './render/renderer';
import { loadEnvironment } from './render/env';
import { createPost } from './render/post';
import { createQualityGovernor, parseTier } from './render/quality';
import { createBoard } from './scene/board';
import { createHall } from './scene/hall';
import { detailForTier } from './scene/materials';
import { createPieces } from './scene/pieces';
import { applyMove, initialState, legalMoves, outcome, parseUci, toFen, type GameState } from './game';
import { createAiController } from './ai/controller';
import { createWorkerPort } from './ai/workerPort';

const HDRI_URL = `${import.meta.env.BASE_URL}hdri/sepulchral_chapel_rotunda_1k.hdr`;
const BUDGET_MS = 1000 / 60;
const AI_COLOR = 'black';

async function main(): Promise<void> {
  const hud = document.getElementById('hud')!;
  const { renderer, markShadowsDirty, shadowUpdates } = createRenderer(document.body);

  const params = new URLSearchParams(location.search);
  const forced = parseTier(params.get('tier'));
  const startTier = forced ?? 'high';

  const scene = new Scene();
  scene.background = new Color('#140d08');
  scene.fog = new Fog('#140d08', 22, 48);

  // Default view: behind White, ~38 degrees above the board. `?cam=x,y,z` overrides (screenshots).
  const camera = new PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 120);
  const camParam = params.get('cam')?.split(',').map(Number);
  const camPos = camParam?.length === 3 && camParam.every(Number.isFinite) ? new Vector3(...(camParam as [number, number, number])) : new Vector3(0, 8.6, 11.0);
  camera.position.copy(camPos);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, -0.2, 0.4);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 5;
  controls.maxDistance = 20;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = 1.25; // never below ~18 degrees above the board plane
  controls.update();

  const env = await loadEnvironment(renderer, HDRI_URL);
  scene.environment = env;
  scene.environmentIntensity = 0.45;

  // Warm key light from a high window; the only shadow caster.
  const sun = new DirectionalLight('#ffd9a8', 2.6);
  sun.position.set(-5, 12, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -7;
  sun.shadow.camera.right = 7;
  sun.shadow.camera.top = 7;
  sun.shadow.camera.bottom = -7;
  sun.shadow.camera.near = 2;
  sun.shadow.camera.far = 30;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.015;
  sun.shadow.radius = 4; // PCF blur (PCFSoftShadowMap was removed in three r18x)
  scene.add(sun);
  scene.add(new HemisphereLight('#ffe6c4', '#2a1c10', 0.35));

  let detail = detailForTier(startTier);
  scene.add(createHall(renderer.capabilities.getMaxAnisotropy(), detail === 'low').group);
  const board = createBoard(detail);
  scene.add(board.group);
  const pieces = createPieces(detail);
  scene.add(pieces.group);

  // ---- game + AI -----------------------------------------------------------
  let game: GameState = initialState();
  const history: GameState[] = [];
  let lastEval: number | null = null;
  let lastError = '';
  pieces.sync(game.board);
  markShadowsDirty('init');

  const show = (): void => {
    if (pieces.sync(game.board)) markShadowsDirty('piece-move');
  };

  const port = createWorkerPort();
  const ai = createAiController(port, {
    applyMove(uci, evalCp) {
      const m = parseUci(uci);
      const r = m ? applyMove(game, m) : null;
      if (!r || !r.ok) return { ok: false, message: `engine returned illegal move ${uci}` };
      history.push(game);
      game = r.state;
      lastEval = evalCp;
      show();
      return { ok: true };
    },
    showError(message) {
      lastError = message;
    },
  });

  const maybeAskAi = (): void => {
    if (game.turn === AI_COLOR && !outcome(game)) ai.requestMove(toFen(game), { timeMs: 300 });
  };

  /** Placeholder human input until square picking lands: play a random legal move for white. */
  const humanMove = (): void => {
    if (game.turn === AI_COLOR || outcome(game)) return;
    if (!ai.userMove()) return; // input locked while the AI is thinking
    const moves = legalMoves(game);
    const m = moves[Math.floor(Math.random() * moves.length)];
    if (!m) return;
    const r = applyMove(game, m);
    if (!r.ok) return;
    history.push(game);
    game = r.state;
    lastError = '';
    show();
    maybeAskAi();
  };

  const undo = (): void => {
    ai.undo(); // cancels any in-flight search and bumps requestId
    // Undo back to the human's turn.
    do game = history.pop() ?? game;
    while (game.turn === AI_COLOR && history.length > 0);
    show();
  };

  const reset = (): void => {
    ai.reset();
    history.length = 0;
    game = initialState();
    lastEval = null;
    lastError = '';
    show();
  };

  let downAt: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }));
  renderer.domElement.addEventListener('pointerup', (e) => {
    // Treat as a click only if the pointer barely moved (so orbiting doesn't trigger moves).
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 5) humanMove();
    downAt = null;
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'm' || e.key === 'Enter') humanMove();
    else if (e.key === 'u') undo();
    else if (e.key === 'r') reset();
  });

  // ---- quality + render loop -------------------------------------------------
  const post = createPost(renderer, scene, camera, startTier);
  const governor = forced ? null : createQualityGovernor({ budgetMs: BUDGET_MS });

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
      if (next) {
        post.setTier(next);
        const d = detailForTier(next);
        if (d !== detail) {
          detail = d;
          board.setDetail(d);
          pieces.setDetail(d); // same silhouettes and positions, so the cached shadow map stays valid
        }
      }
    }
    post.render(dt);
    hudAcc += dt;
    if (hudAcc > 0.25) {
      hudAcc = 0;
      const end = outcome(game);
      hud.textContent =
        `tier: ${post.tier}${forced ? ' (forced)' : ''} · ${(dt * 1000).toFixed(1)} ms · ` +
        `shadow updates: init ${shadowUpdates.init}, moves ${shadowUpdates['piece-move']} · ` +
        `AI: ${ai.machine.phase.tag} #${ai.machine.currentRequestId}` +
        (lastEval !== null ? ` eval ${lastEval}cp` : '') +
        (lastError ? ` · error: ${lastError}` : '') +
        (end ? ` · ${end}` : '') +
        ` · ${game.turn} to move · click/space = move, u = undo, r = reset`;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main().catch((err: unknown) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88">${String(err)}</pre>`);
});
