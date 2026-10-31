// Wire protocol between main thread and AI worker. The worker only ever sees a FEN string:
// no shared state, no piece ids, no three objects.

export type ToWorker =
  | { kind: 'search'; requestId: number; fen: string; depth: number; timeMs: number }
  | { kind: 'cancel'; requestId: number };

export type FromWorker =
  | { kind: 'bestmove'; requestId: number; uci: string; evalCp: number }
  | { kind: 'error'; requestId: number; message: string };

/** Transport the controller talks to. A real Worker or a test fake. */
export interface AiPort {
  post(msg: ToWorker): void;
  /** Returns an unsubscribe function. */
  subscribe(handler: (msg: FromWorker) => void): () => void;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const isId = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);

/** Boundary parser for messages arriving from the worker. */
export function parseFromWorker(x: unknown): FromWorker | null {
  if (!isObj(x) || !isId(x.requestId)) return null;
  if (x.kind === 'bestmove' && typeof x.uci === 'string' && typeof x.evalCp === 'number')
    return { kind: 'bestmove', requestId: x.requestId, uci: x.uci, evalCp: x.evalCp };
  if (x.kind === 'error' && typeof x.message === 'string') return { kind: 'error', requestId: x.requestId, message: x.message };
  return null;
}

/** Boundary parser for messages arriving at the worker. */
export function parseToWorker(x: unknown): ToWorker | null {
  if (!isObj(x) || !isId(x.requestId)) return null;
  if (x.kind === 'cancel') return { kind: 'cancel', requestId: x.requestId };
  if (x.kind === 'search' && typeof x.fen === 'string' && isId(x.depth) && typeof x.timeMs === 'number')
    return { kind: 'search', requestId: x.requestId, fen: x.fen, depth: x.depth, timeMs: x.timeMs };
  return null;
}
