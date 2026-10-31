// Worker entry. Receives FEN only; replies with bestmove/error tagged with the same requestId.
import { search } from './engine';
import { parseToWorker, type FromWorker } from './protocol';

// Typed narrowly instead of pulling the whole webworker lib into a DOM-typed program.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<unknown>) => void) | null;
  postMessage(m: FromWorker): void;
};

const cancelled = new Set<number>();
const reply = (m: FromWorker): void => ctx.postMessage(m);

ctx.onmessage = (e) => {
  const msg = parseToWorker(e.data);
  if (!msg) return;
  if (msg.kind === 'cancel') {
    cancelled.add(msg.requestId);
    return;
  }
  // Simulated think time so cancellation is observable; a real engine would poll `cancelled` in its loop.
  const delay = Math.max(0, Math.min(msg.timeMs, 2_000));
  setTimeout(() => {
    if (cancelled.delete(msg.requestId)) return;
    const r = search(msg.fen);
    reply(r.ok ? { kind: 'bestmove', requestId: msg.requestId, uci: r.uci, evalCp: r.evalCp } : { kind: 'error', requestId: msg.requestId, message: r.message });
  }, delay);
};
