'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createService } = require('../server.cjs');

async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-support-'));
  let service;
  async function start() {
    service = createService({ dataDir: dir, roster: [{ id: 's1', classId: '501', name: '测试甲' }, { id: 's2', classId: '501', name: '测试乙' }] });
    await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  }
  await start();
  async function api(route, body) {
    const response = await fetch(`http://127.0.0.1:${service.server.address().port}${route}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, ...await response.json() };
  }
  let next = 0;
  const event = (type, levelId, payload = {}, extra = {}) => api('/api/events', { studentId: 's1', round: 1, eventId: `support-${++next}`, type, levelId, payload, editedAt: Date.now(), ...extra });
  await api('/api/login', { classId: '501', studentId: 's1' });
  await event('draft', 'sale', { config: { model: 'ventilation', operator: '>=', yes: '', no: '' }, input: { temperature: 30 } });
  t.after(async () => { await service.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, api, event, restart: async () => { await service.close(); await start(); } };
}

test('通关法宝只给当前一步答案与理由，重看同一提示及事件重传不重复扣次', async t => {
  const c = await setup(t);
  const first = await c.event('tool_hint', 'sale', { step: { phase: 'flow', slot: 'diamond' } }, { eventId: 'hint-one' });
  assert.equal(first.status, 200);
  assert.equal(first.result.used, 1);
  assert.equal(first.result.remaining, 4);
  assert.equal(first.result.reused, false);
  assert.ok(first.result.hint.key);
  assert.ok(first.result.hint.action);
  assert.ok(first.result.hint.why);
  const replay = await c.event('tool_hint', 'sale', { step: { phase: 'flow', slot: 'diamond' } }, { eventId: 'hint-one' });
  assert.deepEqual(replay.result, first.result);
  const reread = await c.event('tool_hint', 'sale', { step: { phase: 'flow', slot: 'diamond' } });
  assert.equal(reread.result.reused, true);
  assert.equal(reread.result.used, 1);
  assert.equal(reread.state.support.hints.length, 1);
  assert.equal(reread.state.levels.sale.hinted, true);
  assert.equal(reread.state.conceptHints.filter(hint => hint.evidenceKind === 'tool_hint').length, 1);
  assert.equal(reread.state.points, 0);
});

test('全课跨站共用5次法宝，同时请求与刷新重启不会回补额度，已看提示仍能重看', async t => {
  const c = await setup(t);
  const config = { model: 'ventilation', operator: '>=', yes: 'on', no: 'off' };
  await c.event('draft', 'sale', { config });
  await c.event('draft', 'minimum', { config: { operator: '<', yes: 'a', no: 'b' }, input: { a: 3, b: 8 } });
  const steps = [
    ['sale', { phase: 'flow', slot: 'diamond' }],
    ['sale', { phase: 'flow', slot: 'yes' }],
    ['sale', { phase: 'flow', slot: 'no' }],
    ['sale', { phase: 'predict', temperature: 29 }],
    ['minimum', { phase: 'flow', slot: 'diamond' }],
    ['sale', { phase: 'predict', temperature: 30 }]
  ];
  const replies = await Promise.all(steps.map(([id, step]) => c.event('tool_hint', id, { step })));
  assert.equal(replies.filter(reply => reply.status === 200).length, 5);
  assert.equal(replies.filter(reply => reply.code === 'TOOL_HINT_LIMIT').length, 1);
  const reread = await c.event('tool_hint', 'sale', { step: steps[0][1] });
  assert.equal(reread.status, 200);
  assert.equal(reread.result.reused, true);
  assert.equal(reread.result.remaining, 0);
  const latest = await c.api('/api/state?studentId=s1');
  assert.equal(latest.state.support.hints.length, 5);
  assert.ok(latest.state.support.hints.some(hint => hint.levelId === 'minimum'));
  await c.restart();
  const restored = await c.api('/api/state?studentId=s1');
  assert.deepEqual(restored.state.support, latest.state.support);
  const different = await c.event('tool_hint', 'sale', { step: { phase: 'predict', temperature: 31 } });
  assert.equal(different.status, 409);
  assert.equal(different.code, 'TOOL_HINT_LIMIT');
  const otherStudent = await c.event('tool_hint', 'sale', { step: steps[0][1] }, { studentId: 's2' });
  assert.equal(otherStudent.result.used, 1);
  assert.equal(otherStudent.result.remaining, 4);
  await c.api('/api/teacher/lesson-session', { classId: '501' });
  const newRound = await c.api('/api/state?studentId=s1');
  assert.equal(newRound.round, 2);
  assert.deepEqual(newRound.state.support.hints, []);
  const historical = await c.event('tool_hint', 'sale', { step: steps[0][1] });
  assert.equal(historical.status, 409);
});

test('法宝拒绝独立考核和无效步骤，旧草稿不能清空全课支持记录', async t => {
  const c = await setup(t);
  const invalid = await c.event('tool_hint', 'quiz', { step: { phase: 'flow', slot: 'diamond' } });
  assert.equal(invalid.status, 400);
  const badStep = await c.event('tool_hint', 'sale', { step: { phase: 'unknown' } });
  assert.equal(badStep.status, 400);
  const saved = await c.event('tool_hint', 'sale', { step: { phase: 'flow', slot: 'diamond' } });
  const changed = await c.event('draft', 'sale', { support: { hints: [] }, hint: 0 }, { editedAt: 0 });
  assert.deepEqual(changed.state.support, saved.state.support);
  assert.equal(changed.state.levels.sale.hinted, true);
  assert.equal(changed.state.quiz.base.first, null);
  assert.equal(changed.examGate.open, false);
  assert.equal(changed.state.points, 0);
  const teacher = await c.api('/api/teacher?classId=501');
  assert.deepEqual(teacher.students.find(student => student.id === 's1').state.support, saved.state.support);
});

test('旧状态补充法宝默认值时保留原始预测、运行与积分，答案支持标记沿用既有验收机制', async t => {
  const c = await setup(t);
  const config = { model: 'ventilation', operator: '>=', yes: 'on', no: 'off' };
  await c.event('draft', 'sale', { config });
  await c.event('prediction', 'sale', { value: 'off', config, input: { temperature: 30 } });
  for (const temperature of [29, 30, 31]) await c.event('run', 'sale', { config, input: { temperature } });
  const completed = await c.event('complete', 'sale', { config, reason: 'boundary' });
  assert.equal(completed.state.points, 25);
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(c.dir, 'classroom.sqlite'));
  const row = db.prepare('SELECT json FROM states WHERE studentId=? AND round=?').get('s1', 1);
  const original = JSON.parse(row.json);
  delete original.support;
  db.prepare('UPDATE states SET json=? WHERE studentId=? AND round=?').run(JSON.stringify(original), 's1', 1);
  db.close();
  await c.restart();
  const restored = await c.api('/api/state?studentId=s1');
  assert.deepEqual(restored.state.support, { hints: [], scaffolds: [] });
  assert.deepEqual(restored.state.predictions, original.predictions);
  assert.deepEqual(restored.state.runs, original.runs);
  assert.equal(restored.state.points, 25);
  await c.event('tool_hint', 'sale', { step: { phase: 'flow', slot: 'diamond' } });
  const supported = await c.event('complete', 'sale', { config, reason: 'boundary' });
  assert.equal(supported.result.attemptKind, 'hinted');
  assert.equal(supported.state.points, 25);
  assert.deepEqual(supported.state.predictions, original.predictions);
  assert.deepEqual(supported.state.runs, original.runs);
});

test('教师展开证据显示全课法宝用量、本站提示和解析，正文安全显示', async t => {
  const c = await setup(t);
  const saved = await c.event('tool_hint', 'sale', { step: { phase: 'flow', slot: 'diamond' } });
  const vm = require('node:vm');
  let source = fs.readFileSync(path.join(__dirname, '../public/teacher.mjs'), 'utf8').replace(/^import .*;\n/gm, '').replace('load();setInterval(load,5000);', '');
  source += '\nglobalThis.evidenceRows = (students, open) => { data = { examClosedAt: null }; expanded = open ? students[0].id : ""; return rows(students); };';
  const context = { window: { AdventureRules: {} }, document: {}, pointsLabel: () => '0', attemptPercent: () => null };
  vm.runInNewContext(source, context);
  const student = { id: 's1', name: '测试甲', entered: true, lastSync: null, state: saved.state };
  const collapsed = context.evidenceRows([student], false);
  assert.equal(collapsed.includes('本课已用'), false);
  const expanded = context.evidenceRows([student], true);
  assert.match(expanded, /本课已用 1\/5 次/);
  assert.match(expanded, /本站法宝提示 1 次/);
  assert.ok(expanded.includes(saved.result.hint.action));
  assert.ok(expanded.includes(saved.result.hint.why));
  student.state.support.hints[0].action = '<img src=x onerror=alert(1)>';
  assert.ok(context.evidenceRows([student], true).includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('找确认按钮仍占法宝次数，学生独立规则证据不受概念帮助标记污染', async t => {
  const c=await setup(t);
  const answer=await c.event('tool_hint','sale',{step:{phase:'confirm'}});
  assert.equal(answer.result.used,1);
  assert.equal(answer.state.support.hints[0].conceptual,false);
  assert.equal(answer.state.levels.sale.hinted,false);
  assert.equal(answer.state.conceptHints.length,0);
  const config={model:'ventilation',operator:'>=',yes:'on',no:'off'};
  await c.event('draft','sale',{config});
  for(const temperature of [29,30,31])await c.event('run','sale',{config,input:{temperature}});
  const accepted=await c.event('complete','sale',{config,reason:'boundary'});
  assert.equal(accepted.result.passed,true);
  assert.equal(accepted.result.attemptKind,'first');
});
