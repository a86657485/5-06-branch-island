import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseCard, confirmCurrent, emptySession, goNext, placeCard } from '../public/quiz-flow.mjs';

const question = {
  id: 'q22',
  type: 'flowchart_fill',
  options: ['跳绳≥100', '跳绳＞100', '跳绳＜100', '得星', '没星', '输入次数'],
  interaction: { figure: { nodes: [{ slot: 's1' }, { slot: 's2' }, { slot: 's3' }] } }
};

test('填槽和确认都停在当前题，确认后才能到下一题', () => {
  const session = emptySession([question, { ...question, id: 'next', type: 'single_choice', options: ['甲', '乙'] }]);
  chooseCard(session, 2);
  placeCard(session, 's1');
  assert.equal(session.index, 0);
  assert.equal(goNext(session), 0);
  chooseCard(session, 4); placeCard(session, 's2');
  chooseCard(session, 3); placeCard(session, 's3');
  assert.equal(goNext(session), 0);
  confirmCurrent(session);
  assert.equal(session.index, 0);
  assert.equal(goNext(session), 1);
});
