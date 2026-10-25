import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import ts from '../engine/node_modules/typescript/lib/typescript.js';

const require = createRequire(import.meta.url);
const vue = require('../engine/node_modules/vue');
const model = require('../engine/src/gui/flow-model.ts');
const focus = require('../engine/src/gui/assisted-focus.ts');
const script = fs.readFileSync(new URL('../engine/src/gui/FlowPanel.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
const compiled = ts.transpileModule(`${script}\nmodule.exports = { editFlow, choose, undo, showScaffold, highlightChoice, step, toolAnswer };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
}).outputText;

function harness(flow = { diamond: 'ge30', yes: 'on', no: 'off', locked: true }) {
  const context = { levelId: 'sale', draft: { config: { model: 'ventilation', operator: '>=', yes: 'on', no: 'off' } } };
  const props = { mode: 'sale', flow, sentence: { slots: [], locked: true }, predictions: { 29: 'off', 30: 'on', 31: 'on', locked: true } };
  const module = { exports: {} };
  const imports = {
    vue: { ...vue, inject: (_key, fallback) => fallback, onMounted() {}, onUnmounted() {} },
    '../classroom-bridge': { getContext: () => context, request: async () => ({}), subscribeContext: () => () => {} },
    './assisted-focus': focus,
    '../../../public/task-guidance.mjs': { stationBrief: () => ({ purpose: '' }) },
    './plain': { toPlain: value => JSON.parse(JSON.stringify(value)) },
    './SentencePanel.vue': {},
    './flow-model': model
  };
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    require: name => { assert.ok(Object.hasOwn(imports, name), `Unexpected dependency ${name}`); return imports[name]; },
    defineProps: () => props, withDefaults: (value, defaults) => ({ ...defaults, ...value }),
    window: { dispatchEvent() {} }, CustomEvent: class {}, console
  });
  return { ...module.exports, context };
}

function pendingHelp() {
  return { key: randomUUID(), kind: 'run', level: 3, config: { operator: '>=' }, step: { phase: 'flow', slot: 'yes' }, target: { cardId: 'on' } };
}

test('重新选条件后，尚未展示的旧运行帮助不再高亮；新事件仍可帮助当前出口', async () => {
  const h = harness();
  h.context.scaffold = pendingHelp();
  h.showScaffold(h.context);
  assert.equal(h.toolAnswer.value, null);
  h.editFlow();
  h.choose('lt30');
  await vue.nextTick();
  assert.equal(h.step.value.slot, 'yes');
  h.showScaffold(h.context);
  assert.equal(h.highlightChoice('on'), false, '旧 >= 程序的启动卡帮助不能进入新 < 程序');
  h.context.scaffold = { eventKey: randomUUID(), kind: 'run', level: 3, config: { operator: '<' }, step: { phase: 'flow', slot: 'yes' }, target: { cardId: 'off' } };
  h.showScaffold(h.context);
  assert.equal(h.highlightChoice('off'), true, '当前槽位的新 eventKey 帮助仍能显示');
  assert.equal(h.highlightChoice('on'), false);
});

test('撤回也清除尚未展示的帮助，返回旧槽位时不会补亮旧答案', async () => {
  const h = harness({ diamond: 'ge30', yes: '', no: '', locked: false });
  h.choose('off');
  await vue.nextTick();
  assert.equal(h.step.value.slot, 'no');
  h.context.scaffold = pendingHelp();
  h.showScaffold(h.context);
  assert.equal(h.toolAnswer.value, null);
  h.undo();
  await vue.nextTick();
  assert.equal(h.step.value.slot, 'yes');
  h.showScaffold(h.context);
  assert.equal(h.highlightChoice('on'), false);
});
