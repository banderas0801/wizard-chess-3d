import { describe, it, expect, beforeEach } from 'vitest';
import { createQualityGovernor } from './quality';

describe('QualityGovernor (Hysteresis Frame Rate Regulator)', () => {
  let virtualTime = 0;
  const mockNow = () => virtualTime;

  beforeEach(() => {
    virtualTime = 0;
  });

  it('khởi tạo với tier mặc định high', () => {
    const gov = createQualityGovernor({ budgetMs: 16.67, nowFn: mockNow });
    expect(gov.getCurrentTier()).toBe('high');
  });

  it('hạ tier từ high xuống low khi trung bình 30 frame > budgetMs * 1.2 (20.0ms)', () => {
    const gov = createQualityGovernor({ budgetMs: 16.67, nowFn: mockNow });

    let changedTier = null;
    for (let i = 0; i < 29; i++) {
      virtualTime += 25;
      changedTier = gov.sample(25);
      expect(changedTier).toBeNull();
    }

    // Frame thứ 30
    virtualTime += 25;
    changedTier = gov.sample(25);
    expect(changedTier).toBe('low');
    expect(gov.getCurrentTier()).toBe('low');
  });

  it('tiếp tục hạ từ low xuống off nếu tiếp tục lag 30 frame', () => {
    const gov = createQualityGovernor({
      budgetMs: 16.67,
      initialTier: 'low',
      nowFn: mockNow
    });

    let changedTier = null;
    for (let i = 0; i < 30; i++) {
      virtualTime += 24;
      changedTier = gov.sample(24);
    }

    expect(changedTier).toBe('off');
    expect(gov.getCurrentTier()).toBe('off');
  });

  it('KHÔNG nâng tier nếu chưa qua 10 giây kể từ lần hạ gần nhất', () => {
    const gov = createQualityGovernor({
      budgetMs: 16.67,
      initialTier: 'high',
      nowFn: mockNow
    });

    // 1. Hạ tier tại t = 750ms
    for (let i = 0; i < 30; i++) {
      virtualTime += 25;
      gov.sample(25);
    }
    expect(gov.getCurrentTier()).toBe('low');

    // 2. Chạy 5 giây mượt (500 frame * 10ms = 5000ms), tổng thời gian = 750 + 5000 = 5750ms (< 10000ms)
    let changedTier = null;
    for (let i = 0; i < 500; i++) {
      virtualTime += 10;
      changedTier = gov.sample(10);
    }

    expect(changedTier).toBeNull();
    expect(gov.getCurrentTier()).toBe('low');
  });

  it('KHÔNG nâng tier nếu chuỗi 5 giây mượt bị ngắt quãng bởi 1 frame lag', () => {
    const gov = createQualityGovernor({
      budgetMs: 16.67,
      initialTier: 'low',
      nowFn: mockNow
    });

    // Cho qua 12 giây kể từ lần hạ
    virtualTime = 12000;

    // Chạy mượt 4.5 giây (450 frames @ 10ms)
    for (let i = 0; i < 450; i++) {
      virtualTime += 10;
      gov.sample(10);
    }

    // 1 frame lag (15ms > 11.67ms) làm reset bộ đếm mượt liên tục
    virtualTime += 15;
    gov.sample(15);

    // Chạy thêm 1 giây nữa (chưa đủ 5 giây liên tục mới)
    let changedTier = null;
    for (let i = 0; i < 100; i++) {
      virtualTime += 10;
      changedTier = gov.sample(10);
    }

    expect(changedTier).toBeNull();
    expect(gov.getCurrentTier()).toBe('low');
  });

  it('NÂNG TIER THÀNH CÔNG khi mượt liên tục 5 giây VÀ đã qua 10 giây kể từ lần hạ', () => {
    const gov = createQualityGovernor({
      budgetMs: 16.67,
      initialTier: 'high',
      nowFn: mockNow
    });

    // 1. Hạ xuống 'low' tại thời điểm t = 750ms
    for (let i = 0; i < 30; i++) {
      virtualTime += 25;
      gov.sample(25);
    }
    expect(gov.getCurrentTier()).toBe('low');

    // 2. Thời gian trôi qua 6 giây bình thường
    virtualTime += 6000;

    // 3. Bây giờ chạy mượt liên tục 5 giây (500 frames @ 10ms)
    // Tại frame thứ 500, smoothDurationMs = 5000ms VÀ totalTime = 750 + 6000 + 5000 = 11750ms (> 10s)
    let changedTier = null;
    for (let i = 0; i < 500; i++) {
      virtualTime += 10;
      changedTier = gov.sample(10);
    }

    expect(changedTier).toBe('high');
    expect(gov.getCurrentTier()).toBe('high');
  });
});
