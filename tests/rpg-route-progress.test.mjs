import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceRoute, bothRoadsVerified } from '../engine/src/modules/lesson/route-progress.mjs';

function walk(points, route = 'bridge', key = 'test') {
  return points.reduce((progress, position) => advanceRoute(progress, position, route, key), undefined);
}

function crossingLine(y) {
  return Array.from({ length: 34 }, (_, index) => ({ x: 450 + index * 20, y }));
}

test('两种现场都正确到达后才让游客过街', () => {
  const open = { input: { facility: true }, correct: true, scene: { outcome: 'arrived' } };
  const closed = { input: { facility: false }, correct: true, scene: { outcome: 'arrived' } };
  const blocked = { input: { facility: false }, correct: false, scene: { outcome: 'blocked' } };
  assert.equal(bothRoadsVerified([open, blocked]), false);
  assert.equal(bothRoadsVerified([open, closed]), true);
  assert.equal(bothRoadsVerified([open, closed], 1), false);
});

test('route evidence requires walking from the west entrance through the middle to the east exit', () => {
  const progress = walk(crossingLine(340));
  assert.equal(progress.stage, 3);
});

test('arriving at the east exit alone does not prove a route was walked', () => {
  assert.equal(walk([{ x: 1100, y: 340 }]).stage, 0);
});

test('a large jump from the entrance to the exit never earns route evidence', () => {
  const progress = walk([{ x: 450, y: 340 }, { x: 1100, y: 340 }]);
  assert.equal(progress.stage, 0);
});

test('walking the other corridor cannot prove the selected branch', () => {
  assert.equal(walk(crossingLine(681), 'bridge').stage, 0);
  assert.equal(walk(crossingLine(681), 'crossing').stage, 3);
});

test('changing input or program clears unfinished route progress', () => {
  const before = walk(crossingLine(340).slice(0, 18));
  assert.equal(before.stage, 2);
  const after = advanceRoute(before, { x: 810, y: 340 }, 'bridge', 'changed-program');
  assert.equal(after.stage, 0);
});

test('leaving the corridor before reaching the east end requires a fresh west entrance', () => {
  let progress = walk(crossingLine(340).slice(0, 18));
  progress = advanceRoute(progress, { x: 800, y: 410 }, 'bridge', 'test');
  progress = advanceRoute(progress, { x: 800, y: 470 }, 'bridge', 'test');
  for (const position of crossingLine(340).slice(18)) progress = advanceRoute(progress, position, 'bridge', 'test');
  assert.equal(progress.stage, 0);
});
