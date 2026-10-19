import test from 'node:test';
import assert from 'node:assert/strict';
import { currentFocus, gotoTitle, routeDots } from '../public/focus.mjs';
import { advanceRoute, routeMark } from '../engine/src/modules/lesson/route-progress.mjs';
import { keepNewerScene } from '../engine/src/classroom-bridge.ts';
import { createIdleTimer } from '../public/idle-timer.mjs';

test('同一时刻只有一个焦点，过街行走时不能一键前往', () => {
  const start = currentFocus({ levelId: 'sale', scene: { phase: 'start' }, level: { valid: false } });
  assert.equal(start.id, 'guide');
  assert.equal(start.goto, true);
  assert.equal(start.target.place, 'guide');
  assert.equal(start.hint, '先听园艺员说任务。');
  assert.equal([...start.hint].length <= 30, true);
  assert.equal(start.hint.includes('≥'), false);
  const repairStart = currentFocus({ levelId: 'repair', scene: { phase: 'start' } });
  assert.equal(repairStart.hint, '沿箭头走到返修点，听维修员说问题。');
  assert.equal(repairStart.goto, false);
  assert.equal(repairStart.gotoReason, '同图走到返修，不传送。');
  assert.equal(repairStart.target.mapId, 'greenhouse');
  assert.equal(repairStart.target.place, 'guide');
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
  const closedPanel = currentFocus({
    levelId: 'cross',
    scene: walk && { phase: 'executed', measured: true, facility: true, ticket: { output: 'bridge' }, actions: [], signal: 'green' },
    level: { valid: false },
    draft: { panel: 'sentence', flow: { locked: true }, sentence: { locked: false, slots: [] } },
    panelOpen: false
  });
  assert.equal(closedPanel.step, '10');
  assert.equal(closedPanel.dots.length, walk.dots.length);
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
  assert.equal(slot.hint, '把卡片拖进亮着的空格，或先点卡片再点空格。');
  assert.equal(slot.strong, '把卡片拖进亮着的空格，或先点卡片再点空格。');
  assert.equal([...slot.strong].length <= 30, true);
  const sentence = currentFocus({
    levelId: 'sale',
    scene: { phase: 'assigned', measured: true },
    draft: { panel: 'sentence', flow: { locked: true }, sentence: { locked: false, slots: [] }, predictionsLocked: { locked: true } }
  });
  assert.equal(sentence.id, 'sentence-slot-next');
  const predictTab = currentFocus({
    levelId: 'sale',
    scene: { phase: 'assigned', measured: true },
    draft: { panel: 'flow', flow: { locked: true, diamond: 'ge30', yes: 'on', no: 'off' }, sentence: { locked: false }, predictionsLocked: { locked: false } }
  });
  assert.equal(predictTab.id, 'predict-tab');
  assert.equal(predictTab.kind, 'panel');
  assert.equal(predictTab.hint, '点「预测」，锁定三个温度的预测。');
  const predictFromSentence = currentFocus({
    levelId: 'sale',
    scene: { phase: 'assigned', measured: true },
    draft: { panel: 'sentence', flow: { locked: true }, sentence: { locked: false }, predictionsLocked: { locked: false } }
  });
  assert.equal(predictFromSentence.id, 'predict-tab');
  assert.equal(predictFromSentence.hint, '点「预测」，锁定三个温度的预测。');
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
  const draw = currentFocus({ levelId: 'cross', scene: { phase: 'observed', measured: true, facility: true }, draft: { flow: { locked: false } }, level: { valid: false } });
  assert.equal(draw.hint, '到导行屏，按 E 打开画图。');
  assert.equal(draw.target.place, 'control');
  assert.equal(currentFocus({ levelId: 'repair', scene: { phase: 'measured', measured: true }, draft: { flow: { locked: false } } }).hint, '先运行原程序，看 30℃。');
});

