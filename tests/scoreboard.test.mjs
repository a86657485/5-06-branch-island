import test from 'node:test';
import assert from 'node:assert/strict';
import { pointsLabel, scoreboard } from '../public/scoreboard.mjs';

test('主线和选做加分分开，旧存档里并进去的 25 分会拆出来', () => {
  assert.deepEqual(scoreboard({ points: 75, bonusPoints: 0, levels: {} }), { main: 75, bonus: 0 });
  assert.deepEqual(scoreboard({
    points: 75,
    bonusPoints: 25,
    levels: { minimum: { completed: true, points: 25 } }
  }), { main: 75, bonus: 25 });
  assert.deepEqual(scoreboard({
    points: 125,
    levels: { minimum: { completed: true, points: 25 } }
  }), { main: 100, bonus: 25 });
  assert.equal(pointsLabel({ points: 100, bonusPoints: 0 }), '100 积分');
  assert.equal(pointsLabel({
    points: 75,
    bonusPoints: 25,
    levels: { minimum: { completed: true, points: 25 } }
  }), '75 积分 · 选做加分 25');
});
