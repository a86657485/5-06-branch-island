import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import rules from '../public/rules.js';
import { standBeside } from '../engine/src/modules/lesson/approach.ts';
import { toPlain } from '../engine/src/gui/plain.ts';
import { currentFocus, mapFor } from '../public/focus.mjs';
import { DIALOG_DISMISS_EVENTS, dialogCloseValue, dialogCloseWritesEvidence } from '../engine/src/gui/dialog-policy.ts';
import { closedBridgeSelected } from '../engine/src/modules/lesson/route-progress.mjs';
import {
  conditionLine, lockFlow, placeCard, repairEditMessage, repairPreset, repairSymbolHint, unlockPredictionsOnEdit
} from '../engine/src/gui/flow-model.ts';

const layout = JSON.parse(fs.readFileSync(new URL('../engine/src/tiled/layout.json', import.meta.url), 'utf8'));

test('前往园艺员时站在东侧并面向他，不朝向南边的核验仪', () => {
  const places = layout.greenhouse.positions;
  const point = id => ({ x: places[id][0], y: places[id][1] });
  const others = ['sensor', 'control', 'fan', 'verify', 'portal'].map(point);
  const stand = standBeside(point('guide'), point('start'), others);
  assert.deepEqual(stand, { x: places.guide[0] + 16, y: places.guide[1], direction: 'left' });
  assert.equal(Math.hypot(stand.x - places.verify[0], stand.y - places.verify[1]) >= 40, true);
  const south = { x: places.guide[0], y: places.guide[1] + 32 };
  assert.equal(Math.hypot(south.x - places.verify[0], south.y - places.verify[1]) < 40, true);
});

test('面板数据先变成普通对象，才能发给课堂页', () => {
  const raw = { flow: { diamond: 'on', yes: '', no: '', locked: false }, panel: 'flow' };
  const proxy = new Proxy(raw, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      return value && typeof value === 'object' ? new Proxy(value, this) : value;
    }
  });
  assert.throws(() => structuredClone(proxy), error => error.name === 'DataCloneError');
  const plain = toPlain(proxy);
  assert.equal(plain.flow.diamond, 'on');
  assert.equal(plain.panel, 'flow');
  assert.deepEqual(structuredClone(plain), plain);
});

test('改条件后预测要重新锁定，原来的选择还在', () => {
  const table = { 29: 'off', 30: 'on', 31: 'on', locked: true };
  const kept = unlockPredictionsOnEdit(table, false);
  assert.equal(kept.locked, true);
  const again = unlockPredictionsOnEdit(table, true);
  assert.equal(again.locked, false);
  assert.equal(again[30], 'on');
  assert.equal(again[29], 'off');
});

test('返修没看到故障不能改，只改符号仍然错，对调出口或改回小于才能过', () => {
  assert.match(repairEditMessage(true, false), /先用原程序/);
  assert.equal(repairEditMessage(true, true), '');
  assert.equal(repairEditMessage(false, false), '');
  const preset = repairPreset();
  assert.equal(placeCard(preset, 'diamond', 'gt30').diamond, 'gt30');
  const symbolOnly = { model: 'ventilation', operator: '>=', yes: 'off', no: 'on' };
  assert.equal(rules.evaluate('repair', symbolOnly, { temperature: 30 }).correct, false);
  assert.equal(rules.evaluate('repair', symbolOnly, { temperature: 30 }).output, 'off');
  const symbolChanged = { model: 'ventilation', operator: '<', yes: 'on', no: 'off' };
  assert.equal(rules.evaluate('repair', symbolChanged, { temperature: 30 }).correct, false);
  assert.equal(rules.evaluate('repair', symbolChanged, { temperature: 30 }).output, 'off');
  assert.match(repairSymbolHint(symbolChanged), /仍然不转/);
  const greater = { model: 'ventilation', operator: '>', yes: 'on', no: 'off' };
  assert.equal(rules.normalizeConfig('repair', greater).operator, '>');
  assert.equal(rules.evaluate('repair', greater, { temperature: 30 }).correct, false);
  assert.equal(rules.evaluate('repair', greater, { temperature: 31 }).correct, true);
  assert.match(repairSymbolHint(greater), /仍然不转/);
  const swapped = { model: 'ventilation', operator: '>=', yes: 'on', no: 'off' };
  const restored = { model: 'ventilation', operator: '<', yes: 'off', no: 'on' };
  assert.equal(repairSymbolHint(restored), '');
  for (const config of [swapped, restored]) {
    for (const temperature of [29, 30, 31]) assert.equal(rules.evaluate('repair', config, { temperature }).correct, true);
  }
  const broken = { model: 'ventilation', operator: '>=', yes: 'off', no: 'on' };
  const runs = [
    { config: broken, input: { temperature: 30 } },
    ...[29, 30, 31].map(temperature => ({ config: swapped, input: { temperature } }))
  ];
  assert.equal(rules.validateComplete('repair', swapped, runs, 'swap', 0).passed, true);
  assert.equal(rules.validateComplete('repair', symbolChanged, [
    runs[0],
    ...[29, 30, 31].map(temperature => ({ config: symbolChanged, input: { temperature } }))
  ], 'swap', 0).passed, false);
});

