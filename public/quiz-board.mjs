import { canLeave, chooseCard, chooseSingle, confirmCurrent, currentQuestion, dropCard, filled, goNext, goTo, groupsIntoTargets, placeCard, slotIds } from './quiz-flow.mjs';

export function quizSubmittedNotice(tier) {
  return tier === 'challenge' ? '检测已提交。看看自己的结果。' : '检测已提交。看看错题。';
}

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

const shapeRole = shape => (shape === 'diamond' ? '判断条件' : shape === 'io' ? '读入的数据' : shape === 'terminator' ? '' : '要做的事');

/** 把 interaction.figure 画成流程图：空位就地渲染成可点的槽；菱形的两个出口左右并排。 */
function figureMarkup(question, value, pending) {
  const figure = question.interaction?.figure;
  if (!figure || !Array.isArray(figure.nodes) || !figure.nodes.length) return '';
  const nodes = figure.nodes;
  const edges = Array.isArray(figure.edges) ? figure.edges : [];
  const byId = {};
  nodes.forEach(node => { byId[node.id] = node; });
  const outgoing = {};
  edges.forEach(edge => {
    if (!outgoing[edge.from]) outgoing[edge.from] = [];
    outgoing[edge.from].push(edge);
  });

  const nodeMarkup = node => {
    const shape = `qf-${esc(node.shape || 'process')}`;
    const role = shapeRole(node.shape);
    if (node.slot) {
      const picked = value?.[node.slot];
      const text = Number.isInteger(picked) ? optionLabel(question, picked) : '待填';
      return `<div class="qf-node ${shape}"><button type="button" data-slot="${esc(node.slot)}" class="quiz-slot qf-slot${Number.isInteger(picked) ? ' filled' : ''}" ${pending ? 'disabled' : ''}><b>${esc(text)}</b><small>${esc(role)}${Number.isInteger(picked) ? '' : ' · 点这里放入卡片'}</small></button></div>`;
    }
    return `<div class="qf-node ${shape}"><span class="qf-text">${esc(node.text || '')}</span>${role ? `<small class="qf-role">${esc(role)}</small>` : ''}</div>`;
  };

  const rendered = new Set();
  const rows = [];
  nodes.forEach(node => {
    if (rendered.has(node.id)) return;
    rendered.add(node.id);
    const outs = (outgoing[node.id] || []).filter(edge => byId[edge.to] && !rendered.has(edge.to));
    if (node.shape === 'diamond' && outs.length >= 2) {
      rows.push(`<li class="qf-row">${nodeMarkup(node)}</li>`);
      const columns = outs.slice(0, 2).map(edge => {
        rendered.add(edge.to);
        return `<div class="qf-col"><span class="qf-branch">${esc(edge.label || '')}</span>${nodeMarkup(byId[edge.to])}</div>`;
      }).join('');
      rows.push(`<li class="qf-row qf-branch-row">${columns}</li>`);
      return;
    }
    rows.push(`<li class="qf-row">${nodeMarkup(node)}</li>`);
  });

  return `<figure class="quiz-figure"><figcaption class="qf-title">补全这张图：图里的「待填」就是要放卡片的位置</figcaption><ol class="qf-list">${rows.join('')}</ol><p class="qf-legend">菱形＝判断条件（能回答“是/否”）｜方框＝要做的事｜是、否是两条不同的出口</p></figure>`;
}

/** 分组题：把每张卡分进一个筐，筐里回显已放的卡，点卡片上的 × 可以取回。 */
function groupingMarkup(question, value, pending) {
  const targets = question.interaction?.targets || [];
  if (!targets.length) return '';
  const assigned = value && typeof value === 'object' ? value : {};
  const buckets = {};
  targets.forEach(target => { buckets[target.id] = []; });
  Object.keys(assigned).forEach(card => {
    const bucket = assigned[card];
    if (buckets[bucket]) buckets[bucket].push(Number(card));
  });
  const blocks = targets.map(target => {
    const chips = (buckets[target.id] || []).map(card => `<button type="button" class="qf-chip" data-unassign="${card}" ${pending ? 'disabled' : ''} title="点一下取回">${esc(optionLabel(question, card))}<span aria-hidden="true">×</span></button>`).join('');
    return `<div class="qf-target" data-slot="${esc(target.id)}" role="button" tabindex="0" title="先点卡片，再点这里放入"><p class="qf-target-name">${esc(target.label || target.text || target.id)}</p><div class="qf-chips">${chips || '<span class="qf-empty">先点卡片，再点这个筐</span>'}</div></div>`;
  }).join('');
  return `<div class="qf-targets">${blocks}</div>`;
}

/** 句子补全题：把 frame 里的 {s1}/{s2} 就地渲染成可点的空格。 */
function frameMarkup(question, value, pending, skip) {
  const frame = question.interaction?.frame || question.interaction?.code || '';
  if (!/\{s\d+\}/.test(frame)) return '';
  const html = frame.split(/(\{s\d+\})/).map(part => {
    const hit = part.match(/^\{(s\d+)\}$/);
    if (!hit) return esc(part);
    const slot = hit[1];
    const picked = value?.[slot];
    const text = Number.isInteger(picked) ? optionLabel(question, picked) : '空';
    if (skip && skip.has(slot)) return `<span class="qf-inline-echo">${esc(text)}</span>`;
    return `<button type="button" data-slot="${esc(slot)}" class="qf-inline-slot${Number.isInteger(picked) ? ' filled' : ''}" ${pending ? 'disabled' : ''}>${esc(text)}</button>`;
  }).join('');
  return `<p class="qf-sentence">${html}</p>`;
}

