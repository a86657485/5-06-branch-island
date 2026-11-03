import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileState } from '../public/sync.mjs';
const scaffolds = await import('../public/scaffold.mjs').catch(() => ({}));
const guidance = await import('../public/task-guidance.mjs');
const state = () => ({drafts:{},levels:{},runs:{sale:[],repair:[]},conceptHints:[],support:{hints:[{key:'paid',levelId:'sale'}]}});
const wrong = {correct:false,condition:false,branch:'no',output:'off',expected:'on'};
const config = {model:'ventilation',operator:'>',yes:'on',no:'off'};
const run = (s,n,extra={}) => scaffolds.recordScaffold(s,'sale',{kind:'run',input:{temperature:30},config,result:wrong,eventKey:`run-${n}`,at:`2026-10-25T00:00:0${n}Z`,...extra});

test('同一输入跨方案递进观察、线索、局部示范，不消耗法宝或改答案',()=>{
 assert.equal(typeof scaffolds.recordScaffold,'function');
 const s=state();
 const a=run(s,1),b=run(s,2,{config:{...config,yes:'off'}}),c=run(s,3);
 assert.deepEqual([a.level,b.level,c.level],[1,2,3]);
 assert.equal(a.conceptual,false);assert.equal(b.conceptual,true);assert.equal(c.conceptual,true);
 assert.equal(a.target.choiceId,undefined);assert.equal(b.target.cardId,undefined);assert.ok(c.target.cardId);
 assert.equal(s.support.hints.length,1);
 assert.equal(s.levels.sale.hinted,true);
 assert.deepEqual(config,{model:'ventilation',operator:'>',yes:'on',no:'off'});
 assert.ok(c.lines.every(line=>[...line].length<=25));
 assert.equal(s.conceptHints.filter(h=>h.evidenceKind==='scaffold').length,2);
});

test('同eventKey重传不重复递进；正确后重置连续次数但保留旧记录',()=>{
 assert.equal(typeof scaffolds.recordScaffold,'function');const s=state();
 const first=run(s,1);assert.deepEqual(run(s,1),first);assert.equal(s.support.scaffolds.length,1);
 assert.equal(run(s,2,{result:{...wrong,correct:true}}),null);
 const retry=run(s,3);assert.equal(retry.level,1);assert.equal(retry.count,1);assert.equal(s.support.scaffolds.length,3);
});

test('预置返修30℃故障不算学生错，编辑后的错误正常记录',()=>{
 assert.equal(typeof scaffolds.recordScaffold,'function');const s=state();
 const event={kind:'run',input:{temperature:30},config:{model:'ventilation',operator:'>=',yes:'off',no:'on'},result:{correct:false,condition:true,branch:'yes',output:'off',expected:'on'},eventKey:'fault'};
 assert.equal(scaffolds.recordScaffold(s,'repair',event),null);assert.equal(s.support.scaffolds?.length||0,0);
 s.drafts.repair={flow:{preset:false},diagnoseAnswer:'exit'};
 assert.equal(scaffolds.recordScaffold(s,'repair',{...event,eventKey:'student-edit'}).level,1);
});

test('缺测试、网络/导航异常和未读数不算概念错误，理由仅齐测后递进',()=>{
 assert.equal(typeof scaffolds.recordScaffold,'function');const s=state();
 assert.equal(run(s,1,{kind:'navigation'}),null);
 assert.equal(run(s,2,{input:{}}),null);
 assert.equal(run(s,3,{kind:'reason',testsSatisfied:false,result:{passed:false}}),null);
 assert.equal(run(s,4,{kind:'reason',testsSatisfied:true,result:{passed:false}}).level,1);
 assert.equal(run(s,5,{kind:'reason',testsSatisfied:true,result:{passed:false}}).level,2);
 assert.equal(run(s,6,{kind:'reason',testsSatisfied:true,result:{passed:false}}).target.choiceId,'boundary');
});

test('各输入的连续错误分开，刷新复制后沿用计数',()=>{
 assert.equal(typeof scaffolds.recordScaffold,'function');const s=state();
 run(s,1);const fresh=structuredClone(s);
 assert.equal(run(fresh,2).level,2);
 assert.equal(run(fresh,3,{input:{temperature:31}}).level,1);
});

