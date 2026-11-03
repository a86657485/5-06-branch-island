/**
 * 基础层逐题判定（2026-11-03）。
 *
 * 老师要求：每一题选完就判对错、给解析；最后提交判达标；不达标重答。
 * 这里守住两件事：反馈文案把标准答案翻成学生看得懂的话；判过的题锁住，不能靠反复点选项刷分。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { answerSummary, feedbackMarkup, mountQuiz } from '../public/quiz-board.mjs';

const single = {
  id: 'q-demo', type: 'single_choice', tier: 'base', prompt: '哪张卡不能放进菱形？',
  options: ['灯亮着', '温度＞30', '今天是周末', '打开风扇'], answer: 3,
  explanation: '菱形里放能回答“是/否”的条件；“打开风扇”是动作。',
  review: '读每张卡：能回答“是/否”吗？'
};

const fill = {
  id: 'q-fill', type: 'drag_op', tier: 'base', prompt: '把卡片放进空格',
  options: ['启动风机', '关闭风机'], answer: { s1: 1 },
  explanation: '条件不成立走“否”出口。', review: '先看条件再选出口。',
  interaction: { figure: { nodes: [{ id: 'n1', slot: 's1', shape: 'process' }], edges: [] } }
};

test('标准答案翻成学生话：单选给选项，填空给槽位与卡片', () => {
  assert.equal(answerSummary(single, 3), '打开风扇');
  assert.equal(answerSummary(fill, { s1: 1 }), 's1：关闭风机');
});

test('答错给正确答案、解析和回看', () => {
  const html = feedbackMarkup(single, { correct: false, answer: 3, explanation: single.explanation, review: single.review });
  assert.match(html, /❌ 答错了/);
  assert.match(html, /正确答案：<b>打开风扇<\/b>/);
  assert.match(html, /解析：菱形里放能回答/);
  assert.match(html, /回看：读每张卡/);
  assert.match(html, /is-wrong/);
});

test('答对不重复公布答案，但仍给解析', () => {
  const html = feedbackMarkup(single, { correct: true, answer: 3, explanation: single.explanation, review: single.review });
  assert.match(html, /✅ 答对了/);
  assert.equal(html.includes('正确答案'), false);
  assert.match(html, /解析：/);
});

/** 最小 DOM 桩，接住 mountQuiz 的 HTML。 */
function render(question, { answers = {}, graded = {} } = {}) {
  let html = '';
  const node = {
    classList: { add() {} },
    set innerHTML(value) { html = value; },
    get innerHTML() { return html; },
    querySelectorAll() { return []; },
    querySelector() { return { onclick: null, disabled: false, scrollIntoView() {} }; }
  };
  mountQuiz(node, {
    questions: [question], tier: 'base', pending: false,
    draft: { answers: { [question.id]: answers }, confirmed: {}, graded: Object.keys(graded).length ? { [question.id]: graded } : {} },
    focus: { id: 'quiz-card-current', hint: '', strong: '' },
    onSave() {}, onRender() {}, onTier() {}, onNotice() {}, onCheck() { return null; }
  });
  return html;
}

test('判过的单选题锁住选项，并显示反馈', () => {
  const html = render(single, { answers: 1, graded: { correct: false, answer: 3, explanation: single.explanation } });
  assert.match(html, /❌ 答错了/);
  assert.match(html, /data-single="1"[^>]*disabled/);
  assert.match(html, /data-single="3"[^>]*is-correct/);
  assert.match(html, /data-single="1"[^>]*is-wrong/);
});

test('还没判的题可以继续作答，不提前显示对错', () => {
  const html = render(single, { answers: 1 });
  assert.equal(html.includes('答对了'), false);
  assert.equal(html.includes('答错了'), false);
});
