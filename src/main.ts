import { DirectionalLight, PerspectiveCamera, Scene, Timer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createRenderer } from './render/renderer';
import { loadEnvironment } from './render/env';
import { createPost } from './render/post';
import { createQualityGovernor, parseTier } from './render/quality';
import { createBoard } from './scene/board';
import { createPieces } from './scene/pieces';
import { applyMove, initialState, legalMoves, outcome, parseUci, toFen, type GameState } from './game';
import { createAiController } from './ai/controller';
import { createWorkerPort } from './ai/workerPort';

const HDRI_URL = `${import.meta.env.BASE_URL}hdri/studio_small_08_1k.hdr`;
const BUDGET_MS = 1000 / 60;
const AI_COLOR = 'black';

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
  const params = new URLSearchParams(location.search);
  const forced = parseTier(params.get('tier'));
  const post = createPost(renderer, scene, camera, forced ?? 'high');
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
      if (next) post.setTier(next);
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
