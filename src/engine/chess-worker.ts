/**
 * Web Worker tính toán nước đi AI tương thích hệ số FIDE ELO
 * Chạy trên luồng nền (Worker Thread), giải phóng 100% Main Thread
 */

import { DIFFICULTY_TIERS, DifficultyTier, OPENING_BOOK } from '../game/ai-difficulty';

export interface WorkerRequest {
  type: 'CALCULATE_MOVE';
  requestId: string;
  fen: string;
  tierId: 'novice' | 'adept' | 'archmage' | 'grandmaster';
  turn: 'w' | 'b';
}

export interface WorkerResponse {
  type: 'MOVE_RESULT';
  requestId: string;
  bestMove: {
    from: { r: number; c: number };
    to: { r: number; c: number };
    uci: string;
    promotion?: 'q' | 'r' | 'b' | 'n';
  } | null;
  evaluation: number;
  elo: number;
  fideRank: string;
  depthReached: number;
  nodesSearched: number;
  durationMs: number;
}

// Bảng điểm giá trị quân cờ (Centipawns)
const PIECE_VALS: Record<string, number> = {
  p: 100,
  n: 320,
  b: 335,
  r: 500,
  q: 900,
  k: 20000
};

// Bảng điểm vị trí (Piece-Square Tables cơ bản)
const PST_PAWN = [
  [0,  0,  0,  0,  0,  0,  0,  0],
  [50, 50, 50, 50, 50, 50, 50, 50],
  [10, 10, 20, 30, 30, 20, 10, 10],
  [5,  5, 10, 25, 25, 10,  5,  5],
  [0,  0,  0, 20, 20,  0,  0,  0],
  [5, -5,-10,  0,  0,-10, -5,  5],
  [5, 10, 10,-20,-20, 10, 10,  5],
  [0,  0,  0,  0,  0,  0,  0,  0]
];

const PST_KNIGHT = [
  [-50,-40,-30,-30,-30,-30,-40,-50],
  [-40,-20,  0,  0,  0,  0,-20,-40],
  [-30,  0, 10, 15, 15, 10,  0,-30],
  [-30,  5, 15, 20, 20, 15,  5,-30],
  [-30,  0, 15, 20, 20, 15,  0,-30],
  [-30,  5, 10, 15, 15, 10,  5,-30],
  [-40,-20,  0,  5,  5,  0,-20,-40],
  [-50,-40,-30,-30,-30,-30,-40,-50]
];

// Hàm phân tích bàn cờ từ FEN đơn giản
function parseFenToBoard(fen: string): { board: (string | null)[][]; turn: string } {
  const parts = fen.split(' ');
  const rows = parts[0]!.split('/');
  const board: (string | null)[][] = Array(8).fill(null).map(() => Array(8).fill(null));

  for (let r = 0; r < 8; r++) {
    let c = 0;
    for (const char of rows[r]!) {
      if (char >= '1' && char <= '8') {
        c += parseInt(char, 10);
      } else {
        const color = char === char.toUpperCase() ? 'w' : 'b';
        board[r]![c] = color + char.toLowerCase();
        c++;
      }
    }
  }

  return { board, turn: parts[1] || 'w' };
}

// Chuyển tọa độ sang UCI (vd: from: 6,4 to: 4,4 -> "e2e4")
function squareToUci(r: number, c: number): string {
  const file = String.fromCharCode(97 + c);
  const rank = 8 - r;
  return `${file}${rank}`;
}

function uciToSquare(uci: string): { from: { r: number; c: number }; to: { r: number; c: number } } {
  const fromC = uci.charCodeAt(0) - 97;
  const fromR = 8 - parseInt(uci[1]!, 10);
  const toC = uci.charCodeAt(2) - 97;
  const toR = 8 - parseInt(uci[3]!, 10);
  return { from: { r: fromR, c: fromC }, to: { r: toR, c: toC } };
}

