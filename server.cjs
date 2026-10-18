'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isIP } = require('node:net');
const { DatabaseSync } = require('node:sqlite');
const rules = require('./public/rules.js');
const adventure = require('./public/adventure-rules.js');
const quizApi = require('./quiz.cjs');
const { questions, version:quizVersion } = quizApi;
const BASE = __dirname;
const CLASSES = ['501', '502', '503', '504'];
const ROUND = 1;
const APP_ID = 'branch-island-5-06';
function fail(status, message, code) { throw Object.assign(new Error(message), { status, code }); }
function checkedRule(action) { try { return action(); } catch (error) { fail(400,error.message); } }
function isPrivateAddress(address) {
  if (!address) return false;
  const ip = address.replace(/^::ffff:/i, '').split('%')[0].toLowerCase();
  if (!isIP(ip)) return false;
  if (ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')) return true;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
  const parts = ip.split('.').map(Number);
  if (parts.some(part => part > 255)) return false;
  return parts[0] === 127 || parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 169 && parts[1] === 254);
}
function initialState() {
  return { drafts: {}, levels: Object.fromEntries(rules.levels.map(level => [level.id, { completed: false, valid: false, points: 0, completedAt: null, reason: null, evidenceStart: 0 }])), runs: Object.fromEntries(rules.levels.map(level => [level.id, []])), predictions: Object.fromEntries(rules.levels.map(level => [level.id, []])), attempts: [], points: 0, bonusPoints: 0, quizOpenedAt: null, exam: { openedAt: null }, quiz: { base: { first: null, latest: null, attempts: [], firstSubmittedAt: null, firstScore: null, passed: false }, challenge: { unlockedAt: null, closed: false, first: null, latest: null, attempts: [], firstSubmittedAt: null } }, awards: {}, navHelp: [], conceptHints: [], intro: { accepted: false, heightCase: null, judged: null, ticket: null, idea: null, sawSign: false, done: false, skipped: false, review: false, blocked: null } };
}
function ensureState(state) {
  state.exam ||= { openedAt: null };
  state.quizOpenedAt ??= state.exam.openedAt || null;
  if (state.quizOpenedAt && !state.exam.openedAt) state.exam.openedAt = state.quizOpenedAt;
  state.quiz ||= {};
  state.quiz.base ||= { first: null, latest: null, attempts: [], firstSubmittedAt: null, firstScore: null, passed: false };
  state.quiz.base.attempts ||= [];
  state.quiz.challenge ||= { unlockedAt: null, closed: false, first: null, latest: null, attempts: [], firstSubmittedAt: null };
  state.quiz.challenge.attempts ||= [];
  state.awards ||= {};
  state.navHelp ||= [];
  state.conceptHints ||= [];
  for (const level of Object.values(state.levels || {})) {
    if (!level || typeof level !== 'object') continue;
    level.submissions ??= 0;
    if (level.hinted == null) level.hinted = false;
  }
  state.attempts ||= [];
  if (!('intro' in state)) state.intro = null;
  return state;
}
function createService(options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(BASE, 'runtime');
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const rosterPath = process.env.ROSTER_PATH || (fs.existsSync(path.join(BASE, 'roster.json')) ? path.join(BASE, 'roster.json') : path.join(BASE, 'roster.example.json'));
  const rosterSource = options.roster || JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
  const roster = Array.isArray(rosterSource) ? rosterSource : (rosterSource.classes || []).flatMap(group => group.students.map(student => ({ ...student, classId: group.id })));
  const db = new DatabaseSync(path.join(dataDir, 'classroom.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS students(id TEXT PRIMARY KEY, classId TEXT NOT NULL, name TEXT NOT NULL, manual INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS states(studentId TEXT NOT NULL, round INTEGER NOT NULL, json TEXT NOT NULL, meta TEXT NOT NULL, lastSync TEXT NOT NULL, PRIMARY KEY(studentId,round));
    CREATE TABLE IF NOT EXISTS events(studentId TEXT NOT NULL, round INTEGER NOT NULL, eventId TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(studentId,round,eventId));
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, studentId TEXT NOT NULL, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS class_flags(classId TEXT PRIMARY KEY, examClosedAt TEXT);
    CREATE TABLE IF NOT EXISTS lesson_sessions(classId TEXT PRIMARY KEY, round INTEGER NOT NULL, startedAt TEXT NOT NULL);`);
  const rosterIds = new Set();
  const insertStudent = db.prepare('INSERT INTO students VALUES(?,?,?,0) ON CONFLICT(id) DO UPDATE SET classId=excluded.classId,name=excluded.name,manual=0');
  for (const student of roster) {
    if (!student.id || !CLASSES.includes(String(student.classId)) || typeof student.name !== 'string' || !student.name.trim() || rosterIds.has(String(student.id))) throw new Error('名单中的班级、学生标识或姓名不完整或重复');
    rosterIds.add(String(student.id));
    insertStudent.run(String(student.id), String(student.classId), student.name.trim());
  }
  if (!Array.isArray(questions) || !questions.length) throw new Error('题库没有可作答的题目');
  const now = () => new Date().toISOString();
  const requiredLevels = () => rules.levels.filter(level => level.required !== false);
  function classClosedAt(classId) { return db.prepare('SELECT examClosedAt FROM class_flags WHERE classId=?').get(classId)?.examClosedAt || null; }
  function currentRound(classId) { return db.prepare('SELECT round FROM lesson_sessions WHERE classId=?').get(classId)?.round || 1; }
  function roundOf(student) { return student ? currentRound(student.classId) : 1; }
  function missingStations(state) { return requiredLevels().filter(level => !state.levels[level.id]?.valid).map(level => level.id); }
  function issueSession(studentId) {
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(token, studentId, now());
    return token;
  }
  function requireSession(req, studentId) {
    const token = req.headers['x-student-session'];
    if (typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token)) fail(403, '请从自己的学生入口进入');
    const row = db.prepare('SELECT studentId FROM sessions WHERE token=?').get(token);
    if (!row || row.studentId !== String(studentId)) fail(403, '请从自己的学生入口进入');
  }
  function syncExam(studentId, record) {
    ensureState(record.state);
    const student = studentById(studentId);
    if (!record.state.quizOpenedAt && !missingStations(record.state).length && student && !classClosedAt(student.classId)) {
      const at = now();
      record.state.quizOpenedAt = at;
      record.state.exam.openedAt = at;
      save(studentId, record);
    }
  }
  function examGateFor(studentId, record) {
    ensureState(record.state);
    const student = studentById(studentId);
    const closedAt = student ? classClosedAt(student.classId) : null;
    const opened = !!record.state.quizOpenedAt;
    return { open: opened && !closedAt, closed: !!closedAt, openedAt: record.state.quizOpenedAt, missing: opened ? [] : missingStations(record.state) };
  }
  function envelope(studentId, record, result) {
    ensureState(record.state);
    return { state: record.state, result, examGate: examGateFor(studentId, record), rewardUnlocked: rewardFor(record.state), challengeUnlocked: !!record.state.quiz.challenge.unlockedAt };
  }
  function quizTier(payload) {
    if (payload.tier !== 'base' && payload.tier !== 'challenge') fail(400, '请选择基础层或挑战层');
    return payload.tier;
  }
  function rememberQuiz(bucket, attempt) {
    bucket.attempts.push(attempt);
    bucket.latest = structuredClone(attempt);
    if (!bucket.first) bucket.first = structuredClone(attempt);
  }
  function visibleDetail(question, detail) {
    const row = { id: detail.id, correct: detail.correct, answered: detail.answered, status: detail.answered ? (detail.correct ? 'correct' : 'incorrect') : 'unanswered' };
    if (detail.answered && !detail.correct) {
      row.explanation = question.explanation || '';
      row.review = question.review || '';
    }
    return row;
  }
  function acceptQuizDraft(state, payload) {
    const tier = quizTier(payload);
    if (tier === 'challenge' && !state.quiz.challenge.unlockedAt) fail(409, '先提交基础层，再做挑战层');
    if (tier === 'challenge' && state.quiz.challenge.closed) fail(409, '挑战层已经提交，不能补做');
    if (payload.answers != null && (typeof payload.answers !== 'object' || Array.isArray(payload.answers))) fail(400, '考核草稿格式不正确');
    if (payload.index != null && (!Number.isInteger(payload.index) || payload.index < 0)) fail(400, '考核草稿格式不正确');
    const list = quizApi.byTier(tier);
    for (const [qid, value] of Object.entries(payload.answers || {})) {
      const question = list.find(item => item.id === qid);
      if (!question || !quizApi.valueAllowed(question, value)) fail(400, '考核草稿格式不正确');
    }
  }
  function submitQuiz(state, body) {
    const payload = body.payload;
    if ('quizVersion' in payload && payload.quizVersion !== quizVersion) fail(409, '检测题库版本已更新，旧作答已保留，请重新打开检测后再提交', 'QUIZ_VERSION_MISMATCH');
    const tier = quizTier(payload);
    if (!payload.answers || typeof payload.answers !== 'object' || Array.isArray(payload.answers)) fail(400, '作答请按题目提交');
    if (tier === 'challenge' && !state.quiz.challenge.unlockedAt) fail(409, '先提交基础层，再做挑战层');
    if (tier === 'challenge' && state.quiz.challenge.closed) fail(409, '挑战层已经提交，不能补做');
    const list = quizApi.byTier(tier);
    if (list.some(question => !quizApi.isFilled(question, payload.answers[question.id]))) fail(400, '这一层全部作答后才能提交');
    const graded = quizApi.grade(tier, payload.answers);
    const details = graded.details.map(detail => visibleDetail(list.find(question => question.id === detail.id), detail));
    const at = now();
    if (tier === 'base') {
      const meets = quizApi.basePassed(graded);
      const attempt = { id: body.eventId, tier, quizVersion, score: graded.score, total: graded.total, at, passed: meets, objectives: graded.objectives, details };
      const bucket = state.quiz.base;
      rememberQuiz(bucket, attempt);
      state.attempts.push(attempt);
      if (!bucket.firstSubmittedAt) {
        bucket.firstSubmittedAt = at;
        bucket.firstScore = graded.score;
        bucket.passed = meets;
        state.quiz.challenge.unlockedAt = at;
        if (meets && !state.awards['quiz-base']) {
          state.awards['quiz-base'] = { points: quizApi.basePoints(), label: '达标', at };
          state.points += quizApi.basePoints();
        }
      }
      state.drafts.quiz = { tier: 'challenge', answers: {}, index: 0, quizVersion };
      return { score: graded.score, total: graded.total, passed: bucket.passed, rewardUnlocked: quizApi.rewardUnlocked(bucket.firstScore), challengeUnlocked: true, details };
    }
    const meets = quizApi.challengeAwarded(graded.score);
    const attempt = { id: body.eventId, tier, quizVersion, score: graded.score, total: graded.total, at, awarded: meets, details };
    const bucket = state.quiz.challenge;
    rememberQuiz(bucket, attempt);
    bucket.closed = true;
    bucket.firstSubmittedAt = at;
    state.attempts.push(attempt);
    if (meets && !state.awards['quiz-challenge']) {
      state.awards['quiz-challenge'] = { points: quizApi.challengePoints(), label: '挑战加分', at };
      state.points += quizApi.challengePoints();
    }
    state.drafts.quiz = { tier: 'challenge', answers: {}, index: 0, quizVersion, closed: true };
    return { score: graded.score, total: graded.total, awarded: !!state.awards['quiz-challenge'], details };
  }
  function rewardFor(state) {
    ensureState(state);
    const first = state.quiz.base.first;
    return !!(first && quizApi.rewardUnlocked(first.score));
  }
  function rememberAttempt(bucket, attempt) {
    bucket.history.push(attempt);
    bucket.latest = structuredClone(attempt);
    if (!bucket.first) bucket.first = structuredClone(attempt);
  }
  function studentById(id) { return db.prepare('SELECT id,classId,name FROM students WHERE id=?').get(String(id || '')); }
  function recordFor(id) {
    const round = roundOf(studentById(id));
    const row = db.prepare('SELECT * FROM states WHERE studentId=? AND round=?').get(id, round);
    const record = row ? { state: JSON.parse(row.json), meta: JSON.parse(row.meta), lastSync: row.lastSync, entered: true } : { state: initialState(), meta: { draftTimes: {}, currentConfigs: {}, validatedConfigs: {} }, lastSync: null, entered: false };
    ensureState(record.state);
    record.round = round;
    return record;
  }
  function save(id, record) {
    record.lastSync = now();
    const round = record.round || roundOf(studentById(id));
    db.prepare('INSERT INTO states VALUES(?,?,?,?,?) ON CONFLICT(studentId,round) DO UPDATE SET json=excluded.json,meta=excluded.meta,lastSync=excluded.lastSync').run(id, round, JSON.stringify(record.state), JSON.stringify(record.meta), record.lastSync);
  }
  function allStudents() { return db.prepare('SELECT id,classId,name,manual FROM students ORDER BY classId,rowid').all().filter(student => rosterIds.has(student.id) || student.manual); }
  function classes() { return CLASSES.map(id => ({ id, students: allStudents().filter(student => student.classId === id).map(({id,name}) => ({id,name})) })); }
  function teacher(req) {
    if (!isPrivateAddress(req.socket.remoteAddress)) fail(403, '教师入口仅开放给本机和局域网设备');
    checkOrigin(req);
  }
  function checkOrigin(req) {
    if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, '请从本课堂网址直接操作');
    if (req.headers.origin) {
      let origin;
      try { origin = new URL(req.headers.origin); } catch { fail(403, '来源网址无效'); }
      if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) fail(403, '请从本课堂网址直接操作');
    }
  }
  function requireOpen(state, id) {
    const index = rules.levels.findIndex(level => level.id === id);
    if (index < 0) fail(400, '找不到这个任务');
    if (rules.levels.slice(0,index).some(level => !state.levels[level.id].completed)) fail(409, '请先完成前面的主线任务');
  }
    const draftConfigKey = (id,config) => JSON.stringify(rules.normalizeConfig(id,config,true));
  function isVisitDefault(id, config) {
    if (!config || typeof config !== 'object') return false;
    if (id === 'cross') return config.yes === '' && config.no === '';
    if (id === 'minimum') return !config.operator && !config.yes && !config.no;
    if (id === 'sale') return config.model === 'ventilation' && config.operator === '>=' && config.yes === '' && config.no === '';
    if (id === 'repair') return config.model === 'ventilation' && config.operator === '>=' && config.yes === 'off' && config.no === 'on';
    return false;
  }
  function sanitizeIntro(payload) {
    const intro = { accepted: false, heightCase: null, judged: null, ticket: null, idea: null, sawSign: false, done: false, skipped: false, review: false, blocked: null };
    intro.accepted = !!payload.accepted;
    if ([116, 138].includes(payload.heightCase)) intro.heightCase = payload.heightCase;
    if (payload.judged === 'half' || payload.judged === 'full') intro.judged = payload.judged;
    if (payload.ticket === '10') intro.ticket = '10';
    if (typeof payload.idea === 'string') intro.idea = payload.idea.slice(0, 40);
    intro.sawSign = !!payload.sawSign;
    intro.done = !!payload.done;
    intro.skipped = !!payload.skipped;
    intro.review = !!payload.review;
    if (typeof payload.blocked === 'string') intro.blocked = payload.blocked.slice(0, 80);
    return intro;
  }
  function useConfig(record, id, config, partial = false) {
    const key = partial ? draftConfigKey(id,config) : rules.configKey(id,config);
    if (record.meta.currentConfigs[id] !== key) {
      record.state.levels[id].valid = false;
      record.state.levels[id].evidenceStart = record.state.runs[id].length;
    }
    record.meta.currentConfigs[id] = key;
    return key;
  }
  function handleEvent(body) {
    const student = studentById(body.studentId);
    if (!student) fail(400, '请先选择班级与姓名');
    const round = roundOf(student);
    if (body.round !== round) fail(409, '记录属于其他课次，请刷新课堂');
    if (typeof body.eventId !== 'string' || !body.eventId || body.eventId.length > 120) fail(400, '记录标识不完整');
    if (!['draft','run','prediction','complete','quiz','nav_help','concept_hint'].includes(body.type)) fail(400, '记录类型不正确');
    if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) fail(400, '记录内容不正确');
    const previous = db.prepare('SELECT result FROM events WHERE studentId=? AND round=? AND eventId=?').get(student.id,round,body.eventId);
    if (previous) { const kept = recordFor(student.id); return envelope(student.id, kept, JSON.parse(previous.result)); }
    const record = recordFor(student.id);
    const { state, meta } = record;
    const id = body.levelId;
    const payload = body.payload;
    let result;
    ensureState(state);
    syncExam(student.id, record);
    if (body.type === 'nav_help') {
      const trigger = payload.trigger;
      if (!['idle','button','onboard','goto','gate_info'].includes(trigger)) fail(400, '导航帮助类型不正确');
      if (payload.strength != null && ![0,1,2].includes(payload.strength)) fail(400, '导航帮助强度不正确');
      const entry = { levelId: typeof payload.levelId === 'string' ? payload.levelId.slice(0, 40) : (id || ''), mapId: typeof payload.mapId === 'string' ? payload.mapId.slice(0, 40) : '', step: typeof payload.step === 'string' ? payload.step.slice(0, 40) : '', focusId: typeof payload.focusId === 'string' ? payload.focusId.slice(0, 80) : '', trigger, strength: payload.strength ?? 0, idleMs: Number.isFinite(payload.idleMs) ? payload.idleMs : 0, at: now() };
      state.navHelp.push(entry);
      if (state.navHelp.length > 300) state.navHelp.splice(0, state.navHelp.length - 300);
      result = { saved: true };
    } else if (body.type === 'concept_hint') {
      requireOpen(state, id);
      const levelNo = Number(payload.level);
      if (![1, 2, 3].includes(levelNo)) fail(400, '概念提示等级不正确');
      state.conceptHints.push({ levelId: id, level: levelNo, evidenceKind: typeof payload.evidenceKind === 'string' ? payload.evidenceKind.slice(0, 40) : 'station', at: now() });
      state.levels[id].hinted = true;
      result = { saved: true, hinted: true };
    } else if (body.type === 'draft' && id === 'intro') {
      state.intro = sanitizeIntro(payload);
      result = { saved: true };
    } else if (body.type === 'quiz' || (body.type === 'draft' && id === 'quiz')) {
      const gate = examGateFor(student.id, record);
      if (!state.quizOpenedAt) fail(409, '完成温室、返修和路口三站的当前验证后再进入考核');
      if (gate.closed) fail(409, '本班考核已由教师关闭');
    } else requireOpen(state,id);
    if (result) {
      /* nav_help 已写好结果 */
    } else if (body.type === 'draft') {
      const editedAt = body.editedAt;
      if (!Number.isFinite(editedAt) || editedAt < 0) fail(400, '草稿缺少编辑时间');
      if ('hint' in payload && (!Number.isInteger(payload.hint) || payload.hint < 0 || payload.hint > 3)) fail(400, '草稿思路帮助请选择0到3之间的整数等级');
      if (['prediction','reason'].some(field => field in payload && typeof payload[field] !== 'string')) fail(400, '草稿预测与理由请使用页面中的文字选择');
      if ('input' in payload) {
        if (!payload.input || typeof payload.input !== 'object' || Array.isArray(payload.input)) fail(400, '草稿输入格式不正确，请重新设置实验输入');
        const fields = id === 'cross' ? ['facility'] : id === 'minimum' ? ['a','b'] : payload.config?.model === 'ventilation' ? ['temperature'] : ['height'];
        if (fields.some(field => field in payload.input && (id === 'cross' ? typeof payload.input[field] !== 'boolean' : !Number.isFinite(payload.input[field])))) fail(400, '草稿输入请使用页面中的数字或现场情况选择');
      }
      if ('scene' in payload) payload.scene = checkedRule(() => adventure.validateSceneDraft(payload.scene));
      if ('rpg' in payload) payload.rpg = checkedRule(() => adventure.validateRpgDraft(payload.rpg,id));
      if (id === 'quiz') acceptQuizDraft(state, payload);
      else if ('config' in payload) checkedRule(() => rules.normalizeConfig(id,payload.config,true));
      if (Array.isArray(payload.flowRejections)) {
        payload.flowRejections = payload.flowRejections.filter(item => item && Array.isArray(item.mCodes) && item.mCodes.includes('M8')).slice(-20).map(item => ({
          mCodes: ['M8'],
          diamond: typeof item.diamond === 'string' ? item.diamond.slice(0, 40) : '',
          at: Number.isFinite(item.at) ? item.at : now()
        }));
      }
      if (editedAt >= (meta.draftTimes[id] ?? -1)) {
        if (id !== 'quiz' && payload.scene?.version === 1) {
          meta.sceneVersions ||= {};
          const firstScene = meta.sceneVersions[id] !== 1;
          meta.sceneVersions[id] = 1;
          const runs = state.runs[id] || [];
          const legacyHeight = ['sale', 'repair'].includes(id) && runs.some(run => run.input && Object.hasOwn(run.input, 'height')) && !runs.some(run => run.config?.model === 'ventilation');
          if (firstScene && legacyHeight) {
            state.levels[id].evidenceStart = runs.length;
            state.levels[id].valid = false;
          }
        }
        const previousDraft = state.drafts[id] && typeof state.drafts[id] === 'object' && !Array.isArray(state.drafts[id]) ? state.drafts[id] : {};
        const visitDefault = payload.config && state.levels[id]?.valid && isVisitDefault(id, payload.config) && !payload.flow;
        if (visitDefault) delete payload.config;
        state.drafts[id] = { ...previousDraft, ...payload, config: payload.config || previousDraft.config, input: payload.input ? { ...(previousDraft.input || {}), ...payload.input } : previousDraft.input, flow: payload.flow || previousDraft.flow, sentence: payload.sentence || previousDraft.sentence };
        meta.draftTimes[id] = editedAt;
        if (id !== 'quiz' && payload.config) useConfig(record,id,payload.config,true);
        result = { saved: true };
      } else result = { saved: false, feedback: '已保留较新的草稿，旧记录没有覆盖它。' };
    } else if (body.type === 'run') {
      const config = checkedRule(() => rules.normalizeConfig(id,payload.config));
      const evaluated = checkedRule(() => rules.evaluate(id,config,payload.input));
      const scene = 'sceneEvidence' in payload ? checkedRule(() => adventure.validateEvidence(id,payload.sceneEvidence,payload.input,evaluated)) : null;
      if (scene && 'prediction' in payload && payload.prediction !== scene.prediction) fail(400, '场景预测与当前预测不一致，请重新确认');
      // 实验始终累计；过时补传不替换当前草稿中的方案。
      if (!state.drafts[id]?.config || draftConfigKey(id,state.drafts[id].config) === rules.configKey(id,config)) useConfig(record,id,config);
      if (config.model === 'ventilation' && (config.operator === '>' || config.operator === '<=') && payload.input?.temperature === 30 && !evaluated.correct) evaluated.mCodes = ['M3'];
      state.runs[id].push({ config, input: payload.input, ...evaluated, ...(scene ? { scene } : {}), at: now() });
      result = evaluated;
    } else if (body.type === 'prediction') {
      const choices = id === 'cross' ? ['bridge','crossing'] : id === 'minimum' ? ['a','b'] : payload.config?.model === 'ventilation' ? ['on','off'] : ['5','10'];
      if (!choices.includes(payload.value)) fail(400, '请选择本次输出预测');
      const config = checkedRule(() => rules.normalizeConfig(id,payload.config));
      checkedRule(() => rules.evaluate(id,config,payload.input));
      state.predictions[id].push({ value: payload.value, input: payload.input, config, at: now() });
      result = { saved: true, first: state.predictions[id][0] };
    } else if (body.type === 'complete') {
      const config = checkedRule(() => rules.normalizeConfig(id,payload.config));
      if (state.drafts[id]?.config && draftConfigKey(id,state.drafts[id].config) !== rules.configKey(id,config)) {
        result = { passed: false, feedback: '提交的方案与当前草稿不同，请先运行并提交当前方案。' };
      } else {
        useConfig(record,id,config);
        result = rules.validateComplete(id,config,state.runs[id],payload.reason,state.levels[id].evidenceStart || 0);
        state.levels[id].submissions = (state.levels[id].submissions || 0) + 1;
        state.levels[id].valid = result.passed;
        if (result.passed) {
          const level = state.levels[id];
          const hinted = level.hinted === true;
          level.attemptKind = hinted ? 'hinted' : (level.submissions > 1 ? 'revision' : (id === 'cross' || id === 'minimum' ? 'transfer' : 'first'));
          result = { ...result, attemptKind: level.attemptKind, hinted };
          level.reason = payload.reason;
          meta.validatedConfigs[id] = rules.configKey(id,config);
          if (!level.completed) {
            level.completed = true;
            const award = rules.levels.find(item => item.id === id);
            level.points = award.points;
            level.completedAt = now();
            if (award.required === false) state.bonusPoints = (Number(state.bonusPoints) || 0) + award.points;
            else state.points += award.points;
          }
          syncExam(student.id, record);
        }
      }
    } else {
      result = submitQuiz(state, body);
      meta.draftTimes.quiz = Math.max(meta.draftTimes.quiz || 0, Number.isFinite(body.editedAt) ? body.editedAt : Date.now());
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      save(student.id,record);
      db.prepare('INSERT INTO events VALUES(?,?,?,?)').run(student.id,round,body.eventId,JSON.stringify(result));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return envelope(student.id, record, result);
  }
  function teacherData(classId) {
    if (classId && !CLASSES.includes(classId)) fail(400,'请选择五年级班级');
    const students = allStudents().filter(student => !classId || student.classId === classId).map(({manual,...student}) => {
      const record = recordFor(student.id);
      return { ...student, entered: record.entered, state: record.state, lastSync: record.lastSync };
    });
    const entered = students.filter(student => student.entered).length;
    const examined = students.filter(student => student.state.attempts.length);
    const mean = select => {
      const values = examined.map(student => {
        const attempt = select(student.state.attempts);
        return attempt?.total ? attempt.score / attempt.total * 100 : null;
      }).filter(value => value != null);
      return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 : null;
    };
    const misconceptions = questions.map(question => {
      const records = examined.map(student => student.state.attempts.find(attempt => attempt.quizVersion === quizVersion)?.details.find(detail => detail.id === question.id)).filter(Boolean);
      return { id: question.id, prompt: question.prompt, incorrect: records.filter(detail => !detail.correct).length, total: records.length };
    }).filter(item => item.incorrect).sort((a,b) => b.incorrect-a.incorrect).slice(0,5);
    const summary = { total: students.length, entered, notEntered: students.length-entered, completed: students.filter(student => rules.levels.every(level => student.state.levels[level.id].completed)).length, points: students.reduce((sum,student) => sum+student.state.points,0), quizFirstAverage: mean(attempts => attempts[0]), quizLatestAverage: mean(attempts => attempts.at(-1)), quizAttempts: students.reduce((sum,student) => sum+student.state.attempts.length,0), levels: Object.fromEntries(rules.levels.map(level => [level.id,{ completed: students.filter(student => student.state.levels[level.id].completed).length, valid: students.filter(student => student.state.levels[level.id].valid).length }])), misconceptions };
    return { round: classId ? currentRound(classId) : ROUND, lessonRound: classId ? currentRound(classId) : ROUND, priorSessions: classId ? priorSessions(classId) : [], quizVersion, updatedAt: now(), classes: classes(), students, summary, examClosedAt: classId ? classClosedAt(classId) : null };
  }
  function priorSessions(classId) {
    const current = currentRound(classId);
    if (current <= 1) return [];
    const rosterStudents = allStudents().filter(student => student.classId === classId);
    const sessions = [];
    for (let round = 1; round < current; round += 1) {
      const rows = rosterStudents.map(student => {
        const row = db.prepare('SELECT json FROM states WHERE studentId=? AND round=?').get(student.id, round);
        if (!row) return null;
        const state = JSON.parse(row.json);
        return { id: student.id, name: student.name, points: state.points || 0, passed: !!state.quiz?.base?.passed, firstScore: state.quiz?.base?.firstScore ?? null };
      }).filter(Boolean);
      sessions.push({ round, students: rows });
    }
    return sessions;
  }
  function startLesson(classId) {
    if (!CLASSES.includes(classId)) fail(400, '请选择五年级班级');
    const next = currentRound(classId) + 1;
    const at = now();
    db.prepare('INSERT INTO lesson_sessions(classId, round, startedAt) VALUES(?,?,?) ON CONFLICT(classId) DO UPDATE SET round=excluded.round, startedAt=excluded.startedAt').run(classId, next, at);
    db.prepare('DELETE FROM class_flags WHERE classId=?').run(classId);
    return { classId, round: next, startedAt: at };
  }
  function closeExam(classId) {
    if (!CLASSES.includes(classId)) fail(400, '请选择五年级班级');
    const at = now();
    db.prepare('INSERT INTO class_flags(classId, examClosedAt) VALUES(?,?) ON CONFLICT(classId) DO UPDATE SET examClosedAt=excluded.examClosedAt').run(classId, at);
    for (const student of allStudents().filter(item => item.classId === classId)) {
      const record = recordFor(student.id);
      ensureState(record.state);
      record.state.quiz.challenge.closed = true;
      save(student.id, record);
    }
    return { classId, examClosedAt: at };
  }
  const mime = { '.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.mjs':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff','.json':'application/json; charset=utf-8','.tmx':'application/xml; charset=utf-8','.tsx':'application/xml; charset=utf-8','.mp3':'audio/mpeg','.wav':'audio/wav' };
  function json(res,status,data) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data)); }
  async function readBody(req) {
    const chunks=[];let length=0;
    for await (const chunk of req) { length+=chunk.length;if(length>64*1024) fail(413,'提交内容过大');chunks.push(chunk); }
    let body;try {body=JSON.parse(Buffer.concat(chunks).toString());} catch {fail(400,'提交格式不正确');}
    if (!body || typeof body!=='object' || Array.isArray(body)) fail(400,'提交格式不正确');
    return body;
  }
  const server = http.createServer(async(req,res) => {
    try {
      const url = new URL(req.url,'http://classroom.local');
      const route = decodeURIComponent(url.pathname);
      if (route.startsWith('/api/teacher') || route === '/teacher.html') teacher(req);
      if (req.method === 'POST') checkOrigin(req);
      if (req.method === 'GET' && route === '/api/config') return json(res,200,{appId:APP_ID,round:ROUND,levels:rules.levels});
      if (req.method === 'GET' && route === '/api/roster') return json(res,200,{classes:classes()});
      if (req.method === 'GET' && route === '/api/quiz') {
        const studentId = url.searchParams.get('studentId');
        const student = studentId ? studentById(studentId) : null;
        if (studentId && !student) fail(404, '学生身份不存在');
        const record = student ? recordFor(student.id) : null;
        if (record) syncExam(student.id, record);
        const gate = record ? examGateFor(student.id, record) : { open: false, closed: false, openedAt: null, missing: rules.levels.filter(level => level.required !== false).map(level => level.id) };
        const unlocked = !!(record && record.state.quiz.challenge.unlockedAt);
        const tiers = gate.open && unlocked ? ['base', 'challenge'] : ['base'];
        return json(res, 200, { quizVersion, questions: gate.open ? quizApi.publicQuestions(tiers) : [], examGate: gate, challengeUnlocked: unlocked, rewardUnlocked: record ? rewardFor(record.state) : false });
      }
      if (req.method === 'GET' && route === '/api/state') {
        const student=studentById(url.searchParams.get('studentId'));if(!student) fail(404,'学生身份不存在');
        const record=recordFor(student.id); syncExam(student.id, record);
        return json(res,200,{student,round:record.round,...envelope(student.id, record, null)});
      }
      if (req.method === 'GET' && route === '/api/teacher') return json(res,200,teacherData(url.searchParams.get('classId')));
      if (req.method === 'POST' && route === '/api/teacher/exam-close') { const body=await readBody(req); return json(res,200,closeExam(String(body.classId||''))); }
      if (req.method === 'POST' && route === '/api/teacher/lesson-session') { const body=await readBody(req); return json(res,200,startLesson(String(body.classId||''))); }
      if (req.method === 'GET' && route === '/api/teacher/solutions') return json(res,200,{levels:rules.solutions,questions,quizVersion,tiers:quizApi.bank.tiers});
      if (req.method === 'POST' && route === '/api/login') {
        const body=await readBody(req);const classId=String(body.classId || '');if(!CLASSES.includes(classId)) fail(400,'请选择五年级班级');
        let student;
        if (body.studentId) { student=studentById(body.studentId);if(!student || student.classId!==classId) fail(400,'所选姓名与班级不一致'); }
        else {
          if (typeof body.name!=='string') fail(400,'请填写姓名');
          const name=body.name.trim().replace(/\s+/g,' ');if(!name || name.length>40 || /[\u0000-\u001f]/.test(name)) fail(400,'姓名请输入1到40个可显示字符');
          const matches=allStudents().filter(student=>student.classId===classId && student.name===name);
          if(matches.length>1) fail(400,'本班有同名同学，请从名单选择对应身份');
          student=matches[0];
          if(!student) { const id=`manual-${crypto.createHash('sha256').update(`${classId}\0${name}`).digest('hex').slice(0,24)}`;db.prepare('INSERT OR IGNORE INTO students VALUES(?,?,?,1)').run(id,classId,name);student=studentById(id); }
          else student={id:student.id,classId:student.classId,name:student.name};
        }
        const record=recordFor(student.id);save(student.id,record);return json(res,200,{student,round:record.round,state:record.state});
      }
      if (req.method === 'POST' && route === '/api/events') return json(res,200,handleEvent(await readBody(req)));
      if (route.startsWith('/api/')) fail(404,'接口不存在');
      if (!['GET','HEAD'].includes(req.method)) fail(405,'请求方法不支持');
      const name = route === '/' ? 'index.html' : ['/rpgjs','/rpgjs/'].includes(route) ? 'rpgjs/index.html' : route.slice(1);
      if (!name || name.split('/').some(part=>part.startsWith('.') || !part) || !mime[path.extname(name)]) fail(404,'文件不存在');
      const publicDir=path.join(BASE,'public');const file=path.join(publicDir,name);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile() || !fs.realpathSync(file).startsWith(fs.realpathSync(publicDir)+path.sep)) fail(404,'文件不存在');
      const engineResource = name.startsWith('rpgjs/');
      res.writeHead(200,{'Content-Type':mime[path.extname(name)],'Cache-Control':name.startsWith('assets/')?'public, max-age=86400':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':`default-src 'self'; script-src 'self'${engineResource?" 'wasm-unsafe-eval'":''}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'${engineResource?' data:':''}; object-src 'none'; base-uri 'self'; frame-ancestors '${engineResource?'self':'none'}'${engineResource?"; worker-src 'self' blob:":''}`});
      if (req.method==='HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    } catch(error) { if (!res.headersSent) json(res,error.status || (error instanceof URIError ? 400 : 500),{error:error.status || error instanceof URIError ? error.message : '课堂服务暂时无法处理请求，请重试',...(error.code?{code:error.code}:{})});if(!error.status && !(error instanceof URIError)) console.error(error); }
  });
  return { server, close: () => new Promise((resolve,reject) => { server.close(error => { try {db.close();} catch(closeError) {error ||= closeError;} if(error) reject(error);else resolve(); });server.closeIdleConnections(); }) };
}
if (require.main === module) {
  const service=createService();const port=Number(process.env.PORT || 8766);const host=process.env.HOST || '0.0.0.0';
  service.server.listen(port,host,()=>console.log(`分支冒险岛已启动： http://localhost:${port}`));
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>service.close().then(()=>process.exit(0)));
}
module.exports = { createService, isPrivateAddress };
