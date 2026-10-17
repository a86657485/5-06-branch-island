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
