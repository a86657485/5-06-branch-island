/**
 * 门禁与渲染同源（编程红线第 2 条）。
 *
 * 2026-10-29 事故：q22 的 interaction.figure 有数据但没有渲染器，
 * 学生只看到 s1/s2/s3 三个孤立按钮，永远填不满，确认按钮恒 disabled。
 *
 * 本文件对题库里每一道题做静态渲染，断言：
 *   1. 门禁要求的每一个槽位，渲染结果里都存在可点元素；
 *   2. 非选择题必须渲染出「确认本题」；
 *   3. 有 figure 的题必须画出图，有 frame 的题必须就地开槽；
 *   4. 把答案填满后，「确认本题」不再 disabled —— 直接防死锁。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mountQuiz } from '../public/quiz-board.mjs';
import { filled, groupsIntoTargets, slotIds } from '../public/quiz-flow.mjs';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bank = JSON.parse(fs.readFileSync(path.join(projectRoot, 'data', '03_questions.json'), 'utf8'));
const questions = Array.isArray(bank) ? bank : bank.questions;

/** 用最小 DOM 桩接住 mountQuiz 产出的字符串，不对真实浏览器做依赖。 */
function render(question, answers = {}) {
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
    tier: question.tier,
    draft: { answers: answers == null ? {} : { [question.id]: answers }, confirmed: {} },
    pending: false,
    onSave() {},
    onRender() {},
    onTier() {},
    onNotice() {}
  });
  return html;
}

const slotAttrs = html => new Set([...html.matchAll(/data-slot="([^"]+)"/g)].map(match => match[1]));
const confirmTag = html => (html.match(/<button id="confirm-question"[^>]*>/) || [])[0] || '';

/** 造一份「全填满」的答案，用来验证确认按钮会解锁。 */
function filledAnswers(question) {
  if (question.type === 'single_choice') return 0;
  if (question.type === 'ordering') return question.options.map((_, index) => index);
  const targets = question.interaction?.targets || [];
  if (question.type === 'matching' || groupsIntoTargets(question)) {
    const keys = question.type === 'matching' ? slotIds(question) : question.options.map((_, index) => String(index));
    return Object.fromEntries(keys.map(key => [key, targets[0].id]));
  }
  return Object.fromEntries(slotIds(question).map(slot => [slot, 0]));
}

test('题库每道题都能被门禁填满：渲染出的槽位覆盖门禁要求的槽位', () => {
  assert.equal(questions.length, 23, '题库题数变了，请先复核下面逐题的结论');
  const problems = [];
  for (const question of questions) {
    const html = render(question);
    if (question.type === 'single_choice') {
      const singles = [...html.matchAll(/data-single="/g)].length;
      if (singles !== question.options.length) problems.push(`${question.id} 选项渲染 ${singles}/${question.options.length}`);
      continue;
    }
    const rendered = slotAttrs(html);
    const required = question.type === 'matching' || groupsIntoTargets(question)
      ? (question.interaction?.targets || []).map(target => target.id)
      : slotIds(question);
    const missing = required.filter(slot => !rendered.has(slot));
    if (missing.length) problems.push(`${question.id}（${question.type}）缺可点槽位 ${missing.join(',')}`);
    if (!confirmTag(html)) problems.push(`${question.id} 没有「确认本题」`);
  }
  assert.deepEqual(problems, [], `以下题目渲染不出可填位置，学生会被卡死：\n${problems.join('\n')}`);
});

test('有 figure 的题必须画出图，有 frame 的题必须就地开槽', () => {
  const problems = [];
  for (const question of questions) {
    const html = render(question);
    const figure = question.interaction?.figure;
    if (figure && Array.isArray(figure.nodes) && figure.nodes.length) {
      if (!/class="quiz-figure"/.test(html)) problems.push(`${question.id} 有 figure 数据但没画出图`);
      const slots = figure.nodes.map(node => node.slot).filter(Boolean);
      if (question.type === 'single_choice' && slots.length) {
        problems.push(`${question.id} 是选择题，图里不该有要填的空（${slots.join(',')}）`);
      }
    }
    const frame = question.interaction?.frame || question.interaction?.code || '';
    const frameSlots = [...new Set([...frame.matchAll(/\{(s\d+)\}/g)].map(match => match[1]))];
    if (frameSlots.length) {
      const inline = (html.match(/class="qf-inline-slot|class="qf-inline-echo/g) || []).length;
      if (inline !== frameSlots.length) problems.push(`${question.id} 句子有 ${frameSlots.length} 个空，只渲染了 ${inline} 个`);
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('答案填满后「确认本题」必须解锁（防死锁）', () => {
  const problems = [];
  for (const question of questions) {
    if (question.type === 'single_choice') continue;
    const answers = filledAnswers(question);
    assert.equal(filled(question, answers), true, `${question.id} 的满答案构造有误，先修测试`);
    const tag = confirmTag(render(question, answers));
    if (!tag) problems.push(`${question.id} 填满后找不到确认按钮`);
    else if (/disabled/.test(tag)) problems.push(`${question.id} 填满后确认按钮仍是 disabled`);
  }
  assert.deepEqual(problems, [], `以下题目填满也无法提交：\n${problems.join('\n')}`);
});

test('空白作答时「确认本题」必须保持禁用（防误放行）', () => {
  const problems = [];
  for (const question of questions) {
    if (question.type === 'single_choice') continue;
    const tag = confirmTag(render(question));
    if (!tag) continue;
    if (!/disabled/.test(tag)) problems.push(`${question.id} 一个字没填就能确认`);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('分组题的每个筐都能接收卡片，且能取回', () => {
  const problems = [];
  for (const question of questions) {
    if (question.type !== 'matching' && !groupsIntoTargets(question)) continue;
    const targets = (question.interaction?.targets || []).map(target => target.id);
    const html = render(question);
    for (const id of targets) {
      if (!html.includes(`data-slot="${id}"`)) problems.push(`${question.id} 的筐 ${id} 不可点`);
    }
    const assigned = filledAnswers(question);
    const filledHtml = render(question, assigned);
    const chips = (filledHtml.match(/data-unassign="/g) || []).length;
    if (chips !== question.options.length) problems.push(`${question.id} 分完后只能取回 ${chips}/${question.options.length} 张`);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});
