import { Color, DirectionalLight, Fog, HemisphereLight, PerspectiveCamera, Scene, Timer, Vector3 } from 'three';
import { createCameraRig, type Preset } from './render/camera';
import { createRenderer } from './render/renderer';
import { loadEnvironment } from './render/env';
import { createPost } from './render/post';
import { createQualityGovernor, parseTier, type QualityTier } from './render/quality';
import { createProceduralAnimator } from './scene/anim';
import { createCharacterAnimator, loadCharacterKit } from './scene/character';
import { createChoreographer } from './scene/choreo';
import { createStrikeFx, SHAKE_SCALE } from './scene/fx';
import { planMove } from './scene/plan';
import { createAnimatorStage } from './scene/stage';
import { createBoard, squareToWorld } from './scene/board';
import { createHall, hallColliders } from './scene/hall';
import { detailForTier, getMaterials } from './scene/materials';
import { createPieces } from './scene/pieces';
import { fromFen, initialState, legalMoves, outcome, parseUci, toFen, type GameState, type Move, type Square } from './game';
import { createAiController } from './ai/controller';
import { createWorkerPort } from './ai/workerPort';

const HDRI_URL = `${import.meta.env.BASE_URL}hdri/sepulchral_chapel_rotunda_1k.hdr`;
const BUDGET_MS = 1000 / 60;
const AI_COLOR = 'black';
const PRESET_KEYS: Record<string, Preset> = { '1': 'player', '2': 'overhead', '3': 'side', '4': 'overview' };

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
  const camStart = camParam?.length === 3 && camParam.every(Number.isFinite) ? (camParam as [number, number, number]) : 'player';
  const rig = createCameraRig(camera, renderer.domElement, hallColliders(), camStart);

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

  // ---- game + AI + choreography ---------------------------------------------
  // `?fen=...&play=uci` starts from a position and plays one move (demo/screenshots);
  // `&pause=phase:seconds` freezes animation time that long into that phase.
  let game: GameState = (() => {
    const f = params.get('fen');
    try {
      return f ? fromFen(f) : initialState();
    } catch {
      return initialState();
    }
  })();
  const history: GameState[] = [];
  let lastEval: number | null = null;
  let lastError = '';
  let tier: QualityTier = startTier;
  const toggles = { shake: true, closeUp: true };
  const FRAGMENTS: Record<QualityTier, number> = { high: 18, low: 10, off: 5 };

  const proc = createProceduralAnimator({ fragments: FRAGMENTS[startTier] });
  // Step 4b: knights become rigged Quaternius characters (CC0) once the FBX arrives; `?characters=0` opts out.
  const animator = createCharacterAnimator(proc, 'knight', {
    body: (c) => getMaterials(detail)[c === 'white' ? 'ivory' : 'ebony'],
    accent: () => getMaterials(detail).gold,
  });
  animator.idleSway = startTier !== 'off';
  const fx = createStrikeFx();
  scene.add(fx.group);
  const idleAll = (): void => {
    animator.attachAll(pieces.group); // idempotent: new/promoted/re-detailed pieces get their character
    for (const obj of pieces.group.children) animator.play(obj, 'idle');
  };
  pieces.sync(game.board);
  idleAll();
  markShadowsDirty('init');

  const show = (): void => {
    if (pieces.sync(game.board)) markShadowsDirty('piece-move');
    idleAll();
  };
  const world = (sq: Square): Vector3 => squareToWorld(sq, new Vector3());

  const stage = createAnimatorStage({ animator, get: (id) => pieces.get(id), fx });

  let phaseTime = 0;
  let timeScale = 1;
  const pauseSpec = params.get('pause')?.split(':');
  const fixedDt = Number(params.get('fixedDt') ?? 0); // deterministic stepping for slow headless captures

  const choreo = createChoreographer<GameState>({
    stage,
    commit(next) {
      // The one place a move changes the game state.
      history.push(game);
      game = next;
      lastError = '';
      show();
    },
    toggles: () => ({ shake: toggles.shake && tier !== 'off', closeUp: toggles.closeUp && tier !== 'off' }),
    effect(cue, moverId, at) {
      if (cue.kind === 'shake') {
        const k = SHAKE_SCALE[tier];
        if (k > 0) rig.shake(0.16 * cue.strength * k);
        return;
      }
      const from = pieces.get(moverId)?.position.clone() ?? world(at);
      fx.play(cue.kind, from, world(at), cue.strength, tier);
    },
    closeUp: (sq) => void rig.focus(world(sq)),
    closeUpEnd: () => void rig.unfocus(),
    onPhase(next) {
      phaseTime = 0;
      if (pauseSpec && next === pauseSpec[0] && Number(pauseSpec[1]) === 0) timeScale = 0;
    },
    onIdle(reason) {
      if (reason === 'settled') maybeAskAi();
    },
  });

  const port = createWorkerPort();
  const ai = createAiController(port, {
    applyMove(uci, evalCp) {
      const m = parseUci(uci);
      const plan = m ? planMove(game, m) : null;
      if (!plan) return { ok: false, message: `engine returned illegal move ${uci}` };
      if (!choreo.begin(plan)) return { ok: false, message: 'board busy' };
      lastEval = evalCp;
      return { ok: true };
    },
    showError(message) {
      lastError = message;
    },
  });

  function maybeAskAi(): void {
    if (game.turn === AI_COLOR && !outcome(game)) ai.requestMove(toFen(game), { timeMs: 300 });
  }

  const startMove = (m: Move): boolean => {
    const plan = planMove(game, m);
    if (!plan || !choreo.begin(plan)) return false;
    return true;
  };

  /** Placeholder human input until square picking lands: play a random legal move for white. */
  const humanMove = (): void => {
    if (choreo.inputLocked) return; // only NEW move selection is locked while pieces move
    if (game.turn === AI_COLOR || outcome(game)) return;
    if (!ai.userMove()) return; // input locked while the AI is thinking
    const moves = legalMoves(game);
    const m = moves[Math.floor(Math.random() * moves.length)];
    if (m) startMove(m);
  };

  /** Never locked: cancel any animation (state untouched), then roll history back separately. */
  const undo = (): void => {
    choreo.cancel();
    ai.undo(); // cancels any in-flight search and bumps requestId
    // Undo back to the human's turn.
    do game = history.pop() ?? game;
    while (game.turn === AI_COLOR && history.length > 0);
    animator.release();
    void rig.unfocus();
    show();
  };

  const reset = (): void => {
    choreo.cancel();
    ai.reset();
    history.length = 0;
    game = initialState();
    lastEval = null;
    lastError = '';
    animator.release();
    show();
  };

  let charactersReady: Promise<unknown> = Promise.resolve();
  if (params.get('characters') !== '0') {
    charactersReady = loadCharacterKit(`${import.meta.env.BASE_URL}models/quaternius-knight`)
      .then((kit) => {
        animator.kit = kit;
        // Mid-move the animator holds the old meshes' poses; characters join at the next idle.
        if (choreo.phase === 'idle') {
          idleAll();
          markShadowsDirty('piece-move');
        }
      })
      .catch((e: unknown) => console.warn('character models unavailable, keeping procedural knights', e));
  }

  const demoMove = params.get('play');
  if (demoMove) {
    const m = parseUci(demoMove);
    // Wait for the character models so the demo shows the move as it will normally look.
    void charactersReady.then(() =>
      setTimeout(() => {
        if (m && startMove(m)) return;
        lastError = `demo move ${demoMove} not legal here`;
      }, Number(params.get('delay') ?? 1500)),
    );
  }

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
    else if (e.key === 's') toggles.shake = !toggles.shake;
    else if (e.key === 'c') toggles.closeUp = !toggles.closeUp;
    else if (PRESET_KEYS[e.key]) void rig.flyTo(PRESET_KEYS[e.key]!, 900);
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
    const dt = fixedDt > 0 ? fixedDt : timer.getDelta();
    phaseTime += dt * timeScale;
    if (pauseSpec && choreo.phase === pauseSpec[0] && phaseTime >= Number(pauseSpec[1])) timeScale = 0;
    const adt = dt * timeScale;
    choreo.tick(adt);
    animator.update(adt);
    fx.update(adt);
    // Shadows follow moving pieces every frame, and stop again once everything is still.
    if (choreo.animating || animator.moving) markShadowsDirty('piece-move');
    rig.update(dt);
    if (governor) {
      const next = governor.sample(dt * 1000);
      if (next) {
        post.setTier(next);
        tier = next;
        animator.idleSway = next !== 'off';
        proc.fragments = FRAGMENTS[next];
      }
      const d = detailForTier(tier);
      // Swapping piece meshes mid-animation would orphan the animator's targets: wait for idle.
      if (d !== detail && choreo.phase === 'idle') {
        detail = d;
        board.setDetail(d);
        pieces.setDetail(d); // same silhouettes and positions, so the cached shadow map stays valid
        idleAll();
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
        `AI: ${ai.machine.phase.tag} #${ai.machine.currentRequestId} · anim: ${choreo.phase}` +
        (lastEval !== null ? ` eval ${lastEval}cp` : '') +
        (lastError ? ` · error: ${lastError}` : '') +
        (end ? ` · ${end}` : '') +
        ` · ${game.turn} to move · click/space = move, u = undo, r = reset, 1-4 = camera, s/c = shake ${toggles.shake ? 'on' : 'off'}/close-up ${toggles.closeUp ? 'on' : 'off'}`;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main().catch((err: unknown) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88">${String(err)}</pre>`);
});
