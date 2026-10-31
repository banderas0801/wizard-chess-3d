# chess3d

Vite + TypeScript (strict) + three. Steps 1–2 of the App Lab blueprint: rendering pipeline,
adaptive quality, procedural board/pieces. No AI yet.

- `npm run dev` · `npm run build` · `npm test` · `npm run lint` · `npm run typecheck`
- `?tier=off|low|high` forces a post-processing tier and disables the quality governor.
- Click (without dragging) or press Space/M/Enter to play the next demo move.

Layout: `src/render` (renderer, env, post, quality governor), `src/scene` (board, pieces),
`src/game` (pure TS state — importing `three` there is a lint error and a test failure).

Invariants: see `src/render/quality.ts` (downgrade fast / upgrade slow) and
`src/render/renderer.ts` (`shadowMap.needsUpdate` only via `markShadowsDirty('init' | 'piece-move')`).

## Step 4: move choreography (`src/scene/choreo.ts`)

Statechart per move: quiet `idle → approach → settle → idle`; capture `idle → approach → strike → shatter → settle → idle`;
mate continues `settle → kingFall → idle`. The game state (FEN) changes exactly once, on entering `settle`.

- Cancel in `approach | strike | shatter` → `cancelled` → `idle`: debris cleared, victim restored, attacker home, FEN untouched.
- Cancel in `settle | kingFall` → `idle`: the move is already committed, so only the animation stops.
  Reverting it is undo through history, not the choreographer.
- The capture close-up zoom ends with the move (on `settle` or on cancel) and flies back to the pre-zoom camera pose.
  Only new move selection is locked while animating; undo is never locked (`src/scene/closeup.test.ts`).

Third-party assets and their CC0 sources: `SOURCES.md`.
