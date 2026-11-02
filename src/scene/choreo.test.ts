import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Quaternion, Vector3 } from 'three';
import { fromFen, initialState, parseUci, toFen, type GameState, type PieceType } from '../game';
import { createProceduralAnimator } from './anim';
import { squareToWorld } from './board';
import { animDt, createChoreographer, MAX_ANIM_DT, type ChoreoStage, type Phase } from './choreo';
import { createPieces } from './pieces';
import { planMove } from './plan';
import { createAnimatorStage } from './stage';
import { STRIKE_PROFILES } from './strike';

const DT = 1 / 60;

/** Fake clock + game host around any stage (a logging fake by default). */
function harness(start: GameState, opts: { toggles?: { shake: boolean; closeUp: boolean }; stage?: ChoreoStage; onTick?: (dt: number) => void } = {}) {
  let game = start;
  const fens: string[] = [toFen(game)];
  const log: string[] = [];
  const phases: Phase[] = [];
  const toggles = opts.toggles ?? { shake: true, closeUp: true };
  const stage: ChoreoStage = opts.stage ?? {
    move: (p) => log.push(`move ${p.id} ${p.from}-${p.to}`),
    attack: (id) => log.push(`attack ${id}`),
    pull: (id) => log.push(`pull ${id}`),
    shatter: (id) => log.push(`shatter ${id}`),
    fall: (id) => log.push(`fall ${id}`),
    cancel: () => log.push('stage.cancel'),
    release: () => log.push('stage.release'),
  };
  const choreo = createChoreographer<GameState>({
    stage,
    commit(next) {
      game = next;
      fens.push(toFen(game));
      log.push(`commit in ${choreo.phase}`);
    },
    toggles: () => toggles,
    effect: (cue) => log.push(`fx ${cue.kind}`),
    closeUp: (_sq, shot) => log.push(shot === 'mate' ? 'closeUp mate' : 'closeUp'),
    closeUpEnd: () => log.push('closeUpEnd'),
    onPhase: (p) => phases.push(p),
  });
  const step = (): void => {
    choreo.tick(DT);
    opts.onTick?.(DT);
  };
  const clock = (seconds: number): void => {
    for (let t = 0; t < seconds; t += DT) step();
  };
  const until = (p: Phase): void => {
    for (let i = 0; i < 600 && choreo.phase !== p; i++) step();
    expect(choreo.phase).toBe(p);
  };
  const play = (uci: string): boolean => choreo.begin(planMove(game, parseUci(uci)!)!);
  return { choreo, clock, until, play, log, phases, fens, get game() { return game; } };
}

// White to move; Bxf7 is a capture, and Qxf7 would be mate.
const CAPTURE_FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4';

