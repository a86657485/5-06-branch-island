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
  assert.match(storyScript('sale', 'opening').lines.join(''), /新装.*还没.*自动/);
  assert.match(storyScript('sale', 'opening').lines.at(-1), /29、30、31/);
  assert.match(storyScript('repair', 'result_ok').lines.join(''), /故障.*修.*重验/);
  assert.equal(storyScript('cross', 'opening').npc, '巡检员小巡');
  assert.match(storyScript('minimum', 'opening').lines.at(-1), /随时可走/);
});

test('开场以问题、约定和行动组成三幕，不抢先讲解或冒称世界后果', () => {
  assert.equal(storyScript('brief', 'brief').lines.length, 4);
  assert.doesNotMatch(storyScript('brief', 'brief').lines.join(''), /先看知识卡|先学/);
  const causes = {
    sale: /新装.*没.*自动.*没法.*守/,
    repair: /备用控制板.*30℃.*停.*程序.*换过/,
    cross: /游客.*不知.*小巡.*导行屏/,
    minimum: /电池.*充电口.*一个.*电量.*少/
  };
  for (const [id, cause] of Object.entries(causes)) {
    const story = storyScript(id, 'opening');
    assert.equal(story.lines.length, 6, `${id} 应有三幕各两句`);
    assert.match(story.lines.join(''), cause, `${id} 要交代问题成因`);
    assert.match(story.lines.slice(4).join(''), /先|试|测|观察|读/, `${id} 第三幕引出行动`);
  }
  const results = ['sale','repair','cross','minimum'].map(id => storyScript(id, 'result_ok').lines.join(''));
  assert.match(results[0], /29、30、31.*符合告示.*备用板/);
  assert.match(results[1], /故障.*修.*重验.*小巡/);
  assert.match(results[2], /两种现场.*对岸.*基础检测/);
  assert.match(results[3], /两组.*低电量.*基础检测/);
  for (const text of results) assert.doesNotMatch(text, /凉下来了|苗抬起头|加分记上/);
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
