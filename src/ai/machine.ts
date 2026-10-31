// Pure AI turn state machine. No Worker, no DOM, no three: (state, event) -> (state, effects).
//
//   idle      --aiTurn-------------------------> thinking   [id++, post search(id)]
//   thinking  --bestmove(id == current)--------> applying   [apply(uci)]
//   thinking  --bestmove/error(id != current)--> thinking   (stale: ignored)
//   thinking  --undo | reset-------------------> idle       [post cancel(id), id++]
//   thinking  --error(id == current)-----------> error      [report(message)]
//   applying  --applied------------------------> idle       (host re-syncs pieces + marks shadows dirty)
//   applying  --applyFailed--------------------> error      [report(message)]
//   error     --errorShown---------------------> idle
//   idle|error--userMove | undo | reset--------> idle       [id++]   (no search outstanding: nothing to cancel)
//   thinking  --userMove-----------------------> thinking   (input locked: rejected)

import type { FromWorker, ToWorker } from './protocol';

export type Phase =
  | { readonly tag: 'idle' }
  | { readonly tag: 'thinking'; readonly requestId: number }
  | { readonly tag: 'applying'; readonly requestId: number; readonly uci: string; readonly evalCp: number }
  | { readonly tag: 'error'; readonly requestId: number; readonly message: string };

export interface Machine {
  readonly phase: Phase;
  /** Monotonic. Only a worker reply carrying exactly this id may advance the machine. */
  readonly currentRequestId: number;
}

export type AiEvent =
  | { readonly type: 'aiTurn'; readonly fen: string; readonly timeMs: number }
  | { readonly type: 'worker'; readonly msg: FromWorker }
  | { readonly type: 'applied' }
  | { readonly type: 'applyFailed'; readonly message: string }
  | { readonly type: 'errorShown' }
  | { readonly type: 'userMove' }
  | { readonly type: 'undo' }
  | { readonly type: 'reset' };

export type Effect =
  | { readonly kind: 'post'; readonly msg: ToWorker }
  | { readonly kind: 'apply'; readonly uci: string; readonly evalCp: number }
  | { readonly kind: 'report'; readonly message: string }
  | { readonly kind: 'ignoredStale'; readonly requestId: number }
  | { readonly kind: 'rejected'; readonly event: AiEvent['type']; readonly phase: Phase['tag'] };

export interface Step {
  readonly machine: Machine;
  readonly effects: readonly Effect[];
}

export const initialMachine: Machine = { phase: { tag: 'idle' }, currentRequestId: 0 };

const IDLE: Phase = { tag: 'idle' };

export function step(m: Machine, ev: AiEvent): Step {
  const p = m.phase;
  const reject = (): Step => ({ machine: m, effects: [{ kind: 'rejected', event: ev.type, phase: p.tag }] });

  switch (ev.type) {
    case 'aiTurn': {
      if (p.tag !== 'idle') return reject();
      const requestId = m.currentRequestId + 1;
      return {
        machine: { phase: { tag: 'thinking', requestId }, currentRequestId: requestId },
        effects: [{ kind: 'post', msg: { kind: 'search', requestId, fen: ev.fen, timeMs: ev.timeMs } }],
      };
    }
    case 'worker': {
      const msg = ev.msg;
      if (p.tag !== 'thinking' || msg.requestId !== m.currentRequestId || p.requestId !== msg.requestId) {
        return { machine: m, effects: [{ kind: 'ignoredStale', requestId: msg.requestId }] };
      }
      if (msg.kind === 'bestmove') {
        return {
          machine: { ...m, phase: { tag: 'applying', requestId: msg.requestId, uci: msg.uci, evalCp: msg.evalCp } },
          effects: [{ kind: 'apply', uci: msg.uci, evalCp: msg.evalCp }],
        };
      }
      return {
        machine: { ...m, phase: { tag: 'error', requestId: msg.requestId, message: msg.message } },
        effects: [{ kind: 'report', message: msg.message }],
      };
    }
    case 'applied':
      return p.tag === 'applying' ? { machine: { ...m, phase: IDLE }, effects: [] } : reject();
    case 'applyFailed':
      return p.tag === 'applying'
        ? {
            machine: { ...m, phase: { tag: 'error', requestId: p.requestId, message: ev.message } },
            effects: [{ kind: 'report', message: ev.message }],
          }
        : reject();
    case 'errorShown':
      return p.tag === 'error' ? { machine: { ...m, phase: IDLE }, effects: [] } : reject();
    case 'userMove':
      if (p.tag === 'thinking' || p.tag === 'applying') return reject(); // board input locked
      return { machine: { phase: IDLE, currentRequestId: m.currentRequestId + 1 }, effects: [] };
    case 'undo':
    case 'reset': {
      if (p.tag === 'applying') return reject(); // synchronous window; host never sends this
      const effects: Effect[] =
        p.tag === 'thinking' ? [{ kind: 'post', msg: { kind: 'cancel', requestId: p.requestId } }] : [];
      return { machine: { phase: IDLE, currentRequestId: m.currentRequestId + 1 }, effects };
    }
  }
}

export const isInputLocked = (m: Machine): boolean => m.phase.tag === 'thinking' || m.phase.tag === 'applying';
