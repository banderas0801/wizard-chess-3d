/**
 * Wizard Chess 3D - Hệ Thống Cấp Độ AI Tương Thích Chuẩn FIDE ELO Quốc Tế
 * 
 * Bảng quy chiếu chuẩn thế giới:
 * - ELO 600 - 800: Beginner / Người mới tập chơi (Novice Apprentice)
 * - ELO 1200 - 1400: Intermediate / Kỳ thủ câu lạc bộ (Adept Mage)
 * - ELO 1800 - 2000: Candidate Master / Kiện tướng FIDE (Archmage)
 * - ELO 2400 - 2600: Grandmaster / Đại Kiện Tướng Quốc Tế (Grand Sorcerer)
 */

export interface DifficultyTier {
  id: 'novice' | 'adept' | 'archmage' | 'grandmaster';
  name: string;
  fantasyTitle: string;
  fideRank: string;
  elo: number;
  depth: number;
  blunderRate: number;     // Tỉ lệ mắc sai lầm ngớ ngẩn (0..1)
  evalJitter: number;      // Độ nhiễu ngẫu nhiên trong hàm đánh giá điểm (centipawns)
  useQuiescence: boolean;  // Tìm kiếm tĩnh để tránh lỗi Horizon Effect
  useOpeningBook: boolean; // Sách khai cuộc chuẩn
  description: string;
}

export const DIFFICULTY_TIERS: Record<string, DifficultyTier> = {
  novice: {
    id: 'novice',
    name: 'Học Việc (Novice)',
    fantasyTitle: 'Tập Sự Thánh Đường',
    fideRank: 'Sơ cấp (Beginner)',
    elo: 750,
    depth: 1,
    blunderRate: 0.28,      // 28% cơ hội đi nước cờ ngẫu nhiên
    evalJitter: 120,        // Độ lệch 1.2 tốt
    useQuiescence: false,
    useOpeningBook: false,
    description: 'Thích hợp cho người mới làm quen cờ vua. AI thỉnh thoảng bỏ sót quân bị đe dọa và chỉ nhìn trước 1 nước cờ.'
  },
  adept: {
    id: 'adept',
    name: 'Pháp Sư (Adept)',
    fantasyTitle: 'Kỵ Sĩ Phép Thuật',
    fideRank: 'Kỳ thủ Câu lạc bộ (Club Player)',
    elo: 1350,
    depth: 3,
    blunderRate: 0.08,      // 8% cơ hội đi nước kém tối ưu
    evalJitter: 40,
    useQuiescence: false,
    useOpeningBook: true,
    description: 'Biết chiếm trung tâm, phát triển quân bài bản, nhập thành bảo vệ vua và chớp thời cơ ăn quân không có bảo vệ.'
  },
  archmage: {
    id: 'archmage',
    name: 'Đại Pháp Sư (Archmage)',
    fantasyTitle: 'Trưởng Lão Hội Đồng',
    fideRank: 'Kiện tướng FIDE (FIDE Master / CM)',
    elo: 1950,
    depth: 4,
    blunderRate: 0.01,
    evalJitter: 10,
    useQuiescence: true,     // Tính chuỗi ăn quân đến trạng thái tĩnh
    useOpeningBook: true,
    description: 'Sắc bén trong chiến thuật (xiên, ghim, chĩa đôi), tính toán sâu 4-5 nước và trừng phạt ngay các sơ hở thế trận.'
  },
  grandmaster: {
    id: 'grandmaster',
    name: 'Phù Thủy Tối Thượng (Grandmaster)',
    fantasyTitle: 'Đại Phù Thủy Hư Không',
    fideRank: 'Đại Kiện Tướng Quốc Tế (Grandmaster - GM)',
    elo: 2550,
    depth: 6,
    blunderRate: 0.0,       // 0% sai số - chơi tối ưu tuyệt đối
    evalJitter: 0,
    useQuiescence: true,
    useOpeningBook: true,
    description: 'Tương đương sức mạnh Đại Kiện Tướng. Khai cuộc chuẩn sách, phối hợp tấn công cánh vua tàn độc và tàn cuộc chính xác từng ly.'
  }
};

/**
 * Thư viện khai cuộc mini (Opening Book) cho các cấp độ ELO >= 1200
 */
export const OPENING_BOOK: Record<string, string[]> = {
  // Xuất phát: e4, d4, Nf3, c4
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1': ['e2e4', 'd2d4', 'g1f3', 'c2c4'],
  // Đáp trả e4: e5, c5 (Sicilian), e6 (French), c6 (Caro-Kann)
  'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1': ['e7e5', 'c7c5', 'e7e6', 'c7c6'],
  // Đáp trả d4: d5, Nf6 (Indian Defenses)
  'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq d3 0 1': ['d7d5', 'g8f6'],
  // Ý (Giuoco Piano): 1. e4 e5 2. Nf3 Nc6 3. Bc4
  'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3': ['f1c4', 'f1b5', 'd2d4'],
};
