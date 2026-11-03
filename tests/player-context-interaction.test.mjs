import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../engine/node_modules/typescript/lib/typescript.js';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
async function harness(){
 const counts={sync:0,actors:0,variables:0,actions:0},variables=new Map(),listeners=new Map();
 let callback;
 const emitted=[];
 const context={levelId:'sale',draft:{scene:{phase:'assigned',deviceOutput:'off'},rpg:{mapId:'greenhouse',position:{x:100,y:100}}}};
 const events=[{id:'guide',name:'园艺员阿绿',x:()=>130,y:()=>100,execMethod:async()=>{counts.actions++;}},...['sensor','control','fan','verify','portal'].map(id=>({id,name:id,x:()=>1000,y:()=>1000,execMethod:async()=>{}}))];
 const map={id:'greenhouse',getEvents:()=>events,isEventVisibleForPlayer:event=>!event.hidden,setAutoTick(){},getCollisions:()=>[],getInteractionCollisions:()=>[]};
 const player={id:'qa',name:'',x:()=>100,y:()=>100,direction:()=>1,setGraphic(){},setHitbox(){},changeDirection(){},getVariable:key=>variables.get(key),setVariable(key,value){counts.variables++;variables.set(key,value);counts.sync++;},syncChanges(){counts.sync++;},getCurrentMap:()=>map,async changeMap(){await hooks.onJoinMap(player,map);}};
 const imports={
  '../../tiled/layout.json':{greenhouse:{positions:{start:[100,100]}}},'@rpgjs/common':{Direction:{Up:1,Down:2,Left:3,Right:4}},'@rpgjs/server':{},
  '../../classroom-bridge':{ready:async()=>{},subscribeContext:fn=>{callback=fn;return ()=>{};},getContext:()=>context},'./click-path':{},'./runtime':{ctx:()=>context,rpc:async()=>{}},'./routes':{checkRoute:async()=>{}},
  './active-player':{mapForContext:c=>c.levelId==='cross'?'crossing-east':c.levelId==='minimum'?'energy':'greenhouse',registerActivePlayer(){},clearActivePlayer(){}},'./approach':{},'./thermal':{async ensureGreenhouseActors(){counts.actors++;counts.sync++;}},'../../../../public/focus.mjs':{currentFocus:()=>({target:{x:130,y:100}})},
  './interaction':fs.existsSync(new URL('../engine/src/modules/lesson/interaction.ts',import.meta.url))?require('../engine/src/modules/lesson/interaction.ts'):undefined
  ,'./greenhouse-cast':require('../engine/src/modules/lesson/greenhouse-cast.ts')
 };
 const source=fs.readFileSync(new URL('../engine/src/modules/lesson/player.ts',import.meta.url),'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(js+'\nmodule.exports.publishInteraction=publishInteraction;',{ module,exports:module.exports,require:id=>imports[id],window:{addEventListener(type,fn){listeners.set(type,fn);},dispatchEvent(event){emitted.push(event);}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},console,setTimeout,clearTimeout});
 const hooks=module.exports.player;await hooks.onConnected(player);
 const flush=async()=>{await new Promise(resolve=>setImmediate(resolve));};await flush();
 const reset=()=>Object.keys(counts).forEach(key=>counts[key]=0);
 return {hooks,player,map,events,context,counts,reset,emitted,publish:module.exports.publishInteraction,async contextChanged(){callback(context);await flush();},flush};
}
test('五次相同checkpoint上下文不再重同步演员和变量',async()=>{
 const h=await harness();h.reset();for(let i=0;i<5;i++)await h.contextChanged();
 assert.equal(h.counts.sync,0);assert.equal(h.counts.variables,0);assert.equal(h.counts.actors,0);
});
test('同图切站、风机输出变化、补演员和新player对象仍同步',async()=>{
 const h=await harness();h.reset();h.context.levelId='repair';await h.contextChanged();assert.equal(h.counts.actors,1);
 h.context.draft.scene.deviceOutput='on';await h.contextChanged();assert.equal(h.player.getVariable('deviceOutput'),'on');assert.equal(h.counts.actors,2);
 h.events.splice(h.events.findIndex(event=>event.id==='sensor'),1);await h.contextChanged();assert.equal(h.counts.actors,3);
 await h.hooks.onJoinMap({...h.player},h.map);assert.equal(h.counts.actors,4);
});
test('自定义手动动作只执行48px内最近且对玩家可见的事件一次',async()=>{
 const h=await harness();h.events.unshift({id:'hidden',hidden:true,x:()=>101,y:()=>100,execMethod:async()=>{throw Error('不可见事件不能交互');}});
 await h.hooks.onInput(h.player,{action:'lesson:interact'});assert.equal(h.counts.actions,1);
 h.player.x=()=>-100;await h.hooks.onInput(h.player,{action:'lesson:interact'});assert.equal(h.counts.actions,1);
});
test('键盘默认action已有SDK碰撞对象时，不重复执行最近事件',async()=>{
 const h=await harness();h.map.getCollisions=()=>['guide'];
 await h.hooks.onInput(h.player,{action:'action'});assert.equal(h.counts.actions,0);
 h.map.getCollisions=()=>[];await h.hooks.onInput(h.player,{action:'action'});assert.equal(h.counts.actions,1);
});
test('本地SDK实际onAction方法让自定义动作绕过碰撞，默认键盘动作只交互一次',async()=>{
 const h=await harness();
 const source=fs.readFileSync(new URL('../engine/node_modules/@rpgjs/server/src/rooms/map.ts',import.meta.url),'utf8');
 const start=source.indexOf('  onAction(player:'),end=source.indexOf('\n  /**',start);
 assert.ok(start>0&&end>start);
 const js=ts.transpileModule(`class SdkMap {${source.slice(start,end)}};exports.SdkMap=SdkMap;`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 const module={exports:{}};vm.runInNewContext(js,{module,exports:module.exports,Control:{Action:'action'},Set,Date});
 const sdk=new module.exports.SdkMap();let collisionReads=0;
 Object.assign(sdk,h.map,{getCollisions(){collisionReads++;return ['guide'];},getEvent:()=>h.events[0]});
 h.map.getCollisions=()=>['guide'];
 h.player.execMethod=(_method,[action])=>h.hooks.onInput(h.player,action);
 sdk.onAction(h.player,{action:'lesson:interact'});await h.flush();
 assert.equal(collisionReads,0);assert.equal(h.counts.actions,1);
 sdk.onAction(h.player,{action:'action'});await h.flush();
 assert.equal(collisionReads,1);assert.equal(h.counts.actions,2);
});

test('切图期间旧地图不能覆盖新地图的手动目标提示或触发旧事件',async()=>{
 const h=await harness();h.context.levelId='cross';h.events[0].id='fan';h.emitted.length=0;
 h.publish(h.player);
 assert.equal(h.emitted.length,0,'旧温室不应再发布风机提示');
 await h.hooks.onInput(h.player,{action:'lesson:interact'});
 assert.equal(h.counts.actions,0,'切图时不交互旧地图');
});
test('重建玩家对象后，旧对象的迟到提示不能覆盖当前玩家',async()=>{
 const h=await harness();await h.hooks.onJoinMap({...h.player},h.map);h.player.x=()=>-100;h.emitted.length=0;
 h.publish(h.player);
 assert.equal(h.emitted.length,0);
});
