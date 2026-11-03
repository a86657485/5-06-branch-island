import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from '../engine/node_modules/typescript/lib/typescript.js';
import rules from '../public/rules.js';
const require=createRequire(import.meta.url);
function harness(id='sale'){
 const config=id==='cross'?{yes:'bridge',no:'crossing'}:{model:'ventilation',operator:'>=',yes:'on',no:'off'};
 const context={levelId:id,draft:{config,prediction:id==='cross'?'bridge':'on',scene:{phase:'measured',measured:true,temperatureCase:30,facility:true,actorId:id==='cross'?'cross-open':'sensor30',actions:[id==='cross'?'observe':'measure','predict'],visited:[]}},runs:[],evidenceStart:0,level:{},reasons:[{value:'one',label:'一次只选一路'}]};
 const calls=[],dialogs=[],feedbacks=[],answers=[];
 let scaffold;
 const player={id:'test',syncChanges(){},setVariable(){}};
 const imports={
  '@rpgjs/server':{Components:{text:v=>v},EventMode:{Scenario:'scenario'}},
  '../../classroom-bridge':{getContext:()=>context,request:async(method,payload)=>{calls.push({method,payload});if(method==='change')Object.assign(context.draft,payload.patch);if(method==='evaluate')return rules.evaluate(id,payload.config,payload.input);if(method==='experiment'){const result=rules.evaluate(id,config,payload.input);context.runs.push({config,input:payload.input,...result});return {...result,scaffold};}if(method==='complete')return {passed:true,feedback:'本站验收通过。'};return {}; }},
  '../../gui/ask':{ask:async(_p,data)=>{dialogs.push(data);return answers.shift()??null;}},
  './experiment':require('../engine/src/modules/lesson/experiment.ts'),
  '../../gui/flow-model':require('../engine/src/gui/flow-model.ts'),
  './active-player':{mapForContext:()=>id,waitForActivePlayer:async()=>player}
 };
 const source=fs.readFileSync(new URL('../engine/src/modules/lesson/runtime.ts',import.meta.url),'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(js,{module,exports:module.exports,require:id=>imports[id],console,window:{dispatchEvent:event=>feedbacks.push(event)},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}}});
 return {context,calls,dialogs,feedbacks,answers,player,runtime:module.exports,setScaffold:value=>scaffold=value};
}
test('普通执行直接显示场景结果，不强迫关闭成功弹窗',async()=>{
 const h=harness();await h.runtime.apply(h.player);
 assert.equal(h.context.draft.scene.ticket.output,'on');
 assert.equal(h.dialogs.length,0);
 assert.equal(h.feedbacks[0].type,'lesson-feedback');
});
test('核验仍保存原证据，递进支架只作为短反馈展示',async()=>{
 const h=harness();h.context.draft.scene.actions=['measure','predict','ticket'];h.context.draft.scene.ticket=rules.evaluate('sale',h.context.draft.config,{temperature:30});
 h.setScaffold({level:3,action:'先看条件里的等号。',why:'刚好达到也属于成立。',target:{cardId:'ge30'}});
 await h.runtime.record(h.player,'gate');
 assert.equal(h.calls.filter(c=>c.method==='experiment').length,1);
 assert.equal(h.context.runs.length,1);
 assert.equal(h.dialogs.length,0);
 const helped=h.feedbacks.find(event=>event.detail.level===3);
 assert.equal(helped.detail.target.cardId,'ge30');
 assert.equal(h.context.draft.scene.ticket,undefined);
 assert.match(h.feedbacks.at(-1).detail.text,/风机实际.*启动.*预测.*一致.*告示/);
});

test('风机核验对照实际动作、预测及告示，错误预测不被报成一致',async()=>{
 const h=harness();h.context.draft.prediction='off';h.context.draft.scene.actions=['measure','predict','ticket'];h.context.draft.scene.ticket=rules.evaluate('sale',h.context.draft.config,{temperature:30});
 await h.runtime.record(h.player,'gate');
 assert.match(h.feedbacks.at(-1).detail.text,/风机实际.*启动.*预测.*不同.*符合告示/);
 assert.equal(h.calls.filter(c=>c.method==='experiment').length,1);
 assert.equal(h.dialogs.length,0);
});
test('第三必做站验收后首选基础检测，选做有独立入口',async()=>{
 const h=harness('cross');h.answers.push('one','next');await h.runtime.review(h.player);
 assert.deepEqual(Array.from(h.dialogs[1].choices,c=>c.id),['next','optional']);
 assert.equal(h.dialogs[1].choices[0].label,'进入基础检测');
 assert.equal(h.calls.at(-1).method,'next');
 assert.equal(h.calls.at(-1).payload.optional,undefined);
});
test('明确选择储能选做才发送optional，不改服务端开考判据',async()=>{
 const h=harness('cross');h.answers.push('one','optional');await h.runtime.review(h.player);
 assert.equal(h.calls.at(-1).method,'next');
 assert.equal(h.calls.at(-1).payload.optional,true);
});
