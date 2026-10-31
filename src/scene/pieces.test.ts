import { it, expect } from 'vitest';
import { createPieces } from './pieces';
it('sync rebuilds a piece mesh when its type changes (promotion)', () => {
  const p = createPieces();
  const pawn = { id: 'x', type: 'pawn', color: 'black' } as const;
  p.sync(new Map([['a2', pawn]]) as never);
  const before = p.group.getObjectByName('x');
  expect(p.sync(new Map([['a1', { ...pawn, type: 'queen' }]]) as never)).toBe(true);
  const after = p.group.getObjectByName('x')!;
  expect(after).not.toBe(before);
  expect(after.userData.type).toBe('queen');
  expect(p.group.children.length).toBe(1);
});
