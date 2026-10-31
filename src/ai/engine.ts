// Placeholder engine: greedy 1-ply material search with random tie-break. Pure; FEN in, UCI out.
import { applyMove, fromFen, legalMoves, outcome, toUci, type GameState, type PieceType } from '../game';

const VALUE: Record<PieceType, number> = { pawn: 100, knight: 320, bishop: 330, rook: 500, queen: 900, king: 0 };

/** Material balance in centipawns from the side-to-move's perspective. */
export function materialCp(s: GameState): number {
  let cp = 0;
  for (const p of s.board.values()) cp += (p.color === s.turn ? 1 : -1) * VALUE[p.type];
  return cp;
}

export type SearchResult = { ok: true; uci: string; evalCp: number } | { ok: false; message: string };

export function search(fen: string, rng: () => number = Math.random): SearchResult {
  let s: GameState;
  try {
    s = fromFen(fen);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  const moves = legalMoves(s);
  if (moves.length === 0) return { ok: false, message: `no legal moves (${outcome(s)})` };
  let best: { uci: string; score: number }[] = [];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const m of moves) {
    const r = applyMove(s, m);
    if (!r.ok) continue;
    const o = outcome(r.state);
    const score = o === 'checkmate' ? 100_000 : o === 'stalemate' ? 0 : -materialCp(r.state);
    if (score > bestScore) {
      bestScore = score;
      best = [{ uci: toUci(m), score }];
    } else if (score === bestScore) best.push({ uci: toUci(m), score });
  }
  const pick = best[Math.floor(rng() * best.length)] ?? best[0]!;
  return { ok: true, uci: pick.uci, evalCp: pick.score };
}