describe('choreographer spec (4 cases)', () => {
  it('1. normal move: idle -> approach -> settle -> idle, FEN changes exactly once at settle', () => {
    const h = harness(initialState());
    expect(h.play('e2e4')).toBe(true);
    h.clock(0.2);
    expect(h.fens.length).toBe(1); // still animating, state untouched
    h.clock(2);
    expect(h.phases).toEqual(['approach', 'settle', 'idle']);
    expect(h.fens.length).toBe(2);
    expect(h.choreo.commits).toBe(1);
    expect(h.log).toContain('commit in settle');
  });

  describe('2. captures and special moves: FEN changes once, at settle', () => {
    it('capture: approach -> strike -> shatter -> settle -> idle, commit after the shatter', () => {
      const h = harness(fromFen(CAPTURE_FEN));
      h.play('c4f7');
      h.clock(3);
      expect(h.phases).toEqual(['approach', 'strike', 'shatter', 'settle', 'idle']);
      expect(h.fens.length).toBe(2);
      expect(h.log).toEqual(expect.arrayContaining(['closeUp', 'attack fen-white-bishop-c4', 'shatter fen-black-pawn-f7', 'fx beam', 'closeUpEnd']));
      expect(h.log.indexOf('commit in settle')).toBeGreaterThan(h.log.indexOf('shatter fen-black-pawn-f7'));
    });

    it('castling: the rook moves alongside, both land in one commit', () => {
      const h = harness(fromFen('4k3/8/8/8/8/8/8/4K2R w K - 0 1'));
      h.play('e1g1');
      h.clock(3);
      expect(h.phases).toEqual(['approach', 'settle', 'idle']);
      expect(h.log).toEqual(expect.arrayContaining([expect.stringMatching(/^move .*king.* e1-g1$/), expect.stringMatching(/^move .*rook.* h1-f1$/)]));
      expect(h.fens).toEqual(['4k3/8/8/8/8/8/8/4K2R w K - 0 1', '4k3/8/8/8/8/8/8/5RK1 b - - 1 1']);
    });

    it('en passant: the victim beside the destination shatters and disappears', () => {
      const h = harness(fromFen('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2'));
      const victim = h.game.board.get('d5')!.id;
      h.play('e5d6');
      h.clock(3);
      expect(h.phases).toEqual(['approach', 'strike', 'shatter', 'settle', 'idle']);
      expect(h.log).toContain(`shatter ${victim}`);
      expect(h.fens.slice(1)).toEqual(['4k3/8/3P4/8/8/8/8/4K3 b - - 0 2']);
    });

    it('promotion: same piece id, new type, committed once', () => {
      const h = harness(fromFen('4k3/P7/8/8/8/8/8/4K3 w - - 0 1'));
      const id = h.game.board.get('a7')!.id;
      const plan = planMove(h.game, parseUci('a7a8q')!)!;
      expect(plan.promotion).toBe('queen');
      expect(h.choreo.begin(plan)).toBe(true);
      h.clock(3);
      expect(h.fens.length).toBe(2);
      expect(h.game.board.get('a8')).toEqual({ id, type: 'queen', color: 'white' });
    });

    it('checkmate: settle -> kingFall -> idle', () => {
      const h = harness(fromFen(CAPTURE_FEN));
      h.play('f3f7');
      h.clock(6);
      expect(h.phases).toEqual(['approach', 'strike', 'shatter', 'settle', 'kingFall', 'idle']);
      expect(h.log).toContain('fall fen-black-king-e8');
      expect(h.fens.length).toBe(2);
      // The mate close-up frames the falling king and is held after idle (no closeUpEnd after it).
      const mate = h.log.indexOf('closeUp mate');
      expect(mate).toBeGreaterThan(h.log.indexOf('commit in settle'));
      expect(h.log.slice(mate)).not.toContain('closeUpEnd');
    });
  });

  it.each(['approach', 'strike'] as const)('3. cancel during %s -> cancelled -> idle, FEN unchanged', (at) => {
    const h = harness(fromFen(CAPTURE_FEN));
    const before = toFen(h.game);
    h.play('c4f7');
    h.until(at);
    h.clock(0.03);
    expect(h.choreo.phase).toBe(at);
    expect(h.choreo.cancel()).toBe(true);
    expect(h.phases.slice(-2)).toEqual(['cancelled', 'idle']);
    expect(h.phases).not.toContain('settle');
    expect(h.log).toContain('stage.cancel');
    h.clock(3); // late ticks must not resurrect the move
    expect(h.choreo.commits).toBe(0);
    expect(h.fens).toEqual([before]);
  });

  it('3b. cancel restores both real meshes to their start squares (approach and strike)', () => {
    for (const at of ['approach', 'strike'] as const) {
      const r = real(CAPTURE_FEN);
      r.h.play('c4f7');
      r.h.until(at);
      r.h.clock(0.05);
      r.h.choreo.cancel();
      expect(r.at('c4').distanceTo(r.pos(r.attacker))).toBeLessThan(1e-6);
      expect(r.at('f7').distanceTo(r.pos(r.victim))).toBeLessThan(1e-6);
      expect(r.h.fens).toEqual([CAPTURE_FEN]);
    }
  });

  it('4. cancel after shatter: debris disposed, victim restored on its square, attacker home, FEN unchanged', () => {
    const r = real(CAPTURE_FEN);
    const childrenBefore = r.pieces.group.children.length;
    r.h.play('c4f7');
    r.h.until('shatter');
    r.h.clock(0.1);
    expect(r.h.choreo.phase).toBe('shatter');
    const victim = r.pieces.get(r.victim)!;
    expect(victim.visible).toBe(false);
    expect(r.pieces.group.children.length).toBeGreaterThan(childrenBefore); // debris flying

    expect(r.h.choreo.cancel()).toBe(true);
    expect(r.h.phases.slice(-2)).toEqual(['cancelled', 'idle']);
    expect(r.fxCleared).toBe(1);
    expect(r.pieces.group.children.length).toBe(childrenBefore); // debris gone
    expect(r.animator.moving).toBe(false);
    expect(victim.visible).toBe(true);
    expect(r.at('f7').distanceTo(victim.position)).toBeLessThan(1e-6);
    expect(r.at('c4').distanceTo(r.pos(r.attacker))).toBeLessThan(1e-6);
    r.h.clock(3);
    expect(r.h.choreo.commits).toBe(0);
    expect(r.h.fens).toEqual([CAPTURE_FEN]);
  });
});

