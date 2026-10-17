import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function setup(lan = false) {
  const sessionId=lan?'01'.repeat(16):'test-session';
  const file = new URL('../public/rpg-scene.mjs', import.meta.url);
  assert.ok(fs.existsSync(file), '需要实现 RPGJS 课堂桥接');
  const messages = [], calls = [], listeners = new Map(), timers = new Map();
  const frameWindow = { postMessage: (data, origin) => messages.push({ data, origin }) };
  const nodes = new Map();
  const root = { innerHTML: '', querySelector(selector) {
    if (selector === 'iframe') return { contentWindow: frameWindow, addEventListener() {}, remove() {} };
    if (!nodes.has(selector)) nodes.set(selector, { hidden: false, textContent: '', href: '' });
    return nodes.get(selector);
  }};
  const window = { location: { origin: 'http://classroom.local', href: 'http://classroom.local/?demo=1' },
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const drafts = { sale: {}, repair: {} };
  let active = 'sale';
  const makeHost = levelId => ({ root, levelId, demo: true, reasons: [],
    getDraft: () => drafts[levelId], getRuns: () => [], getLevel: () => ({}), getEvidenceStart: () => 0,
    onChange: patch => { calls.push(['change', levelId, patch]); Object.assign(drafts[levelId], patch); },
    onPrediction: value => { calls.push(['predict', levelId, value]); return true; },
    onEvaluate: value => { calls.push(['evaluate', levelId, value]); return { output: 'on' }; },
    onExperiment: value => { calls.push(['experiment', levelId, value]); return { correct: true }; },
    onReason: value => calls.push(['reason', levelId, value]), onComplete: options => { calls.push(['complete', levelId, options]); return { passed: true }; },
    onNext: () => { active = 'repair'; scene.navigate(active); return { levelId: active }; },
    onFlow() {}, onHelp() {}, forLevel: id => makeHost(id)
  });
  const context = vm.createContext({ window, location: window.location, URL, URLSearchParams, JSON, Error, Map, Set,
    crypto: lan?{getRandomValues:values=>values.fill(1)}:{randomUUID:()=>sessionId},
    setTimeout: fn => { timers.set(timers.size + 1, fn); return timers.size; }, clearTimeout: id => timers.delete(id) });
  vm.runInContext(fs.readFileSync(file, 'utf8').replace(/export /g, '') + '\nglobalThis.factory=createRpgScene;', context);
  const scene = context.factory(makeHost(active));
  const receive = async (data, origin = window.location.origin, source = frameWindow) => {
    await listeners.get('message')?.({ data: { sessionId, ...data }, origin, source });
  };
  const call = (method, payload = {}, requestId = `request-${calls.length}`) => receive({ type: 'rpgjs-call', method, payload: { levelId: active, ...payload }, requestId });
  return { scene, messages, calls, receive, call, frameWindow, listeners, timers, drafts, root };
}

test('RPGJS 桥接只接受当前同源引擎窗口的握手与请求', async () => {
  const h = setup();
  await h.receive({ type: 'rpgjs-ready' }, 'http://outside.test');
  await h.receive({ type: 'rpgjs-ready' }, undefined, {});
  await h.receive({ type: 'rpgjs-ready', sessionId: 'old-session' });
  assert.equal(h.messages.length, 0);
  await h.receive({ type: 'rpgjs-ready' });
  assert.equal(h.messages[0].data.type, 'rpgjs-init');
  assert.equal(h.messages[0].data.context.levelId, 'sale');
  await h.call('experiment', { input: { temperature: 30 } }, 'run-1');
  assert.equal(h.calls.filter(call => call[0] === 'experiment').length, 1);
  assert.equal(h.messages.at(-1).data.result.value.correct, true);
});

test('重复引擎请求只记一次实验，换场景保留同一引擎并拒绝旧关卡回调', async () => {
  const h = setup();
  await h.receive({ type: 'rpgjs-ready' });
  await h.call('experiment', {}, 'duplicate');
  await h.call('experiment', {}, 'duplicate');
  assert.equal(h.calls.filter(call => call[0] === 'experiment').length, 1);
  await h.call('next', {}, 'next-1');
  assert.equal(h.messages.at(-1).data.result.context.levelId, 'repair');
  await h.call('change', { levelId: 'sale', prediction: 'off' }, 'stale');
  assert.match(h.messages.at(-1).data.error, /任务|场景/);
  assert.equal(h.drafts.sale.prediction, undefined);
  await h.call('change', { prediction: 'on' }, 'new');
  assert.equal(h.drafts.repair.prediction, 'on');
});

test('checkpoint 单列保存位置，核验只通过实验接口提交，验收不销毁场景', async () => {
  const h = setup();
  await h.receive({ type: 'rpgjs-ready' });
  const rpg = { version: 1, engine: 'rpgjs', mapId: 'greenhouse', position: { x: 256, y: 384 }, direction: 'up' };
  await h.call('checkpoint', rpg, 'checkpoint');
  assert.equal(h.drafts.sale.rpg.mapId, 'greenhouse');
  assert.equal(h.calls.filter(call => call[0] === 'experiment').length, 0);
  await h.call('evaluate', { input: { temperature: 30 } }, 'evaluate');
  assert.equal(h.messages.at(-1).data.result.value.output, 'on');
  assert.equal(h.calls.filter(call => call[0] === 'experiment').length, 0);
  await h.call('complete', {}, 'complete');
  assert.equal(h.calls.at(-1)[2].deferRender, true);
  h.scene.destroy();
  assert.equal(h.listeners.has('message'), false);
  const before = h.calls.length;
  await h.call('experiment', {}, 'after-dispose');
  assert.equal(h.calls.length, before);
});

test('引擎加载失败提供显式旧版入口，不自动切换或清空课堂草稿', () => {
  const h = setup();
  for (const fn of h.timers.values()) fn();
  assert.match(h.root.innerHTML, /engine=legacy/);
  assert.equal(h.calls.length, 0);
});

test('普通HTTP局域网没有randomUUID也能建立引擎会话',async()=>{const h=setup(true);await h.receive({type:'rpgjs-ready'});assert.equal(h.messages[0].data.type,'rpgjs-init');assert.equal(h.messages[0].data.sessionId,'01'.repeat(16));});
