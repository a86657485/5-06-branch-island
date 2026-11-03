'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createService}=require('../server.cjs');
async function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'branch-scaffold-'));let service;
 const start=async()=>{service=createService({dataDir:dir,roster:[{id:'sc1',classId:'501',name:'支架测试甲'},{id:'sc2',classId:'501',name:'支架测试乙'}]});await new Promise(r=>service.server.listen(0,'127.0.0.1',r));};await start();
 const api=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${service.server.address().port}${route}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:response.status,...await response.json()};};
 let n=0;const event=(type,levelId,payload,extra={})=>api('/api/events',{studentId:'sc1',round:1,eventId:`scaffold-${++n}`,editedAt:Date.now(),type,levelId,payload,...extra});
 await api('/api/login',{classId:'501',studentId:'sc1'});
 t.after(async()=>{await service.close();fs.rmSync(dir,{recursive:true,force:true});});return {api,event,restart:async()=>{await service.close();await start();}};
}
const bad={model:'ventilation',operator:'>',yes:'on',no:'off'};
const good={model:'ventilation',operator:'>=',yes:'on',no:'off'};
test('真实错误运行三次逐级扶困，重传不重复，免费支架不扣5次法宝',async t=>{
 const c=await setup(t);await c.event('draft','sale',{config:bad,input:{temperature:30}});
 await c.event('tool_hint','sale',{step:{phase:'flow',slot:'diamond'}});
 const a=await c.event('run','sale',{config:bad,input:{temperature:30}});
 assert.equal(a.status,200);assert.equal(a.result.scaffold?.level,1);
 const b=await c.event('run','sale',{config:bad,input:{temperature:30}});assert.equal(b.result.scaffold.level,2);
 const third=await c.event('run','sale',{config:bad,input:{temperature:30}},{eventId:'same-third'});assert.equal(third.result.scaffold.level,3);
 const replay=await c.event('run','sale',{config:bad,input:{temperature:30}},{eventId:'same-third'});
 assert.deepEqual(replay.result,third.result);assert.equal(replay.state.support.scaffolds.length,3);
 assert.equal(replay.state.support.hints.length,1);assert.equal(replay.state.points,0);
 assert.equal(replay.state.conceptHints.filter(h=>h.evidenceKind==='scaffold').length,2);
 await c.restart();const restored=await c.api('/api/state?studentId=sc1');assert.deepEqual(restored.state.support,third.state.support);
});
test('正确重置当前输入连续错误，换配置不清历史，其他输入和学生分开',async t=>{
 const c=await setup(t);await c.event('draft','sale',{config:bad,input:{temperature:30}});
 await c.event('run','sale',{config:bad,input:{temperature:30}});
 const next=await c.event('run','sale',{config:{...bad,operator:'<='},input:{temperature:31}});assert.equal(next.result.scaffold.level,1);
 const second=await c.event('run','sale',{config:{...bad,operator:'<'},input:{temperature:30}});assert.equal(second.result.scaffold.level,2);
 const corrected=await c.event('run','sale',{config:good,input:{temperature:30}});assert.equal(corrected.result.scaffold,undefined);
 const freshError=await c.event('run','sale',{config:bad,input:{temperature:30}});assert.equal(freshError.result.scaffold.level,1);
 assert.equal(freshError.state.support.scaffolds.filter(s=>s.level===0).length,1);
 const other=await c.event('run','sale',{config:bad,input:{temperature:30}},{studentId:'sc2'});assert.equal(other.result.scaffold.level,1);
});
test('返修预置故障不算学生错，编辑后同形错误才进入支架',async t=>{
 const c=await setup(t);
 // 先完成温室以进入现有返修门禁，保持原完成条件。
 await c.event('draft','sale',{config:good,input:{temperature:29}});for(const temperature of [29,30,31])await c.event('run','sale',{config:good,input:{temperature}});await c.event('complete','sale',{config:good,reason:'boundary'});
 const preset={model:'ventilation',operator:'>=',yes:'off',no:'on'};
 await c.event('draft','repair',{config:preset,input:{temperature:30}});
 const original=await c.event('run','repair',{config:preset,input:{temperature:30}});
 assert.equal(original.status,200);assert.equal(original.result.scaffold,undefined);assert.equal(original.state.support.scaffolds.length,0);
 await c.event('draft','repair',{config:preset,flow:{preset:false},diagnoseAnswer:'exit',input:{temperature:30}});
 const edited=await c.event('run','repair',{config:preset,input:{temperature:30}});assert.equal(edited.result.scaffold.level,1);
});
test('理由错只在当前方案必测齐全后计数，概念支持后完成如实标记',async t=>{
 const c=await setup(t);await c.event('draft','sale',{config:good,input:{temperature:29}});
 const missing=await c.event('complete','sale',{config:good,reason:'both'});assert.equal(missing.result.scaffold,undefined);assert.equal(missing.state.support.scaffolds.length,0);
 for(const temperature of [29,30,31])await c.event('run','sale',{config:good,input:{temperature}});
 const a=await c.event('complete','sale',{config:good,reason:'both'});assert.equal(a.result.scaffold.level,1);
 const b=await c.event('complete','sale',{config:good,reason:'both'});assert.equal(b.result.scaffold.level,2);
 const third=await c.event('complete','sale',{config:good,reason:'small'});assert.equal(third.result.scaffold.level,3);assert.equal(third.result.scaffold.target.choiceId,'boundary');
 const completed=await c.event('complete','sale',{config:good,reason:'boundary'});assert.equal(completed.result.passed,true);assert.equal(completed.result.attemptKind,'hinted');assert.equal(completed.state.points,25);assert.equal(completed.state.support.hints.length,0);
 assert.equal(completed.state.support.scaffolds.at(-1).level,0);
});
