import test from 'node:test';
import assert from 'node:assert/strict';
import { findRoute, moveTowards, nearestPointOnSegment } from '../public/navigation.mjs';
test('点击目标沿道路节点行走，绕过中央花坛，不直接穿建筑',()=>{
 const nodes={start:{x:0,y:0},south:{x:0,y:10},east:{x:10,y:10},goal:{x:10,y:0}};
 const route=findRoute(nodes,[['start','south'],['south','east'],['east','goal']],{x:0,y:0},{x:10,y:0});
 assert.deepEqual(route,[{x:0,y:10},{x:10,y:10},{x:10,y:0}]);
});
test('动画步长不会越过目标，停步可以准确恢复位置',()=>{
 assert.deepEqual(moveTowards({x:0,y:0},{x:3,y:4},10),{x:3,y:4,arrived:true});
 const moved=moveTowards({x:0,y:0},{x:3,y:4},2.5);
 assert.equal(moved.x,1.5);assert.equal(moved.y,2);assert.equal(moved.arrived,false);
});
test('道路投影限定在线段内',()=>{
 assert.deepEqual(nearestPointOnSegment({x:12,y:4},{x:0,y:0},{x:10,y:0}),{x:10,y:0});
});
