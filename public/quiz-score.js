(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QuizScore = api;
}(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const OPS = [
    ['<=', (a, b) => a <= b],
    ['>=', (a, b) => a >= b],
    ['≤', (a, b) => a <= b],
    ['≥', (a, b) => a >= b],
    ['＜', (a, b) => a < b],
    ['＞', (a, b) => a > b],
    ['<', (a, b) => a < b],
    ['>', (a, b) => a > b]
  ];

  function create(bank) {
    if (!bank || !Array.isArray(bank.questions) || typeof bank.version !== 'string') throw new Error('题库格式不正确');
    const questions = bank.questions.filter(question => question && question.id && question.tier && question.type);
    if (!questions.length) throw new Error('题库没有可作答的题目');
    const clientFields = Array.isArray(bank.clientFieldsBeforeSubmit) && bank.clientFieldsBeforeSubmit.length
      ? bank.clientFieldsBeforeSubmit
      : ['id', 'goal', 'prompt', 'options', 'tier', 'type', 'interaction'];
    function objectiveCodes() {
      const list = bank.tiers?.base?.objectiveMinimums;
      if (!Array.isArray(list) || !list.length || list.some(code => typeof code !== 'string' || !/^[A-Z]+\d+$/.test(code))) {
        throw new Error('题库 tiers.base.objectiveMinimums 没有写成目标编号列表');
      }
      return list.slice();
    }

    function byTier(tier) { return questions.filter(question => question.tier === tier); }
    function publicQuestion(question) {
      const copy = {};
      for (const field of clientFields) if (Object.hasOwn(question, field)) copy[field] = question[field];
      if (copy.interaction && typeof copy.interaction === 'object') {
        const interaction = { ...copy.interaction };
        delete interaction.note;
        copy.interaction = interaction;
      }
      return copy;
    }
    function publicQuestions(tiers) {
      const allowed = new Set(tiers);
      return questions.filter(question => allowed.has(question.tier)).map(publicQuestion);
    }
    function objectiveIds(question) {
      return [...new Set([...(question.goalIds || []), ...(question.keyIds || []), ...(question.keyDifficultyIds || [])])];
    }
    function grade(tier, answers) {
      const list = byTier(tier);
      const details = list.map(question => ({
        id: question.id,
        answered: isFilled(question, answers?.[question.id]),
        correct: isCorrect(question, answers?.[question.id])
      }));
      const objectives = objectiveCodes().map(code => {
        const related = list.filter(question => objectiveIds(question).includes(code));
        const correct = related.filter(question => details.find(detail => detail.id === question.id)?.correct).length;
        const need = related.length ? Math.ceil(related.length / 2) : 0;
        return { code, total: related.length, correct, need, met: !related.length || correct >= need };
      }).filter(item => item.total);
      return { score: details.filter(detail => detail.correct).length, total: list.length, details, objectives };
    }
    function threshold(tier, field) {
      const value = bank.tiers?.[tier]?.[field];
      if (!Number.isInteger(value)) throw new Error(`题库 ${tier}.${field} 没有写成整数`);
      return value;
    }
    function basePassed(result) {
      return result.score >= threshold('base', 'passLine') && result.objectives.every(item => item.met);
    }
    function rewardUnlocked(score) {
      return Number.isInteger(score) && score >= threshold('base', 'rewardLine');
    }
    function challengeAwarded(score) {
      return Number.isInteger(score) && score >= threshold('challenge', 'passLine');
    }
    function challengeLine() { return threshold('challenge', 'passLine'); }
    function passLine() { return threshold('base', 'passLine'); }
    function rewardLine() { return threshold('base', 'rewardLine'); }
    function basePoints() { return Number(bank.tiers?.base?.points) || 0; }
    function challengePoints() { return Number(bank.tiers?.challenge?.points) || 0; }
    function isCorrect(question, value) {
      if (!isFilled(question, value)) return false;
      if (question.grading?.mode === 'semantic') return semanticCorrect(question, value);
      return exactCorrect(question, value);
    }

    return {
      bank, questions, version: bank.version, byTier, publicQuestion, publicQuestions, grade, basePassed,
      rewardUnlocked, challengeAwarded, challengeLine, passLine, rewardLine, basePoints, challengePoints, isFilled, isCorrect, valueAllowed, objectiveCodes, threshold
    };
  }

  function isFilled(question, value) {
    const answer = question.answer;
    if (typeof answer === 'number') return Number.isInteger(value) && value >= 0 && value < question.options.length;
    if (Array.isArray(answer)) return Array.isArray(value) && value.length === answer.length && value.every(item => Number.isInteger(item) && item >= 0 && item < question.options.length);
    if (!answer || typeof answer !== 'object' || !value || typeof value !== 'object' || Array.isArray(value)) return false;
    const targets = (question.interaction?.targets || []).map(target => target.id);
    return Object.keys(answer).every(key => {
      const expected = answer[key];
      const got = value[key];
      if (typeof expected === 'number') return Number.isInteger(got) && got >= 0 && got < question.options.length;
      return typeof expected === 'string' && targets.includes(got);
    });
  }

  function valueAllowed(question, value) {
    if (value == null) return true;
    const answer = question.answer;
    if (typeof answer === 'number') return Number.isInteger(value) && value >= 0 && value < question.options.length;
    if (Array.isArray(answer)) return Array.isArray(value) && value.length === answer.length && value.every(item => item == null || (Number.isInteger(item) && item >= 0 && item < question.options.length));
    if (!answer || typeof answer !== 'object' || Array.isArray(answer) || typeof value !== 'object' || Array.isArray(value)) return false;
    const targets = (question.interaction?.targets || []).map(target => target.id);
    return Object.entries(value).every(([key, got]) => {
      if (!Object.hasOwn(answer, key)) return false;
      if (got == null || got === '') return true;
      if (typeof answer[key] === 'number') return Number.isInteger(got) && got >= 0 && got < question.options.length;
      return typeof got === 'string' && targets.includes(got);
    });
  }

  function exactCorrect(question, value) {
    const answer = question.answer;
    if (typeof answer === 'number') return value === answer;
    if (Array.isArray(answer)) return value.length === answer.length && value.every((item, index) => item === answer[index]);
    const keys = Object.keys(answer);
    return keys.length === Object.keys(value).length && keys.every(key => value[key] === answer[key]);
  }

  function semanticCorrect(question, value) {
    const inputs = testRange(question.grading?.test);
    if (!inputs) return exactCorrect(question, value);
    if (question.interaction?.code) return pythonMatch(question, value, inputs);
    const roles = frameRoles(question.interaction?.frame);
    if (roles) return frameMatch(question, value, roles, inputs);
    if (question.interaction?.figure) return figureMatch(question, value, inputs);
    return exactCorrect(question, value);
  }

  function testRange(text) {
    const match = String(text || '').match(/(\d+)\s*[—\-–~]\s*(\d+)/);
    if (!match) return null;
    const start = Number(match[1]);
    const end = Number(match[2]);
    const values = [];
    for (let n = Math.min(start, end); n <= Math.max(start, end); n += 1) values.push(n);
    return values.length && values.length <= 25000 ? values : null;
  }

  function parseCondition(text) {
    const raw = String(text || '').replace(/\s/g, '');
    for (const [symbol, compare] of OPS) {
      const at = raw.indexOf(symbol);
      if (at < 0) continue;
      const number = raw.slice(at + symbol.length).match(/^(\d+(?:\.\d+)?)/);
      if (!number) continue;
      return value => compare(value, Number(number[1]));
    }
    return null;
  }

  function optionText(question, index) {
    return Number.isInteger(index) ? question.options[index] : undefined;
  }

  function figureMatch(question, value, inputs) {
    const student = figureOutputs(question, value, inputs);
    const reference = figureOutputs(question, question.answer, inputs);
    return !!student && !!reference && student.every((item, index) => item === reference[index]);
  }

  function figureOutputs(question, slots, inputs) {
    const figure = question.interaction.figure;
    const nodes = Object.fromEntries((figure.nodes || []).map(node => [node.id, node]));
    const diamond = (figure.nodes || []).find(node => node.shape === 'diamond');
    if (!diamond) return null;
    const conditionText = nodeText(question, slots, diamond);
    const condition = parseCondition(conditionText);
    if (!condition) return null;
    const yes = (figure.edges || []).find(edge => edge.from === diamond.id && edge.label === '是');
    const no = (figure.edges || []).find(edge => edge.from === diamond.id && edge.label === '否');
    if (!yes || !no || !nodes[yes.to] || !nodes[no.to]) return null;
    const yesText = nodeText(question, slots, nodes[yes.to]);
    const noText = nodeText(question, slots, nodes[no.to]);
    if (yesText == null || noText == null) return null;
    return inputs.map(input => condition(input) ? yesText : noText);
  }

  function nodeText(question, slots, node) {
    if (!node.slot) return node.text || '';
    return optionText(question, slots?.[node.slot]);
  }

  function frameRoles(frame) {
    if (!frame) return null;
    const condition = frame.match(/[〈<]\s*\{(s\d+)\}\s*[〉>]/);
    const yes = frame.match(/那么\s*\{(s\d+)\}/) || frame.match(/[〉>]\s*\{(s\d+)\}/);
    const no = frame.match(/否则\s*\{(s\d+)\}/);
    if (!condition || !yes || !no) return null;
    return { condition: condition[1], yes: yes[1], no: no[1] };
  }

  function frameMatch(question, value, roles, inputs) {
    const student = frameOutputs(question, value, roles, inputs);
    const reference = frameOutputs(question, question.answer, roles, inputs);
    return !!student && !!reference && student.every((item, index) => item === reference[index]);
  }

  function frameOutputs(question, slots, roles, inputs) {
    const condition = parseCondition(optionText(question, slots?.[roles.condition]));
    const yes = optionText(question, slots?.[roles.yes]);
    const no = optionText(question, slots?.[roles.no]);
    if (!condition || yes == null || no == null) return null;
    return inputs.map(input => condition(input) ? yes : no);
  }

  function pythonMatch(question, value, inputs) {
    const student = pythonOutputs(question, value, inputs);
    const reference = pythonOutputs(question, question.answer, inputs);
    return !!student && !!reference && student.every((item, index) => item === reference[index]);
  }

  function pythonOutputs(question, slots, inputs) {
    const code = question.interaction.code || '';
    const prints = [...code.matchAll(/print\(([ab])\)/g)].map(match => match[1]);
    if (prints.length < 2) return null;
    const operator = optionText(question, slots?.s1);
    const punctuation = optionText(question, slots?.s2);
    const compare = OPS.find(item => item[0] === operator);
    if (!compare || punctuation !== ':') return null;
    const pairs = [];
    const unequal = /≠|!=|不相等/.test(question.grading?.test || '');
    for (const left of inputs) for (const right of inputs) {
      if (unequal && left === right) continue;
      const picked = compare[1](left, right) ? prints[0] : prints[1];
      pairs.push(picked === 'a' ? left : right);
    }
    return pairs;
  }

  return { create };
}));