test('大于和小于等于在 30℃写出核验行，动作卡不能改程序', () => {
  const action = lockFlow('sale', { diamond: 'on', yes: 'on', no: 'off', locked: false });
  assert.equal(action.ok, false);
  assert.equal(action.config, undefined);
  const greater = lockFlow('sale', { diamond: 'gt30', yes: 'on', no: 'off', locked: false });
  const atMost = lockFlow('sale', { diamond: 'le30', yes: 'off', no: 'on', locked: false });
  assert.equal(conditionLine(rules.evaluate('sale', greater.config, { temperature: 30 })), '30＞30 → 不成立');
  assert.equal(conditionLine(rules.evaluate('sale', atMost.config, { temperature: 30 })), '30≤30 → 成立');
  assert.equal(rules.evaluate('sale', greater.config, { temperature: 30 }).output, 'off');
  assert.equal(rules.evaluate('sale', atMost.config, { temperature: 30 }).output, 'off');
});

test('路口求助不给答案，绿灯卡不能执行，封闭时走天桥算受阻', () => {
  const app = fs.readFileSync(new URL('../public/app.mjs', import.meta.url), 'utf8');
  const help = app.slice(app.indexOf('onHelp()'), app.indexOf('onNavHelp'));
  assert.match(help, /怎么操作/);
  assert.equal(help.includes('附近有可用'), false);
  assert.equal(help.includes('温度≥30'), false);
  const illegal = lockFlow('cross', { diamond: 'green-q', yes: 'bridge', no: 'crossing', locked: false });
  assert.equal(illegal.ok, false);
  assert.equal(illegal.config, undefined);
  assert.equal(closedBridgeSelected('bridge', false), true);
  assert.equal(closedBridgeSelected('bridge', true), false);
  assert.equal(closedBridgeSelected('crossing', false), false);
  const step10 = currentFocus({
    levelId: 'cross',
    scene: { phase: 'executed', measured: true, facility: true, ticket: { output: 'bridge' }, actions: [], signal: 'green' },
    level: { valid: false }
  });
  assert.equal(step10.step, '10');
  assert.equal(step10.goto, false);
});

test('从入口走到返修再换三次图，关闭对话不写完成或证据', () => {
  const maps = [
    mapFor('sale', {}),
    mapFor('repair', {}),
    mapFor('cross', { facility: false }),
    mapFor('cross', { facility: true })
  ];
  assert.deepEqual(maps, ['greenhouse', 'workshop', 'crossing', 'crossing-east']);
  assert.equal(new Set(maps).size, 4);
  for (const signal of ['escape', 'return', 'map']) {
    assert.equal(dialogCloseValue(signal), null);
    assert.equal(dialogCloseWritesEvidence(), false);
  }
  assert.equal(DIALOG_DISMISS_EVENTS.includes('lesson-map-changed'), true);
  assert.equal(DIALOG_DISMISS_EVENTS.includes('lesson-level-changed'), true);
});
