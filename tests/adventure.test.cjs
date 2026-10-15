'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rules = require('../public/rules.js');
const source = path.join(__dirname,'../public/adventure-rules.js');
function adventure() { assert.ok(fs.existsSync(source),'需要实现场景证据校验'); return require(source); }
const sale={operator:'<',yes:'5',no:'10'};
const evidence={version:1,station:'sale',actorId:'visitor120',actions:['measure','predict','ticket','gate'],destination:'10',prediction:'5'};
const draft={version:1,x:300,y:220,facing:'down',actorId:'visitor120',phase:'gate',measured:true,actions:['measure','predict','ticket'],visited:['guide','measure'],lastFeedback:'请到闸机检验。'};

test('场景证据保留错误预测，且演员、输入、动作与模型输出相符',()=>{
  const a=adventure();
  assert.deepEqual(a.validateEvidence('sale',evidence,{height:120},rules.evaluate('sale',sale,{height:120})),evidence);
  assert.deepEqual(a.ACTORS.visitor120.input,{height:120});
  assert.throws(()=>a.validateEvidence('sale',evidence,{height:119},rules.evaluate('sale',sale,{height:119})),/角色|游客|输入/);
  assert.throws(()=>a.validateEvidence('sale',{...evidence,destination:'5'},{height:120},rules.evaluate('sale',sale,{height:120})),/结果|输出|目的/);
  for (const change of [{version:2},{station:'repair'},{actorId:'bad'},{actions:['predict','measure','ticket','gate']},{prediction:'yes'}]) {
    assert.throws(()=>a.validateEvidence('sale',{...evidence,...change},{height:120},rules.evaluate('sale',sale,{height:120})),/场景|预测|角色|步骤|任务/);
  }
});
test('错误配置的实际错票仍是可观察的实验，不误当正确结果',()=>{
  const a=adventure(),config={operator:'>=',yes:'5',no:'10'},input={height:120};
  const scene={...evidence,station:'repair',actions:['inspect','predict','ticket','gate'],destination:'5',prediction:'10'};
  const evaluated=rules.evaluate('repair',config,input);
  assert.equal(evaluated.correct,false);
  assert.deepEqual(a.validateEvidence('repair',scene,input,evaluated),scene);
});
test('路口与双数演员限定实际现场输入，双数预测按变量解释',()=>{
  const a=adventure();
  const cross={version:1,station:'cross',actorId:'cross-closed',actions:['observe','predict','route','verify'],destination:'crossing',prediction:'bridge'};
  assert.deepEqual(a.validateEvidence('cross',cross,{facility:false},rules.evaluate('cross',{yes:'bridge',no:'crossing'},{facility:false})),cross);
  assert.throws(()=>a.validateEvidence('cross',cross,{facility:true},rules.evaluate('cross',{yes:'bridge',no:'crossing'},{facility:true})),/角色|输入|现场/);
  const pair={version:1,station:'minimum',actorId:'pair-b',actions:['collect','predict','route','verify'],destination:'2',prediction:'b'};
  assert.deepEqual(a.validateEvidence('minimum',pair,{a:9,b:2},rules.evaluate('minimum',{operator:'<',yes:'a',no:'b'},{a:9,b:2})),pair);
  assert.throws(()=>a.validateEvidence('minimum',pair,{a:8,b:2},rules.evaluate('minimum',{operator:'<',yes:'a',no:'b'},{a:8,b:2})),/角色|输入|现场/);
});
test('场景草稿只保存有限坐标与短摘要，缓存票据不改变评估',()=>{
  const a=adventure(),ticket=rules.evaluate('sale',sale,{height:120});
  const cleaned=a.validateSceneDraft({...draft,ticket,unknown:'不需要保存'});
  assert.equal(cleaned.ticket.output,'10');assert.equal(cleaned.ticket.branch,'no');
  assert.equal('trace' in cleaned.ticket,false);assert.equal('unknown' in cleaned,false);
  assert.deepEqual(a.validateSceneDraft({...draft,actorId:null,facility:false,pair:'pair-a',collected:['a','b'],signal:'red'}).collected,['a','b']);
  for(const change of [{x:-1},{x:Infinity},{x:1201},{y:801},{facing:'diagonal'},{actorId:'anyone'},{phase:'x'.repeat(41)},{measured:1},{actions:Array(9).fill('gate')},{visited:Array(21).fill('guide')},{lastFeedback:'x'.repeat(501)},{ticket:{...ticket,correct:'yes'}},{facility:'false'},{pair:'pair-c'},{collected:['c']},{signal:'yellow'}]) {
    assert.throws(()=>a.validateSceneDraft({...draft,...change}),/场景|坐标|摘要|角色|方向|票|设施|能量|信号/);
  }
});
test('教师摘要展示事件顺序、实际条件与预测比较，旧运行明确标注',()=>{
  const a=adventure();
  const summary=a.evidenceSummary('sale',{...rules.evaluate('sale',sale,{height:120}),input:{height:120},scene:evidence});
  assert.match(summary,/本人角色120厘米体验.*测量.*预测5元.*出票10元.*验闸/);assert.match(summary,/条件不成立/);assert.match(summary,/不相符/);
  assert.match(a.evidenceSummary('sale',{input:{height:119}}),/规则实验（旧版）/);
  const pair={version:1,station:'minimum',actorId:'pair-b',actions:['collect','predict','route','verify'],destination:'2',prediction:'b'};
  assert.match(a.evidenceSummary('minimum',{...rules.evaluate('minimum',{operator:'<',yes:'a',no:'b'},{a:9,b:2}),input:{a:9,b:2},scene:pair}),/预测b.*2.*相符/);
});
test('温室场景温度探头与新模型相符，摘要描述现场调试行为',()=>{
  const a=adventure(),config={model:'ventilation',operator:'>=',yes:'on',no:'off'},input={temperature:30};
  const scene={version:1,station:'sale',actorId:'sensor30',actions:['measure','predict','ticket','gate'],destination:'on',prediction:'off'};
  const result=rules.evaluate('sale',config,input);
  assert.deepEqual(a.validateEvidence('sale',scene,input,result),scene);
  const summary=a.evidenceSummary('sale',{...result,config,input,scene});
  assert.match(summary,/30.*读取温度.*预测.*关闭.*执行风机.*启动.*现场核验/);assert.doesNotMatch(summary,/游客|票|闸/);
  assert.equal(a.validateSceneDraft({...draft,actorId:'sensor30',temperatureCase:30}).temperatureCase,30);
  assert.throws(()=>a.validateSceneDraft({...draft,temperatureCase:32}),/温度|场景/);
  assert.throws(()=>a.validateEvidence('sale',{...scene,destination:'10'},{height:120,temperature:30},rules.evaluate('sale',sale,{height:120,temperature:30})),/场景|输出|结果/);
});

