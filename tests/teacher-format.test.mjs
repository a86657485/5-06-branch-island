import test from 'node:test';
import assert from 'node:assert/strict';
import { attemptPercent, formatAnswer } from '../public/teacher-format.mjs';

test('11/11 显示为 100%，不再按每题 5 分', () => {
  assert.equal(attemptPercent({ score: 11, total: 11 }), 100);
  assert.equal(attemptPercent({ score: 8, total: 11 }), 73);
  assert.equal(attemptPercent({ score: 7, total: 11 }), 64);
  assert.equal(attemptPercent({ score: 11 }), null);
});

test('非选择题的参考答案不显示 undefined', () => {
  const text = formatAnswer({
    options: ['跳绳≥100', '跳绳＞100', '跳绳＜100', '得星', '没星', '输入次数'],
    answer: { s1: 0, s2: 3, s3: 4 }
  });
  assert.equal(text.includes('undefined'), false);
  assert.equal(text.includes('跳绳≥100'), true);
  assert.equal(text.includes('得星'), true);
  assert.equal(formatAnswer({ options: ['甲', '乙', '丙', '丁'], answer: 2 }), 'C：丙');
});