function slotLabel(question, slot, value) {
  if (question.type === 'matching' || groupsIntoTargets(question)) {
    const target = (question.interaction?.targets || []).find(item => item.id === value);
    return target?.label || target?.text || value || '空';
  }
  return Number.isInteger(value) ? optionLabel(question, value) : '空';
}

export function mountQuiz(root, options) {
  root.classList.add('quiz-root');
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
  const grouping = question.type === 'matching' || groupsIntoTargets(question);
  const targets = question.interaction?.targets || [];
  const frame = question.interaction?.frame || question.interaction?.code || '';
  const figure = figureMarkup(question, value, pending);
  const figureSlots = new Set((question.interaction?.figure?.nodes || []).map(node => node.slot).filter(Boolean));
  const frameBlock = /\{s\d+\}/.test(frame) ? frameMarkup(question, value, pending, figureSlots) : '';
  const filledCount = slots.filter(slot => Number.isInteger(value?.[slot])).length;
  const groupedCount = grouping ? Object.keys(value || {}).length : 0;
  const done = filled(question, value);
  const progress = grouping
    ? `<p class="qf-progress${done ? '' : ' pending'}">已分 ${groupedCount} / ${question.options.length} 张${done ? '，可以点「确认本题」了' : '，每张卡都要分进一个筐'}</p>`
    : slots.length
      ? `<p class="qf-progress${done ? '' : ' pending'}">已填 ${filledCount} / ${slots.length} 个空${done ? '，可以点「确认本题」了' : '，填满后才能确认'}</p>`
      : '';
  const cards = question.options.map((text, index) => `<button type="button" data-card="${index}" class="quiz-card ${session.card === index ? 'chosen' : ''}" ${pending ? 'disabled' : 'draggable="true"'}>${esc(text)}</button>`).join('');
  const slotButtons = grouping
    ? targets.map(target => `<button type="button" data-slot="${esc(target.id)}" class="quiz-slot" ${pending ? 'disabled' : ''}>${esc(target.label || target.text || target.id)}</button>`).join('')
    : slots.map(slot => `<button type="button" data-slot="${esc(slot)}" class="quiz-slot" ${pending ? 'disabled' : ''}><b>${esc(slot)}</b><span>${esc(slotLabel(question, slot, question.type === 'ordering' ? value?.[Number(slot)] : value?.[slot]))}</span></button>`).join('');
  const answerArea = grouping
    ? `<p class="muted">① 先点一张卡片 ② 再点下面的分类筐；筐里的卡片点一下可以取回。</p><div class="quiz-cards">${cards}</div>${groupingMarkup(question, value, pending)}${progress}`
    : `<p class="muted">① 先点一张卡片 ② 再点标着「空」的位置。放满后点「确认本题」，才可以去下一题。</p>${figure}${frameBlock}<div class="quiz-cards">${cards}</div>${figureSlots.size || frameBlock ? '' : `<div class="quiz-slots">${slotButtons}</div>`}${progress}`;
  const single = question.type === 'single_choice'
    ? `${figure}<div class="answers">${question.options.map((text, index) => `<button type="button" data-single="${index}" class="answer ${value === index ? 'chosen' : ''}" ${pending ? 'disabled' : ''} aria-pressed="${value === index}"><span>${index + 1}</span>${esc(text)}</button>`).join('')}</div>`
    : `${answerArea}<div class="qf-actions"><button id="confirm-question" class="primary" ${pending || !done ? 'disabled' : ''}>确认本题</button></div>`;
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
  root.querySelectorAll('[data-card]').forEach(button => {
    button.onclick = () => { chooseCard(session, Number(button.dataset.card)); save(); options.onRender(); };
    button.ondragstart = event => { event.dataTransfer?.setData('text/plain', button.dataset.card); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'; };
  });
  root.querySelectorAll('[data-slot]').forEach(button => {
    button.onclick = () => {
      if (session.card == null) {
        options.onNotice('先点上面的卡片，再点图里的空格。');
        options.onRender();
        return;
      }
      placeCard(session, button.dataset.slot);
      save();
      options.onRender();
      const confirmNow = root.querySelector('#confirm-question');
      if (confirmNow && !confirmNow.disabled) confirmNow.scrollIntoView({ block: 'nearest' });
    };
    button.ondragover = event => event.preventDefault();
    button.ondrop = event => {
      event.preventDefault();
      const card = event.dataTransfer?.getData('text/plain');
      if (card == null || card === '') return;
      dropCard(session, card, button.dataset.slot);
      save();
      options.onRender();
    };
  });
  const confirm = root.querySelector('#confirm-question');
  if (confirm) confirm.onclick = () => { confirmCurrent(session); save(); options.onRender(); };
  root.querySelectorAll('[data-unassign]').forEach(button => {
    button.onclick = event => {
      event.stopPropagation();
      const answers = { ...(session.answers[question.id] || {}) };
      delete answers[button.dataset.unassign];
      session.answers[question.id] = answers;
      delete session.confirmed[question.id];
      save();
      options.onRender();
    };
  });
  root.querySelector('#previous').onclick = () => { if (session.index > 0) goTo(session, session.index - 1); save(); options.onRender(); };
  root.querySelector('#next-question').onclick = () => { goNext(session); save(); options.onRender(); };
  root.querySelector('#submit-quiz').onclick = () => {
    const missing = questions.flatMap((item, index) => (item.type === 'single_choice' ? Number.isInteger(session.answers[item.id]) : session.confirmed[item.id] && filled(item, session.answers[item.id])) ? [] : [index + 1]);
    if (missing.length) { options.onNotice(`还有 ${missing.join('、')} 题没有确认。`); return; }
    options.onSubmit(options.tier, session.answers);
  };
}
