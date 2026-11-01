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
 * Quy tắc chuẩn:
 * 1. Hạ tier khi trung bình 30 frame gần nhất > budgetMs * 1.2
 * 2. Chỉ nâng tier khi frameMs < budgetMs * 0.7 liên tục tích lũy đủ 5 giây VÀ đã qua tối thiểu 10 giây kể từ lần hạ gần nhất
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
  let lastDowngradeTime = -Infinity;

  // Thời gian tích lũy mượt liên tục (ms) tính theo frameMs thực tế
  let smoothDurationMs = 0;

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
    },
    sample: (frameMs: number): QualityTier | null => {
      const currentTime = now();

      // 1. Thêm vào cửa sổ 30 frame
      frameWindow.push(frameMs);
      if (frameWindow.length > WINDOW_SIZE) {
        frameWindow.shift();
      }

      // 2. Kiểm tra điều kiện HẠ TIER (trung bình 30 frame > budgetMs * 1.2)
      if (frameWindow.length === WINDOW_SIZE) {
        const avg = getAverage(frameWindow);
        if (avg > dropThreshold && currentTier !== 'off') {
          return downgrade();
        }
      }

      // 3. Kiểm tra điều kiện NÂNG TIER (Hysteresis)
      if (currentTier !== 'high') {
        const timeSinceDowngrade = currentTime - lastDowngradeTime;

        if (frameMs < upgradeThreshold) {
          // Tích lũy đúng frameMs mượt thực tế
          smoothDurationMs += frameMs;
          // Chỉ nâng khi tích lũy đủ 5000ms mượt liên tục VÀ thời gian thực tế đã qua >= 10000ms kể từ lần hạ
          if (smoothDurationMs >= 5000 && timeSinceDowngrade >= 10000) {
            return upgrade();
          }
        } else {
          // Bị gián đoạn bởi frame lag -> reset bộ đếm liên tục
          smoothDurationMs = 0;
        }
      }

      return null;
    }
  };
}
