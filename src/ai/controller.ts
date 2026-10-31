// Imperative shell around the pure machine: owns currentRequestId, runs effects against an
// injected AiPort and host callbacks. Testable with a fake port; no real Worker required.
import { initialMachine, isInputLocked, step, type AiEvent, type Effect, type Machine } from './machine';
import { parseFromWorker, type AiPort } from './protocol';

export interface AiHost {
  /** Apply the engine's move to the live game. Return an error message if it can't be applied. */
  applyMove(uci: string, evalCp: number): { ok: true } | { ok: false; message: string };
  /** Show an error (e.g. on the HUD). */
  showError(message: string): void;
  onChange?(m: Machine): void;
  onEffect?(e: Effect): void;
}

export interface AiController {
  readonly machine: Machine;
  readonly inputLocked: boolean;
  requestMove(fen: string, opts?: { depth?: number; timeMs?: number }): void;
  /** Call BEFORE applying a human move; returns false if input is locked. */
  userMove(): boolean;
  undo(): void;
  reset(): void;
  dispose(): void;
}

export function createAiController(port: AiPort, host: AiHost): AiController {
  let machine = initialMachine;
  let lastStep: readonly Effect[] = [];

  const dispatch = (ev: AiEvent): void => {
    const r = step(machine, ev);
    machine = r.machine;
    lastStep = r.effects;
    host.onChange?.(machine);
    for (const e of r.effects) run(e);
  };

  const run = (e: Effect): void => {
    host.onEffect?.(e);
    switch (e.kind) {
      case 'post':
        port.post(e.msg);
        break;
      case 'apply': {
        const res = host.applyMove(e.uci, e.evalCp);
        dispatch(res.ok ? { type: 'applied' } : { type: 'applyFailed', message: res.message });
        break;
      }
      case 'report':
        host.showError(e.message);
        dispatch({ type: 'errorShown' });
        break;
      case 'ignoredStale':
      case 'rejected':
        break;
    }
  };

  const unsubscribe = port.subscribe((raw) => {
    const msg = parseFromWorker(raw);
    if (msg) dispatch({ type: 'worker', msg });
  });

  return {
    get machine() {
      return machine;
    },
    get inputLocked() {
      return isInputLocked(machine);
    },
    requestMove(fen, opts) {
      dispatch({ type: 'aiTurn', fen, depth: opts?.depth ?? 1, timeMs: opts?.timeMs ?? 300 });
    },
    userMove() {
      dispatch({ type: 'userMove' });
      return !lastStep.some((e) => e.kind === 'rejected');
    },
    undo() {
      dispatch({ type: 'undo' });
    },
    reset() {
      dispatch({ type: 'reset' });
    },
    dispose: unsubscribe,
  };
}
