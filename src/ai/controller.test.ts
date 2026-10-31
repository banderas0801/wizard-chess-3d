import { describe, expect, it } from 'vitest';
import { createAiController, type AiHost } from './controller';
import { search } from './engine';
import { initialMachine, step } from './machine';
import { parseToWorker, type AiPort, type FromWorker, type ToWorker } from './protocol';
import { applyMove, fromFen, initialState, parseUci, toFen, type GameState } from '../game';

/**
 * Fake worker: runs the real placeholder engine on each search, but HOLDS the replies so the
 * test decides when and in what order they are delivered. Honours nothing about cancel on
 * purpose (worst case: a cancelled search still answers late).
 */
function fakeWorker() {
  const posted: ToWorker[] = [];
  const pending: FromWorker[] = [];
  let handler: ((m: FromWorker) => void) | null = null;
  const port: AiPort = {
    post(msg) {
      const parsed = parseToWorker(JSON.parse(JSON.stringify(msg))); // structured-clone-ish: FEN only crosses
      if (!parsed) throw new Error('bad message');
      posted.push(parsed);
      if (parsed.kind === 'search') {
        const r = search(parsed.fen, () => 0);
        pending.push(
          r.ok
            ? { kind: 'bestmove', requestId: parsed.requestId, uci: r.uci, evalCp: r.evalCp }
            : { kind: 'error', requestId: parsed.requestId, message: r.message },
        );
      }
    },
    subscribe(h) {
      handler = h;
      return () => (handler = null);
    },
  };
  return {
    port,
    posted,
    pending,
    deliverReversed() {
      const all = pending.splice(0).reverse();
      for (const m of all) handler?.(m);
    },
    deliver(m: FromWorker) {
      handler?.(m);
    },
  };
}

/** Host that owns a real game and records every move it applies. */
function gameHost(start: GameState = initialState()) {
  let state = start;
  const history: GameState[] = [];
  const applied: string[] = [];
  const errors: string[] = [];
  let shadowDirty = 0;
  const host: AiHost = {
    applyMove(uci) {
      const m = parseUci(uci);
      const r = m ? applyMove(state, m) : null;
      if (!r || !r.ok) return { ok: false, message: `illegal ${uci}` };
      history.push(state);
      state = r.state;
      applied.push(uci);
      shadowDirty++;
      return { ok: true };
    },
    showError: (msg) => errors.push(msg),
  };
  return {
    host,
    applied,
    errors,
    get shadowDirty() {
      return shadowDirty;
    },
    get state() {
      return state;
    },
    humanMove(uci: string) {
      const r = applyMove(state, parseUci(uci)!);
      if (!r.ok) throw new Error(uci);
      history.push(state);
      state = r.state;
    },
    undo() {
      state = history.pop() ?? state;
    },
    reset() {
      state = initialState();
      history.length = 0;
    },
  };
}

