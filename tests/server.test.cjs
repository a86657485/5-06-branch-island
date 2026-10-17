'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const source = path.join(__dirname,'../server.cjs');
const sale={operator:'<',yes:'5',no:'10'};
const repair={operator:'>=',yes:'10',no:'5'};
const broken={operator:'>=',yes:'5',no:'10'};
const cross={yes:'bridge',no:'crossing'};
const minimum={operator:'<',yes:'a',no:'b'};
async function setup(t) {
  assert.ok(fs.existsSync(source),'需要实现持久化课堂服务');
  const {createService}=require(source);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'branch-island-test-'));
  const roster=[{id:'s1',classId:'501',name:'测试学生甲'},{id:'s2',classId:'501',name:'测试学生乙'}];
  let service;
  async function start(){ service=createService({dataDir:dir,roster}); await new Promise(resolve=>service.server.listen(0,'127.0.0.1',resolve)); }
  await start();
  const api=async(route,body,headers={})=>{
    const response=await fetch(`http://127.0.0.1:${service.server.address().port}${route}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
    const data=await response.json(); return {status:response.status,...data};
  };
  let next=0;
  const event=(type,levelId,payload={},extra={})=>api('/api/events',{studentId:'s1',round:1,eventId:`evt-${++next}`,type,levelId,payload,editedAt:Date.now(),...extra});
  async function complete(id,config,inputs,reason){ for(const input of inputs) assert.equal((await event('run',id,{config,input})).status,200);return event('complete',id,{config,reason}); }
  t.after(async()=>{await service.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {api,event,complete,url:()=>`http://127.0.0.1:${service.server.address().port}`,restart:async()=>{await service.close();await start();}};
}
test('引擎checkpoint保存与重启恢复不重置已有学习证据',async t=>{
 const c=await setup(t);await c.api('/api/login',{classId:'501',studentId:'s1'});
 const config={model:'ventilation',operator:'>=',yes:'on',no:'off'};
 await c.complete('sale',config,[29,30,31].map(temperature=>({temperature})),'boundary');
 const rpg={version:1,engine:'rpgjs',mapId:'greenhouse',position:{x:256,y:384},direction:'up'};
 const saved=await c.event('draft','sale',{config,rpg:{...rpg,unknown:'不保存'}});
 assert.equal(saved.status,200);assert.deepEqual(saved.state.drafts.sale.rpg,rpg);assert.equal(saved.state.points,25);assert.equal(saved.state.runs.sale.length,3);
 for(const change of [{position:{x:Infinity,y:2}},{mapId:'outside'},{direction:'bad'}])assert.equal((await c.event('draft','sale',{config,rpg:{...rpg,...change}})).status,400);
 await c.restart();const restored=await c.api('/api/state?studentId=s1');assert.deepEqual(restored.state.drafts.sale.rpg,rpg);assert.equal(restored.state.points,25);
});

test('RPGJS 子目录入口允许同源嵌入，其他课堂页面保持禁止嵌入',async t=>{
 const c=await setup(t);
 const response=await fetch(`${c.url()}/rpgjs/`);
 assert.notEqual(response.status,404,'引擎子目录应解析到已构建的 index.html');
 assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'self'/);
 const main=await fetch(`${c.url()}/`);
 assert.match(main.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});
test('服务端拒绝无证据和跨关通关，真实运行后积分按事件与关卡去重',async t=>{
  const c=await setup(t); await c.api('/api/login',{classId:'501',studentId:'s1'});
  assert.equal((await c.event('complete','sale',{config:sale,reason:'boundary'})).result.passed,false);
  assert.equal((await c.event('run','repair',{config:repair,input:{height:120}})).status,409);
  const completed=await c.complete('sale',sale,[119,120,121].map(height=>({height})),'boundary');
  assert.equal(completed.result.passed,true);assert.equal(completed.state.points,25);
  const repeated=await c.event('complete','sale',{config:sale,reason:'boundary',points:999});
  assert.equal(repeated.state.points,25);
  const event={studentId:'s1',round:1,eventId:'same-run',type:'run',levelId:'sale',payload:{config:sale,input:{height:120}}};
  await c.api('/api/events',event); const again=await c.api('/api/events',event);
  assert.equal(again.state.runs.sale.length,4);assert.equal(again.result.output,'10');
});
test('旧草稿不覆盖新方案，修改使当前验证失效但保留已获积分',async t=>{
  const c=await setup(t);await c.api('/api/login',{classId:'501',studentId:'s1'});
  await c.complete('sale',sale,[119,120,121].map(height=>({height})),'boundary');
  const changed={operator:'<',yes:'10',no:'5'};
  let result=await c.event('draft','sale',{config:changed,note:'较新'},{editedAt:200});
  assert.equal(result.state.levels.sale.valid,false);assert.equal(result.state.points,25);
  result=await c.event('draft','sale',{config:sale,note:'较旧'},{editedAt:100});
  assert.equal(result.state.drafts.sale.note,'较新');
  await c.restart(); const restored=await c.api('/api/state?studentId=s1');
  assert.equal(restored.state.points,25); assert.equal(restored.state.drafts.sale.note,'较新');assert.equal(restored.state.levels.sale.valid,false);
});
test('分层考核三站当前通过后开放，首答与奖励分开，挑战层只交一次',async t=>{
  const quiz=require('../quiz.cjs');
  const c=await setup(t);await c.api('/api/login',{classId:'501',studentId:'s1'});
  const hidden=await c.api('/api/quiz?studentId=s1');
  assert.equal(hidden.questions.length,0);assert.equal(hidden.examGate.open,false);assert.deepEqual(hidden.examGate.missing,['sale','repair','cross']);
  assert.equal((await c.event('quiz','quiz',{tier:'base',answers:{}})).status,409);
  const ventilation={model:'ventilation',operator:'>=',yes:'on',no:'off'};
  await c.complete('sale',ventilation,[29,30,31].map(temperature=>({temperature})),'boundary');
  await c.event('run','repair',{config:{...ventilation,yes:'off',no:'on'},input:{temperature:30}});
  await c.complete('repair',ventilation,[29,30,31].map(temperature=>({temperature})),'swap');
  const still=await c.api('/api/state?studentId=s1');
  assert.equal(still.examGate.open,false);assert.deepEqual(still.examGate.missing,['cross']);
  await c.complete('cross',cross,[{facility:true},{facility:false}],'one');
  const opened=await c.api('/api/quiz?studentId=s1');
  assert.equal(opened.examGate.open,true);assert.equal(opened.quizVersion,quiz.version);
  const q22=opened.questions.find(question=>question.id==='q22');
  assert.equal(q22.goal,'流程图补充');assert.equal('goalIds' in q22,false);
  assert.equal(opened.questions.length,11);assert.equal(opened.questions.some(question=>question.tier==='challenge'),false);
  assert.equal('answer' in opened.questions[0],false);assert.equal('explanation' in opened.questions[0],false);
  const baseAnswers={};for(const question of quiz.byTier('base')) baseAnswers[question.id]=question.answer;
  baseAnswers.q35=(quiz.questions.find(question=>question.id==='q35').answer+1)%4;
  await c.event('draft','quiz',{tier:'base',answers:{q35:baseAnswers.q35},index:1},{editedAt:300});
  await c.event('draft','quiz',{tier:'base',answers:{},index:0},{editedAt:200});
  await c.restart();const unfinished=await c.api('/api/state?studentId=s1');
  assert.equal(unfinished.state.drafts.quiz.answers.q35,baseAnswers.q35);assert.equal(unfinished.examGate.open,true);
  assert.equal((await c.event('quiz','quiz',{tier:'base',answers:baseAnswers,quizVersion:'outdated'})).status,409);
  const first=await c.event('quiz','quiz',{tier:'base',answers:baseAnswers,quizVersion:opened.quizVersion},{eventId:'exam-one'});
  assert.equal(first.result.score,10);assert.equal(first.result.passed,true);assert.equal(first.result.rewardUnlocked,true);assert.equal(first.result.challengeUnlocked,true);
  assert.equal(first.state.quiz.base.firstScore,10);assert.equal(first.state.quiz.base.attempts.length,1);assert.equal(first.state.points,95);
  assert.equal(first.result.details.find(detail=>detail.id==='q35').correct,false);assert.equal('correctAnswer' in first.result.details.find(detail=>detail.correct),false);
  const retry=await c.event('quiz','quiz',{tier:'base',answers:baseAnswers},{eventId:'exam-one'});assert.equal(retry.state.quiz.base.attempts.length,1);
  const withChallenge=await c.api('/api/quiz?studentId=s1');assert.equal(withChallenge.questions.filter(question=>question.tier==='challenge').length,12);
  assert.equal((await c.event('quiz','quiz',{tier:'challenge',answers:{}})).status,400);
  const challengeAnswers={};for(const question of quiz.byTier('challenge')) challengeAnswers[question.id]=question.answer;
  const bonus=await c.event('quiz','quiz',{tier:'challenge',answers:challengeAnswers});
  assert.equal(bonus.result.awarded,true);assert.equal(bonus.state.quiz.challenge.closed,true);assert.equal(bonus.state.points,100);
  assert.equal((await c.event('quiz','quiz',{tier:'challenge',answers:challengeAnswers})).status,409);
  await c.event('draft','sale',{config:{...ventilation,operator:'>'}},{editedAt:900});
  const keptOpen=await c.api('/api/state?studentId=s1');assert.equal(keptOpen.state.levels.sale.valid,false);assert.equal(keptOpen.examGate.open,true);
  const closed=await c.api('/api/teacher/exam-close',{classId:'501'});assert.equal(closed.status,200);
  assert.equal((await c.event('quiz','quiz',{tier:'base',answers:baseAnswers})).status,409);
  await c.restart();const restored=await c.api('/api/state?studentId=s1');assert.equal(restored.state.quiz.base.first.id,'exam-one');assert.equal(restored.state.quiz.base.attempts.length,1);
});
test('名单登录稳定隔离同名，手动姓名加入所选班级，大屏统计含未进入者',async t=>{
  const c=await setup(t);const one=await c.api('/api/login',{classId:'501',name:'新同学'});const two=await c.api('/api/login',{classId:'501',name:' 新同学 '});const another=await c.api('/api/login',{classId:'502',name:'新同学'});
  assert.equal(one.student.id,two.student.id);assert.notEqual(one.student.id,another.student.id);
  const result=await c.api('/api/teacher?classId=501');assert.equal(result.students.length,3);assert.equal(result.summary.total,3);assert.equal(result.summary.entered,1);assert.equal(result.summary.notEntered,2);
  assert.equal((await c.api('/api/login',{classId:'502',studentId:'s1'})).status,400);
});
test('拒绝跨源写入、过大提交、旧轮次和非法题目索引，私有LAN教师范围不限制为本机',async t=>{
  const c=await setup(t);assert.equal((await c.api('/api/login',{classId:'501',studentId:'s1'},{Origin:'https://untrusted.example'})).status,403);
  await c.api('/api/login',{classId:'501',studentId:'s1'});
  assert.equal((await c.event('prediction','sale',{value:'yes'},{round:0})).status,409);
  const {isPrivateAddress}=require(source);assert.equal(isPrivateAddress('192.168.1.15'),true);assert.equal(isPrivateAddress('::ffff:10.0.0.9'),true);assert.equal(isPrivateAddress('8.8.8.8'),false);
  const solutions=await c.api('/api/teacher/solutions');
  assert.equal(solutions.status,200);
  assert.deepEqual(solutions.questions.find(question=>question.id==='q22').goalIds,[]);
  assert.equal((await c.api('/api/teacher?classId=501')).status,200);
  assert.equal((await fetch(c.url()+'/roster.json')).status,404);
  assert.equal((await fetch(c.url()+'/server.cjs')).status,404);
  assert.equal((await fetch(c.url()+'/runtime/classroom.sqlite')).status,404);
  assert.equal((await c.api('/api/login',{classId:'501',name:'x'.repeat(70000)})).status,413);
});

test('错误实验输入应得到可操作的400反馈，不能变成服务故障',async t=>{
  const c=await setup(t);await c.api('/api/login',{classId:'501',studentId:'s1'});
  const input=await c.event('run','sale',{config:sale,input:{height:'120'}});
  assert.equal(input.status,400);assert.match(input.error,/身高/);
  const config=await c.event('draft','sale',{config:{operator:'=',yes:'5',no:'10'}});
  assert.equal(config.status,400);assert.match(config.error,/判断条件/);
});
test('不完整规则草稿可同步，保留输入预测理由提示，后续实验不会被队列堵塞',async t=>{
  const c=await setup(t);await c.api('/api/login',{classId:'501',studentId:'s1'});
  const partial={config:{operator:'<',yes:'5',no:''},input:{height:120},prediction:'10',reason:'',hint:1};
  const saved=await c.event('draft','sale',partial,{editedAt:100});
  assert.equal(saved.status,200);assert.deepEqual(saved.state.drafts.sale,partial);assert.equal(saved.state.levels.sale.valid,false);
  const stale=await c.event('draft','sale',{...partial,hint:0},{editedAt:99});assert.equal(stale.state.drafts.sale.hint,1);
  const running=await c.event('run','sale',{config:sale,input:{height:120}});assert.equal(running.status,200);
  const invalid=await c.event('run','sale',{config:partial.config,input:{height:120}});assert.equal(invalid.status,400);
  await c.event('draft','sale',{...partial,config:sale},{editedAt:200});
  const done=await c.complete('sale',sale,[119,120,121].map(height=>({height})),'boundary');assert.equal(done.result.passed,true);
  const edited=await c.event('draft','sale',partial,{editedAt:300});assert.equal(edited.status,200);assert.equal(edited.state.levels.sale.valid,false);assert.equal(edited.state.points,25);
  await c.event('run','repair',{config:broken,input:{height:120}});
  await c.complete('repair',repair,[119,120,121].map(height=>({height})),'swap');
  await c.complete('cross',cross,[{facility:true},{facility:false}],'one');
  const empty=await c.event('draft','minimum',{config:{operator:'',yes:'',no:''},input:{a:8,b:3},prediction:'',reason:'',hint:0});assert.equal(empty.status,200);
  const illegal=await c.event('draft','minimum',{config:{operator:'=',yes:'a',no:''}});assert.equal(illegal.status,400);
});
test('输出预测允许错误并保留当次输入和规则，按任务接受输出值',async t=>{
  const c=await setup(t);await c.api('/api/login',{classId:'501',studentId:'s1'});
  const prediction={value:'5',input:{height:120},config:sale};
  const first=await c.event('prediction','sale',prediction);assert.equal(first.status,200);
  assert.equal(first.state.predictions.sale[0].value,'5');assert.deepEqual(first.state.predictions.sale[0].input,prediction.input);assert.deepEqual(first.state.predictions.sale[0].config,sale);assert.ok(first.state.predictions.sale[0].at);
  await c.event('prediction','sale',{...prediction,value:'10'});const restore=await c.api('/api/state?studentId=s1');assert.equal(restore.state.predictions.sale[0].value,'5');assert.equal(restore.state.predictions.sale[1].value,'10');
  assert.equal((await c.event('prediction','sale',{...prediction,value:'yes'})).status,400);
  await c.complete('sale',sale,[119,120,121].map(height=>({height})),'boundary');
  assert.equal((await c.event('prediction','repair',{value:'10',input:{height:120},config:broken})).status,200);
  await c.event('run','repair',{config:broken,input:{height:120}});await c.complete('repair',repair,[119,120,121].map(height=>({height})),'swap');
  assert.equal((await c.event('prediction','cross',{value:'crossing',input:{facility:true},config:cross})).status,200);
  await c.complete('cross',cross,[{facility:true},{facility:false}],'one');
  assert.equal((await c.event('prediction','minimum',{value:'a',input:{a:8,b:3},config:minimum})).status,200);
});
test('草稿思路帮助只接受0到3整数，拒绝注入且不覆盖合法证据',async t=>{
  const c=await setup(t);await c.api('/api/login',{classId:'501',studentId:'s1'});
  for(const hint of [0,1,2,3]) assert.equal((await c.event('draft','sale',{config:sale,hint},{editedAt:100+hint})).status,200);
  for(const hint of ['<img src=x onerror=alert(1)>','2',-1,4,1.5,null]) {
    const invalid=await c.event('draft','sale',{config:sale,hint},{editedAt:200});
    assert.equal(invalid.status,400);assert.match(invalid.error,/0.*3.*整数/);
  }
  const saved=await c.api('/api/state?studentId=s1');assert.equal(saved.state.drafts.sale.hint,3);
  assert.equal((await c.event('draft','sale',{config:sale},{editedAt:300})).status,200);
});
test('草稿输入和选择字段拒绝会破坏恢复界面的类型，仍允许编辑中的数值',async t=>{
  const c=await setup(t);await c.api('/api/login',{classId:'501',studentId:'s1'});
  const base={config:{operator:'<',yes:'',no:''},input:{height:120.5},prediction:'',reason:'',hint:0};
  assert.equal((await c.event('draft','sale',base)).status,200);
  for(const change of [{input:null},{input:[]},{input:{height:{toString:'bad'}}},{prediction:{}},{reason:[]},{config:null}]) {
    const invalid=await c.event('draft','sale',{...base,...change});assert.equal(invalid.status,400);assert.match(invalid.error,/草稿|选择|条件/);
  }
  const saved=await c.api('/api/state?studentId=s1');assert.deepEqual(saved.state.drafts.sale,base);
});
test('改错再改回旧方案仍须重验，输入与提示修改不清空本次证据，积分只记一次',async t=>{
  const c=await setup(t);await c.api('/api/login',{classId:'501',studentId:'s1'});
  await c.complete('sale',sale,[119,120,121].map(height=>({height})),'boundary');
  await c.event('draft','sale',{config:{operator:'<',yes:'10',no:'5'}},{editedAt:100});
  const returned=await c.event('draft','sale',{config:sale},{editedAt:200});
  assert.equal(returned.state.levels.sale.evidenceStart,3);assert.equal(returned.state.levels.sale.valid,false);assert.equal(returned.state.points,25);
  const noRetest=await c.event('complete','sale',{config:sale,reason:'boundary'});assert.equal(noRetest.result.passed,false);
  await c.event('run','sale',{config:sale,input:{height:119}});
  await c.event('draft','sale',{config:sale,input:{height:120},prediction:'10',reason:'boundary',hint:2},{editedAt:300});
  const notEnough=await c.event('complete','sale',{config:sale,reason:'boundary'});assert.equal(notEnough.result.passed,false);assert.equal(notEnough.state.levels.sale.evidenceStart,3);
  await c.event('run','sale',{config:sale,input:{height:120}});await c.event('run','sale',{config:sale,input:{height:121}});
  const retested=await c.event('complete','sale',{config:sale,reason:'boundary'});assert.equal(retested.result.passed,true);assert.equal(retested.state.points,25);assert.equal(retested.state.runs.sale.length,6);
  await c.restart();const restored=await c.api('/api/state?studentId=s1');assert.equal(restored.state.levels.sale.evidenceStart,3);assert.equal(restored.state.levels.sale.valid,true);
});
test('仅运行时改变方案也须重验，改变后的首次实验应计入本次证据',async t=>{
  const c=await setup(t);await c.api('/api/login',{classId:'501',studentId:'s1'});
  await c.complete('sale',sale,[119,120,121].map(height=>({height})),'boundary');
  await c.event('run','sale',{config:{operator:'<',yes:'10',no:'5'},input:{height:119}});
  const back=await c.event('run','sale',{config:sale,input:{height:119}});assert.equal(back.state.levels.sale.evidenceStart,4);
  const partial=await c.event('complete','sale',{config:sale,reason:'boundary'});assert.equal(partial.result.passed,false);
  await c.event('run','sale',{config:sale,input:{height:120}});await c.event('run','sale',{config:sale,input:{height:121}});
  const final=await c.event('complete','sale',{config:sale,reason:'boundary'});assert.equal(final.result.passed,true);assert.equal(final.state.points,25);
});
test('场景摘要随实验去重、重启恢复，旧运行仍可使用既有通关证据',async t=>{
  const c=await setup(t);await c.api('/api/login',{classId:'501',studentId:'s1'});
  const sceneEvidence={version:1,station:'sale',actorId:'visitor120',actions:['measure','predict','ticket','gate'],destination:'10',prediction:'5'};
  const payload={config:sale,input:{height:120},prediction:'5',sceneEvidence};
  const first=await c.event('run','sale',payload,{eventId:'scene-offline-retry'});assert.equal(first.status,200);assert.deepEqual(first.state.runs.sale[0].scene,sceneEvidence);
  const again=await c.event('run','sale',payload,{eventId:'scene-offline-retry'});assert.equal(again.state.runs.sale.length,1);
  await c.restart();const restored=await c.api('/api/state?studentId=s1');assert.deepEqual(restored.state.runs.sale[0].scene,sceneEvidence);
  await c.event('run','sale',{config:sale,input:{height:119}});await c.event('run','sale',{config:sale,input:{height:121}});
  const completed=await c.event('complete','sale',{config:sale,reason:'boundary'});assert.equal(completed.result.passed,true);assert.equal(completed.state.points,25);assert.equal('scene' in completed.state.runs.sale[1],false);
  const wrongScene={...sceneEvidence,station:'repair',actions:['inspect','predict','ticket','gate'],destination:'5',prediction:'10'};
  const wrong=await c.event('run','repair',{config:broken,input:{height:120},prediction:'10',sceneEvidence:wrongScene});assert.equal(wrong.status,200);assert.equal(wrong.result.correct,false);assert.deepEqual(wrong.state.runs.repair[0].scene,wrongScene);
  const teacher=await c.api('/api/teacher?classId=501');assert.deepEqual(teacher.students.find(s=>s.id==='s1').state.runs.repair[0].scene,wrongScene);
});
test('场景角色、步骤、输出或预测摘要与运行不符时拒绝且不写记录',async t=>{
  const c=await setup(t);await c.api('/api/login',{classId:'501',studentId:'s1'});
  const base={version:1,station:'sale',actorId:'visitor120',actions:['measure','predict','ticket','gate'],destination:'10',prediction:'5'};
  for(const change of [{actorId:'visitor119'},{destination:'5'},{prediction:'yes'},{actions:['measure','predict']},{station:'cross'},{version:0}]) {
    const result=await c.event('run','sale',{config:sale,input:{height:120},sceneEvidence:{...base,...change}});assert.equal(result.status,400);assert.match(result.error,/场景|角色|输出|步骤|预测/);
  }
  const mismatch=await c.event('run','sale',{config:sale,input:{height:120},prediction:'10',sceneEvidence:base});assert.equal(mismatch.status,400);
  const restored=await c.api('/api/state?studentId=s1');assert.equal(restored.state.runs.sale.length,0);
});
test('场景草稿拒绝非法坐标与过长摘要，清理缓存后随原草稿保存',async t=>{
  const c=await setup(t);await c.api('/api/login',{classId:'501',studentId:'s1'});
  const scene={version:1,x:200,y:300,facing:'right',actorId:'visitor120',phase:'measure',measured:true,actions:['measure'],visited:['guide'],lastFeedback:'现在去预测票价。'};
  const saved=await c.event('draft','sale',{config:sale,scene:{...scene,unknown:'不保存'}});assert.equal(saved.status,200);assert.deepEqual(saved.state.drafts.sale.scene,scene);
  for(const change of [{x:null},{x:-1},{x:1201},{y:801},{actions:Array(9).fill('measure')},{lastFeedback:'x'.repeat(501)}]) {
    const result=await c.event('draft','sale',{config:sale,scene:{...scene,...change}});assert.equal(result.status,400);assert.match(result.error,/场景|坐标|摘要/);
  }
  await c.restart();const restored=await c.api('/api/state?studentId=s1');assert.deepEqual(restored.state.drafts.sale.scene,scene);
});
test('温室新模型保存场景并隔离旧任务证据，维修错误可保留',async t=>{
  const c=await setup(t);await c.api('/api/login',{classId:'501',studentId:'s1'});
  const config={model:'ventilation',operator:'>=',yes:'on',no:'off'};
  const sceneEvidence={version:1,station:'sale',actorId:'sensor30',actions:['measure','predict','ticket','gate'],destination:'on',prediction:'off'};
  const predicted=await c.event('prediction','sale',{value:'off',config,input:{temperature:30}});assert.equal(predicted.status,200);
  const scene={version:1,x:250,y:300,facing:'left',actorId:'sensor30',phase:'measure',measured:true,actions:['measure'],visited:[],temperatureCase:30};
  assert.equal((await c.event('draft','sale',{config,input:{temperature:30},scene})).status,200);
  const bad=await c.event('draft','sale',{config,input:{temperature:'30'},scene});assert.equal(bad.status,400);
  const result=await c.event('run','sale',{config,input:{temperature:30},prediction:'off',sceneEvidence});assert.equal(result.status,200);assert.deepEqual(result.state.runs.sale[0].scene,sceneEvidence);
  await c.event('run','sale',{config,input:{temperature:29}});await c.event('run','sale',{config,input:{temperature:31}});
  const done=await c.event('complete','sale',{config,reason:'boundary'});assert.equal(done.result.passed,true);
  const brokenConfig={...config,yes:'off',no:'on'},brokenScene={...sceneEvidence,station:'repair',actions:['inspect','predict','ticket','gate'],destination:'off',prediction:'on'};
  const brokenResult=await c.event('run','repair',{config:brokenConfig,input:{temperature:30},prediction:'on',sceneEvidence:brokenScene});assert.equal(brokenResult.status,200);assert.equal(brokenResult.result.correct,false);
  const repaired=await c.complete('repair',config,[29,30,31].map(temperature=>({temperature})),'swap');assert.equal(repaired.result.passed,true);
  await c.restart();const restored=await c.api('/api/state?studentId=s1');assert.equal(restored.state.points,50);assert.deepEqual(restored.state.drafts.sale.scene,scene);
});

test('旧四关首次进入场景需重验，移动保存与服务重启不重置新证据起点',async t=>{
 const c=await setup(t);await c.api('/api/login',{classId:'501',studentId:'s1'});
 await c.complete('sale',sale,[119,120,121].map(height=>({height})),'boundary');
 await c.event('run','repair',{config:broken,input:{height:120}});
 await c.complete('repair',repair,[119,120,121].map(height=>({height})),'swap');
 await c.complete('cross',cross,[{facility:true},{facility:false}],'one');
 await c.complete('minimum',minimum,[{a:1,b:9},{a:8,b:2}],'compare');
 const scene={version:1,x:200,y:300,facing:'up',phase:'assigned',measured:false,actions:[],visited:[]};
 for(const [id,config,input,actorId,reason]of [['cross',cross,{facility:true},'cross-open','one'],['minimum',minimum,{a:3,b:8},'pair-a','compare']]){
  const migrated=await c.event('draft',id,{config,input,scene:{...scene,actorId}});
  assert.equal(migrated.status,200);assert.equal(migrated.state.points,100);assert.equal(migrated.state.levels[id].completed,true);assert.equal(migrated.state.levels[id].valid,false);assert.equal(migrated.state.levels[id].evidenceStart,2);
  const premature=await c.event('complete',id,{config,reason});assert.equal(premature.result.passed,false);
  await c.event('run',id,{config,input});
  const moved=await c.event('draft',id,{config,input,scene:{...scene,actorId,x:400}});assert.equal(moved.state.levels[id].evidenceStart,2);
  await c.restart();const restored=await c.event('draft',id,{config,input,scene:{...scene,actorId,x:500}});assert.equal(restored.state.levels[id].evidenceStart,2);assert.equal(restored.state.runs[id].length,3);
 }
});