/** Real pieces + procedural animator + the app's stage adapter, on the same fake clock. */
function real(fen: string) {
  const start = fromFen(fen);
  const pieces = createPieces('low');
  pieces.sync(start.board);
  const animator = createProceduralAnimator({ fragments: 8 });
  const ref = { fxCleared: 0 };
  const stage = createAnimatorStage({ animator, get: (id) => pieces.get(id), fx: { clear: () => void ref.fxCleared++ } });
  const h = harness(start, { stage, onTick: (dt) => animator.update(dt) });
  return {
    h, pieces, animator,
    get fxCleared() { return ref.fxCleared; },
    attacker: start.board.get('c4')!.id,
    victim: start.board.get('f7')!.id,
    at: (sq: Parameters<typeof squareToWorld>[0]) => squareToWorld(sq, new Vector3()),
    pos: (id: string) => pieces.get(id)!.position,
  };
}

describe('choreographer behaviour', () => {
  it('quiet move travels along to - from (no fixed axis)', () => {
    const pieces = createPieces('low');
    const start = fromFen('4k3/8/8/8/8/8/8/1N2K3 w - - 0 1');
    pieces.sync(start.board);
    const animator = createProceduralAnimator();
    const stage = createAnimatorStage({ animator, get: (id) => pieces.get(id), fx: { clear() {} } });
    const id = start.board.get('b1')!.id;
    stage.move({ id, from: 'b1', to: 'c3' }, { duration: 0.5, hop: 0, stopShort: 0 });
    for (let t = 0; t < 0.25; t += DT) animator.update(DT);
    const from = squareToWorld('b1', new Vector3());
    const v = squareToWorld('c3', new Vector3()).sub(from);
    const d = pieces.get(id)!.position.clone().sub(from).setY(0);
    expect(d.length()).toBeGreaterThan(0.1);
    expect(Math.abs(d.x * v.z - d.z * v.x)).toBeLessThan(1e-6); // collinear with to - from
  });

  it('one huge dt still commits exactly once', () => {
    const h = harness(fromFen(CAPTURE_FEN));
    h.play('f3f7');
    h.choreo.tick(60);
    expect(h.choreo.phase).toBe('idle');
    expect(h.choreo.commits).toBe(1);
    expect(h.fens.length).toBe(2);
  });

  it('locks new moves while animating, but never cancel', () => {
    const h = harness(initialState());
    h.play('e2e4');
    expect(h.choreo.inputLocked).toBe(true);
    expect(h.play('d2d4')).toBe(false);
    expect(h.choreo.cancel()).toBe(true);
    expect(h.choreo.inputLocked).toBe(false);
    expect(h.choreo.cancel()).toBe(false);
  });

  it('cancel during settle/kingFall stops the animation and keeps the single commit', () => {
    const h = harness(fromFen(CAPTURE_FEN));
    h.play('f3f7');
    h.until('kingFall');
    expect(h.choreo.cancel()).toBe(true);
    expect(h.choreo.phase).toBe('idle');
    expect(h.phases).not.toContain('cancelled');
    expect(h.choreo.commits).toBe(1);
  });

  it('shake and close-up are skipped when toggled off (as at tier off)', () => {
    const h = harness(fromFen(CAPTURE_FEN), { toggles: { shake: false, closeUp: false } });
    h.play('f3f7');
    h.clock(6);
    expect(h.log).not.toContain('fx shake');
    expect(h.log).not.toContain('closeUp');
    expect(h.log).toContain('fx vortex'); // particles stay, the fx layer scales them by tier
  });

  it.each(Object.keys(STRIKE_PROFILES) as (keyof typeof STRIKE_PROFILES)[])('pacing: a %s capture runs ~2.2-3 s end to end', (type) => {
    for (const [from, to] of [['d4', 'd5'], ['d4', 'd7'], ['b1', 'c3']] as const) {
      const choreo = createChoreographer<number>({
        stage: { move() {}, attack() {}, pull() {}, shatter() {}, fall() {}, cancel() {}, release() {} },
        commit() {},
        toggles: () => ({ shake: true, closeUp: true }),
        effect() {},
        closeUp() {},
        closeUpEnd() {},
      });
      choreo.begin({
        mover: { id: 'a', from, to }, profile: STRIKE_PROFILES[type], capture: { id: 'v', square: to },
        companions: [], promotion: null, mate: null, next: 1,
      });
      let t = 0;
      while (choreo.phase !== 'idle' && t < 10) {
        choreo.tick(DT);
        t += DT;
      }
      expect(t, `${type} ${from}-${to}`).toBeGreaterThanOrEqual(2.2);
      expect(t, `${type} ${from}-${to}`).toBeLessThanOrEqual(3.2);
    }
  });

  it('choreo reads profiles only: no piece-type branches in choreo.ts', () => {
    const src = readFileSync(join(import.meta.dirname, 'choreo.ts'), 'utf8').replace(/\/\/.*$/gm, '');
    for (const t of Object.keys(STRIKE_PROFILES)) expect(src).not.toMatch(new RegExp(`['"]${t}['"]`));
    expect(src).not.toMatch(/switch\s*\([^)]*type/);
  });
});

