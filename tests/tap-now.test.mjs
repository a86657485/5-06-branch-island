/**
 * 最后一下：红框 + 动画（2026-11-03）。
 *
 * 课堂观察：学生走到按钮前会停住问“点哪个”。红框必须只圈“完成当前步骤”的操作按钮，
 * 不能圈选项，否则等于替学生作答。轻量场景、完整场景和考核页三处都要有。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mountQuiz } from '../public/quiz-board.mjs';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');

test('轻量场景与考核页共用同一套红框样式', () => {
  const css = read('../public/style.css');
  assert.match(css, /\.tap-now\{[^}]*#e01b24/, '缺少红色实线框');
  assert.match(css, /\.tap-now::after\{[^}]*点这里/, '缺少“点这里”手指标签');
  assert.match(css, /@keyframes tap-now-ring/, '缺少脉动动画');
  assert.match(css, /\.tap-next\{[^}]*border:3px dashed #e01b24/, '缺项时应圈下一个要填的区块');
});

test('完整场景的模板与已打包页面都带红框样式，避免只改一端', () => {
  for (const file of ['../engine/index.html', '../public/rpgjs/index.html']) {
    const html = read(file);
    assert.ok(html.includes('lesson-tap-now'), `${file} 缺少红框样式块`);
    assert.match(html, /\.primary-next\{[^}]*#e01b24/, `${file} 的主按钮没有红框`);
  }
});

test('轻量场景每个对话都圈出“完成这一步”的按钮，缺项时圈区块', () => {
  const scene = read('../public/scene.mjs');
  for (const key of ['start', 'read', 'control', 'sign', 'leave', 'next']) {
    assert.ok(scene.includes(`markTap('${key}')`), `漏掉 ${key} 按钮的红框`);
  }
  assert.ok(scene.includes("markTap(readyToReport()?'review':'continue')"), '核验后没有圈“汇报/继续”');
  assert.ok(scene.includes('markNextBlock('), '四项没填完时没有圈下一个区块');
  assert.ok(scene.includes("s.ticket?'gotoverify':d().prediction?'gofan'"), '锁定设备时没有圈唯一下一步');
});

/** 最小 DOM 桩：只接住 mountQuiz 产出的 HTML。 */
function render(question, { answers = {}, tier = question.tier, focus = null } = {}) {
  let html = '';
  const node = {
    classList: { add() {} },
    set innerHTML(value) { html = value; },
    get innerHTML() { return html; },
    querySelectorAll() { return []; },
    querySelector() { return { onclick: null, disabled: false, scrollIntoView() {} }; }
  };
  mountQuiz(node, {
    questions: [question],
    tier,
    draft: { answers: { [question.id]: answers }, confirmed: {} },
    pending: false,
    focus: focus || undefined,
    onSave() {},
    onRender() {},
    onTier() {},
    onNotice() {}
  });
  return html;
}

const slotQuestion = {
  id: 'tap-slot',
  prompt: '把卡片放进空格',
  type: 'fill',
  tier: 'base',
  options: ['启动风机', '关闭风机'],
  interaction: { figure: { nodes: [{ id: 'n1', slot: 's1', shape: 'process' }], edges: [] } }
};

test('考核页填满空格后「确认本题」自动带红框', () => {
  const html = render(slotQuestion, { answers: { s1: 0 } });
  assert.match(html, /<button id="confirm-question" class="primary tap-now"/);
});

test('还没填满时不打扰，确认按钮不带红框', () => {
  const html = render(slotQuestion, { answers: {} });
  assert.match(html, /<button id="confirm-question" class="primary"/);
});

test('全部答完后「提交这一层」始终带红框，不靠闲置计时才亮', () => {
  const single = { id: 'tap-single', prompt: '选一个', type: 'single_choice', tier: 'base', options: ['会', '不会'] };
  const html = render(single, {
    answers: 0,
    focus: { id: 'quiz-submit-base', hint: '都答完了，点提交这一层。', strong: '点提交按钮。' }
  });
  assert.match(html, /<button id="submit-quiz" class="primary focus-target tap-now"/);
});
