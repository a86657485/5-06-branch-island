import test from 'node:test';
import assert from 'node:assert/strict';
import { createPatrol, markStory, storyChangesLearning, stationUnlocked, storyScript } from '../public/patrol.mjs';

test('跳过剧情只推进叙事，不写学习达成', () => {
  let patrol = createPatrol();
  patrol = markStory(patrol, 'brief', true);
  patrol = markStory(patrol, 'sale:opening', true);
  assert.equal(patrol.briefSeen, true);
  assert.deepEqual(patrol.skipped, ['brief', 'sale:opening']);
  assert.equal(storyChangesLearning(), false);
  assert.equal(storyScript('sale', 'opening').lines.includes('温室好热！菜苗都蔫了！'), true);
  assert.equal(storyScript('sale', 'opening').lines.includes('设备怎样看情况，决定做哪件事？'), true);
  assert.equal(storyScript('repair', 'result_ok').lines[0], '修好了！条件改了出口要跟着。');
  assert.equal(storyScript('cross', 'opening').npc, '巡检员小巡');
  assert.equal(storyScript('minimum', 'opening').lines[1], '选做哦，做完随时可走。');
});

test('巡检单固定从温室到路口，储能柜不插队', () => {
  assert.equal(stationUnlocked('sale', {}), true);
  assert.equal(stationUnlocked('repair', {}), false);
  assert.equal(stationUnlocked('repair', { sale: { completed: true } }), true);
  assert.equal(stationUnlocked('cross', { sale: { completed: true } }), false);
  assert.equal(stationUnlocked('cross', { sale: { completed: true }, repair: { completed: true } }), true);
  assert.equal(stationUnlocked('minimum', {}), true);
  assert.equal(stationUnlocked('quiz', {}), true);
});