describe('capture motion is continuous (no snap, no dead hold)', () => {
  // One capture per strike profile, played on real pieces with the app's commit (sync + idle).
  const CASES: Record<PieceType, readonly [string, string]> = {
    pawn: ['4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', 'e4d5'],
    knight: ['4k3/8/8/3p4/8/4N3/8/4K3 w - - 0 1', 'e3d5'],
    bishop: [CAPTURE_FEN, 'c4f7'],
    rook: ['4k3/8/8/3p4/8/8/8/3RK3 w - - 0 1', 'd1d5'],
    queen: ['4k3/8/8/3p4/8/8/8/3QK3 w - - 0 1', 'd1d5'],
    king: ['4k3/8/8/8/8/8/3p4/4K3 w - - 0 1', 'e1d2'],
  };

  it.each(Object.keys(CASES) as PieceType[])('%s: attacker rotation never jumps across the capture', (type) => {
    const [fen, uci] = CASES[type];
    let game = fromFen(fen);
    const pieces = createPieces('low');
    pieces.sync(game.board);
    const animator = createProceduralAnimator({ fragments: 4 });
    const stage = createAnimatorStage({ animator, get: (id) => pieces.get(id), fx: { clear() {} } });
    const phases: Phase[] = [];
    const choreo = createChoreographer<GameState>({
      stage,
      commit(next) {
        game = next;
        pieces.sync(game.board); // as main's show(): rotation back to restYaw, position on the square
        for (const o of pieces.group.children) animator.play(o, 'idle');
      },
      toggles: () => ({ shake: false, closeUp: false }),
      effect() {},
      closeUp() {},
      closeUpEnd() {},
      onPhase: (p) => phases.push(p),
    });
    const plan = planMove(game, parseUci(uci)!)!;
    expect(plan.profile).toBe(STRIKE_PROFILES[type]);
    const attacker = pieces.get(plan.mover.id)!;
    expect(choreo.begin(plan)).toBe(true);

    const prev = new Quaternion().copy(attacker.quaternion);
    const prevPos = attacker.position.clone();
    let commitJump = Infinity;
    let maxAfterImpact = 0;
    let impact = false;
    for (let i = 0; i < 600 && choreo.phase !== 'idle'; i++) {
      const before = choreo.phase;
      choreo.tick(DT);
      animator.update(DT);
      const jump = prev.angleTo(attacker.quaternion);
      if (before === 'shatter' && choreo.phase !== 'shatter') {
        commitJump = jump;
        expect(attacker.position.distanceTo(prevPos), 'position at commit').toBeLessThan(0.05);
      }
      if (impact) maxAfterImpact = Math.max(maxAfterImpact, jump);
      if (choreo.phase === 'shatter') impact = true;
      prev.copy(attacker.quaternion);
      prevPos.copy(attacker.position);
    }
    expect(phases).toEqual(['approach', 'strike', 'shatter', 'settle', 'idle']);
    expect(commitJump, 'rotation step on the commit frame').toBeLessThan(0.02);
    // Spins/slashes turn fast, but never a one-frame snap.
    expect(maxAfterImpact, 'largest per-frame rotation after impact').toBeLessThan(0.35);
  });

  it.each(Object.keys(STRIKE_PROFILES) as PieceType[])('%s: settle starts as the attack clip ends (no dead hold)', (type) => {
    const prof = STRIKE_PROFILES[type];
    const durations: Partial<Record<Phase, number>> = {};
    let attackDur = 0;
    let at = 0;
    let current: Phase = 'idle';
    let t = 0;
    const choreo = createChoreographer<number>({
      stage: { move() {}, attack: (_id, _to, o) => void (attackDur = o.duration), pull() {}, shatter() {}, fall() {}, cancel() {}, release() {} },
      commit() {},
      toggles: () => ({ shake: false, closeUp: false }),
      effect() {},
      closeUp() {},
      closeUpEnd() {},
      onPhase(next) {
        durations[current] = t - at;
        current = next;
        at = t;
      },
    });
    choreo.begin({
      mover: { id: 'a', from: 'd4', to: 'd5' }, profile: prof, capture: { id: 'v', square: 'd5' },
      companions: [], promotion: null, mate: null, next: 1,
    });
    const step = 1 / 600;
    while (choreo.phase !== 'idle' && t < 10) {
      t += step;
      choreo.tick(step);
    }
    expect(attackDur).toBeCloseTo(prof.strike, 6);
    expect(durations.shatter!).toBeCloseTo(prof.strike * (1 - prof.impactAt), 2);
    expect(durations.strike! + durations.shatter!).toBeCloseTo(prof.strike, 2);
  });
});

