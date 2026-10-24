import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../engine/src/gui/flow-model.ts';

const blank = () => ({ mode: 'sale', flow: model.emptyFlow(), sentence: model.emptySentence(), predictions: model.emptyPredictions(), diagnosed: true, diagnose: '' });

test('单击卡片按判断、是、否依次放入，保留学生选择而不代答', () => {
  assert.equal(typeof model.guidedPanelStep, 'function');
  const state = blank();
  for (const [slot, card] of [['diamond', 'gt30'], ['yes', 'on'], ['no', 'off']]) {
    assert.deepEqual(model.guidedPanelStep(state), { phase: 'flow', slot });
    state.flow = model.placeCard(state.flow, slot, card);
  }
  assert.deepEqual(model.guidedPanelStep(state), { phase: 'lock' });
  const locked = model.lockFlow('sale', state.flow);
  assert.equal(locked.config.operator, '>');
  assert.equal(model.thermalTrials(locked.config).find(item => item.temperature === 30).correct, false);
});

test('流程图自动生成一致的句子，确认后再进入三次运行前预测', () => {
  assert.equal(typeof model.sentenceFromFlow, 'function');
  const state = blank();
  state.flow = model.lockFlow('sale', { diamond: 'lt30', yes: 'off', no: 'on', locked: false }).flow;
  assert.deepEqual(model.guidedPanelStep(state), { phase: 'sentence' });
  const sentence = model.sentenceFromFlow('sale', state.flow);
  assert.deepEqual(sentence.slots, ['if', 'lt30', 'then', 'off', 'else', 'on']);
  state.sentence = model.lockSentence('sale', sentence, state.flow).sentence;
  for (const temperature of [29, 30, 31]) {
    assert.deepEqual(model.guidedPanelStep(state), { phase: 'predict', temperature });
    state.predictions = model.setPrediction(state.predictions, temperature, 'off');
  }
  assert.deepEqual(model.guidedPanelStep(state), { phase: 'predict', temperature: null });
  state.predictions = model.lockPredictions(state.predictions).table;
  assert.deepEqual(model.guidedPanelStep(state), { phase: 'run' });
});

test('返修先体验原故障，看到故障后才诊断与编辑', () => {
  assert.equal(typeof model.guidedPanelStep, 'function');
  const state = { ...blank(), mode: 'repair', flow: model.repairPreset(), diagnosed: false };
  assert.deepEqual(model.guidedPanelStep(state), { phase: 'original' });
  state.diagnosed = true;
  assert.deepEqual(model.guidedPanelStep(state), { phase: 'diagnose' });
  state.diagnose = 'exit';
  state.slot = 'diamond';
  assert.deepEqual(model.guidedPanelStep(state), { phase: 'flow', slot: 'diamond' });
});

test('路口与储能保留原句子验证，完成后回现场作本次预测', () => {
  assert.equal(typeof model.sentenceFromFlow, 'function');
  for (const [mode, diamond, yes, no] of [['cross', 'bridge-q', 'bridge', 'crossing'], ['minimum', 'lt', 'a', 'b']]) {
    const state = { ...blank(), mode };
    const result = model.lockFlow(mode, { diamond, yes, no, locked: false });
    assert.equal(result.ok, true, mode);
    state.flow = result.flow;
    state.sentence = model.lockSentence(mode, model.sentenceFromFlow(mode, state.flow), state.flow).sentence;
    assert.equal(state.sentence.locked, true, mode);
    assert.deepEqual(model.guidedPanelStep(state), { phase: 'run' });
  }
});

test('撤销快照只包含面板编辑，保留原配置且不会复制法宝、实验或分数', () => {
  assert.equal(typeof model.panelEditSnapshot, 'function');
  const source = { ...blank(), config: { model: 'ventilation', operator: '>=', yes: 'on', no: 'off' }, slot: 'diamond', support: { used: 3 }, runs: ['saved'], points: 7, sceneRev: 9 };
  const snapshot = model.panelEditSnapshot(source);
  source.flow.diamond = 'gt30';
  source.predictions[29] = 'on';
  source.config.yes = 'off';
  assert.equal(snapshot.flow.diamond, '');
  assert.equal(snapshot.predictions[29], '');
  assert.equal(snapshot.config.yes, 'on');
  assert.deepEqual(Object.keys(snapshot).sort(), ['config', 'diagnose', 'flow', 'predictions', 'sentence', 'slot']);
});

test('当前步骤只展示同类卡片，比较符和两个出口仍由学生选择', () => {
  assert.equal(typeof model.cardsForSlot, 'function');
  const conditions = model.cardsForSlot('sale', 'diamond');
  assert.equal(conditions.every(card => card.kind === 'condition'), true);
  assert.equal(conditions.some(card => card.id === 'ge30'), true);
  assert.equal(conditions.some(card => card.id === 'gt30'), true);
  for (const slot of ['yes', 'no']) {
    assert.deepEqual(model.cardsForSlot('sale', slot).map(card => card.id), ['on', 'off']);
  }
});

test('法宝额度未连接或用完时不能再申请，正在取提示时也不能连点', () => {
  assert.equal(typeof model.canUseTool, 'function');
  assert.equal(model.canUseTool(), false);
  assert.equal(model.canUseTool({ remaining: 0 }), false);
  assert.equal(model.canUseTool({ remaining: 1 }), true);
  assert.equal(model.canUseTool({ remaining: 1 }, true), false);
});