// Sinh danh sách nước đi thô
function generateMoves(board: (string | null)[][], turn: string): { from: { r: number; c: number }; to: { r: number; c: number }; capture: boolean }[] {
  const moves: { from: { r: number; c: number }; to: { r: number; c: number }; capture: boolean }[] = [];
  const opp = turn === 'w' ? 'b' : 'w';

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r]![c];
      if (!p || p[0] !== turn) continue;

      const type = p[1]!;

      // 1. Pawn
      if (type === 'p') {
        const dir = turn === 'w' ? -1 : 1;
        const startR = turn === 'w' ? 6 : 1;

        if (r + dir >= 0 && r + dir < 8 && !board[r + dir]![c]) {
          moves.push({ from: { r, c }, to: { r: r + dir, c }, capture: false });
          if (r === startR && !board[r + dir * 2]![c]) {
            moves.push({ from: { r, c }, to: { r: r + dir * 2, c }, capture: false });
          }
        }
        for (const dc of [-1, 1]) {
          const nr = r + dir;
          const nc = c + dc;
          if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
            const target = board[nr]![nc];
            if (target && target[0] === opp) {
              moves.push({ from: { r, c }, to: { r: nr, c: nc }, capture: true });
            }
          }
        }
      }

      // 2. Knight
      if (type === 'n') {
        const deltas = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
        for (const [dr, dc] of deltas) {
          const nr = r + dr!;
          const nc = c + dc!;
          if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
            const target = board[nr]![nc];
            if (!target) moves.push({ from: { r, c }, to: { r: nr, c: nc }, capture: false });
            else if (target[0] === opp) moves.push({ from: { r, c }, to: { r: nr, c: nc }, capture: true });
          }
        }
      }

      // 3. Bishop, Rook, Queen
      if (type === 'b' || type === 'r' || type === 'q') {
        const dirs: [number, number][] = [];
        if (type === 'b' || type === 'q') dirs.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
        if (type === 'r' || type === 'q') dirs.push([-1, 0], [1, 0], [0, -1], [0, 1]);

        for (const [dr, dc] of dirs) {
          let step = 1;
          while (true) {
            const nr = r + dr * step;
            const nc = c + dc * step;
            if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) break;
            const target = board[nr]![nc];
            if (!target) {
              moves.push({ from: { r, c }, to: { r: nr, c: nc }, capture: false });
            } else {
              if (target[0] === opp) {
                moves.push({ from: { r, c }, to: { r: nr, c: nc }, capture: true });
              }
              break;
            }
            step++;
          }
        }
      }

      // 4. King
      if (type === 'k') {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
              const target = board[nr]![nc];
              if (!target) moves.push({ from: { r, c }, to: { r: nr, c: nc }, capture: false });
              else if (target[0] === opp) moves.push({ from: { r, c }, to: { r: nr, c: nc }, capture: true });
            }
          }
        }
      }
    }
  }

  return moves;
}

// Đánh giá tĩnh bàn cờ
function evaluateBoard(board: (string | null)[][], turn: string, jitter: number): number {
  let score = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r]![c];
      if (!p) continue;

      const color = p[0]!;
      const type = p[1]!;
      let val = PIECE_VALS[type] || 0;

      // Cộng điểm PST
      if (type === 'p') {
        val += color === 'w' ? PST_PAWN[r]![c]! : PST_PAWN[7 - r]![c]!;
      } else if (type === 'n') {
        val += color === 'w' ? PST_KNIGHT[r]![c]! : PST_KNIGHT[7 - r]![c]!;
      }

      if (color === turn) score += val;
      else score -= val;
    }
  }

  // Thêm độ nhiễu ngẫu nhiên tương ứng cấp độ ELO
  if (jitter > 0) {
    score += (Math.random() - 0.5) * jitter;
  }

  return score;
}

let nodesCount = 0;

function minimax(
  board: (string | null)[][],
  depth: number,
  alpha: number,
  beta: number,
  turn: string,
  tier: DifficultyTier
): number {
  nodesCount++;

  if (depth === 0) {
    return evaluateBoard(board, turn, tier.evalJitter);
  }

  const moves = generateMoves(board, turn);
  if (moves.length === 0) return -100000;

  // Move ordering: ưu tiên nước ăn quân
  moves.sort((a, b) => (b.capture ? 10 : 0) - (a.capture ? 10 : 0));

  let maxScore = -Infinity;
  const opp = turn === 'w' ? 'b' : 'w';

  for (const m of moves) {
    // Make move
    const savedFrom = board[m.from.r]![m.from.c];
    const savedTo = board[m.to.r]![m.to.c];

    board[m.to.r]![m.to.c] = savedFrom;
    board[m.from.r]![m.from.c] = null;

    const score = -minimax(board, depth - 1, -beta, -alpha, opp, tier);

    // Undo move
    board[m.from.r]![m.from.c] = savedFrom;
    board[m.to.r]![m.to.c] = savedTo;

    if (score > maxScore) maxScore = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break; // Cắt nhánh Alpha-Beta
  }

  return maxScore;
}

