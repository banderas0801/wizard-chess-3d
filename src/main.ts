import { Color, DirectionalLight, Fog, HemisphereLight, PerspectiveCamera, Scene, Timer, Vector3 } from 'three';
import { CAPTURE_SHOT, createCameraRig, MATE_SHOT, type Preset } from './render/camera';
import { createRenderer } from './render/renderer';
import { loadEnvironment } from './render/env';
import { createPost } from './render/post';
import { createQualityGovernor, parseTier, type QualityTier } from './render/quality';
import { createProceduralAnimator } from './scene/anim';
import { createCharacterAnimator, loadCharacterKit } from './scene/character';
import { createStatueAnimator, loadStatueKit, type StatueKit } from './scene/statue';
import { MODEL_ASSETS, type AssetName } from './scene/assets';
import { animDt, createChoreographer, TIMING } from './scene/choreo';
import { SHAKE_SCALE, shakeAllowed as shakeGate, type Side } from './fx/budget';
import { createStrikeFx } from './fx/strike-fx';
import { planMove } from './scene/plan';
import { createAnimatorStage } from './scene/stage';
import { createBoard, squareToWorld } from './scene/board';
import { createHall, hallColliders } from './scene/hall';
import { detailForTier, getMaterials } from './scene/materials';
import { createPieces } from './scene/pieces';
import { fromFen, initialState, legalMoves, outcome, parseUci, toFen, type GameState, type Move, type PieceType, type Square } from './game';
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
  // `zen`: future Zen mode; for now it only turns camera shake off (`?zen=1` or the z key).
  const toggles = { shake: true, closeUp: true, zen: params.get('zen') === '1' };
  /** Shake is off at tier off and in Zen mode, whatever the s toggle says. */
  const shakeAllowed = (): boolean => shakeGate(toggles, tier);
  const FRAGMENTS: Record<QualityTier, number> = { high: 18, low: 10, off: 5 };

  const proc = createProceduralAnimator({ fragments: FRAGMENTS[startTier] });
  // Step 4b: knights become a rigged Quaternius horse (CC0) on their turned base once the glTF arrives;
  // `?characters=0` opts out.
  const knights = createCharacterAnimator(proc, 'knight', {
    body: (c) => getMaterials(detail)[c === 'white' ? 'ivory' : 'ebony'],
    accent: () => getMaterials(detail).gold,
    eye: () => getMaterials(detail).ebony,
  });
  // Sculpted statues stand straight on the square (no pedestal), scaled to STATUE_HEIGHT (scene/assets).
  const statues = (base: Parameters<typeof createStatueAnimator>[0], type: PieceType) => createStatueAnimator(base, { type });
  // Every piece is the user's Meshy statue (public/models/pieces), a rigid figure on the statue layer:
  // white gold aura, black obsidian + crimson; strike profiles unchanged (the rook's is the 'slam').
  // The knight statue replaces the rigged horse, which is only loaded as its fallback (see
  // charactersReady), so the two never both attach.
  const pawns = statues(knights, 'pawn');
  const rooks = statues(pawns, 'rook');
  const knightStatues = statues(rooks, 'knight');
  const bishops = statues(knightStatues, 'bishop');
  const queens = statues(bishops, 'queen');
  const animator = statues(queens, 'king');
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
  /** Seconds left before the AI is asked to move (a beat between moves); < 0 = not waiting. */
  let aiWait = -1;
  let timeScale = 1;
  /** Real seconds of the king's slow-motion beat left (time runs at SLOWMO_RATE meanwhile). */
  let slowmo = 0;
  const SLOWMO_SECONDS = 0.45;
  const SLOWMO_RATE = 0.3;
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
    toggles: () => ({ shake: shakeAllowed(), closeUp: toggles.closeUp && tier !== 'off' }),
    effect(cue, moverId, at, impactIn) {
      if (cue.kind === 'shake') {
        const k = SHAKE_SCALE[tier];
        if (k > 0) rig.shake(0.16 * cue.strength * k);
        return;
      }
      if (cue.kind === 'slowmo') {
        if (tier !== 'off' && !toggles.zen) slowmo = SLOWMO_SECONDS * cue.strength;
        return;
      }
      const mover = pieces.get(moverId);
      const last = (mover?.position ?? world(at)).clone();
      const from = (): Vector3 => {
        const o = pieces.get(moverId); // the mover's live position; its last one once it is gone
        return o ? last.copy(o.position) : last;
      };
      const side: Side = (mover?.userData.color as Side | undefined) ?? game.turn;
      fx.play(cue, { from, to: world(at), side, tier, impactIn });
    },
    closeUp: (sq, shot) => void (shot === 'mate' ? rig.focus(world(sq), 900, MATE_SHOT) : rig.focus(world(sq), 450, CAPTURE_SHOT)),
    closeUpEnd: () => void rig.unfocus(),
    onPhase(next) {
      phaseTime = 0;
      if (pauseSpec && next === pauseSpec[0] && Number(pauseSpec[1]) === 0) timeScale = 0;
    },
    onIdle(reason) {
      if (reason === 'settled') aiWait = TIMING.gap;
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
    aiWait = -1;
    slowmo = 0;
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
    aiWait = -1;
    slowmo = 0;
    choreo.cancel();
    void rig.unfocus(); // leave a held checkmate close-up
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
    // Mid-move the animator holds the old meshes' poses; characters join at the next idle.
    const join = (): void => {
      if (choreo.phase !== 'idle') return;
      idleAll();
      markShadowsDirty('piece-move');
    };
    const url = (name: AssetName): string => `${import.meta.env.BASE_URL}${MODEL_ASSETS[name].base}`;
    const statue = (name: 'pawn' | 'rook' | 'bishop' | 'queen' | 'king', layer: { kit: StatueKit | null }): Promise<void> =>
      loadStatueKit(url(name))
        .then((kit) => {
          layer.kit = kit;
          join();
        })
        .catch((e: unknown) => console.warn(`${name} model unavailable, keeping procedural ${name}s`, e));
    charactersReady = Promise.all([
      // Knight: the Meshy statue; if it fails, the rigged horse + rider; if that fails too, the turned knight.
      loadStatueKit(url('knight'))
        .then((kit) => {
          knightStatues.kit = kit;
          join();
        })
        .catch((e: unknown) => {
          console.warn('knight model unavailable, falling back to the horse', e);
          return loadCharacterKit(url('horse')).then((kit) => {
            knights.kit = kit;
            join();
          });
        })
        .catch((e: unknown) => console.warn('horse model unavailable, keeping procedural knights', e)),
      statue('pawn', pawns),
      statue('rook', rooks),
      statue('bishop', bishops),
      statue('queen', queens),
      statue('king', animator),
    ]);
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
    else if (e.key === 'z') toggles.zen = !toggles.zen;
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
    if (aiWait >= 0) {
      aiWait -= dt;
      if (aiWait < 0) maybeAskAi();
    }
    const step = animDt(dt); // pieces/fx/choreo never jump more than MAX_ANIM_DT per frame
    phaseTime += step * timeScale;
    if (pauseSpec && choreo.phase === pauseSpec[0] && phaseTime >= Number(pauseSpec[1])) timeScale = 0;
    const slow = slowmo > 0 ? SLOWMO_RATE : 1;
    slowmo = Math.max(0, slowmo - dt);
    const adt = step * timeScale * slow;
    choreo.tick(adt);
    animator.update(adt);
    fx.update(adt);
    // Shadows follow moving pieces every frame, and stop again once everything is still.
    if (choreo.animating || animator.moving) markShadowsDirty('piece-move');
    rig.shakeEnabled = shakeAllowed();
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
        ` · ${game.turn} to move · click/space = move, u = undo, r = reset, 1-4 = camera, s/c/z = shake ${toggles.shake ? 'on' : 'off'}/close-up ${toggles.closeUp ? 'on' : 'off'}/zen ${toggles.zen ? 'on' : 'off'}`;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main().catch((err: unknown) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88">${String(err)}</pre>`);
});
