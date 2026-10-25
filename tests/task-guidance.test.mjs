import test from 'node:test';
import assert from 'node:assert/strict';

const guidance = await import('../public/task-guidance.mjs').catch(() => ({}));
const draft = (patch = {}) => ({
  config: { model: 'ventilation', operator: '>=', yes: 'on', no: 'off' },
  flow: { diamond: 'ge30', yes: 'on', no: 'off', locked: true },
  input: { temperature: 30 }, scene: { temperatureCase: 30, phase: 'measured', actions: ['measure'], measured: true },
  ...patch
});
function hint(level, value, step) {
  assert.equal(typeof guidance.toolHint, 'function', 'shared toolHint is not implemented');
  return guidance.toolHint(level, value, step);
}

test('four station briefs explain the problem, purpose and observable success', () => {
  assert.equal(typeof guidance.stationBrief, 'function', 'stationBrief is not implemented');
  for (const id of ['sale', 'repair', 'cross', 'minimum']) {
    const brief = guidance.stationBrief(id);
    assert.deepEqual(Object.keys(brief), ['problem', 'purpose', 'success']);
    for (const line of Object.values(brief)) assert.ok(line.length > 6 && line.length <= 65);
    assert.doesNotMatch(brief.purpose, /补流程图|拼句子/);
  }
  assert.match(guidance.stationBrief('minimum').purpose, /本次|今天/);
});

test('tool keys are stable across object property order and ignore movement-only changes', () => {
  const a = draft();
  const b = { input: { temperature: 30 }, flow: { locked: true, no: 'off', yes: 'on', diamond: 'ge30' }, config: { no: 'off', yes: 'on', operator: '>=', model: 'ventilation' }, scene: { ...a.scene, x: 120, y: 50 }, sceneRev: 99 };
  assert.equal(hint('sale', a, { phase: 'flow', slot: 'yes' }).key, hint('sale', b, { phase: 'flow', slot: 'yes' }).key);
});

test('irrelevant or invented step fields cannot consume a fresh hint', () => {
  const a = draft();
  const step = { phase: 'flow', slot: 'yes' };
  assert.deepEqual(hint('sale', a, step), hint('sale', a, { ...step, key: 'random-client-key', temperature: 999 }));
  assert.deepEqual(hint('sale', a, { phase: 'predict' }), hint('sale', a, { phase: 'predict', slot: 'client-value', key: 'different', temperature: 999 }));
  assert.equal(hint('sale', a, { phase: 'world', key: 'invented-a' }).key, hint('sale', a, { phase: 'world', key: 'invented-b' }).key);
});

test('six actual steps have distinct keys; changed input, program and station are new hints', () => {
  const a = draft();
  const steps = [{ phase: 'flow', slot: 'diamond' }, { phase: 'flow', slot: 'yes' }, { phase: 'flow', slot: 'no' }, ...[29, 30, 31].map(temperature => ({ phase: 'predict', temperature }))];
  assert.equal(new Set(steps.map(step => hint('sale', a, step).key)).size, 6);
  const key = hint('sale', a, { phase: 'predict' }).key;
  assert.notEqual(key, hint('sale', draft({ input: { temperature: 29 }, scene: { temperatureCase: 29 } }), { phase: 'predict' }).key);
  assert.notEqual(key, hint('sale', draft({ config: { ...a.config, yes: 'off' } }), { phase: 'predict' }).key);
  assert.notEqual(key, hint('repair', a, { phase: 'predict' }).key);
});

test('predictions follow the current program, including the initial 30 degree repair fault', () => {
  const faulty = draft({ config: { model: 'ventilation', operator: '>=', yes: 'off', no: 'on' }, flow: { diamond: 'ge30', yes: 'off', no: 'on', locked: true, preset: true } });
  const result = hint('repair', faulty, { phase: 'predict', temperature: 30 });
  assert.match(result.action, /关闭风机/);
  assert.match(result.why, /成立/);
  assert.match(result.why, /不符/);
  assert.match(hint('sale', draft(), { phase: 'predict', temperature: 29 }).action, /关闭风机/);
  assert.match(hint('sale', draft(), { phase: 'predict', temperature: 30 }).action, /启动风机/);
});

test('compatible less-than thermal choices are retained rather than forced to one solution', () => {
  const less = draft({ config: { model: 'ventilation', operator: '<', yes: 'off', no: 'on' }, flow: { diamond: 'lt30', yes: 'off', no: 'on', locked: true } });
  assert.match(hint('repair', less, { phase: 'flow', slot: 'diamond' }).action, /＜30/);
  assert.match(hint('repair', less, { phase: 'flow', slot: 'yes' }).action, /关闭风机/);
  assert.match(hint('repair', less, { phase: 'flow', slot: 'no' }).action, /启动风机/);
  const badBoundary = draft({ config: { model: 'ventilation', operator: '>', yes: 'on', no: 'off' }, flow: { diamond: 'gt30', yes: 'on', no: 'off' } });
  assert.match(hint('sale', badBoundary, { phase: 'flow', slot: 'yes' }).action, /≥30/);
});

