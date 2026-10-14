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