describe('animation dt clamp', () => {
  it('passes normal frames through and caps hitches at 1/30 s', () => {
    expect(MAX_ANIM_DT).toBeCloseTo(1 / 30, 12);
    expect(animDt(1 / 60)).toBe(1 / 60);
    expect(animDt(1 / 30)).toBe(1 / 30);
    expect(animDt(0.5)).toBe(1 / 30);
    expect(animDt(-1)).toBe(0);
  });

  it('a 500 ms hitch mid-attack moves the attacker no further than one 1/30 s step', () => {
    const run = (hitch: number): number => {
      const r = real(CAPTURE_FEN);
      r.h.play('c4f7');
      r.h.until('strike');
      const at = r.pos(r.attacker).clone();
      const dt = animDt(hitch);
      r.h.choreo.tick(dt);
      r.animator.update(dt);
      return r.pos(r.attacker).distanceTo(at);
    };
    expect(run(0.5)).toBeCloseTo(run(1 / 30), 9);
    expect(run(0.5)).toBeLessThan(0.15);
  });

  it('main feeds clamped dt to choreo/animator/fx and real dt to the camera', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'main.ts'), 'utf8');
    expect(src).toMatch(/const step = animDt\(dt\)/);
    expect(src).toMatch(/const adt = step \* timeScale \* slow/);
    for (const call of ['choreo.tick(adt)', 'animator.update(adt)', 'fx.update(adt)', 'rig.update(dt)']) expect(src).toContain(call);
  });
});
