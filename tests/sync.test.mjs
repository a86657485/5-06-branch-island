import test from 'node:test';
import assert from 'node:assert/strict';
import { SyncQueue } from '../public/sync.mjs';
import * as sync from '../public/sync.mjs';

test('保存确认保留页面正在编辑的草稿引用，后续选择与答案不丢失', () => {
  assert.equal(typeof sync.reconcileState, 'function');
  const draft = { config: { yes: '5', no: '' } };
  const answers = { answers: [0, null], index: 0 };
  const local = { drafts: { sale: draft, quiz: answers }, points: 0 };
  const remote = { drafts: { sale: { config: { yes: '5', no: '' } }, quiz: { answers: [0, null], index: 0 } }, points: 25 };
  const current = sync.reconcileState(local, remote);
  draft.config.no = '10';
  answers.answers[1] = 2;
  assert.equal(current.drafts.sale.config.no, '10');
  assert.equal(current.drafts.quiz.answers[1], 2);
  assert.equal(current.points, 25);
  assert.equal(sync.reconcileState(local, remote, false).drafts, remote.drafts);
});

test('断网不丢事件，换人后按原身份补传且不重复发送', async () => {
  const values = new Map();
  const storage = { getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, v) };
  let online = false;
  const sent = [];
  const send = async e => { if (!online) throw new Error('offline'); sent.push(e); return { state: { points: 25 } }; };
  const queue = new SyncQueue(storage, send);
  queue.add({ studentId: 'one', round: 1, eventId: 'a' });
  await queue.flush();
  queue.add({ studentId: 'two', round: 1, eventId: 'b' });
  assert.equal(queue.pending(), 2);
  online = true;
  await Promise.all([queue.flush(), queue.flush()]);
  assert.deepEqual(sent.map(e => e.studentId), ['one', 'two']);
  assert.equal(queue.pending(), 0);
  await queue.flush();
  assert.equal(sent.length, 2);
});

test('服务拒绝的证据保留，刷新后仍可查，不静默删除', async () => {
  const values = new Map();
  const storage = { getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, v) };
  const queue = new SyncQueue(storage, async () => { throw new Error('本轮不匹配'); });
  queue.add({ studentId: 'one', round: 1, eventId: 'a' });
  await queue.flush();
  assert.equal(queue.pending('one'), 1);
  assert.match(queue.error, /本轮/);
  assert.equal(new SyncQueue(storage, async () => ({})).pending('one'), 1);
});

test('已失效的旧卷完整归档后解除阻塞，后续学习事件仍可同步', async () => {
  const values = new Map();
  const storage = { getItem:k=>values.get(k)||null, setItem:(k,v)=>values.set(k,v) };
  const sent=[];const archived=[];
  const old={studentId:'one',round:1,eventId:'old',type:'quiz',payload:{quizVersion:'old',answers:[0,1]}};
  const queue=new SyncQueue(storage,async e=>{if(e.type==='quiz')throw Object.assign(new Error('版本失效'),{code:'QUIZ_VERSION_MISMATCH'});sent.push(e.eventId);return{};},()=>{},e=>archived.push(e.eventId));
  queue.add(old);queue.add({studentId:'one',round:1,eventId:'new',type:'draft',payload:{}});
  await queue.flush();
  assert.equal(queue.pending(),0);assert.deepEqual(sent,['new']);assert.deepEqual(archived,['old']);
  const restored=new SyncQueue(storage,async()=>({}));
  assert.deepEqual(restored.archived()[0].event,old);
  assert.equal(restored.archived()[0].reason,'版本失效');
});

test('校验拒绝的记录会留下说明并让后面的记录继续同步', async () => {
  const values = new Map();
  const storage = { getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, v) };
  const sent = [];
  const rejected = [];
  const queue = new SyncQueue(storage, async event => {
    if (event.eventId === 'bad') throw Object.assign(new Error('请检查判断条件'), { status: 400 });
    sent.push(event.eventId);
    return {};
  }, () => {}, () => {}, (event, error) => rejected.push([event.eventId, error.message]));
  queue.add({ studentId: 'one', round: 1, eventId: 'bad', type: 'draft' });
  queue.add({ studentId: 'one', round: 1, eventId: 'next', type: 'run' });
  await queue.flush();
  assert.deepEqual(sent, ['next']);
  assert.equal(queue.pending(), 0);
  assert.deepEqual(rejected, [['bad', '请检查判断条件']]);
  assert.equal(queue.archived()[0].reason, '请检查判断条件');
});

test('普通409冲突继续保留，不能被当作旧题库错误归档', async () => {
  const values=new Map();const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
  const queue=new SyncQueue(storage,async()=>{throw Object.assign(new Error('轮次不一致'),{status:409});});
  queue.add({studentId:'one',round:1,eventId:'keep',type:'quiz',payload:{}});
  await queue.flush();assert.equal(queue.pending(),1);assert.deepEqual(queue.archived(),[]);
});

test('较旧保存回应不回滚已确认的法宝次数和答案支持证据', () => {
  const a = { key: 'a', levelId: 'sale', action: '选择条件', why: '条件能判断真假', at: '2026-10-24T00:00:00.000Z' };
  const b = { key: 'b', levelId: 'repair', action: '交换出口', why: '保持原规则', at: '2026-10-24T00:01:00.000Z' };
  const local = { drafts: { sale: {} }, support: { hints: [a, b] }, conceptHints: [{ levelId: 'repair', evidenceKind: 'tool_hint', key: 'b', at: b.at }], levels: { repair: { hinted: true } } };
  const remote = { drafts: { sale: {} }, support: { hints: [a] }, conceptHints: [], levels: { repair: { hinted: false } } };
  const result = sync.reconcileState(local, remote);
  assert.deepEqual(result.support.hints, [a, b]);
  assert.equal(result.levels.repair.hinted, true);
  assert.equal(result.conceptHints.length, 1);
  const noSupport = sync.reconcileState(local, { drafts: {}, levels: {} }, false);
  assert.deepEqual(noSupport.support.hints, [a, b]);
  assert.equal(noSupport.levels.repair.hinted, true);
});

test('纯操作法宝同步保留次数，不产生概念帮助标记；旧记录按概念帮助保留',()=>{
 const hint={key:'confirm',levelId:'sale',conceptual:false};
 const result=sync.reconcileState({support:{hints:[hint]},levels:{}},{support:{hints:[]},levels:{}});
 assert.equal(result.support.hints.length,1);
 assert.notEqual(result.levels.sale?.hinted,true);
 const legacy=sync.reconcileState({support:{hints:[{key:'legacy',levelId:'sale'}]}},{levels:{}});
 assert.equal(legacy.levels.sale.hinted,true);
});
