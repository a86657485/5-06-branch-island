import { canLeave, chooseCard, chooseSingle, confirmCurrent, currentQuestion, filled, goNext, goTo, placeCard, slotIds } from './quiz-flow.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function sessionFrom(draft, questions) {
  return {
    index: Number.isInteger(draft.index) ? draft.index : 0,
    answers: draft.answers && typeof draft.answers === 'object' && !Array.isArray(draft.answers) ? draft.answers : {},
    confirmed: draft.confirmed && typeof draft.confirmed === 'object' ? draft.confirmed : {},
    card: Number.isInteger(draft.card) ? draft.card : null,
    questions
  };
}

function persist(draft, session) {
  draft.answers = session.answers;
  draft.confirmed = session.confirmed;
  draft.index = session.index;
  draft.card = session.card;
}

function optionLabel(question, index) {
  return question.options[index] ?? '';
}

function slotLabel(question, slot, value) {
  if (question.type === 'matching') {
    const target = (question.interaction?.targets || []).find(item => item.id === value);
    return target?.label || target?.text || value || '空';
  }
  return Number.isInteger(value) ? optionLabel(question, value) : '空';
}

export function mountQuiz(root, options) {
  const questions = options.questions.filter(question => question.tier === options.tier);
  const draft = options.draft;
  const session = sessionFrom(draft, questions);
  if (session.index >= questions.length) session.index = 0;
  const question = currentQuestion(session);
  const pending = options.pending;
  const answered = questions.filter(item => item.type === 'single_choice' ? Number.isInteger(session.answers[item.id]) : session.confirmed[item.id] && filled(item, session.answers[item.id])).length;
  if (!question) {
    root.innerHTML = `<h1>这一层还没有题目</h1>`;
    return;
  }
  const slots = slotIds(question);
  const value = session.answers[question.id];
  const targets = question.interaction?.targets || [];
  const frame = question.interaction?.frame || question.interaction?.code || '';
  const cards = question.options.map((text, index) => `<button type="button" data-card="${index}" class="quiz-card ${session.card === index ? 'chosen' : ''}" ${pending ? 'disabled' : ''}>${esc(text)}</button>`).join('');
  const slotButtons = question.type === 'matching'
    ? targets.map(target => `<button type="button" data-slot="${esc(target.id)}" class="quiz-slot" ${pending ? 'disabled' : ''}>${esc(target.label || target.text || target.id)}</button>`).join('')
    : slots.map(slot => `<button type="button" data-slot="${esc(slot)}" class="quiz-slot" ${pending ? 'disabled' : ''}><b>${esc(slot)}</b><span>${esc(slotLabel(question, slot, question.type === 'ordering' ? value?.[Number(slot)] : value?.[slot]))}</span></button>`).join('');
  const single = question.type === 'single_choice'
    ? `<div class="answers">${question.options.map((text, index) => `<button type="button" data-single="${index}" class="answer ${value === index ? 'chosen' : ''}" ${pending ? 'disabled' : ''} aria-pressed="${value === index}"><span>${index + 1}</span>${esc(text)}</button>`).join('')}</div>`
    : `<p class="muted">先点一张卡片，再点要放进去的位置。放满后点「确认本题」，才可以去下一题。</p>${frame ? `<p class="quiz-frame">${esc(frame)}</p>` : ''}<div class="quiz-cards">${cards}</div><div class="quiz-slots">${slotButtons}</div><button id="confirm-question" class="primary" ${pending || !filled(question, value) ? 'disabled' : ''}>确认本题</button>`;
  const review = options.review;
  const focus = options.focus || { id: 'quiz-card-current', hint: '读题作答。整道题一起看，不标选项。', strong: '先点卡片区，再点空格。' };
  const strength = options.focusStrength || 0;
  const submitId = options.tier === 'challenge' ? 'quiz-submit-challenge' : 'quiz-submit-base';
  const focusClass = id => focus.id === id ? ` focus-target${strength >= 2 ? ' tap-hand' : ''}` : '';
  const focusAttr = id => focus.id === id ? ` data-focus="${id}" data-strength="${strength}"` : '';
  root.innerHTML = `${review || ''}<p id="quiz-focus-hint" class="focus-hint" role="status">${esc(strength ? focus.strong : focus.hint)}</p><div class="task-heading"><div><p class="eyebrow">${options.tier === 'challenge' ? '挑战层' : '基础层'} · 提交前不显示正误</p><h1>${esc(question.prompt)}</h1></div></div><p class="muted">已完成 ${answered}/${questions.length}。点选和拖放都不会自动跳题。</p><div class="tier-switch"><button type="button" data-tier="base" class="${options.tier === 'base' ? 'primary' : 'quiet'}">基础层</button>${options.challengeUnlocked ? `<button type="button" data-tier="challenge" class="${options.tier === 'challenge' ? 'primary' : 'quiet'}${focusClass('quiz-challenge-entry')}"${focusAttr('quiz-challenge-entry')}>挑战层</button>` : '<span class="muted">挑战层在基础层提交后出现</span>'}</div><div class="question-nav">${questions.map((item, index) => `<button type="button" data-question="${index}" class="${index === session.index ? 'current' : ''} ${item.type === 'single_choice' ? (Number.isInteger(session.answers[item.id]) ? 'answered' : '') : (session.confirmed[item.id] ? 'answered' : '')}">${index + 1}</button>`).join('')}</div><article class="question${focusClass('quiz-card-current')}"${focusAttr('quiz-card-current')}>${single}</article><div class="quiz-actions"><button id="previous" class="quiet" ${session.index === 0 || pending ? 'disabled' : ''}>上一题</button><button id="next-question" class="primary" ${pending || !canLeave(session) ? 'disabled' : ''}>下一题</button><button id="submit-quiz" class="${`primary${focusClass(submitId)}`}"${focusAttr(submitId)} ${pending ? 'disabled' : ''}>${pending ? '正在提交' : '提交这一层'}</button></div><div id="notice" class="notice" ${options.notice ? '' : 'hidden'} role="status">${esc(options.notice)}</div>${options.rewardUnlocked ? `<p class="award"><a href="/reward/index.html">打开奖励小游戏</a></p>` : ''}`;
  const save = () => { persist(draft, session); options.onSave(); };
  root.querySelectorAll('[data-tier]').forEach(button => { button.onclick = () => options.onTier(button.dataset.tier); });
  root.querySelectorAll('[data-question]').forEach(button => { button.onclick = () => { goTo(session, Number(button.dataset.question)); save(); options.onRender(); }; });
  root.querySelectorAll('[data-single]').forEach(button => { button.onclick = () => { chooseSingle(session, Number(button.dataset.single)); save(); options.onRender(); }; });
  root.querySelectorAll('[data-card]').forEach(button => { button.onclick = () => { chooseCard(session, Number(button.dataset.card)); save(); options.onRender(); }; });
  root.querySelectorAll('[data-slot]').forEach(button => { button.onclick = () => { placeCard(session, button.dataset.slot); save(); options.onRender(); }; });
  const confirm = root.querySelector('#confirm-question');
  if (confirm) confirm.onclick = () => { confirmCurrent(session); save(); options.onRender(); };
  root.querySelector('#previous').onclick = () => { if (session.index > 0) goTo(session, session.index - 1); save(); options.onRender(); };
  root.querySelector('#next-question').onclick = () => { goNext(session); save(); options.onRender(); };
  root.querySelector('#submit-quiz').onclick = () => {
    const missing = questions.flatMap((item, index) => (item.type === 'single_choice' ? Number.isInteger(session.answers[item.id]) : session.confirmed[item.id] && filled(item, session.answers[item.id])) ? [] : [index + 1]);
    if (missing.length) { options.onNotice(`还有 ${missing.join('、')} 题没有确认。`); return; }
    options.onSubmit(options.tier, session.answers);
  };
}
