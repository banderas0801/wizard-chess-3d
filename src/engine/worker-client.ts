/**
 * WorkerClient - Cầu nối phi đồng bộ quản lý Web Worker AI
 * Bảo vệ bất biến: Quản lý requestId để loại bỏ triệt để Stale Response khi Undo/Reset
 */

import { WorkerRequest, WorkerResponse } from './chess-worker';

export class ChessWorkerClient {
  private worker: Worker | null = null;
  private currentRequestId = 0;
  private pendingResolve: ((res: WorkerResponse) => void) | null = null;

  constructor() {
    this._initWorker();
  }

  private _initWorker() {
    try {
      this.worker = new Worker(new URL('./chess-worker.ts', import.meta.url), {
        type: 'module'
      });

      this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const res = e.data;
        if (res.type !== 'MOVE_RESULT') return;

        // BẢO VỆ BẤT BIẾN: Chỉ chấp nhận kết quả khớp đúng requestId hiện tại!
        if (res.requestId === String(this.currentRequestId)) {
          if (this.pendingResolve) {
            const cb = this.pendingResolve;
            this.pendingResolve = null;
            cb(res);
          }
        } else {
          // Bỏ qua kết quả cũ nếu ván đấu đã bị Undo hoặc Reset (Stale Response Dropped)
          console.log(`[Worker] Bỏ qua nước cờ cũ mang requestId=${res.requestId}, hiện tại=${this.currentRequestId}`);
        }
      };

      this.worker.onerror = (err) => {
        console.error('[Worker Error]:', err);
      };
    } catch (err) {
      console.warn('[Worker] Trình duyệt không hỗ trợ Module Worker:', err);
    }
  }

  /**
   * Yêu cầu AI tính toán nước đi tiếp theo
   */
  public calculateMove(
    fen: string,
    tierId: 'novice' | 'adept' | 'archmage' | 'grandmaster',
    turn: 'w' | 'b'
  ): Promise<WorkerResponse> {
    this.currentRequestId++;
    const requestId = String(this.currentRequestId);

    return new Promise((resolve) => {
      this.pendingResolve = resolve;

      const req: WorkerRequest = {
        type: 'CALCULATE_MOVE',
        requestId,
        fen,
        tierId,
        turn
      };

      if (this.worker) {
        this.worker.postMessage(req);
      }
    });
  }

  /**
   * Hủy ngay lập tức yêu cầu đang tính toán (dùng khi Undo hoặc ván mới)
   */
  public cancel(): void {
    this.currentRequestId++; // Tăng requestId -> toàn bộ kết quả cũ đang tính sẽ tự động bị bỏ qua
    this.pendingResolve = null;
  }

  public terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
