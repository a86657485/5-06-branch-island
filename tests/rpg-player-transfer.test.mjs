import test from 'node:test';
import assert from 'node:assert/strict';
import { registerActivePlayer,waitForActivePlayer,clearActivePlayer } from '../engine/src/modules/lesson/active-player.ts';
test('切图后的对话等候新房间角色，不能继续绑定旧房间对象',async()=>{
 const old={id:'qa-player'},next={id:'qa-player'};
 registerActivePlayer(old,'greenhouse');
 let settled=false;const pending=waitForActivePlayer('qa-player','workshop').then(player=>{settled=true;return player;});
 await Promise.resolve();assert.equal(settled,false);
 registerActivePlayer(next,'workshop');assert.equal(await pending,next);assert.notEqual(next,old);
 clearActivePlayer('qa-player');
});
test('已在目标地图时复用当前房间角色',async()=>{const player={id:'qa-player'};registerActivePlayer(player,'crossing');assert.equal(await waitForActivePlayer('qa-player','crossing'),player);clearActivePlayer('qa-player');});
