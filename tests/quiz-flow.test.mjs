import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseCard, confirmCurrent, emptySession, filled, goNext, placeCard } from '../public/quiz-flow.mjs';

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

test('分类题把每张卡片放进目标框', () => {
  const sort = {
    id: 'q20', type: 'drag_op', options: ['15%', '20%', '21%', '35%'],
    interaction: { targets: [{ id: 'remind', label: '提醒充电' }, { id: 'none', label: '不提醒' }] }
  };
  const session = emptySession([sort]);
  chooseCard(session, 0); placeCard(session, 'remind');
  chooseCard(session, 1); placeCard(session, 'remind');
  chooseCard(session, 2); placeCard(session, 'none');
  assert.equal(filled(sort, session.answers.q20), false);
  chooseCard(session, 3); placeCard(session, 'none');
  assert.deepEqual(session.answers.q20, { 0: 'remind', 1: 'remind', 2: 'none', 3: 'none' });
  assert.equal(filled(sort, session.answers.q20), true);
  confirmCurrent(session);
  assert.equal(session.confirmed.q20, true);
});
