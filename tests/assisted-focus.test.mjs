import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const focus = await import('../engine/src/gui/assisted-focus.ts').catch(() => ({}));
const source = path => fs.readFileSync(new URL('../'+path, import.meta.url), 'utf8');

test('普通候选没有答案焦点，主动法宝只标当前一步的一个位置', () => {
 assert.equal(typeof focus.assistedChoice, 'function');
 assert.equal(focus.assistedChoice(null, 'flow:yes', 'on'), false);
 const help={origin:'tool',stepKey:'flow:yes',target:{cardId:'on'}};
 assert.equal(focus.assistedChoice(help, 'flow:yes', 'on'), true);
 assert.equal(focus.assistedChoice(help, 'flow:yes', 'off'), false);
 assert.equal(focus.assistedChoice(help, 'flow:no', 'on'), false);
});

test('第二级支架只圈关键字段，第三级才允许局部示范答案', () => {
 assert.equal(typeof focus.assistedField, 'function');
 const help={origin:'scaffold',level:2,stepKey:'flow:yes',target:{focusKey:'condition',cardId:'on'}};
 assert.equal(focus.assistedChoice(help,'flow:yes','on'),false);
 assert.equal(focus.assistedField(help,'flow:yes','condition'),true);
 assert.equal(focus.assistedField(help,'flow:no','condition'),false);
 assert.equal(focus.assistedChoice({...help,level:3},'flow:yes','on'),true);
});

test('普通预测焦点落在区域或提交，不给未作答按钮批量描框',()=>{
 const standalone=source('engine/src/standalone.ts');
 const html=source('engine/index.html');
 assert.doesNotMatch(standalone,/querySelectorAll\('\.predict-row\.next button'\)/);
 assert.doesNotMatch(html,/\.predict-row\.next button\s*\{/);
 assert.match(html,/\.predict-table\.focus-target/);
});

test('先学回顾入口不消耗法宝，控制柜和NPC里都可打开',()=>{
 for(const path of ['engine/src/gui/FlowPanel.vue','engine/src/gui/LessonDialog.vue','engine/src/standalone.ts']){
  const text=source(path);
  assert.match(text,/request\('learn'/,path);
 }
});
test('法宝示范还可定位当前确认或运行按钮，关闭后不保留',()=>{
 assert.equal(typeof focus.assistedOperation,'function');
 const help={origin:'tool',stepKey:'confirm',target:{focusKey:'flow-lock'}};
 assert.equal(focus.assistedOperation(help,'confirm','flow-lock'),true);
 assert.equal(focus.assistedOperation(help,'predict','flow-lock'),false);
 assert.equal(focus.assistedOperation(null,'confirm','flow-lock'),false);
});

test('同一支架关闭再开面板不会重复展示，新事件和不同界面仍能收到帮助',()=>{
 assert.equal(typeof focus.claimScaffold,'function');
 assert.equal(focus.claimScaffold('flow:sale','event-reopen'),true);
 assert.equal(focus.claimScaffold('flow:sale','event-reopen'),false);
 assert.equal(focus.claimScaffold('flow:sale','event-next'),true);
 assert.equal(focus.claimScaffold('dialog:sale','event-reopen'),true);
});

test('三级是出口帮助不能在否出口复用同名卡片高亮',()=>{
 assert.equal(typeof focus.scaffoldMatches,'function');
 const help={step:{phase:'flow',slot:'yes'}};
 assert.equal(focus.scaffoldMatches(help,{phase:'flow',slot:'yes'}),true);
 assert.equal(focus.scaffoldMatches(help,{phase:'flow',slot:'no'}),false);
 assert.equal(focus.scaffoldMatches(help,{phase:'predict',temperature:30}),false);
 assert.equal(focus.scaffoldMatches({step:{phase:'flow'}},{phase:'flow',slot:'diamond'}),true);
});