test('错误指引走向不存在的天桥记录受阻，摘要保留安全侧而不虚构到达',()=>{
 const a=adventure(),input={facility:false},config={yes:'crossing',no:'bridge'},evaluated=rules.evaluate('cross',config,input);
 const scene={version:1,station:'cross',actorId:'cross-closed',actions:['observe','predict','route','blocked'],destination:'bridge',prediction:'bridge',outcome:'blocked'};
 assert.deepEqual(a.validateEvidence('cross',scene,input,evaluated),scene);
 const summary=a.evidenceSummary('cross',{...evaluated,config,input,scene});assert.match(summary,/通道受阻，留在安全侧/);assert.doesNotMatch(summary,/到达/);
 assert.throws(()=>a.validateEvidence('cross',{...scene,actions:['observe','predict','route','verify']},input,evaluated),/步骤/);
 assert.throws(()=>a.validateEvidence('cross',scene,{facility:true},rules.evaluate('cross',config,{facility:true})),/角色|输入|受阻/);
 assert.throws(()=>a.validateEvidence('cross',{...scene,destination:'crossing'},input,rules.evaluate('cross',{yes:'bridge',no:'crossing'},input)),/受阻/);
 assert.throws(()=>a.validateEvidence('cross',{...scene,outcome:'teleport'},input,evaluated),/通行结果/);
 const arrived={...scene,actions:['observe','predict','route','verify'],outcome:'arrived',destination:'crossing'};assert.equal(a.validateEvidence('cross',arrived,input,rules.evaluate('cross',{yes:'bridge',no:'crossing'},input)).outcome,'arrived');
});
