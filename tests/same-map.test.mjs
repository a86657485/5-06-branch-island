import test from 'node:test';
import assert from 'node:assert/strict';
import adventure from '../public/adventure-rules.js';
import { currentFocus, mapFor } from '../public/focus.mjs';
import { mapForContext } from '../engine/src/modules/lesson/active-player.ts';

const rpg = (mapId) => ({ version: 1, engine: 'rpgjs', mapId, position: { x: 460, y: 445 }, direction: 'down' });

test('S1 与 S2 同在温室，返修点有箭头且不能一键传送', () => {
  assert.equal(mapFor('sale', {}), 'greenhouse');
  assert.equal(mapFor('repair', {}), 'greenhouse');
  assert.equal(mapForContext({ levelId: 'sale', draft: {} }), mapForContext({ levelId: 'repair', draft: {} }));
  assert.equal(mapForContext({ levelId: 'repair', draft: { scene: { facility: false } } }), 'greenhouse');
  const sale = currentFocus({ levelId: 'sale', scene: { phase: 'start' } });
  const repair = currentFocus({ levelId: 'repair', scene: { phase: 'start' } });
  assert.equal(repair.target.mapId, sale.target.mapId);
  assert.equal(repair.target.x, sale.target.x);
  assert.equal(repair.target.y, sale.target.y);
  assert.equal(repair.target.place, 'guide');
  assert.equal(repair.goto, false);
  assert.match(repair.gotoReason, /不传送/);
  assert.equal(repair.dots.length > 0, true);
  assert.equal(repair.dots.some(dot => dot.x === repair.target.x && dot.y === repair.target.y), false);
  const closed = currentFocus({ levelId: 'quiz', exam: { open: false, missing: [{ id: 'repair', title: '控制器返修' }, { id: 'cross', title: '路口导行屏' }] } });
  assert.equal(closed.hint, '还差：控制器返修。');
  assert.equal(adventure.validateRpgDraft(rpg('greenhouse'), 'repair').mapId, 'greenhouse');
  assert.equal(adventure.validateRpgDraft(rpg('workshop'), 'repair').mapId, 'workshop');
});
