import test from 'node:test';
import assert from 'node:assert/strict';
import layout from '../engine/src/tiled/layout.json' with { type: 'json' };
import { GREENHOUSE_ACTORS, planGreenhouseSync } from '../engine/src/modules/lesson/greenhouse-cast.ts';

const ids = ['guide', 'sensor', 'control', 'fan', 'verify', 'portal'];

test('登录或刷新进入温室时，S1 和 S2 都摆全同一套角色', () => {
  for (const levelId of ['sale', 'repair']) {
    const plan = planGreenhouseSync([], levelId);
    assert.deepEqual(plan.map(actor => actor.id), ids);
    assert.equal(plan.every(actor => actor.create), true);
    for (const actor of plan) {
      const point = layout.greenhouse.positions[actor.id];
      assert.deepEqual([actor.x, actor.y], point, actor.id);
    }
  }
  const sale = planGreenhouseSync([], 'sale');
  const repair = planGreenhouseSync([], 'repair');
  assert.equal(sale.find(actor => actor.id === 'guide').graphic, 'gardener');
  assert.equal(sale.find(actor => actor.id === 'guide').label, '园艺员阿绿');
  assert.equal(repair.find(actor => actor.id === 'guide').graphic, 'mechanic');
  assert.equal(repair.find(actor => actor.id === 'guide').label, '维修员老修');
  assert.equal(repair.find(actor => actor.id === 'control').graphic, 'control');
  assert.equal(repair.find(actor => actor.id === 'fan').graphic, 'fan-off');
  const placed = GREENHOUSE_ACTORS.map(actor => ({ id: `${actor.id}::student`, x: actor.x, y: actor.y }));
  const again = planGreenhouseSync(placed, 'repair', true);
  assert.equal(again.some(actor => actor.create), false);
  assert.equal(again.find(actor => actor.id === 'fan').graphic, 'fan-on');
  const drifted = planGreenhouseSync([{ id: 'guide::student', x: 0, y: 0 }], 'repair');
  assert.equal(drifted.find(actor => actor.id === 'guide').move, true);
  assert.equal(drifted.find(actor => actor.id === 'sensor').create, true);
});
