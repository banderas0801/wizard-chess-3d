import { QualityTier } from './post';

export interface QualityGovernorOptions {
  budgetMs?: number; // Mặc định 16.67ms (tương đương 60 FPS)
  initialTier?: QualityTier;
  nowFn?: () => number; // Để tiêm thời gian giả trong unit test
}

export interface QualityGovernor {
  sample: (frameMs: number) => QualityTier | null;
  getCurrentTier: () => QualityTier;
  reset: () => void;
}

/**
 * Bộ điều tiết hiệu năng thông minh (Hysteresis Quality Governor)
 * Quy tắc:
 * 1. Hạ tier khi trung bình 30 frame gần nhất > budgetMs * 1.2
 * 2. Chỉ nâng tier khi frameMs < budgetMs * 0.7 liên tục trong 5 giây VÀ đã qua tối thiểu 10 giây kể từ lần hạ gần nhất
 */
export function createQualityGovernor(options: QualityGovernorOptions = {}): QualityGovernor {
  const budgetMs = options.budgetMs ?? 16.67;
  const now = options.nowFn ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));

  const dropThreshold = budgetMs * 1.2;
  const upgradeThreshold = budgetMs * 0.7;

  let currentTier: QualityTier = options.initialTier ?? 'high';

  // Bộ đệm 30 frame gần nhất
  const frameWindow: number[] = [];
  const WINDOW_SIZE = 30;

  // Thời điểm hạ tier gần nhất
  let lastDowngradeTime: number = -Infinity;

  // Thời gian tích lũy mượt liên tục (ms)
  let smoothDurationMs: number = 0;
  let lastSampleTime: number = now();

  function getAverage(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sum = arr.reduce((acc, val) => acc + val, 0);
    return sum / arr.length;
  }

  function downgrade(): QualityTier | null {
    const prevTier = currentTier;
    if (currentTier === 'high') currentTier = 'low';
    else if (currentTier === 'low') currentTier = 'off';

    if (currentTier !== prevTier) {
      lastDowngradeTime = now();
      smoothDurationMs = 0; // Reset bộ đếm mượt
      frameWindow.length = 0; // Reset bộ đệm frame
      return currentTier;
    }
    return null;
  }

  function upgrade(): QualityTier | null {
    const prevTier = currentTier;
    if (currentTier === 'off') currentTier = 'low';
    else if (currentTier === 'low') currentTier = 'high';

    if (currentTier !== prevTier) {
      smoothDurationMs = 0;
      frameWindow.length = 0;
      return currentTier;
    }
    return null;
  }

  return {
    getCurrentTier: () => currentTier,
    reset: () => {
      currentTier = options.initialTier ?? 'high';
      frameWindow.length = 0;
      lastDowngradeTime = -Infinity;
      smoothDurationMs = 0;
      lastSampleTime = now();
    },
    sample: (frameMs: number): QualityTier | null => {
      const currentTime = now();
      const deltaElapsed = Math.max(0, currentTime - lastSampleTime);
      lastSampleTime = currentTime;

      // 1. Thêm vào cửa sổ 30 frame
      frameWindow.push(frameMs);
      if (frameWindow.length > WINDOW_SIZE) {
        frameWindow.shift();
      }

      // 2. Kiểm tra điều kiện HẠ TIER
      if (frameWindow.length === WINDOW_SIZE) {
        const avg = getAverage(frameWindow);
        if (avg > dropThreshold && currentTier !== 'off') {
          return downgrade();
        }
      }

      // 3. Kiểm tra điều kiện NÂNG TIER
      if (currentTier !== 'high') {
        const timeSinceDowngrade = currentTime - lastDowngradeTime;

        if (frameMs < upgradeThreshold) {
          smoothDurationMs += deltaElapsed;
          // Chỉ nâng khi < budgetMs * 0.7 liên tục 5s (5000ms) VÀ đã qua 10s (10000ms) kể từ lần hạ
          if (smoothDurationMs >= 5000 && timeSinceDowngrade >= 10000) {
            return upgrade();
          }
        } else {
          // Bị gián đoạn -> reset thời gian tích lũy mượt
          smoothDurationMs = 0;
        }
      }

      return null;
    }
  };
}
