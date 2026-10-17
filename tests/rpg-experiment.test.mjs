import test from 'node:test';
import assert from 'node:assert/strict';
import { advance, resetTrial, evidenceFor } from '../engine/src/modules/lesson/experiment.ts';
test('a device run needs reading, prediction, execution and physical verification in that order',()=>{
 let s=resetTrial({version:1,station:'sale',actorId:'sensor30',actions:[],measured:false});
 assert.throws(()=>advance(s,'ticket'),/顺序/);
 s=advance(s,'measure');s=advance(s,'predict');s=advance(s,'ticket');
 assert.throws(()=>evidenceFor('sale',s,'on'),/核验/);
 s=advance(s,'gate');assert.deepEqual(evidenceFor('sale',s,'on').actions,['measure','predict','ticket','gate']);
});
test('a changed trial cannot reuse an earlier result or prediction',()=>{
 const s=resetTrial({version:1,actions:['measure','predict','ticket'],measured:true,prediction:'on'});
 assert.equal(s.ticket,undefined);assert.equal(s.prediction,undefined);assert.deepEqual(s.actions,[]);assert.equal(s.measured,false);
});
test('revising a prediction preserves one action but keeps its chosen value',()=>{
 let s={actions:['observe'],actorId:'cross-closed',prediction:'bridge'};s=advance(s,'predict');s={...s,prediction:'crossing'};s=advance(s,'predict');s=advance(s,'route');s=advance(s,'verify');
 assert.deepEqual(evidenceFor('cross',s,'crossing').actions,['observe','predict','route','verify']);assert.equal(s.prediction,'crossing');
});

test('不能用重新采样丢掉已执行但未核验的错误结果',()=>{assert.throws(()=>resetTrial({actions:['measure','predict','ticket'],ticket:{output:'off',correct:false}}),/先到核验/);});