test('repair navigation preserves the original fault before offering a fix', () => {
  const original = draft({ flow: { diamond: 'ge30', yes: 'off', no: 'on', preset: true }, scene: { phase: 'assigned' }, diagnoseAnswer: '' });
  assert.match(hint('repair', original, { phase: 'world', key: 'sensor' }).action, /30℃.*原程序/);
  assert.doesNotMatch(hint('repair', original, { phase: 'world', key: 'sensor' }).action, /交换/);
  assert.match(hint('repair', original, { phase: 'diagnose' }).action, /出口/);
});

test('road and battery predictions use the actual branch, not an ideal answer', () => {
  const road = { input: { facility: false }, config: { yes: 'bridge', no: 'crossing' } };
  assert.match(hint('cross', road, { phase: 'predict' }).action, /人行横道/);
  const batteries = { input: { a: 9, b: 2 }, config: { operator: '>', yes: 'a', no: 'b' }, flow: { diamond: 'gt', yes: 'a', no: 'b' } };
  const actual = hint('minimum', batteries, { phase: 'predict' });
  assert.match(actual.action, /A/);
  assert.match(actual.why, /不符/);
  assert.match(hint('minimum', batteries, { phase: 'flow', slot: 'yes' }).action, /B/);
  assert.match(hint('minimum', batteries, { phase: 'flow', slot: 'no' }).action, /A/);
});

test('world guidance distinguishes collecting both batteries, connecting and verification', () => {
  const collecting = { input: { a: 3, b: 8 }, config: { operator: '<', yes: 'a', no: 'b' }, scene: { collected: ['a'] } };
  assert.match(hint('minimum', collecting, { phase: 'world', key: 'batteryB' }).action, /B/);
  const executed = { ...collecting, scene: { ticket: { output: 'a' }, actions: ['collect', 'predict'] } };
  assert.match(hint('minimum', executed, { phase: 'world', key: 'batteryA' }).action, /A.*接入/);
  assert.match(hint('minimum', { ...executed, scene: { ...executed.scene, actions: ['collect', 'predict', 'route'] } }, { phase: 'world', key: 'monitor' }).action, /核验/);
});

test('road signal help waits for green before starting the selected crossing', () => {
  const a = { input: { facility: false }, config: { yes: 'bridge', no: 'crossing' }, scene: { signal: 'red', ticket: { output: 'crossing' }, actions: ['observe', 'predict'] } };
  const result = hint('cross', a, { phase: 'world', key: 'signal' });
  assert.match(result.action, /等待绿灯，准备通行/);
  assert.match(result.why, /红灯不通行/);
  assert.notEqual(result.key, hint('cross', a, { phase: 'world', key: 'crossingWest' }).key);
});

test('sentence support explains the student program without filling or changing it', () => {
  const a = draft();
  const before = structuredClone(a);
  const result = hint('sale', a, { phase: 'sentence' });
  assert.match(result.action, /如果.*否则/);
  assert.deepEqual(a, before);
  assert.deepEqual(Object.keys(result), ['key', 'action', 'why', 'conceptual', 'target']);
  assert.deepEqual(result.target, { focusKey: 'sentence-confirm' });
});

test('end-of-station help explains the existing reason choices, including the alternate repair', () => {
  assert.match(hint('sale', draft(), { phase: 'reason' }).action, /刚好30℃也要开/);
  assert.match(hint('repair', draft(), { phase: 'reason' }).action, /两边动作也要对调/);
  const restored = draft({ config: { model: 'ventilation', operator: '<', yes: 'off', no: 'on' } });
  assert.match(hint('repair', restored, { phase: 'reason' }).action, /只改判断方向/);
  assert.match(hint('repair', restored, { phase: 'reason' }).why, /改回＜30/);
  assert.match(hint('cross', {}, { phase: 'reason' }).action, /只走选中的一路/);
  assert.match(hint('minimum', {}, { phase: 'reason' }).action, /哪块少就先给哪块充/);
  assert.notEqual(hint('sale', draft(), { phase: 'reason' }).key, hint('sale', draft(), { phase: 'world', key: 'guide' }).key);
});

test('explanations use short sentences; unsupported exam hints are rejected', () => {
  for (const phase of ['flow', 'predict', 'diagnose', 'sentence', 'world', 'reason']) {
    const result = hint('sale', draft(), { phase, slot: 'yes', key: 'control' });
    for (const line of result.why.split(/[。！？]/).filter(Boolean)) assert.ok([...line].length <= 25, line);
  }
  assert.throws(() => hint('quiz', draft(), { phase: 'predict' }), /探究|站点/);
  assert.throws(() => hint('sale', draft(), { phase: 'exam' }), /步骤/);
});

test('确认和运行提示属于操作帮助，判断答案才是概念帮助',()=>{
 for(const phase of ['confirm','confirm-predictions','run'])assert.equal(guidance.toolHint('sale',{}, {phase}).conceptual,false,phase);
 assert.equal(guidance.toolHint('sale',{}, {phase:'flow',slot:'diamond'}).conceptual,true);
});
