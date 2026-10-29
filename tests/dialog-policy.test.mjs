import test from 'node:test';
import assert from 'node:assert/strict';
import { DIALOG_DISMISS_EVENTS, dialogCloseValue, dialogCloseWritesEvidence } from '../engine/src/gui/dialog-policy.ts';

test('换图、Esc 和返回现场都只关闭对话，不写证据', () => {
  assert.deepEqual([...DIALOG_DISMISS_EVENTS], ['lesson-map-changed', 'lesson-level-changed']);
  assert.equal(dialogCloseValue('escape'), null);
  assert.equal(dialogCloseValue('return'), null);
  assert.equal(dialogCloseValue('map'), null);
  assert.equal(dialogCloseWritesEvidence(), false);
});

test('NPC预测对话的法宝使用当前输入，剧情对话只给现场引导', async () => {
  const policy = await import('../engine/src/gui/dialog-policy.ts');
  assert.equal(typeof policy.dialogTaskStep, 'function');
  assert.deepEqual(policy.dialogTaskStep(['off', 'on'], 30), { phase: 'predict', temperature: 30 });
  assert.deepEqual(policy.dialogTaskStep(['bridge', 'crossing']), { phase: 'predict' });
  assert.deepEqual(policy.dialogTaskStep(['a', 'b']), { phase: 'predict' });
  assert.deepEqual(policy.dialogTaskStep(['accept', 'review']), { phase: 'world', key: 'guide' });
  assert.deepEqual(policy.dialogTaskStep(['one', 'two'], undefined, '验收负责人'), { phase: 'reason' });
  assert.deepEqual(policy.dialogTaskStep(['green'], undefined, '人行信号灯'), { phase: 'world', key: 'signal' });
});
