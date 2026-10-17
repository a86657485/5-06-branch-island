import test from 'node:test';
import assert from 'node:assert/strict';
import { currentFocus } from '../public/focus.mjs';
import { createIdleTimer } from '../public/idle-timer.mjs';

test('同一时刻只有一个焦点，过街行走时不能一键前往', () => {
  const start = currentFocus({ levelId: 'sale', scene: { phase: 'start' }, level: { valid: false } });
  assert.equal(start.id, 'guide');
  assert.equal(start.goto, true);
  assert.equal(start.target.place, 'guide');
  assert.equal(start.hint, '先听园艺员说任务。');
  assert.equal([...start.hint].length <= 30, true);
  assert.equal(start.hint.includes('≥'), false);
  assert.equal(currentFocus({ levelId: 'repair', scene: { phase: 'start' } }).hint, '听维修员说控制器的问题。');
  assert.equal(currentFocus({ levelId: 'cross', scene: { phase: 'start' } }).hint, '听巡检员说导行屏的任务。');
  assert.equal(currentFocus({ levelId: 'minimum', scene: { phase: 'start' } }).hint, '听能源工程师说配电规则。');

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
  assert.equal(walk.dots.length > 3, true);
  assert.equal(walk.dots.some(dot => dot.x === walk.target.x && dot.y === walk.target.y), false);
  assert.notDeepEqual(walk.dots, wrongRoute.dots);

  const slot = currentFocus({
    levelId: 'sale',
    scene: { phase: 'assigned', measured: true },
    draft: { panel: 'flow', flow: { diamond: '', yes: '', no: '', locked: false } }
  });
  assert.equal(slot.id, 'slot-next');
  assert.equal(slot.step, '4');
  assert.equal(slot.thinking, true);
  const sentence = currentFocus({
    levelId: 'sale',
    scene: { phase: 'assigned', measured: true },
    draft: { panel: 'sentence', flow: { locked: true }, sentence: { locked: false, slots: [] } }
  });
  assert.equal(sentence.id, 'sentence-slot-next');
  const predict = currentFocus({
    levelId: 'sale',
    scene: { phase: 'assigned', measured: true },
    draft: { panel: 'predict', flow: { locked: true }, sentence: { locked: true }, predictionsLocked: { locked: false } }
  });
  assert.equal(predict.id, 'predict-row-next');
  const repairProbe = currentFocus({ levelId: 'repair', scene: { phase: 'assigned', measured: false }, level: { valid: false } });
  assert.equal(repairProbe.step, '2');
  assert.equal(repairProbe.hint, '选 30℃，先运行原程序看看。');
  assert.equal(currentFocus({ levelId: 'sale', scene: { phase: 'assigned', measured: false } }).hint, '到温度探头，选一个温度。');
});

test('闸机引导从运维主管开始，出票后还要看告示再回答', () => {
  const fresh = currentFocus({ levelId: 'gate', intro: { accepted: false } });
  assert.equal(fresh.step, '1');
  assert.equal(fresh.id, 'gate-lead');
  assert.equal(fresh.hint, '走到运维主管面前，按 E 交谈。');
  const ruler = currentFocus({ levelId: 'gate', intro: { accepted: true } });
  assert.equal(ruler.id, 'gate-ruler');
  const judged = currentFocus({ levelId: 'gate', intro: { accepted: true, heightCase: 116 } });
  assert.equal(judged.id, 'i0-judge');
  const ticket = currentFocus({ levelId: 'gate', intro: { accepted: true, heightCase: 116, judged: 'half' } });
  assert.equal(ticket.id, 'gate-turnstile');
  const sign = currentFocus({ levelId: 'gate', intro: { accepted: true, heightCase: 116, judged: 'half', ticket: '10' } });
  assert.equal(sign.id, 'gate-sign');
  assert.equal(sign.hint, '看告示，和闸机出的票比一比。');
  const idea = currentFocus({ levelId: 'gate', intro: { accepted: true, heightCase: 116, judged: 'half', ticket: '10', sawSign: true } });
  assert.equal(idea.step, '6');
  assert.equal(idea.hint, '回运维主管处，回答一个问题。');
  const portal = currentFocus({ levelId: 'gate', intro: { accepted: true, heightCase: 116, judged: 'half', ticket: '10', sawSign: true, idea: '看情况收费' } });
  assert.equal(portal.id, 'gate-portal');
  assert.equal(portal.hint, '从北边园区通道去温室。');
});

test('脚印沿两条腿走，大约每 32 像素一点，不落在终点上', () => {
  const east = currentFocus({
    levelId: 'cross',
    scene: { phase: 'executed', measured: true, facility: true, ticket: { output: 'bridge' }, actions: [], signal: 'green' },
    level: { valid: false }
  });
  const west = currentFocus({
    levelId: 'cross',
    scene: { phase: 'executed', measured: true, facility: false, ticket: { output: 'crossing' }, actions: [] },
    level: { valid: false }
  });
  for (const focus of [east, west]) {
    assert.equal(focus.dots.length > 3, true);
    assert.equal(focus.dots.some(dot => dot.x === focus.target.x && dot.y === focus.target.y), false);
    for (let i = 1; i < focus.dots.length; i += 1) {
      const gap = Math.hypot(focus.dots[i].x - focus.dots[i - 1].x, focus.dots[i].y - focus.dots[i - 1].y);
      assert.equal(gap <= 48, true);
    }
  }
  assert.notDeepEqual(east.dots, west.dots);
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
