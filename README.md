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
