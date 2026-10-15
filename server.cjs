'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isIP } = require('node:net');
const { DatabaseSync } = require('node:sqlite');
const rules = require('./public/rules.js');
const adventure = require('./public/adventure-rules.js');
const { questions, version:quizVersion } = require('./quiz.cjs');
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
  return { drafts: {}, levels: Object.fromEntries(rules.levels.map(level => [level.id, { completed: false, valid: false, points: 0, completedAt: null, reason: null, evidenceStart: 0 }])), runs: Object.fromEntries(rules.levels.map(level => [level.id, []])), predictions: Object.fromEntries(rules.levels.map(level => [level.id, []])), attempts: [], points: 0 };
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
    CREATE TABLE IF NOT EXISTS events(studentId TEXT NOT NULL, round INTEGER NOT NULL, eventId TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(studentId,round,eventId));`);
  const rosterIds = new Set();
  const insertStudent = db.prepare('INSERT INTO students VALUES(?,?,?,0) ON CONFLICT(id) DO UPDATE SET classId=excluded.classId,name=excluded.name,manual=0');
  for (const student of roster) {
    if (!student.id || !CLASSES.includes(String(student.classId)) || typeof student.name !== 'string' || !student.name.trim() || rosterIds.has(String(student.id))) throw new Error('名单中的班级、学生标识或姓名不完整或重复');
    rosterIds.add(String(student.id));
    insertStudent.run(String(student.id), String(student.classId), student.name.trim());
  }
  if (!Array.isArray(questions) || questions.length !== 20) throw new Error('本课考核必须包含20题');
  const now = () => new Date().toISOString();
  function studentById(id) { return db.prepare('SELECT id,classId,name FROM students WHERE id=?').get(String(id || '')); }
  function recordFor(id) {
    const row = db.prepare('SELECT * FROM states WHERE studentId=? AND round=?').get(id, ROUND);
    return row ? { state: JSON.parse(row.json), meta: JSON.parse(row.meta), lastSync: row.lastSync, entered: true } : { state: initialState(), meta: { draftTimes: {}, currentConfigs: {}, validatedConfigs: {} }, lastSync: null, entered: false };
  }
  function save(id, record) {
    record.lastSync = now();
    db.prepare('INSERT INTO states VALUES(?,?,?,?,?) ON CONFLICT(studentId,round) DO UPDATE SET json=excluded.json,meta=excluded.meta,lastSync=excluded.lastSync').run(id, ROUND, JSON.stringify(record.state), JSON.stringify(record.meta), record.lastSync);
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
    if (body.round !== ROUND) fail(409, '记录属于其他轮次，请刷新课堂');
    if (typeof body.eventId !== 'string' || !body.eventId || body.eventId.length > 120) fail(400, '记录标识不完整');
    if (!['draft','run','prediction','complete','quiz'].includes(body.type)) fail(400, '记录类型不正确');
    if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) fail(400, '记录内容不正确');
    const previous = db.prepare('SELECT result FROM events WHERE studentId=? AND round=? AND eventId=?').get(student.id,ROUND,body.eventId);
    if (previous) return { state: recordFor(student.id).state, result: JSON.parse(previous.result) };
    const record = recordFor(student.id);
    const { state, meta } = record;
    const id = body.levelId;
    const payload = body.payload;
    let result;
    if (body.type === 'quiz' || (body.type === 'draft' && id === 'quiz')) {
      if (rules.levels.some(level => !state.levels[level.id].completed)) fail(409, '完成四个主线任务后再进入考核');
    } else requireOpen(state,id);
    if (body.type === 'draft') {
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
      if (id === 'quiz') {
        if (!Array.isArray(payload.answers) || payload.answers.length !== 20 || payload.answers.some(answer => answer !== null && (!Number.isInteger(answer) || answer < 0 || answer > 3)) || !Number.isInteger(payload.index) || payload.index < 0 || payload.index > 19) fail(400, '考核草稿格式不正确');
      } else if ('config' in payload) checkedRule(() => rules.normalizeConfig(id,payload.config,true));
      if (editedAt >= (meta.draftTimes[id] ?? -1)) {
        if (id !== 'quiz' && payload.scene?.version === 1) {
          meta.sceneVersions ||= {};
          if (meta.sceneVersions[id] !== 1) {
            state.levels[id].evidenceStart = state.runs[id].length;
            state.levels[id].valid = false;
            meta.sceneVersions[id] = 1;
          }
        }
        state.drafts[id] = payload;
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
        state.levels[id].valid = result.passed;
        if (result.passed) {
          const level = state.levels[id];
          level.reason = payload.reason;
          meta.validatedConfigs[id] = rules.configKey(id,config);
          if (!level.completed) { level.completed = true; level.points = rules.levels.find(level => level.id === id).points; level.completedAt = now(); state.points += level.points; }
        }
      }
    } else {
      if ('quizVersion' in payload && payload.quizVersion !== quizVersion) fail(409, '检测题库版本已更新，旧作答已保留，请重新打开检测后再提交', 'QUIZ_VERSION_MISMATCH');
      if (!Array.isArray(payload.answers) || payload.answers.length !== 20 || payload.answers.some(answer => !Number.isInteger(answer) || answer < 0 || answer > 3)) fail(400, '20题全部作答后才能提交');
      const details = questions.map((question,index) => ({ id: question.id, answer: payload.answers[index], correctAnswer: question.answer, correct: payload.answers[index] === question.answer, explanation: question.explanation }));
      const score = details.filter(detail => detail.correct).length;
      const attempt = { id: body.eventId, quizVersion, score, total: 20, at: now(), details };
      state.attempts.push(attempt);
      state.drafts.quiz = { answers: Array(20).fill(null), index: 0, quizVersion };
      meta.draftTimes.quiz = Math.max(meta.draftTimes.quiz || 0, Number.isFinite(body.editedAt) ? body.editedAt : Date.now());
      result = { score, total: 20, details };
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      save(student.id,record);
      db.prepare('INSERT INTO events VALUES(?,?,?,?)').run(student.id,ROUND,body.eventId,JSON.stringify(result));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { state, result };
  }
  function teacherData(classId) {
    if (classId && !CLASSES.includes(classId)) fail(400,'请选择五年级班级');
    const students = allStudents().filter(student => !classId || student.classId === classId).map(({manual,...student}) => {
      const record = recordFor(student.id);
      return { ...student, entered: record.entered, state: record.state, lastSync: record.lastSync };
    });
    const entered = students.filter(student => student.entered).length;
    const examined = students.filter(student => student.state.attempts.length);
    const mean = select => examined.length ? Math.round(examined.reduce((sum,student) => sum + select(student.state.attempts).score,0) / examined.length * 10) / 10 : null;
    const misconceptions = questions.map(question => {
      const records = examined.map(student => student.state.attempts.find(attempt => attempt.quizVersion === quizVersion)?.details.find(detail => detail.id === question.id)).filter(Boolean);
      return { id: question.id, prompt: question.prompt, incorrect: records.filter(detail => !detail.correct).length, total: records.length };
    }).filter(item => item.incorrect).sort((a,b) => b.incorrect-a.incorrect).slice(0,5);
    const summary = { total: students.length, entered, notEntered: students.length-entered, completed: students.filter(student => rules.levels.every(level => student.state.levels[level.id].completed)).length, points: students.reduce((sum,student) => sum+student.state.points,0), quizFirstAverage: mean(attempts => attempts[0]), quizLatestAverage: mean(attempts => attempts.at(-1)), quizAttempts: students.reduce((sum,student) => sum+student.state.attempts.length,0), levels: Object.fromEntries(rules.levels.map(level => [level.id,{ completed: students.filter(student => student.state.levels[level.id].completed).length, valid: students.filter(student => student.state.levels[level.id].valid).length }])), misconceptions };
    return { round: ROUND, quizVersion, updatedAt: now(), classes: classes(), students, summary };
  }
  const mime = { '.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.mjs':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2','.mp3':'audio/mpeg','.wav':'audio/wav' };
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
      if (req.method === 'GET' && route === '/api/quiz') return json(res,200,{quizVersion,questions:questions.map(({answer,explanation,...question})=>question)});
      if (req.method === 'GET' && route === '/api/state') {
        const student=studentById(url.searchParams.get('studentId'));if(!student) fail(404,'学生身份不存在');
        return json(res,200,{student,round:ROUND,state:recordFor(student.id).state});
      }
      if (req.method === 'GET' && route === '/api/teacher') return json(res,200,teacherData(url.searchParams.get('classId')));
      if (req.method === 'GET' && route === '/api/teacher/solutions') return json(res,200,{levels:rules.solutions,questions});
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
        const record=recordFor(student.id);save(student.id,record);return json(res,200,{student,round:ROUND,state:record.state});
      }
      if (req.method === 'POST' && route === '/api/events') return json(res,200,handleEvent(await readBody(req)));
      if (route.startsWith('/api/')) fail(404,'接口不存在');
      if (!['GET','HEAD'].includes(req.method)) fail(405,'请求方法不支持');
      const name = route === '/' ? 'index.html' : route.slice(1);
      if (!name || name.split('/').some(part=>part.startsWith('.') || !part) || !mime[path.extname(name)]) fail(404,'文件不存在');
      const publicDir=path.join(BASE,'public');const file=path.join(publicDir,name);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile() || !fs.realpathSync(file).startsWith(fs.realpathSync(publicDir)+path.sep)) fail(404,'文件不存在');
      res.writeHead(200,{'Content-Type':mime[path.extname(name)],'Cache-Control':name.startsWith('assets/')?'public, max-age=86400':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"});
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
