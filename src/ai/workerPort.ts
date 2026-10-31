import type { AiPort, FromWorker } from './protocol';

/** Adapts a real module Worker to the AiPort interface. */
export function createWorkerPort(): AiPort & { terminate(): void } {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  return {
    post: (msg) => worker.postMessage(msg),
    subscribe(handler) {
      const listener = (e: MessageEvent<FromWorker>): void => handler(e.data);
      worker.addEventListener('message', listener);
      return () => worker.removeEventListener('message', listener);
    },
    terminate: () => worker.terminate(),
  };
}
