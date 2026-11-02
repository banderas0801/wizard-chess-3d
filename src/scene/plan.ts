// Builds a MovePlan from a legal move. Pure: special-move data (capture square, castling rook,
// promotion) comes from the engine's MoveEffects; nothing here re-derives chess rules.
import { applyMove, outcome, type GameState, type Move } from '../game';
import type { MovePlan } from './choreo';
import { STRIKE_PROFILES } from './strike';

export function planMove(state: GameState, m: Move): MovePlan<GameState> | null {
  const r = applyMove(state, m);
  if (!r.ok) return null;
  const { piece, capture, castle, promotion } = r.effects;

  let mate: MovePlan<GameState>['mate'] = null;
  if (outcome(r.state) === 'checkmate') {
    for (const [sq, p] of r.state.board) if (p.type === 'king' && p.color === r.state.turn) mate = { kingId: p.id, square: sq };
  }

  return {
    mover: { id: piece.id, from: m.from, to: m.to },
    profile: STRIKE_PROFILES[piece.type],
    capture: capture ? { id: capture.piece.id, square: capture.square } : null,
    companions: castle ? [{ id: castle.rook.id, from: castle.from, to: castle.to }] : [],
    promotion,
    mate,
    next: r.state,
  };
}