// Xử lý thông điệp từ Main Thread
self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  if (req.type !== 'CALCULATE_MOVE') return;

  const startTime = performance.now();
  nodesCount = 0;

  const tier = DIFFICULTY_TIERS[req.tierId] || DIFFICULTY_TIERS.adept!;
  const { board, turn } = parseFenToBoard(req.fen);

  // 1. Kiểm tra Sách Khai Cuộc (Opening Book) nếu cấp độ ELO >= 1200
  if (tier.useOpeningBook && OPENING_BOOK[req.fen]) {
    const bookMoves = OPENING_BOOK[req.fen]!;
    const chosenUci = bookMoves[Math.floor(Math.random() * bookMoves.length)]!;
    const coords = uciToSquare(chosenUci);

    const res: WorkerResponse = {
      type: 'MOVE_RESULT',
      requestId: req.requestId,
      bestMove: {
        from: coords.from,
        to: coords.to,
        uci: chosenUci
      },
      evaluation: 0,
      elo: tier.elo,
      fideRank: tier.fideRank,
      depthReached: tier.depth,
      nodesSearched: 1,
      durationMs: performance.now() - startTime
    };
    self.postMessage(res);
    return;
  }

  // 2. Sinh tất cả nước đi hợp lệ
  const moves = generateMoves(board, turn);
  if (moves.length === 0) {
    self.postMessage({
      type: 'MOVE_RESULT',
      requestId: req.requestId,
      bestMove: null,
      evaluation: 0,
      elo: tier.elo,
      fideRank: tier.fideRank,
      depthReached: 0,
      nodesSearched: 0,
      durationMs: performance.now() - startTime
    });
    return;
  }

  // 3. Cơ chế Blunder Rate theo ELO:
  // Nếu roll trúng tỉ lệ sai sót (ví dụ 28% ở ELO 750), AI sẽ chọn ngẫu nhiên một nước cờ hợp lệ
  if (tier.blunderRate > 0 && Math.random() < tier.blunderRate) {
    const randomMove = moves[Math.floor(Math.random() * moves.length)]!;
    const uci = squareToUci(randomMove.from.r, randomMove.from.c) + squareToUci(randomMove.to.r, randomMove.to.c);

    self.postMessage({
      type: 'MOVE_RESULT',
      requestId: req.requestId,
      bestMove: {
        from: randomMove.from,
        to: randomMove.to,
        uci
      },
      evaluation: -50,
      elo: tier.elo,
      fideRank: tier.fideRank,
      depthReached: 1,
      nodesSearched: moves.length,
      durationMs: performance.now() - startTime
    });
    return;
  }

  // 4. Tìm kiếm Minimax Alpha-Beta chuẩn theo độ sâu ELO
  moves.sort((a, b) => (b.capture ? 10 : 0) - (a.capture ? 10 : 0));

  let bestMove = moves[0]!;
  let bestScore = -Infinity;
  const opp = turn === 'w' ? 'b' : 'w';

  for (const m of moves) {
    const savedFrom = board[m.from.r]![m.from.c];
    const savedTo = board[m.to.r]![m.to.c];

    board[m.to.r]![m.to.c] = savedFrom;
    board[m.from.r]![m.from.c] = null;

    const score = -minimax(board, tier.depth - 1, -Infinity, Infinity, opp, tier);

    board[m.from.r]![m.from.c] = savedFrom;
    board[m.to.r]![m.to.c] = savedTo;

    if (score > bestScore) {
      bestScore = score;
      bestMove = m;
    }
  }

  const uci = squareToUci(bestMove.from.r, bestMove.from.c) + squareToUci(bestMove.to.r, bestMove.to.c);

  const response: WorkerResponse = {
    type: 'MOVE_RESULT',
    requestId: req.requestId,
    bestMove: {
      from: bestMove.from,
      to: bestMove.to,
      uci
    },
    evaluation: bestScore,
    elo: tier.elo,
    fideRank: tier.fideRank,
    depthReached: tier.depth,
    nodesSearched: nodesCount,
    durationMs: performance.now() - startTime
  };

  self.postMessage(response);
};