describe('AI controller with a fake worker', () => {
  it('never applies a stale bestmove when replies arrive in reversed order', () => {
    const w = fakeWorker();
    const g = gameHost();
    const ai = createAiController(w.port, g.host);

    // Human e2e4, AI asked for black's reply (req 1).
    expect(ai.userMove()).toBe(true);
    g.humanMove('e2e4');
    ai.requestMove(toFen(g.state));
    const firstId = ai.machine.currentRequestId;
    expect(ai.machine.phase).toEqual({ tag: 'thinking', requestId: firstId });
    expect(ai.inputLocked).toBe(true);

    // Human undoes while AI is thinking -> cancel(1), id bumped.
    ai.undo();
    g.undo();
    expect(w.posted.at(-1)).toEqual({ kind: 'cancel', requestId: firstId });
    expect(ai.machine.phase.tag).toBe('idle');

    // Human plays d2d4 instead; AI asked again with a fresh id.
    expect(ai.userMove()).toBe(true);
    g.humanMove('d2d4');
    const fenAfterD4 = toFen(g.state);
    ai.requestMove(fenAfterD4);
    const current = ai.machine.currentRequestId;
    expect(current).toBeGreaterThan(firstId);
    expect(ai.machine.phase).toEqual({ tag: 'thinking', requestId: current });

    // Fake worker answers newest first, then the stale (cancelled) one.
    const stale = w.pending.find((m) => m.requestId === firstId)!;
    const fresh = w.pending.find((m) => m.requestId === current)!;
    expect(stale.kind).toBe('bestmove');
    expect(w.pending.map((m) => m.requestId)).toEqual([firstId, current]);
    w.deliverReversed(); // delivers [current, firstId]

    // Exactly one move applied, and it is the one computed for the d4 position.
    expect(g.applied).toHaveLength(1);
    expect(fresh.kind === 'bestmove' && g.applied[0]).toBe(fresh.kind === 'bestmove' && fresh.uci);
    const expected = search(fenAfterD4, () => 0);
    expect(expected.ok && g.applied[0]).toBe(expected.ok && expected.uci);
    expect(g.shadowDirty).toBe(1);
    expect(ai.machine.phase.tag).toBe('idle');
    expect(g.errors).toEqual([]);
  });

  it('ignores a stale reply that arrives first and keeps thinking', () => {
    const w = fakeWorker();
    const g = gameHost();
    const ai = createAiController(w.port, g.host);
    g.humanMove('e2e4');
    ai.requestMove(toFen(g.state));
    const firstId = ai.machine.currentRequestId;
    ai.reset();
    expect(w.posted.at(-1)).toEqual({ kind: 'cancel', requestId: firstId });
    g.reset();
    g.humanMove('g1f3');
    ai.userMove();
    ai.requestMove(toFen(g.state));
    const id = ai.machine.currentRequestId;
    const [first, second] = w.pending.splice(0);
    expect(first!.requestId).toBe(firstId);
    w.deliver(first!); // stale
    expect(g.applied).toEqual([]);
    expect(ai.machine.phase).toEqual({ tag: 'thinking', requestId: id });
    w.deliver(second!);
    expect(g.applied).toHaveLength(1);
    expect(ai.machine.phase.tag).toBe('idle');
    // A very late duplicate of an old id while idle is also ignored.
    w.deliver(first!);
    expect(g.applied).toHaveLength(1);
  });

  it('locks board input while thinking', () => {
    const w = fakeWorker();
    const g = gameHost();
    const ai = createAiController(w.port, g.host);
    g.humanMove('e2e4');
    ai.requestMove(toFen(g.state));
    expect(ai.userMove()).toBe(false);
    expect(ai.machine.phase.tag).toBe('thinking');
    w.deliverReversed();
    expect(ai.userMove()).toBe(true);
  });

  it('matching worker error -> error -> idle, shown on HUD; nothing applied', () => {
    const w = fakeWorker();
    const g = gameHost(fromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')); // black stalemated
    const phases: string[] = [];
    const ai = createAiController(w.port, { ...g.host, onChange: (m) => phases.push(m.phase.tag) });
    ai.requestMove(toFen(g.state));
    w.deliverReversed();
    expect(g.errors).toEqual(['no legal moves (stalemate)']);
    expect(g.applied).toEqual([]);
    expect(phases).toEqual(['thinking', 'error', 'idle']);
  });

  it('an illegal bestmove from the worker is not applied and becomes an error', () => {
    const w = fakeWorker();
    const g = gameHost();
    const ai = createAiController(w.port, g.host);
    g.humanMove('e2e4');
    ai.requestMove(toFen(g.state));
    w.pending.length = 0;
    w.deliver({ kind: 'bestmove', requestId: ai.machine.currentRequestId, uci: 'e8e1', evalCp: 0 });
    expect(g.applied).toEqual([]);
    expect(g.errors).toEqual(['illegal e8e1']);
    expect(ai.machine.phase.tag).toBe('idle');
  });

  it('only FEN crosses the port (no piece ids / shared state)', () => {
    const w = fakeWorker();
    const g = gameHost();
    const ai = createAiController(w.port, g.host);
    ai.requestMove(toFen(g.state));
    const msg = w.posted[0]!;
    expect(Object.keys(msg).sort()).toEqual(['depth', 'fen', 'kind', 'requestId', 'timeMs']);
    expect(JSON.stringify(msg)).not.toMatch(/white-|black-/);
  });
});

describe('machine (pure)', () => {
  it('requestId is strictly increasing across aiTurn / userMove / undo / reset', () => {
    let m = initialMachine;
    const ids: number[] = [];
    const evs = [
      { type: 'aiTurn', fen: 'x', depth: 1, timeMs: 1 },
      { type: 'undo' },
      { type: 'userMove' },
      { type: 'aiTurn', fen: 'x', depth: 1, timeMs: 1 },
      { type: 'reset' },
    ] as const;
    for (const ev of evs) {
      m = step(m, ev).machine;
      ids.push(m.currentRequestId);
    }
    expect(ids).toEqual([1, 2, 3, 4, 5]);
  });

  it('error/bestmove for a non-current id never leaves thinking', () => {
    const t = step(initialMachine, { type: 'aiTurn', fen: 'x', depth: 1, timeMs: 1 }).machine;
    for (const msg of [
      { kind: 'bestmove', requestId: 0, uci: 'e2e4', evalCp: 0 },
      { kind: 'error', requestId: 7, message: 'x' },
    ] as const) {
      const r = step(t, { type: 'worker', msg });
      expect(r.machine).toBe(t);
      expect(r.effects).toEqual([{ kind: 'ignoredStale', requestId: msg.requestId }]);
    }
  });

  it('randomised: no apply effect ever carries a non-current id', () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    let m = initialMachine;
    for (let i = 0; i < 5_000; i++) {
      const k = Math.floor(rnd() * 6);
      const id = Math.floor(rnd() * (m.currentRequestId + 2));
      const ev =
        k === 0 ? ({ type: 'aiTurn', fen: 'x', depth: 1, timeMs: 1 } as const)
        : k === 1 ? ({ type: 'worker', msg: { kind: 'bestmove', requestId: id, uci: 'a', evalCp: 0 } } as const)
        : k === 2 ? ({ type: 'worker', msg: { kind: 'error', requestId: id, message: 'e' } } as const)
        : k === 3 ? ({ type: 'undo' } as const)
        : k === 4 ? ({ type: 'userMove' } as const)
        : ({ type: m.phase.tag === 'applying' ? 'applied' : 'errorShown' } as const);
      const r = step(m, ev);
      for (const e of r.effects) {
        if (e.kind === 'apply') {
          expect(ev.type).toBe('worker');
          if (ev.type === 'worker') expect(ev.msg.requestId).toBe(m.currentRequestId);
        }
      }
      expect(r.machine.currentRequestId).toBeGreaterThanOrEqual(m.currentRequestId);
      m = r.machine;
    }
  });
});
