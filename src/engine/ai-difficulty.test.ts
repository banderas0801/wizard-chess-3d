import { describe, it, expect } from 'vitest';
import { DIFFICULTY_TIERS, OPENING_BOOK } from '../game/ai-difficulty';

describe('AI Difficulty & ELO Rating System', () => {
  it('định nghĩa đầy đủ 4 cấp độ với chỉ số ELO và xếp hạng FIDE thực tế', () => {
    const novice = DIFFICULTY_TIERS.novice!;
    const adept = DIFFICULTY_TIERS.adept!;
    const archmage = DIFFICULTY_TIERS.archmage!;
    const gm = DIFFICULTY_TIERS.grandmaster!;

    expect(novice.elo).toBe(750);
    expect(novice.fideRank).toContain('Beginner');

    expect(adept.elo).toBe(1350);
    expect(adept.fideRank).toContain('Club Player');

    expect(archmage.elo).toBe(1950);
    expect(archmage.fideRank).toContain('FIDE Master');

    expect(gm.elo).toBe(2550);
    expect(gm.fideRank).toContain('Grandmaster');
  });

  it('độ sâu (depth) và tính năng nâng cao tăng dần theo ELO', () => {
    expect(DIFFICULTY_TIERS.novice!.depth).toBeLessThan(DIFFICULTY_TIERS.adept!.depth);
    expect(DIFFICULTY_TIERS.adept!.depth).toBeLessThan(DIFFICULTY_TIERS.archmage!.depth);
    expect(DIFFICULTY_TIERS.archmage!.depth).toBeLessThan(DIFFICULTY_TIERS.grandmaster!.depth);

    // Cấp độ cao bật Quiescence Search và Opening Book
    expect(DIFFICULTY_TIERS.novice!.useQuiescence).toBe(false);
    expect(DIFFICULTY_TIERS.archmage!.useQuiescence).toBe(true);
    expect(DIFFICULTY_TIERS.grandmaster!.useQuiescence).toBe(true);

    // Blunder rate giảm về 0 ở cấp độ Grandmaster
    expect(DIFFICULTY_TIERS.novice!.blunderRate).toBeGreaterThan(0.2);
    expect(DIFFICULTY_TIERS.grandmaster!.blunderRate).toBe(0.0);
  });

  it('thư viện Opening Book chứa các nước khai cuộc phổ biến', () => {
    const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    expect(OPENING_BOOK[startFen]).toBeDefined();
    expect(OPENING_BOOK[startFen]).toContain('e2e4');
    expect(OPENING_BOOK[startFen]).toContain('d2d4');
  });
});
