'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const quiz = require('../quiz.cjs');
const { create } = require('../public/quiz-score.js');

const FINAL_OBJECTIVES = ['G1', 'G2', 'K1', 'K2', 'K3', 'K4', 'K5', 'ZD1', 'ZD2', 'ND1', 'ND2'];

function baseAnswers(wrongIds = []) {
  const answers = {};
  for (const question of quiz.byTier('base')) {
    answers[question.id] = structuredClone(question.answer);
    if (wrongIds.includes(question.id)) {
      assert.equal(typeof question.answer, 'number');
      answers[question.id] = (question.answer + 1) % question.options.length;
    }
  }
  return answers;
}

test('v5.1a 题库按层读取，学生端看不到答案和教师字段', () => {
  assert.equal(quiz.version, '2026-10-17-branch-v5.1a');
  assert.equal(quiz.byTier('base').length, 11);
  assert.equal(quiz.byTier('challenge').length, 12);
  assert.equal(quiz.questions.length, 23);
  assert.equal(new Set(quiz.questions.map(question => question.id)).size, 23);
  const types = new Set(quiz.questions.map(question => question.type));
  for (const type of ['single_choice', 'matching', 'ordering', 'flowchart_fill', 'drag_op', 'blocks_assemble', 'python_fill']) assert.equal(types.has(type), true);
  const visible = quiz.publicQuestions(['base']);
  assert.equal(visible.length, 11);
  assert.equal(visible.some(question => question.tier === 'challenge'), false);
  for (const field of ['answer', 'explanation', 'grading', 'review', 'teacherNote', 'misconceptionIds', 'goalIds']) {
    assert.equal(field in visible[0], false);
  }
  assert.equal('note' in (visible.find(question => question.interaction)?.interaction || {}), false);
});

test('达标线、奖励线和目标最低线只读题库，老师确认的名单含 ZD1、ZD2', () => {
  assert.equal(quiz.passLine(), 8);
  assert.equal(quiz.rewardLine(), 8);
  assert.equal(quiz.challengeLine(), 8);
  assert.deepEqual(quiz.bank.tiers.base.objectiveMinimums, FINAL_OBJECTIVES);
  assert.deepEqual(quiz.objectiveCodes(), quiz.bank.tiers.base.objectiveMinimums);
  const copy = structuredClone(quiz.bank);
  copy.tiers.base.objectiveMinimums = ['G1'];
  assert.deepEqual(create(copy).objectiveCodes(), ['G1']);
});

test('7/11 不奖励；8/11 奖励但目标未过半时记为未达标', () => {
  const perfect = quiz.grade('base', baseAnswers());
  assert.equal(perfect.score, 11);
  assert.equal(quiz.basePassed(perfect), true);
  assert.equal(quiz.rewardUnlocked(perfect.score), true);
  assert.equal(perfect.objectives.every(item => item.met), true);

  const rewarded = quiz.grade('base', baseAnswers(['q35', 'q4', 'q19']));
  assert.equal(rewarded.score, 8);
  assert.equal(quiz.rewardUnlocked(rewarded.score), true);
  assert.equal(quiz.basePassed(rewarded), false);
  assert.equal(rewarded.objectives.find(item => item.code === 'K1').met, false);

  const short = quiz.grade('base', baseAnswers(['q35', 'q4', 'q19', 'q7']));
  assert.equal(short.score, 7);
  assert.equal(quiz.rewardUnlocked(short.score), false);
  assert.equal(quiz.basePassed(short), false);
});

test('每题计入哪些目标只看题目上的编号，改 q22 的映射会改变统计', () => {
  const copy = structuredClone(quiz.bank);
  const question = copy.questions.find(item => item.id === 'q22');
  const before = quiz.grade('base', baseAnswers());
  question.goalIds = ['G1'];
  question.keyIds = [];
  question.keyDifficultyIds = [];
  const after = create(copy).grade('base', baseAnswers());
  const total = (result, code) => result.objectives.find(item => item.code === code).total;
  assert.equal(total(after, 'G2'), total(before, 'G2') - 1);
  assert.equal(total(after, 'ZD2'), total(before, 'ZD2') - 1);
  assert.equal(total(after, 'G1'), total(before, 'G1') + 1);
});

test('流程图等价条件交换出口算对，只改符号不算对', () => {
  const question = quiz.questions.find(item => item.id === 'q22');
  assert.equal(quiz.isCorrect(question, question.answer), true);
  assert.equal(quiz.isCorrect(question, { s1: 2, s2: 4, s3: 3 }), true);
  assert.equal(quiz.isCorrect(question, { s1: 1, s2: 3, s3: 4 }), false);
});

test('挑战层分数线只读题库里的整数', () => {
  const answers = {};
  for (const question of quiz.byTier('challenge')) answers[question.id] = structuredClone(question.answer);
  const graded = quiz.grade('challenge', answers);
  assert.equal(graded.total, 12);
  assert.equal(graded.score, 12);
  assert.equal(quiz.challengeAwarded(graded.score), true);
  assert.equal(quiz.challengeAwarded(quiz.challengeLine() - 1), false);
});
