// Pure quality governor. No three, no DOM: time comes from an injectable clock.

export type QualityTier = 'off' | 'low' | 'high';

const ORDER: readonly QualityTier[] = ['off', 'low', 'high'];

export const WINDOW_FRAMES = 30;
export const DOWNGRADE_FACTOR = 1.2;
export const UPGRADE_FACTOR = 0.7;
export const STABLE_MS = 5_000;
export const COOLDOWN_MS = 10_000;

export interface GovernorOptions {
  budgetMs: number;
  /** Milliseconds clock; defaults to performance.now(). */
  now?: () => number;
  initial?: QualityTier;
}

export interface QualityGovernor {
  /** Feed one frame time. Returns the new tier when it changes, otherwise null. */
  sample(frameMs: number): QualityTier | null;
  readonly tier: QualityTier;
}

/**
 * Invariants:
 *  - Downgrade fast: once the mean of the last 30 frames exceeds budget*1.2, drop one tier and reset the window.
 *  - Upgrade slow: only after every frame for >= 5s was under budget*0.7 AND >= 10s since the last downgrade.
 *  - Frames between 0.7x and 1.2x budget neither downgrade nor count as stable (hysteresis band).
 */
export function createQualityGovernor(opts: GovernorOptions): QualityGovernor {
  const { budgetMs } = opts;
  if (!(budgetMs > 0)) throw new Error('budgetMs must be > 0');
  const now = opts.now ?? (() => performance.now());

  let tierIdx = ORDER.indexOf(opts.initial ?? 'high');
  const window: number[] = [];
  let windowSum = 0;
  let stableSince: number | null = null;
  let lastDowngradeAt = Number.NEGATIVE_INFINITY;

  const resetWindow = (): void => {
    window.length = 0;
    windowSum = 0;
  };

  return {
    get tier() {
      return ORDER[tierIdx]!;
    },
    sample(frameMs: number): QualityTier | null {
      const t = now();
      if (!Number.isFinite(frameMs) || frameMs < 0) return null;

      window.push(frameMs);
      windowSum += frameMs;
      if (window.length > WINDOW_FRAMES) windowSum -= window.shift()!;

      if (frameMs < budgetMs * UPGRADE_FACTOR) {
        stableSince ??= t;
      } else {
        stableSince = null;
      }

      if (tierIdx > 0 && window.length === WINDOW_FRAMES && windowSum / WINDOW_FRAMES > budgetMs * DOWNGRADE_FACTOR) {
        tierIdx -= 1;
        lastDowngradeAt = t;
        stableSince = null;
        resetWindow();
        return ORDER[tierIdx]!;
      }

      if (
        tierIdx < ORDER.length - 1 &&
        stableSince !== null &&
        t - stableSince >= STABLE_MS &&
        t - lastDowngradeAt >= COOLDOWN_MS
      ) {
        tierIdx += 1;
        // Each further upgrade needs its own fresh 5s of stability.
        stableSince = t;
        resetWindow();
        return ORDER[tierIdx]!;
      }

      return null;
    },
  };
}

export function parseTier(s: string | null | undefined): QualityTier | null {
  return s === 'off' || s === 'low' || s === 'high' ? s : null;
}
