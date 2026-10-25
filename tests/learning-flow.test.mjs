import test from 'node:test';
import assert from 'node:assert/strict';
const flow=await import('../public/learning-flow.mjs').catch(()=>({}));
test('三必做之后默认检测，只有主动选做才去储能',()=>{
 assert.equal(typeof flow.nextTask,'function');
 assert.equal(flow.nextTask('sale'),'repair');
 assert.equal(flow.nextTask('repair'),'cross');
 assert.equal(flow.nextTask('cross'),'quiz');
 assert.equal(flow.nextTask('cross',true),'minimum');
 assert.equal(flow.nextTask('minimum'),'quiz');
});
test('先学卡首次按站展示，重看不算通关，检测不弹站点先学',()=>{
 assert.equal(typeof flow.learnDue,'function');
 const patrol={seen:{}};
 assert.equal(flow.learnDue(patrol,'sale'),true);
 patrol.seen[flow.learnKey('sale')]=true;
 assert.equal(flow.learnDue(patrol,'sale'),false);
 assert.equal(flow.learnDue(patrol,'repair'),true);
 assert.equal(flow.learnDue(patrol,'quiz'),false);
 assert.equal(patrol.completed,undefined);
});

test('三项必做完成后重进优先基础检测，不把储能选做算必做',()=>{
 assert.equal(typeof flow.resumeTask,'function');
 assert.equal(flow.resumeTask({sale:{completed:true},repair:{completed:true},cross:{completed:true}}),'quiz');
 assert.equal(flow.resumeTask({sale:{completed:true}}),'repair');
});
