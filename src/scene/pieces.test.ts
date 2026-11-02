import { it, expect } from 'vitest';
import { Box3, type Object3D } from 'three';
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

it('the rook is a chariot: two wheels on the ground either side, ram facing the opponent', () => {
  const p = createPieces();
  p.sync(new Map([['a1', { id: 'wr', type: 'rook', color: 'white' }], ['a8', { id: 'br', type: 'rook', color: 'black' }]]) as never);
  for (const id of ['wr', 'br']) {
    const rook = p.group.getObjectByName(id)!;
    const wheels = rook.userData.wheels as Object3D[];
    expect(wheels.length).toBe(2);
    expect(wheels[0]!.position.z * wheels[1]!.position.z).toBeLessThan(0);
    const b = new Box3().setFromObject(wheels[0]!);
    expect((b.max.y - b.min.y) / 2).toBeCloseTo(rook.userData.wheelRadius as number, 2); // rolls without slipping
    expect(b.min.y - rook.position.y).toBeCloseTo(0, 2); // rolls on the board
  }
  expect(p.group.getObjectByName('wr')!.rotation.y).toBeCloseTo(Math.PI / 2);
  expect(p.group.getObjectByName('br')!.rotation.y).toBeCloseTo(-Math.PI / 2);
});