test('旧闸机字段不占焦点，浮层打开时地图设备不再当焦点', () => {
  const fresh = currentFocus({ levelId: 'gate', intro: { accepted: false } });
  assert.equal(fresh.id, 'guide');
  assert.equal(fresh.hint, '先听园艺员说任务。');
  const leftover = currentFocus({ levelId: 'sale', intro: { done: false, ticket: '10' }, scene: { phase: 'start' } });
  assert.equal(leftover.id, 'guide');
  assert.equal(leftover.target.place, 'guide');
  const story = currentFocus({ levelId: 'sale', overlay: 'story', scene: { phase: 'assigned', measured: false } });
  assert.equal(story.id, 'story-skip');
  assert.equal(story.pause, true);
  assert.equal(story.target.place, undefined);
  const list = currentFocus({ overlay: 'checklist', levelId: 'repair', scene: { phase: 'start' } });
  assert.equal(list.id, 'patrol-checklist');
  assert.equal(list.hint, '打开巡检单，确认本站任务。');
  const route = currentFocus({ overlay: 'route', levelId: 'sale' });
  assert.equal(route.id, 'route-arrow');
  assert.equal(route.hint, '沿箭头去下一巡检站。');
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
    const bridge = focus.target.place.startsWith('bridge');
    for (const dot of focus.dots) {
      assert.equal(bridge ? dot.y >= 288 && dot.y <= 392 : dot.y >= 608 && dot.y <= 744, true);
    }
    for (let i = 1; i < focus.dots.length; i += 1) {
      const gap = Math.hypot(focus.dots[i].x - focus.dots[i - 1].x, focus.dots[i].y - focus.dots[i - 1].y);
      assert.equal(gap <= 48, true);
    }
  }
  assert.notDeepEqual(east.dots, west.dots);

  const zebraAfterBridge = currentFocus({
    levelId: 'cross',
    scene: {
      phase: 'executed', measured: true, facility: false, signal: 'green',
      ticket: { output: 'crossing' }, actions: ['observe', 'predict'], visited: ['verified']
    },
    level: { valid: false },
    draft: { panel: 'sentence', flow: { locked: true }, sentence: { locked: false, slots: [] } },
    panelOpen: false
  });
  assert.equal(zebraAfterBridge.step, '10');
  assert.equal(zebraAfterBridge.hint, '沿导行屏指的路，亲自走过去。');
  assert.equal(zebraAfterBridge.goto, false);
  assert.equal(zebraAfterBridge.target.place, 'crossingWest');
  assert.equal(zebraAfterBridge.dots.length > 3, true);
  assert.equal(zebraAfterBridge.dots.every(dot => dot.y >= 608 && dot.y <= 744), true);

  const arrived = currentFocus({
    levelId: 'cross',
    scene: { phase: 'arrived', measured: true, facility: true, ticket: { output: 'bridge' }, actions: ['observe', 'predict', 'route'], signal: 'green' },
    level: { valid: false },
    draft: { panel: 'sentence', flow: { locked: true }, sentence: { locked: false, slots: [] } },
    panelOpen: false
  });
  assert.equal(arrived.hint, '到核验处保存这次结果。');
  assert.equal(arrived.step, '9');
});

test('只沿天桥脚印走会记成 route', () => {
  const focus = currentFocus({
    levelId: 'cross',
    scene: { phase: 'executed', measured: true, facility: true, ticket: { output: 'bridge' }, actions: [], signal: 'green' },
    level: { valid: false }
  });
  const dots = focus.dots;
  assert.equal(dots.some(dot => dot.x >= 430 && dot.x <= 580 && dot.y >= 288 && dot.y <= 392), true);
  assert.equal(dots.some(dot => dot.x >= 700 && dot.x <= 860 && dot.y >= 288 && dot.y <= 392), true);
  assert.equal(dots[0].x, 470);
  assert.equal(dots[dots.length - 1].x >= 1024 && dots[dots.length - 1].x <= 1180, true);
  const progress = dots.reduce((state, dot) => advanceRoute(state, dot, 'bridge', 'footprints'), undefined);
  assert.equal(routeMark(progress.stage), 'route');
  const zebra = routeDots('crossing', 'crossing');
  assert.equal(zebra.length < dots.length, true);
  assert.equal(zebra.some(dot => dot.x >= 700 && dot.x <= 860), false);
});

