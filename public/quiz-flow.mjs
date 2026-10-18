/** 考核作答推进：填槽和点选都不改题号，只有学生明确点「下一题」或「确认本题」之后的下一题才前进。 */

export function emptySession(questions) {
  return { index: 0, answers: {}, confirmed: {}, card: null, questions };
}

export function currentQuestion(session) {
  return session.questions[session.index] || null;
}

export function slotIds(question) {
  if (!question || question.type === 'single_choice') return [];
  const interaction = question.interaction || {};
  const named = [...`${interaction.frame || ''} ${interaction.code || ''}`.matchAll(/\{(s\d+)\}/g)].map(match => match[1]);
  const figure = (interaction.figure?.nodes || []).map(node => node.slot).filter(Boolean);
  const unique = [...new Set([...named, ...figure])];
  if (unique.length) return unique;
  if (question.type === 'ordering' || question.type === 'matching') return question.options.map((_, index) => String(index));
  return [];
}

export function slotsOf(question) { return slotIds(question); }

export function groupsIntoTargets(question) {
  const targets = question?.interaction?.targets || [];
  return !!question && question.type !== 'single_choice' && question.type !== 'ordering' && question.type !== 'matching' && targets.length > 0 && slotIds(question).length === 0;
}

export function filled(question, value) {
  if (!question || value == null) return false;
  if (question.type === 'single_choice') return Number.isInteger(value) && value >= 0 && value < question.options.length;
  if (question.type === 'ordering') return Array.isArray(value) && value.length === question.options.length && value.every(item => Number.isInteger(item) && item >= 0 && item < question.options.length);
  if (question.type === 'matching' || groupsIntoTargets(question)) {
    const targets = new Set((question.interaction?.targets || []).map(target => target.id));
    const keys = question.type === 'matching' ? slotIds(question) : question.options.map((_, index) => String(index));
    return keys.every(slot => targets.has(value?.[slot]));
  }
  return slotIds(question).every(slot => Number.isInteger(value?.[slot]) && value[slot] >= 0 && value[slot] < question.options.length);
}

export function chooseCard(session, cardIndex) {
  session.card = cardIndex;
  return session.index;
}

export function dropCard(session, cardIndex, slotId) {
  const index = Number(cardIndex);
  if (!Number.isInteger(index)) return session.index;
  chooseCard(session, index);
  return placeCard(session, slotId);
}

export function placeCard(session, slotId) {
  const question = currentQuestion(session);
  if (!question || question.type === 'single_choice' || session.card == null) return session.index;
  if (question.type === 'ordering') {
    const next = Array.isArray(session.answers[question.id]) ? session.answers[question.id].slice() : Array(question.options.length).fill(null);
    next[Number(slotId)] = session.card;
    session.answers[question.id] = next;
  } else if (question.type === 'matching' || groupsIntoTargets(question)) {
    const next = { ...(session.answers[question.id] || {}) };
    next[String(session.card)] = slotId;
    session.answers[question.id] = next;
  } else {
    const next = { ...(session.answers[question.id] || {}) };
    next[slotId] = session.card;
    session.answers[question.id] = next;
  }
  session.card = null;
  delete session.confirmed[question.id];
  return session.index;
}

export function chooseSingle(session, optionIndex) {
  const question = currentQuestion(session);
  if (!question || question.type !== 'single_choice') return session.index;
  session.answers[question.id] = optionIndex;
  session.confirmed[question.id] = true;
  return session.index;
}

export function confirmCurrent(session) {
  const question = currentQuestion(session);
  if (!question || question.type === 'single_choice') return session.index;
  if (!filled(question, session.answers[question.id])) return session.index;
  session.confirmed[question.id] = true;
  return session.index;
}

export function canLeave(session) {
  const question = currentQuestion(session);
  if (!question) return false;
  if (question.type === 'single_choice') return Number.isInteger(session.answers[question.id]);
  return !!session.confirmed[question.id] && filled(question, session.answers[question.id]);
}

export function goTo(session, index) {
  if (!Number.isInteger(index) || index < 0 || index >= session.questions.length) return session.index;
  if (index === session.index) return session.index;
  session.index = index;
  session.card = null;
  return session.index;
}

export function goNext(session) {
  if (!canLeave(session)) return session.index;
  if (session.index >= session.questions.length - 1) return session.index;
  return goTo(session, session.index + 1);
}
