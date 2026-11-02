import test from 'node:test';
import assert from 'node:assert/strict';
import { panelModel, predictBlock, panelStatus, ruleSentence, valueLabel, actionValues, judgeValues } from '../public/rule-panel.mjs';

const kinds = model => model.map(block => block.kind);
const values = block => block.cards.map(card => card.value);

test('判断卡与动作卡在数据层就是两组，取值不重叠', () => {
  for (const station of ['sale', 'repair', 'minimum']) {
    const model = panelModel(station, {});
    assert.deepEqual(kinds(model), ['judge', 'action', 'action']);
    const judge = values(model[0]);
    const action = values(model[1]);
    assert.deepEqual(values(model[2]), action, '是/否两个出口必须给同一组动作，只是排在不同块');
    for (const value of judge) {
      assert.ok(!action.includes(value), `${station}：判断卡的取值 ${value} 混进了动作卡`);
    }
  }
  const cross = panelModel('cross', {}, { facility: true });
  assert.deepEqual(kinds(cross), ['judge', 'action', 'action']);
  assert.deepEqual(values(cross[0]), ['yes'], '现场判断只有一个观察结果，不是可选条件');
});

test('每个 block 都带序号和“是/否”归属，渲染层不会排错行', () => {
  const model = panelModel('sale', {});
  assert.deepEqual(model.map(b => b.step), [1, 2, 3]);
  assert.deepEqual(model.map(b => b.field), ['operator', 'yes', 'no']);
  assert.match(model[1].title, /是/);
  assert.match(model[2].title, /否/);
  assert.match(model[0].title, /判断/);
  assert.equal(predictBlock('sale').kind, 'predict');
  assert.equal(predictBlock('sale').field, 'prediction');
});

test('第二站：判断卡锁定只读，两个出口和预测仍可改', () => {
  const model = panelModel('repair', { operator: '>=', yes: 'off', no: 'on' }, { locked: true });
  assert.equal(model[0].readOnly, true, '原设备条件不能改');
  assert.equal(model[1].readOnly, true, '故障未确认前出口也锁着');
  assert.equal(model[2].readOnly, true);
  assert.equal(predictBlock('repair', { locked: true }).readOnly, false, '预测永远可以选');

  const unlocked = panelModel('repair', { operator: '>=', yes: 'on', no: 'off' }, { locked: false });
  assert.equal(unlocked[0].readOnly, true, '第二站的判断条件始终是原设备的 ≥30℃');
  assert.equal(unlocked[1].readOnly, false, '诊断后出口必须能改');
  assert.equal(unlocked[2].readOnly, false);
});

test('第三站：判断来自现场观察，读到设施才显示对应结论', () => {
  const withBridge = panelModel('cross', {}, { facility: true });
  const without = panelModel('cross', {}, { facility: false });
  assert.equal(withBridge[0].cards[0].label, '附近有天桥');
  assert.equal(without[0].cards[0].label, '附近没有天桥');
  assert.deepEqual(values(without[1]), ['bridge', 'crossing']);
});

test('还差哪几项：缺什么就报什么，全齐才 ready', () => {
  assert.deepEqual(panelStatus('sale', {}).missing, ['判断条件', '是分支动作', '否分支动作']);
  assert.deepEqual(panelStatus('sale', { operator: '>=', yes: 'on' }).missing, ['否分支动作']);
  assert.deepEqual(panelStatus('sale', { operator: '>=', yes: 'on', no: 'off' }), { ready: true, missing: [] });
  assert.deepEqual(panelStatus('repair', { yes: 'off', no: 'on' }).missing, [], '第二站判断条件是给定的，不该算缺项');
  assert.deepEqual(panelStatus('cross', {}).missing, ['是分支动作', '否分支动作'], '第三站判断来自现场，不算缺项');
  assert.deepEqual(panelStatus('minimum', { operator: '<' }).missing, ['是分支动作', '否分支动作']);
});

test('规则回显随选择变化，没选的地方写清楚', () => {
  assert.equal(ruleSentence('sale', {}), '如果 （还没选） → 是：（还没选）；否：（还没选）');
  assert.equal(
    ruleSentence('sale', { operator: '>=', yes: 'on', no: 'off' }),
    '如果 温度 ≥ 30℃ → 是：启动风机；否：停止风机',
  );
  assert.equal(
    ruleSentence('minimum', { operator: '<', yes: 'a', no: 'b' }),
    '如果 A 比 B 少 → 是：送电池A；否：送电池B',
  );
  assert.equal(
    ruleSentence('cross', { yes: 'bridge', no: 'crossing' }, { facility: false }),
    '如果 附近有可用天桥 → 是：走天桥；否：走斑马线',
  );
});

test('valueLabel 覆盖三个站点用到的全部取值', () => {
  const pairs = [
    ['sale', '>=', '温度 ≥ 30℃'], ['sale', '<', '温度 ＜ 30℃'],
    ['sale', 'on', '启动风机'], ['sale', 'off', '停止风机'],
    ['cross', 'bridge', '走天桥'], ['cross', 'crossing', '走斑马线'],
    ['minimum', 'a', '送电池A'], ['minimum', 'b', '送电池B'],
  ];
  for (const [station, value, label] of pairs) assert.equal(valueLabel(station, value), label);
  assert.equal(valueLabel('sale', undefined), '（未设置）');
});

test('动作卡只给当前站点合法的两个出口，不串站', () => {
  assert.deepEqual(actionValues('sale').map(v => v[0]), ['on', 'off']);
  assert.deepEqual(actionValues('cross').map(v => v[0]), ['bridge', 'crossing']);
  assert.deepEqual(actionValues('minimum').map(v => v[0]), ['a', 'b']);
  assert.deepEqual(judgeValues('sale').map(v => v[0]), ['>=', '<']);
  assert.deepEqual(judgeValues('minimum').map(v => v[0]), ['<', '>']);
});
