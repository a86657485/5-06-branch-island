import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from '../engine/node_modules/typescript/lib/typescript.js';
import rules from '../public/rules.js';
const require = createRequire(import.meta.url);
const base = path.resolve(import.meta.dirname, '..');
const model = require('../engine/src/gui/flow-model.ts');
const experiment = require('../engine/src/modules/lesson/experiment.ts');
const layout = JSON.parse(fs.readFileSync(path.join(base, 'engine/src/tiled/layout.json'), 'utf8'));
function compile(file, imports, extras = {}) {
  const source = fs.readFileSync(path.join(base, file), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, require: name => {
    if (Object.hasOwn(imports, name)) return imports[name];
    if (name.endsWith('task-guidance.mjs')) return require('../public/task-guidance.mjs');
    throw new Error(`Unexpected dependency ${name}`);
  }, ...extras, console, setTimeout, clearTimeout, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
  return module.exports;
}
function harness(id = 'sale') {
  const config = id === 'repair' ? { model: 'ventilation', operator: '>=', yes: 'off', no: 'on' } : id === 'cross' ? { yes: 'bridge', no: 'crossing' } : id === 'minimum' ? { operator: '<', yes: 'a', no: 'b' } : { model: 'ventilation', operator: '>=', yes: 'on', no: 'off' };
  const context = { levelId: id, draft: { config, scene: { version: 1, phase: 'assigned', measured: true, actions: [id === 'repair' ? 'inspect' : id === 'cross' ? 'observe' : id === 'minimum' ? 'collect' : 'measure'], visited: [], temperatureCase: 30, facility: true, pair: 'pair-a', actorId: id === 'repair' ? 'sensor30' : id === 'cross' ? 'cross-open' : id === 'minimum' ? 'pair-a' : 'sensor30' } }, runs: [], level: {}, evidenceStart: 0, reasons: [{ value: 'boundary', label: '比较边界' }] };
  const dialogs = [], calls = [], guis = [], answers = [], feedbacks = [];
  const variables = new Map();
  const player = { id: 'test-player', syncChanges() {}, getVariable: key => variables.get(key), setVariable: (key, value) => variables.set(key, value), gui: name => ({ open: async data => { guis.push({ name, data }); return null; } }), x: () => 450, y: () => 340 };
  const runtime = compile('engine/src/modules/lesson/runtime.ts', {
    '@rpgjs/server': { Components: { text: text => ({ text }) }, EventMode: { Scenario: 'Scenario' } },
    '../../classroom-bridge': { getContext: () => context, request: async (method, payload) => {
      calls.push({ method, payload });
      if (method === 'change') Object.assign(context.draft, payload.patch);
      if (method === 'predict') context.draft.prediction = payload.value;
      if (method === 'evaluate') return rules.evaluate(id, payload.config, payload.input);
      if (method === 'experiment') { const result = rules.evaluate(id, config, payload.input); context.runs.push({ config: { ...config }, input: payload.input, scene: payload.sceneEvidence, ...result }); return result; }
      return { saved: true };
    } },
    '../../gui/ask': { ask: async (_player, data) => { dialogs.push(data); return answers.shift() ?? null; } },
    './experiment': experiment,
    '../../gui/flow-model': model,
    './active-player': { waitForActivePlayer: async () => player, mapForContext: () => 'test-map' }
  }, { window: { dispatchEvent: event => feedbacks.push(event.detail) }, CustomEvent: class { constructor(type, options) { this.type=type; this.detail=options.detail; } } });
  const imports = { './runtime': runtime, '../../gui/flow-model': model, '../../tiled/layout.json': layout, '@rpgjs/common': { Direction: { Right: 'right' } }, '@rpgjs/server': { EventMode: { Scenario: 'Scenario' }, Components: { text: text => ({ text }) } }, './route-progress.mjs': require('../engine/src/modules/lesson/route-progress.mjs'), './greenhouse-cast': { actorIdOf: id => id, planGreenhouseSync: () => [] } };
  const thermal = compile('engine/src/modules/lesson/thermal.ts', imports);
  const routes = compile('engine/src/modules/lesson/routes.ts', imports);
  const act = async (events, eventId) => events.find(item => item.id === eventId).event.onAction(player);
  return { context, runtime, thermal, routes, dialogs, calls, guis, answers, feedbacks, player, variables, act };
}
function run(id, config, input, correct = true) { return { config: { ...config }, input, correct, ...(id === 'cross' ? { scene: { outcome: correct ? 'arrived' : 'blocked' } } : {}) }; }

test('返修第一次在原30℃程序上先预测、再次点击才运行，不打开编辑器代替故障', async () => {
  const h = harness('repair'); h.answers.push('off');
  await h.runtime.configure(h.player);
  assert.equal(h.guis.length, 0);
  assert.equal(h.calls.filter(call => call.method === 'predict').length, 1);
  assert.equal(h.context.draft.scene.ticket, undefined);
  assert.match(h.dialogs[0].text, /30/);
  assert.match(h.dialogs[0].program.condition, /≥|>=/);
  assert.equal(h.dialogs[0].program.yes, '关闭风机');
  assert.equal(h.dialogs[0].program.no, '启动风机');
  await h.runtime.configure(h.player);
  assert.equal(h.context.draft.scene.ticket.output, 'off');
  assert.equal(h.context.draft.scene.ticket.correct, false);
  assert.equal(h.calls.filter(call => call.method === 'predict').length, 1);
});

test('关闭预测对话不选择答案、不运行；故障核验后未重新读数也可先修图', async () => {
  const h = harness('repair');
  await h.runtime.configure(h.player);
  assert.equal(h.calls.length, 0);
  h.context.runs.push(run('repair', h.context.draft.config, { temperature: 30 }, false));
  h.context.draft.scene.measured = false;
  await h.runtime.configure(h.player);
  assert.equal(h.guis.length, 1);
  assert.equal(h.guis[0].data.diagnosed, true);
  assert.equal(h.guis[0].data.measured, false);
});

test('路口和储能控制台只打开当前一步：画图、预测、运行，不给并行菜单', async () => {
  for (const [id, eventId] of [['cross', 'road-console'], ['minimum', 'energy-console']]) {
    const h = harness(id), events = id === 'cross' ? h.routes.crossingEvents : h.routes.energyEvents;
    await h.act(events, eventId);
    assert.equal(h.guis.length, 1, id);
    assert.equal(h.dialogs.length, 0, id);
    h.context.draft.flow = { locked: true };
    h.answers.push(id === 'cross' ? 'bridge' : 'a');
    await h.act(events, eventId);
    assert.equal(h.calls.filter(call => call.method === 'predict').length, 1, id);
    assert.equal(h.context.draft.scene.ticket, undefined, id);
    const before = h.feedbacks.length;
    await h.act(events, eventId);
    assert.ok(h.context.draft.scene.ticket, id);
    assert.equal(h.feedbacks.length - before, 1, `${id}一次运行只给一条现场短反馈`);
  }
});

test('四站负责人初次只给领取委托，未跑齐不提供验收捷径', async () => {
  const problems={sale:/没法.*守.*读温度/,repair:/备用.*30℃.*先.*旧程序/,cross:/游客.*不知.*观察/,minimum:/一个.*充电口.*读.*电量/};
  for (const id of ['sale', 'repair', 'cross', 'minimum']) {
    const h = harness(id); h.context.draft.scene.phase = 'start';
    const events = ['sale', 'repair'].includes(id) ? h.thermal.greenhouseEvents : id === 'cross' ? h.routes.crossingEvents : h.routes.energyEvents;
    const eventId = ['sale', 'repair'].includes(id) ? 'guide' : id === 'cross' ? 'road-guide' : 'energy-guide';
    await h.act(events, eventId);
    assert.equal(h.dialogs[0].choices.length, 1, id);
    assert.equal(h.dialogs[0].choices[0].id, 'accept', id);
    assert.match(h.dialogs[0].text, problems[id], id);
    assert.equal(h.calls.some(call => call.method === 'complete'), false, id);
  }
});

test('传感器建议首个尚未正确核验温度，返修故障首次只给30℃', async () => {
  const h = harness('sale'); h.context.runs.push(run('sale', h.context.draft.config, { temperature: 29 }));
  await h.act(h.thermal.greenhouseEvents, 'sensor');
  assert.equal(h.dialogs[0].choices.length, 3);
  assert.match(h.dialogs[0].text, /试读30|建议.*30/);
  const repair = harness('repair');
  await repair.act(repair.thermal.greenhouseEvents, 'sensor');
  assert.deepEqual(JSON.parse(JSON.stringify(repair.dialogs[0].choices.map(choice => choice.id))), ['30']);
});

test('单击信号灯只提供等待绿灯，错误天桥入口和走完整路线约束保留', async () => {
  const h = harness('cross'); h.context.draft.scene.signal = 'red'; h.answers.push('green');
  await h.act(h.routes.crossingEvents, 'road-signal');
  assert.equal(h.dialogs[0].choices.length, 1);
  assert.equal(h.dialogs[0].choices[0].id, 'green');
  assert.equal(h.context.draft.scene.signal, 'green');
  const source = fs.readFileSync(path.join(base, 'engine/src/modules/lesson/routes.ts'), 'utf8');
  assert.match(source, /advanceRoute\(/);
  assert.match(source, /closedBridgeSelected\(/);
  assert.match(source, /phase !== 'arrived'/);
});

test('现场核验只显示一条结果与下一步，不重复演出或让学生二次确认匹配', async () => {
  for (const [id, eventId] of [['cross', 'road-verify'], ['minimum', 'energy-verify']]) {
    const h = harness(id), values = id === 'cross' ? { facility: true } : { a: 3, b: 8 };
    const result = rules.evaluate(id, h.context.draft.config, values);
    h.context.draft.prediction = id === 'cross' ? 'bridge' : 'a';
    h.context.draft.scene = { ...h.context.draft.scene, actions: [id === 'cross' ? 'observe' : 'collect', 'predict', 'route'], phase: 'arrived', ticket: result };
    await h.act(id === 'cross' ? h.routes.crossingEvents : h.routes.energyEvents, eventId);
    assert.equal(h.dialogs.length, 0, id);
    assert.equal(h.feedbacks.length, 1, id);
    assert.match(h.feedbacks[0].text, /换一种|负责人|再读/, id);
    assert.match(h.feedbacks[0].text, id === 'cross' ? /实际.*对岸.*预测.*一致.*约定/ : /实际接入电池A.*3%.*预测.*一致.*低电量/, id);
    assert.equal(h.calls.filter(call => call.method === 'experiment').length, 1, id);
    assert.equal(h.context.runs.length, 1, id);
    assert.equal(h.context.draft.scene.ticket, undefined, id);
  }
});

test('路口错误选中不可用天桥时核验反馈保留受阻结果，不冒称已经到岸', async () => {
  const h=harness('cross');
  h.context.draft.config.no='bridge';
  h.context.draft.scene.facility=false;
  h.context.draft.prediction='bridge';
  h.context.draft.scene.actions=['observe','predict'];
  h.context.draft.scene.ticket=rules.evaluate('cross',h.context.draft.config,{facility:false});
  await h.act(h.routes.crossingEvents,'bridge-entrance');
  assert.equal(h.calls.filter(call=>call.method==='experiment').length,1);
  assert.match(h.feedbacks[0].text,/受阻.*安全侧.*预测.*一致.*不符合.*约定/);
  assert.doesNotMatch(h.feedbacks[0].text,/实际.*对岸/);
});

test('负责人先完成当前现场，再换未正确核验的一种；改程序后不能借旧记录跳验收', async () => {
  for (const id of ['cross', 'minimum']) {
    const h = harness(id), events = id === 'cross' ? h.routes.crossingEvents : h.routes.energyEvents;
    const eventId = id === 'cross' ? 'road-guide' : 'energy-guide';
    if (id === 'cross') h.context.draft.scene.facility = false;
    else h.context.draft.scene.pair = 'pair-b';
    await h.act(events, eventId);
    assert.equal(h.dialogs[0].choices[0].id, 'continue', id);
    h.dialogs.length = 0;
    h.context.runs.push(run(id, h.context.draft.config, id === 'cross' ? { facility: false } : { a: 9, b: 2 }));
    h.answers.push('next-case');
    await h.act(events, eventId);
    assert.equal(h.dialogs[0].choices.length, 1, id);
    assert.equal(h.dialogs[0].choices[0].id, 'next-case', id);
    assert.equal(id === 'cross' ? h.context.draft.scene.facility : h.context.draft.scene.pair, id === 'cross' ? true : 'pair-a');
    h.context.runs.push(run(id, h.context.draft.config, id === 'cross' ? { facility: true } : { a: 3, b: 8 }));
    h.dialogs.length = 0;
    await h.act(events, eventId);
    assert.equal(h.dialogs[0].name, '验收负责人', id);
    h.context.draft.config = { ...h.context.draft.config, yes: id === 'cross' ? 'crossing' : 'b' };
    assert.equal(h.runtime.canReview(), false, id);
  }
});

test('温室验收仍要求当前程序29、30、31均正确，返修还必须保留原故障', () => {
  for (const id of ['sale', 'repair']) {
    const h = harness(id), fixed = { model: 'ventilation', operator: '>=', yes: 'on', no: 'off' };
    h.context.draft.config = fixed;
    h.context.runs = [29, 30].map(temperature => run(id, fixed, { temperature }));
    assert.equal(h.runtime.canReview(), false, id);
    h.context.runs.push(run(id, fixed, { temperature: 31 }));
    assert.equal(h.runtime.canReview(), id === 'sale', id);
    if (id === 'repair') {
      h.context.runs.unshift(run(id, { model: 'ventilation', operator: '>=', yes: 'off', no: 'on' }, { temperature: 30 }, false));
      assert.equal(h.runtime.canReview(), true);
    }
    h.context.evidenceStart = h.context.runs.length - 1;
    assert.equal(h.runtime.canReview(), false, id);
  }
});

test('锁定错误程序核验后控制台重新打开编辑器，随后某次正确也不能掩盖原错误', async () => {
  for (const [id, consoleId, verifyId] of [['cross', 'road-console', 'road-verify'], ['minimum', 'energy-console', 'energy-verify']]) {
    const h = harness(id), events = id === 'cross' ? h.routes.crossingEvents : h.routes.energyEvents;
    h.context.draft.config.yes = id === 'cross' ? 'crossing' : 'b';
    h.context.draft.flow = { diamond: id === 'cross' ? 'bridge-q' : 'lt', yes: h.context.draft.config.yes, no: h.context.draft.config.no, locked: true };
    h.context.draft.prediction = h.context.draft.config.yes;
    const values = id === 'cross' ? { facility: true } : { a: 3, b: 8 };
    h.context.draft.scene = { ...h.context.draft.scene, actions: [id === 'cross' ? 'observe' : 'collect', 'predict', 'route'], phase: 'arrived', ticket: rules.evaluate(id, h.context.draft.config, values) };
    await h.act(events, verifyId);
    assert.equal(h.context.runs[0].correct, false, id);
    assert.equal(h.context.draft.flow.locked, true, id);
    assert.equal(h.context.draft.scene.measured, false, id);
    await h.act(events, consoleId);
    assert.equal(h.guis.length, 1, `${id}错误图核验后可以重新选卡`);
    assert.equal(h.guis[0].data.measured, false, id);
    h.context.runs.push(run(id, h.context.draft.config, id === 'cross' ? { facility: false } : { a: 9, b: 2 }));
    await h.act(events, consoleId);
    assert.equal(h.guis.length, 2, `${id}当前方案中的早先错误仍需修订`);
    h.context.draft.config.yes = id === 'cross' ? 'bridge' : 'a';
    assert.equal(h.runtime.currentRuns().length, 0, `${id}修正后不再借用旧方案证据`);
  }
});

 test('四站预测同屏展示当前条件和两边动作，关闭不代答', async () => {
  for (const id of ['sale','repair','cross','minimum']) {
    const h=harness(id);
    await h.runtime.predict(h.player);
    const dialog=h.dialogs[0];
    assert.ok(dialog.program?.condition,id);
    assert.ok(dialog.program?.yes && dialog.program?.no,id);
    assert.notEqual(dialog.program.yes,dialog.program.no,id);
    assert.equal(h.calls.length,0,id);
  }
});

test('现场预测追问当前程序，故障旧板和错误出口仍按真实程序展示', async () => {
  const prompts={sale:/探头读到30℃.*按你设的程序.*风机/,repair:/旧板.*30℃.*按屏上程序.*风机/,cross:/现场.*可用设施.*按屏上程序.*游客.*哪一路/,minimum:/A.*3%.*B.*8%.*按程序.*哪块.*先接/};
  for(const id of ['sale','repair','cross','minimum']){
    const h=harness(id);
    if(id==='sale')h.context.draft.config={model:'ventilation',operator:'>',yes:'on',no:'off'};
    if(id==='cross')h.context.draft.config={yes:'crossing',no:'bridge'};
    if(id==='minimum')h.context.draft.config={operator:'<',yes:'b',no:'a'};
    await h.runtime.predict(h.player);
    const dialog=h.dialogs[0];
    assert.match(dialog.text,prompts[id],id);
    if(id==='sale')assert.match(dialog.program.condition,/＞30/);
    if(id==='repair')assert.equal(dialog.program.yes,'关闭风机');
    if(id==='cross')assert.equal(dialog.program.yes,'走人行横道');
    if(id==='minimum')assert.equal(dialog.program.yes,'先给电池B充电');
    assert.equal(h.calls.length,0,id);
  }
  const fixed=harness('repair');
  fixed.context.runs.push(run('repair',fixed.context.draft.config,{temperature:30},false));
  fixed.context.draft.config={model:'ventilation',operator:'>=',yes:'on',no:'off'};
  fixed.context.draft.scene.temperatureCase=29;
  await fixed.runtime.predict(fixed.player);
  assert.match(fixed.dialogs[0].text,/修后.*29℃.*按屏上程序/);
});

test('验收追问刚才现场的理由，仍只提交原有理由一次', async () => {
  const prompts={sale:/阿绿.*为何.*30℃/,repair:/老修.*旧板.*30℃.*关.*修后.*开.*哪里.*为何/,cross:/小巡.*为何.*每次.*一路/,minimum:/小电.*为何.*一直.*A/};
  for(const id of ['sale','repair','cross','minimum']){
    const h=harness(id);
    await h.runtime.review(h.player);
    assert.equal(h.dialogs[0].name,'验收负责人');
    assert.match(h.dialogs[0].text,prompts[id],id);
    assert.equal(h.calls.length,0,id);
  }
});

test('现场阳光温度实验台可一键连测29/30/31℃并生成标准四步证据，免去7趟折返跑', async () => {
  const h = harness('sale');
  await h.runtime.quickThermalSweep(h.player, { 29: 'off', 30: 'on', 31: 'on' });
  assert.equal(h.context.runs.length, 3);
  assert.deepEqual(h.context.runs.map(r => r.input.temperature), [29, 30, 31]);
  for (const run of h.context.runs) {
    assert.deepEqual(run.scene.actions, ['measure', 'predict', 'ticket', 'gate']);
    assert.equal(run.correct, true);
  }
  assert.equal(h.runtime.canReview(), true);
});