test('过街说明只在亲自走时挂在按钮上', () => {
  const walk = currentFocus({
    levelId: 'cross',
    scene: { phase: 'executed', measured: true, facility: true, ticket: { output: 'bridge' }, actions: [] },
    level: { valid: false }
  });
  assert.equal(gotoTitle(walk, false), '这段要你亲自走过去');
  assert.equal(gotoTitle(walk, true), '');
  assert.equal(gotoTitle({ goto: true, gotoReason: '' }, true), '前往下一目标');
});

test('温室和返修已经跑过时，不先跳去拼句', () => {
  const saleRun = currentFocus({
    levelId: 'sale',
    scene: { phase: 'executed', measured: true, ticket: { output: 'on' }, visited: [] },
    draft: { flow: { locked: true }, sentence: { locked: false }, predictionsLocked: { locked: false } },
    panelOpen: false
  });
  assert.equal(saleRun.step, '9');
  assert.equal(saleRun.id, 'verify');
  assert.equal(saleRun.hint.includes('拼一句'), false);

  const saleNext = currentFocus({
    levelId: 'sale',
    scene: { phase: 'assigned', measured: true, visited: ['verified'] },
    draft: { flow: { locked: true }, sentence: { locked: false }, predictionsLocked: { locked: false } },
    panelOpen: false
  });
  assert.equal(saleNext.step, '7');
  assert.equal(saleNext.hint, '回控制柜，锁定三个温度的预测。');

  const beforeRun = currentFocus({
    levelId: 'sale',
    scene: { phase: 'assigned', measured: true, visited: [] },
    draft: { flow: { locked: true }, sentence: { locked: false } },
    panelOpen: false
  });
  assert.equal(beforeRun.step, '7');
  assert.equal(beforeRun.hint, '回控制柜，锁定三个温度的预测。');
  const sentenceAfterPredict = currentFocus({
    levelId: 'sale',
    scene: { phase: 'assigned', measured: true, visited: [] },
    draft: { flow: { locked: true }, sentence: { locked: false }, predictionsLocked: { locked: true } },
    panelOpen: false
  });
  assert.equal(sentenceAfterPredict.hint, '回控制柜，用词块拼一句。');

  const repairRun = currentFocus({
    levelId: 'repair',
    scene: { phase: 'executed', measured: true, ticket: { output: 'off' }, visited: ['verified'] },
    draft: { flow: { locked: true, preset: true }, sentence: { locked: false } },
    panelOpen: false
  });
  assert.equal(repairRun.step, '9');
  assert.equal(repairRun.id, 'verify');
  assert.equal(repairRun.hint, '到核验处保存这次结果。');

  const repairDiagnose = currentFocus({
    levelId: 'repair',
    scene: { phase: 'assigned', measured: true, visited: ['verified'] },
    draft: { flow: { locked: true, preset: true }, sentence: { locked: false } },
    panelOpen: false
  });
  assert.equal(repairDiagnose.step, '3');
  assert.equal(repairDiagnose.hint, '回控制柜，点一张诊断。');
  const repairNeedsSample = currentFocus({
    levelId: 'repair',
    scene: { phase: 'assigned', measured: false, visited: ['verified'] },
    draft: { flow: { locked: true, preset: true }, sentence: { locked: false } },
    panelOpen: false
  });
  assert.equal(repairNeedsSample.id, 'sensor');
  assert.equal(repairNeedsSample.hint, '到温度探头，选一个温度。');

  const repairEdit = currentFocus({
    levelId: 'repair',
    scene: { phase: 'assigned', measured: true, visited: ['verified'] },
    draft: { flow: { locked: true, preset: true }, sentence: { locked: false }, diagnoseAnswer: 'exit' },
    panelOpen: false
  });
  assert.equal(repairEdit.step, '4');
  assert.equal(repairEdit.hint, '先点新卡片再点格子，或拖放。');

  const repairSentence = currentFocus({
    levelId: 'repair',
    scene: { phase: 'assigned', measured: true, visited: ['verified'] },
    draft: { flow: { locked: true, preset: false, diamond: 'lt30', yes: 'on', no: 'off' }, sentence: { locked: false }, diagnoseAnswer: 'exit' },
    panelOpen: false
  });
  assert.equal(repairSentence.step, '6');
  assert.equal(repairSentence.hint, '回控制柜，用词块拼一句。');

  const cabinet = currentFocus({
    levelId: 'minimum',
    scene: { phase: 'executed', measured: true, ticket: { output: 'a' } },
    draft: { flow: { locked: true }, sentence: { locked: false }, panel: 'sentence' },
    panelOpen: false
  });
  assert.equal(cabinet.step, '9');
  assert.equal(cabinet.id, 'monitor');
  assert.equal(cabinet.hint, '到核验处保存这次结果。');
});

