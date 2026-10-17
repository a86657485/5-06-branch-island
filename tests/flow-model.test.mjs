import test from 'node:test';
import assert from 'node:assert/strict';
import rules from '../public/rules.js';
import {
  conditionLine, emptyFlow, faultSeen, lockFlow, lockPredictions, lockSentence,
  placeCard, repairPreset, sentenceTokens
} from '../engine/src/gui/flow-model.ts';

test('动作卡放进菱形不能锁定，程序保持原样', () => {
  const placed = placeCard(emptyFlow(), 'diamond', 'on');
  const locked = lockFlow('sale', { ...placed, yes: 'on', no: 'off' });
  assert.equal(locked.ok, false);
  assert.equal(locked.flow.locked, false);
  assert.equal(locked.config, undefined);
  assert.match(locked.message, /菱形里要放能回答是\/否的问题/);
  assert.deepEqual(locked.mCodes, ['M8']);
});

test('大于和小于等于可以运行，30℃时风机应关闭', () => {
  const cases = [
    { operator: '>', card: 'gt30', yes: 'on', no: 'off', line: '30＞30 → 不成立' },
    { operator: '<=', card: 'le30', yes: 'off', no: 'on', line: '30≤30 → 成立' }
  ];
  for (const item of cases) {
    const locked = lockFlow('sale', { diamond: item.card, yes: item.yes, no: item.no, locked: false });
    assert.equal(locked.ok, true);
    assert.equal(locked.config.operator, item.operator);
    const at30 = rules.evaluate('sale', locked.config, { temperature: 30 });
    assert.equal(at30.correct, false);
    assert.equal(at30.output, 'off');
    assert.equal(conditionLine(at30), item.line);
    assert.equal(rules.evaluate('sale', locked.config, { temperature: 29 }).correct, true);
    assert.equal(rules.evaluate('sale', locked.config, { temperature: 31 }).correct, true);
  }
});

test('拼句只用锁定流程图里的卡片', () => {
  const flow = lockFlow('sale', { diamond: 'ge30', yes: 'on', no: 'off', locked: false }).flow;
  const tokens = sentenceTokens('sale', flow).map(token => token.label);
  assert.equal(tokens.includes('温度≥30℃？'), true);
  assert.equal(tokens.includes('启动风机'), true);
  assert.equal(tokens.includes('温度＞30℃？'), false);
  assert.equal(sentenceTokens('sale', emptyFlow()).some(token => token.id === 'on'), false);
  const sentence = { slots: ['if', 'ge30', 'then', 'on', 'else', 'off'], locked: false };
  assert.equal(lockSentence('sale', sentence, flow).ok, true);
  assert.equal(lockSentence('sale', { slots: ['if', 'gt30', 'then', 'on', 'else', 'off'], locked: false }, flow).ok, false);
  const cross = lockFlow('cross', { diamond: 'bridge-q', yes: 'bridge', no: 'crossing', locked: false });
  assert.equal(lockSentence('cross', { slots: ['if', 'bridge-q', 'else', 'bridge'], locked: false }, cross.flow).ok, true);
});

test('路口绿灯判断不能执行，返修要先看到故障', () => {
  const illegal = lockFlow('cross', { diamond: 'green-q', yes: 'bridge', no: 'crossing', locked: false });
  assert.equal(illegal.ok, false);
  assert.equal(illegal.flow.locked, false);
  assert.equal(illegal.config, undefined);
  const preset = repairPreset();
  assert.equal(preset.locked, true);
  assert.equal(faultSeen([]), false);
  assert.equal(faultSeen([{ input: { temperature: 30 }, config: { operator: '>=', yes: 'off', no: 'on' }, correct: false }]), true);
  const swapped = lockFlow('repair', { diamond: 'ge30', yes: 'on', no: 'off', locked: false });
  assert.equal(swapped.config.yes, 'on');
  assert.equal(swapped.config.no, 'off');
});

test('三个温度都选了才能锁定预测', () => {
  assert.equal(lockPredictions({ 29: 'on', 30: '', 31: 'off', locked: false }).ok, false);
  const locked = lockPredictions({ 29: 'off', 30: 'on', 31: 'on', locked: false });
  assert.equal(locked.ok, true);
  assert.equal(locked.table.locked, true);
});
