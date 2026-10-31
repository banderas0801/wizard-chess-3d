import { describe, expect, it } from 'vitest';
import { createQualityGovernor, type QualityTier } from './quality';

const BUDGET = 16; // ms
const SLOW = BUDGET * 1.5; // > 1.2x
const FAST = BUDGET * 0.5; // < 0.7x
const MID = BUDGET; // inside hysteresis band

function rig(initial?: QualityTier) {
  let t = 0;
  const gov = createQualityGovernor({ budgetMs: BUDGET, now: () => t, ...(initial ? { initial } : {}) });
  /** Feed n frames of the given duration, advancing the fake clock by that duration each frame. */
  const feed = (n: number, ms: number): (QualityTier | null)[] => {
    const out: (QualityTier | null)[] = [];
    for (let i = 0; i < n; i++) {
      t += ms;
      out.push(gov.sample(ms));
    }
    return out;
  };
  const changes = (xs: (QualityTier | null)[]) => xs.filter((x): x is QualityTier => x !== null);
  return { gov, feed, changes, advance: (ms: number) => (t += ms), time: () => t };
}

describe('quality governor', () => {
  it('starts high and returns null while unchanged', () => {
    const { gov, feed } = rig();
    expect(gov.tier).toBe('high');
    expect(feed(200, MID).every((x) => x === null)).toBe(true);
    expect(feed(200, FAST).every((x) => x === null)).toBe(true); // already at top
    expect(gov.tier).toBe('high');
  });

  it('downgrades fast: high -> low after 30 slow frames, then low -> off after 30 more', () => {
    const { gov, feed } = rig();
    const first = feed(30, SLOW);
    expect(first.slice(0, 29).every((x) => x === null)).toBe(true);
    expect(first[29]).toBe('low');
    const second = feed(30, SLOW);
    expect(second.slice(0, 29).every((x) => x === null)).toBe(true); // window was reset
    expect(second[29]).toBe('off');
    expect(feed(100, SLOW).every((x) => x === null)).toBe(true); // floor
    expect(gov.tier).toBe('off');
  });

  it('uses the rolling mean, not single spikes', () => {
    const { gov, feed } = rig();
    feed(29, MID);
    expect(feed(1, BUDGET * 5)[0]).toBeNull(); // mean = (29*16+80)/30 ≈ 18.1 < 19.2
    expect(gov.tier).toBe('high');
  });

  it('does not upgrade before 5s of continuous stability', () => {
    const { gov, feed, advance } = rig();
    feed(30, SLOW); // -> low at ~0.72s
    advance(20_000); // well past cooldown
    // 4.9s of fast frames
    const out = feed(Math.floor(4_900 / FAST), FAST);
    expect(out.every((x) => x === null)).toBe(true);
    // one mid frame breaks the streak; the next 4.9s is still not enough
    feed(1, MID);
    expect(feed(Math.floor(4_900 / FAST), FAST).every((x) => x === null)).toBe(true);
    expect(gov.tier).toBe('low');
  });

  it('does not upgrade within 10s of the last downgrade even if stable', () => {
    const { gov, feed, time } = rig();
    feed(30, SLOW);
    const downAt = time();
    expect(gov.tier).toBe('low');
    const out: (QualityTier | null)[] = [];
    while (time() - downAt < 9_990) out.push(...feed(1, FAST));
    expect(out.every((x) => x === null)).toBe(true);
    expect(gov.tier).toBe('low');
    // crossing the 10s mark (with >5s stable) upgrades
    const after = feed(5, FAST);
    expect(after).toContain('high');
  });

  it('upgrades off -> low -> high after stability, each step needing its own 5s', () => {
    const { gov, feed, changes, time } = rig();
    feed(60, SLOW);
    expect(gov.tier).toBe('off');
    const downAt = time();
    const log: { tier: QualityTier; at: number }[] = [];
    for (let i = 0; i < 3_000 && gov.tier !== 'high'; i++) {
      const r = feed(1, FAST)[0];
      if (r) log.push({ tier: r, at: time() });
    }
    expect(changes(log.map((l) => l.tier))).toEqual(['low', 'high']);
    expect(log[0]!.at - downAt).toBeGreaterThanOrEqual(10_000);
    expect(log[1]!.at - log[0]!.at).toBeGreaterThanOrEqual(5_000);
  });

  it('does not oscillate on a borderline sequence', () => {
    const { feed, changes } = rig('low');
    // Alternating just-under-downgrade and just-over-upgrade thresholds for 60s.
    const seq: (QualityTier | null)[] = [];
    for (let i = 0; i < 3_000; i++) {
      seq.push(...feed(1, i % 2 === 0 ? BUDGET * 0.69 : BUDGET * 1.19));
    }
    expect(changes(seq)).toEqual([]);
    // Sitting right at budget for a minute: also nothing.
    expect(changes(feed(Math.floor(60_000 / MID), MID))).toEqual([]);
  });

  it('limits flapping under a periodic slow/fast load to at most one change per ~10s', () => {
    const { feed, changes } = rig();
    const seq: (QualityTier | null)[] = [];
    for (let cycle = 0; cycle < 6; cycle++) {
      seq.push(...feed(40, SLOW)); // ~1s slow burst
      seq.push(...feed(Math.floor(2_000 / FAST), FAST)); // 2s fast
    }
    // ~18s total: bursts can only push down; upgrades never fire because 5s stability is never reached.
    expect(changes(seq).every((t) => t !== 'high')).toBe(true);
    expect(changes(seq)).toEqual(['low', 'off']);
  });

  it('ignores invalid samples', () => {
    const { gov } = rig();
    expect(gov.sample(Number.NaN)).toBeNull();
    expect(gov.sample(-1)).toBeNull();
    expect(gov.tier).toBe('high');
  });
});
