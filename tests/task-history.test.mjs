import test from 'node:test';
import assert from 'node:assert/strict';
const history=await import('../public/task-history.mjs').catch(()=>({}));
test('撤回只恢复最近操作字段，场景修订号递增，不回滚求助或历史',()=>{
 assert.equal(typeof history.captureEdit,'function');
 const draft={config:{yes:'on'},input:{temperature:30},prediction:'off',scene:{actions:['measure'],phase:'measured'},sceneRev:7};
 const snapshot=history.captureEdit(draft);
 const current={...draft,input:{temperature:31},scene:{actions:['measure','predict'],ticket:{output:'on'}},sceneRev:9,hint:2};
 const restored=history.restoreEdit(current,snapshot);
 assert.deepEqual(restored.input,{temperature:30});
 assert.equal(restored.scene.ticket,undefined);
 assert.equal(restored.sceneRev,10);
 assert.equal(restored.hint,2);
 const learning={runs:[{correct:false}],predictions:[{value:'off'}],points:25,support:{hints:[{key:'seen'}]}};
 const before=structuredClone(learning);
 history.restoreEdit(current,snapshot);
 assert.deepEqual(learning,before);
});
