import test from 'node:test';
import assert from 'node:assert/strict';
import { currentFocus } from '../public/focus.mjs';
import { createIdleTimer } from '../public/idle-timer.mjs';

test('同一时刻只有一个焦点，过街行走时不能一键前往', () => {
  const start = currentFocus({ levelId: 'sale', scene: { phase: 'start' }, level: { valid: false } });
  assert.equal(start.id, 'guide');
  assert.equal(start.goto, true);
  assert.equal(start.target.place, 'guide');
  assert.equal([...start.hint].length <= 30, true);
  assert.equal(start.hint.includes('≥'), false);

  const walk = currentFocus({
    levelId: 'cross',
    scene: { phase: 'executed', measured: true, facility: true, ticket: { output: 'bridge' }, actions: [], signal: 'green' },
    level: { valid: false }
  });
  assert.equal(walk.step, '10');
  assert.equal(walk.goto, false);
  assert.equal(walk.gotoReason, '这段要你亲自走过去');
  assert.equal(walk.target.place, 'bridgeEast');
  assert.equal(walk.hint.includes('天桥'), false);

  const wrongRoute = currentFocus({
    levelId: 'cross',
    scene: { phase: 'executed', measured: true, facility: false, ticket: { output: 'bridge' }, actions: [] },
    level: { valid: false }
  });
  assert.equal(wrongRoute.target.place, 'bridgeWest');
  assert.equal(wrongRoute.goto, false);
});

test('考核页焦点框住整题或提交按钮，思考步骤用 40 秒', () => {
  const card = currentFocus({
    levelId: 'quiz',
    exam: { open: true, tier: 'base', allFilled: false, submitted: false }
  });
  assert.equal(card.id, 'quiz-card-current');
  assert.equal(card.thinking, true);
  assert.equal(card.hint.includes('选项'), true);
  assert.equal(card.strong.includes('哪一张'), false);

  const submit = currentFocus({
    levelId: 'quiz',
    exam: { open: true, tier: 'base', allFilled: true, submitted: false, baseSubmitted: false }
  });
  assert.equal(submit.id, 'quiz-submit-base');
  assert.equal(submit.thinking, false);

  const closed = currentFocus({
    levelId: 'quiz',
    exam: { open: false, missing: [{ id: 'repair', title: '温室控制器返修' }] }
  });
  assert.equal(closed.id, 'exam-missing');
  assert.equal(closed.target.stationId, 'repair');
});

test('停顿最多加强两次，地图 20 秒、思考 40 秒', () => {
  let time = 0;
  const seen = [];
  const idle = createIdleTimer({ now: () => time, onStrength: detail => seen.push(detail) });
  idle.configure({ key: 'map', thinking: false });
  time = 20000;
  idle.tick();
  time = 40000;
  idle.tick();
  time = 90000;
  idle.tick();
  assert.deepEqual(seen.map(item => item.strength), [1, 2]);
  assert.equal(seen[0].idleMs >= 20000, true);
  idle.configure({ key: 'think', thinking: true });
  time = 90000 + 39999;
  idle.tick();
  assert.equal(idle.strength(), 0);
  time = 90000 + 40000;
  idle.tick();
  assert.equal(idle.strength(), 1);
  idle.setPaused(true);
  time += 80000;
  idle.tick();
  assert.equal(idle.strength(), 1);
});