test('法宝目标匹配当前可行卡片与学生程序预测，包含故障与B数值输出',()=>{
 assert.equal(typeof guidance.assistedTarget,'function');
 assert.deepEqual(guidance.assistedTarget('sale',{flow:{diamond:'lt30'}},{phase:'flow',slot:'yes'}),{cardId:'off'});
 assert.deepEqual(guidance.assistedTarget('repair',{config:{operator:'>=',yes:'off',no:'on'},input:{temperature:30}},{phase:'predict',temperature:30}),{choiceId:'off'});
 assert.deepEqual(guidance.assistedTarget('minimum',{config:{operator:'<',yes:'a',no:'b'},scene:{ticket:{branch:'no',output:'2'},actions:[]}},{phase:'world',key:'batteryB'}),{focusKey:'batteryB'});
 assert.deepEqual(guidance.assistedTarget('cross',{}, {phase:'reason'}),{choiceId:'one'});
 const world=guidance.toolHint('minimum',{config:{operator:'<',yes:'a',no:'b'},scene:{ticket:{branch:'yes',output:'3'},actions:[]}},{phase:'world',key:'batteryA'});
 assert.match(world.action,/电池A/);assert.deepEqual(world.target,{focusKey:'batteryA'});
});

test('旧回应不清掉支架，remote相同eventKey优先，概念提示按事件去重',()=>{
 const local={drafts:{},levels:{sale:{hinted:true}},support:{hints:[],scaffolds:[{eventKey:'one',levelId:'sale',level:3,at:'local'}]},conceptHints:[{eventKey:'one',levelId:'sale',evidenceKind:'scaffold',level:3,at:'local'}]};
 const remote={drafts:{},levels:{},support:{hints:[],scaffolds:[{eventKey:'one',levelId:'sale',level:2,at:'server'}]},conceptHints:[{eventKey:'one',levelId:'sale',evidenceKind:'scaffold',level:2,at:'server'}]};
 const merged=reconcileState(local,remote);assert.equal(merged.support.scaffolds.length,1);assert.equal(merged.support.scaffolds[0].level,2);
 assert.equal(merged.conceptHints.length,1);assert.equal(merged.conceptHints[0].at,'server');
 assert.equal(reconcileState(local,{drafts:{},levels:{}}).support.scaffolds.length,1);
});

test('currentScaffold只取当前case最新反馈，成功reset不回捞旧答案',()=>{
 assert.equal(typeof scaffolds.currentScaffold,'function');const s=state();run(s,1);run(s,2);run(s,3);
 assert.equal(scaffolds.currentScaffold(s,'sale',{temperature:30}).level,3);
 assert.equal(scaffolds.currentScaffold(s,'sale',{temperature:31}),null);
 run(s,4,{result:{...wrong,correct:true}});
 assert.equal(scaffolds.currentScaffold(s,'sale',{temperature:30}),null);
});
test('远端已确认历史在前，本机尚未确认的新错误仍在最后',()=>{
 const local={drafts:{},levels:{},support:{hints:[],scaffolds:[{eventKey:'old',levelId:'sale',level:1,count:1,caseKey:'case'},{eventKey:'pending',levelId:'sale',level:2,count:2,caseKey:'case'}]}};
 const remote={drafts:{},levels:{},support:{hints:[],scaffolds:[{eventKey:'old',levelId:'sale',level:1,count:1,caseKey:'case'},{eventKey:'reset',levelId:'sale',level:0,count:0,caseKey:'case'}]}};
 assert.deepEqual(reconcileState(local,remote).support.scaffolds.map(s=>s.eventKey),['old','reset','pending']);
});
test('确认程序、记下预测与回现场运行分别指向当前按钮',()=>{
 const draft={config:{model:'ventilation',operator:'>=',yes:'on',no:'off'},input:{temperature:30},flow:{diamond:'ge30',yes:'on',no:'off',locked:true},scene:{measured:true}};
 for(const [phase,focusKey,label]of [['confirm','flow-lock','确认这份程序'],['confirm-predictions','predict-lock','记下预测，下一步'],['run','run-next','执行本次温度']]){
  let hint;assert.doesNotThrow(()=>{hint=guidance.toolHint('sale',draft,{phase});});
  assert.equal(hint.target.focusKey,focusKey);assert.ok(hint.action.includes(label));
 }
 const before=guidance.toolHint('sale',{...draft,scene:{measured:false}},{phase:'run'});
 assert.match(before.action,/保存修改，去读取温度/);assert.notEqual(before.key,guidance.toolHint('sale',draft,{phase:'run'}).key);
 const road=guidance.toolHint('cross',{config:{yes:'bridge',no:'crossing'},scene:{measured:true}},{phase:'run'});assert.match(road.action,/保存程序，回现场先预测/);
});