test('温室核验之后按结果去下一处，不再默认回探头', () => {
  const config = { operator: '>=', yes: 'on', no: 'off' };
  const run = (temperature, correct) => ({ config, input: { temperature }, correct });
  const scene = { phase: 'assigned', measured: false, visited: ['verified'] };
  const draft = { flow: { locked: true }, sentence: { locked: true }, predictionsLocked: { locked: true }, config };
  const nextTemp = currentFocus({ levelId: 'sale', scene, draft, runs: [run(29, true)], evidenceStart: 0, panelOpen: false });
  assert.equal(nextTemp.id, 'sensor');
  assert.equal(nextTemp.hint, '换一个温度再试。');
  const wrong = currentFocus({ levelId: 'sale', scene, draft, runs: [run(29, true), run(30, false), run(31, true)], evidenceStart: 0, panelOpen: false });
  assert.equal(wrong.id, 'control');
  assert.equal(wrong.hint, '对照结果，回控制柜改图。');
  const done = currentFocus({ levelId: 'sale', scene, draft, runs: [run(29, true), run(30, true), run(31, true)], evidenceStart: 0, panelOpen: false });
  assert.equal(done.id, 'guide');
  assert.equal(done.step, '11');
  assert.equal(done.hint, '回园艺员那里汇报。');
  const repairPanel = currentFocus({
    levelId: 'repair',
    scene: { phase: 'assigned', measured: true },
    draft: { panel: 'flow', flow: { diamond: '', yes: '', no: '', locked: false } }
  });
  assert.equal(repairPanel.hint, '先点新卡片再点格子，或拖放。');
  assert.equal(repairPanel.strong, '先点新卡片再点格子，或拖放。');
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

test('较旧的场景回包不会抹掉已经开始的过街', () => {
  const newer = { levelId: 'cross', draft: { sceneRev: 2, scene: { ticket: { output: 'bridge' }, phase: 'executed' } } };
  const stale = { levelId: 'cross', draft: { sceneRev: 1, panel: 'sentence', scene: { phase: 'observed' } } };
  const kept = keepNewerScene(newer, stale);
  assert.equal(kept.draft.scene.ticket.output, 'bridge');
  assert.equal(kept.draft.sceneRev, 2);
  assert.equal(keepNewerScene(newer, { levelId: 'cross', draft: { sceneRev: 3, scene: { phase: 'assigned' } } }).draft.scene.phase, 'assigned');
  const moved = keepNewerScene(newer, { levelId: 'repair', draft: { sceneRev: 0, scene: { phase: 'start', temperatureCase: 30 } } });
  assert.equal(moved.levelId, 'repair');
  assert.equal(moved.draft.scene.phase, 'start');
  assert.equal(moved.draft.scene.temperatureCase, 30);
});
