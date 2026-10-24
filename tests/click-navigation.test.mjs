import test from 'node:test';
import assert from 'node:assert/strict';
import { currentFocus } from '../public/focus.mjs';
const clickPath = await import('../engine/src/modules/lesson/click-path.ts').catch(()=>({}));
import { advanceRoute } from '../engine/src/modules/lesson/route-progress.mjs';

const ready = {flow:{locked:true},sentence:{locked:true}};
test('储能读过A后引导读B，执行后先接选中电池再核验',()=>{
 const read = currentFocus({levelId:'minimum',scene:{phase:'reading',collected:['a'],measured:false},draft:ready});
 assert.equal(read.target.place,'batteryB');
 const connect = currentFocus({levelId:'minimum',scene:{phase:'executed',measured:true,ticket:{output:'b'},actions:['collect','predict']},draft:ready});
 assert.equal(connect.target.place,'batteryB');
 const verify=currentFocus({levelId:'minimum',scene:{phase:'connected',measured:true,ticket:{output:'b'},actions:['collect','predict','route']},draft:ready});
 assert.equal(verify.target.place,'monitor');
});
test('路口与储能的下一步区分先预测和运行，采样后不回头读取',()=>{
 for(const id of ['cross','minimum']){
  const predicted=currentFocus({levelId:id,scene:{phase:'observed',measured:true,actions:[id==='cross'?'observe':'collect']},draft:ready});
  assert.match(predicted.hint,/预测/);
  const run=currentFocus({levelId:id,scene:{phase:'predicted',measured:true,actions:[id==='cross'?'observe':'collect','predict']},draft:ready});
  assert.match(run.hint,/运行|执行/);
 }
});
test('一次点击通行仍连续走过原路线证据区，红灯先去信号灯',()=>{
 const red=currentFocus({levelId:'cross',scene:{phase:'executed',measured:true,signal:'red',facility:false,ticket:{output:'crossing'},actions:['observe','predict']},draft:ready});
 assert.equal(red.target.place,'signal');
 assert.equal(red.goto,true);
 const focus=currentFocus({levelId:'cross',scene:{phase:'executed',measured:true,signal:'green',facility:true,ticket:{output:'bridge'},actions:['observe','predict']},draft:ready});
 assert.equal(focus.goto,true);
 assert.equal(typeof clickPath.clickWaypoints,'function','点击路线规划器尚未实现');
 const points=clickPath.clickWaypoints({x:410,y:595},focus.target,{levelId:'cross',scene:{facility:true,signal:'green',ticket:{output:'bridge'},actions:[]}});
 // 插值只是验证路点保留完整连续通行，不跳过规则要求的三区。
 let progress;
 let previous={x:410,y:595};
 for(const next of points){
  const steps=Math.ceil(Math.hypot(next.x-previous.x,next.y-previous.y)/20);
  for(let n=1;n<=steps;n++)progress=advanceRoute(progress,{x:previous.x+(next.x-previous.x)*n/steps,y:previous.y+(next.y-previous.y)*n/steps},'bridge','guided');
  previous=next;
 }
 assert.equal(progress.stage,3);
});
test('点击路点是碰撞框左上角，传给物理移动时转换为中心',()=>{
 assert.equal(typeof clickPath.movementTarget,'function');
 assert.deepEqual(clickPath.movementTarget({x:476,y:445},{w:24,h:24}),{x:488,y:457});
 assert.deepEqual(clickPath.movementTarget({x:760,y:336},{w:24,h:24}),{x:772,y:348});
});
test('换到新路口或新电池组，不让上一现场的verified标记跳过重新采集',()=>{
 const config={yes:'bridge',no:'crossing'};
 const road=currentFocus({levelId:'cross',scene:{phase:'assigned',facility:false,measured:false,visited:['verified'],actions:[]},draft:{...ready,config},runs:[{config,input:{facility:true},correct:true,scene:{outcome:'arrived'}}]});
 assert.equal(road.target.place,'observe');
 const batteryConfig={operator:'<',yes:'a',no:'b'};
 const energy=currentFocus({levelId:'minimum',scene:{phase:'assigned',pair:'pair-b',measured:false,collected:[],visited:['verified'],actions:[]},draft:{...ready,config:batteryConfig},runs:[{config:batteryConfig,input:{a:3,b:8},correct:true}]});
 assert.equal(energy.target.place,'batteryA');
});
test('配电运行输出是数值，导航必须按实际分支所选变量去接入B',()=>{
 const config={operator:'<',yes:'a',no:'b'};
 const connect=currentFocus({levelId:'minimum',scene:{phase:'executed',measured:true,pair:'pair-b',ticket:{output:'2',branch:'no'},actions:['collect','predict']},draft:{...ready,config}});
 assert.equal(connect.target.place,'batteryB');
});
