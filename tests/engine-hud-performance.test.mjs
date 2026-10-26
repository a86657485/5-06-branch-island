import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../engine/node_modules/typescript/lib/typescript.js';

function harness() {
 const counts={query:0,rect:0,create:0,append:0,replace:0,text:0,style:0,classes:0,attributes:0};
 const nodes=new Map();
 function element(id='') {
  let text='',hidden=true,disabled=false,title='';
  const handlers=new Map();
  const classes=new Set(), children=[];
  const node={id,children,isConnected:true,dataset:{},inert:false,
   style:new Proxy({getPropertyValue(key){return this[key]||'';},setProperty(key,value){counts.style++;this[key]=value;}},{set(target,key,value){counts.style++;target[key]=value;return true;}}),
   classList:{contains:key=>classes.has(key),add(key){counts.classes++;classes.add(key);},remove(key){counts.classes++;classes.delete(key);},toggle(key,on){counts.classes++;if(on)classes.add(key);else classes.delete(key);}},
   addEventListener(type,fn){handlers.set(type,fn);},click(){return handlers.get('click')?.();},setAttribute(){},querySelector(){return null;},querySelectorAll(){return [];},
   appendChild(child){counts.append++;children.push(child);return child;},replaceChildren(){counts.replace++;children.length=0;},
   getBoundingClientRect(){counts.rect++;return rect;}
  };
  Object.defineProperties(node,{textContent:{get:()=>text,set:value=>{counts.text++;text=value;}},hidden:{get:()=>hidden,set:value=>{counts.attributes++;hidden=value;}},disabled:{get:()=>disabled,set:value=>{counts.attributes++;disabled=value;}},title:{get:()=>title,set:value=>{counts.attributes++;title=value;}}});
  return node;
 }
 let rect={left:0,top:0,right:1000,bottom:700,width:1000,height:700};
 for(const id of ['engine-controls','engine-status','engine-status-text','engine-reload','engine-dismiss','engine-feedback','engine-assistance','engine-task-hint','focus-marker','focus-label','path-dots','engine-hint','engine-undo','engine-goto','engine-action','engine-action-label','engine-action-help']) nodes.set(id,element(id));
 const arrow=element(),canvas=element(),panel=element('panel');
 nodes.get('focus-marker').querySelector=()=>arrow;
 const context={levelId:'cross',draft:{scene:{},rpg:{mapId:'crossing'}},support:{hints:[]}};
 let focus={kind:'map',id:'route',step:'walk',hint:'走过去',strong:'看看脚印',goto:false,target:{x:400,y:300,mapId:'crossing',place:'bridge'},dots:Array.from({length:19},(_,i)=>({x:200+i*10,y:300}))};
 let camera=0;
 const viewport={parent:{},toWorld(){},toGlobal(point){return {x:point.x+camera,y:point.y};}};
 const listeners=new Map();
 const window={parent:null,location:{origin:'http://localhost'},addEventListener(type,fn){listeners.set(type,fn);},dispatchEvent(event){listeners.get(event.type)?.(event);},setTimeout(){}};window.parent=window;
 let studio=false,mutated;
 const document={hidden:false,body:element(),createElement(){counts.create++;return element();},getElementById:id=>nodes.get(id)||null,addEventListener(){},querySelector(selector){counts.query++;if(selector==='#rpg canvas')return canvas;if(selector==='.studio')return studio?panel:null;if(selector.startsWith('[data-focus='))return panel;return null;},querySelectorAll(){counts.query++;return panel.classList.contains('focus-target')?[panel]:[];}};
 const imports={
  'pixi.js/unsafe-eval':{},'@signe/di':{mergeConfig(){}},'@rpgjs/client':{inject(){},provideRpg(){},startGame:()=>new Promise(()=>{})},'@rpgjs/common':{Direction:{}},'./server':{},'./config/config.client':{},vue:{createApp(){}},
  './classroom-bridge':{dispose(){},getContext:()=>context,ready:()=>new Promise(()=>{}),request:async()=>{},subscribeContext(){},setArtifactBarrier(){}},'./gui/FlowPanel.vue':{},
  '../../public/idle-timer.mjs':{createIdleTimer:()=>({strength:()=>0,reset(){},configure(){},setPaused(){},tick(){}})},'../../public/focus.mjs':{currentFocus:()=>focus,gotoTitle:()=>''},'./gui/flow-model':{},'./gui/plain':{},
  './focus-marker':{focusFootprint:target=>typeof target.x==='number'?{...target,radiusX:20,radiusY:10,halfWidth:15}:null}
 };
 const source=fs.readFileSync(new URL('../engine/src/standalone.ts',import.meta.url),'utf8')+'\nexports.qa={paintFocus,setEngine:value=>engine=value};';
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(js,{module,exports:module.exports,require:id=>imports[id],window,document,console,URLSearchParams,location:{search:''},requestAnimationFrame:()=>1,cancelAnimationFrame(){},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},MutationObserver:class{constructor(fn){mutated=fn;}observe(){}}});
 const actions=[];
 module.exports.qa.setEngine({canvasApp:{stage:viewport},stopProcessingInput:false,interruptCurrentPlayerMovement(){},processAction:action=>actions.push(action)});
 const reset=()=>Object.keys(counts).forEach(key=>counts[key]=0);
 return {paint:()=>module.exports.qa.paintFocus(focus),counts,nodes,reset,actions,emit:(type,detail)=>window.dispatchEvent({type,detail}),overlay:(open,kind='learn')=>window.dispatchEvent({type:'message',data:{type:'rpgjs-overlay',open,kind}}),setStudio(value){studio=value;mutated();},setFocus:value=>focus=value,setCamera:value=>camera=value,setRect:value=>rect=value,panel};
}

test('19点路径静止60帧复用节点，不重复写文字、样式或高亮，一帧最多读取一次画布',()=>{
 const h=harness();h.paint();h.reset();for(let i=0;i<60;i++)h.paint();
 assert.equal(h.counts.create,0);assert.equal(h.counts.replace,0);assert.equal(h.counts.append,0);
 assert.equal(h.counts.text,0);assert.equal(h.counts.style,0);assert.equal(h.counts.classes,0);
 assert.equal(h.counts.attributes,0);
 assert.ok(h.counts.rect<=60,JSON.stringify(h.counts));assert.equal(h.counts.query,0);
});
test('相机位移后同一批脚印和目标继续跟随',()=>{
 const h=harness();h.paint();const first=h.nodes.get('path-dots').children[0];
 h.reset();h.setCamera(60);h.paint();
 assert.equal(h.nodes.get('path-dots').children[0],first);assert.equal(first.style.left,'260px');
 assert.equal(h.nodes.get('focus-marker').style.left,'460px');assert.ok(h.counts.rect<=1);assert.equal(h.counts.create,0);
});
test('同一面板目标不逐帧移除再加高亮',()=>{
 const h=harness();h.setFocus({kind:'panel',id:'sentence-slot-next',step:'lock',hint:'锁定',target:{},dots:[]});h.paint();h.reset();
 for(let i=0;i<60;i++)h.paint();assert.equal(h.counts.classes,0);
});
test('视口移动与任务改变都沿用节点并更新屏幕位置和提示',()=>{
 const h=harness();h.paint();const first=h.nodes.get('path-dots').children[0];
 h.setRect({left:100,top:30,right:1100,bottom:730,width:1000,height:700});h.paint();
 assert.equal(first.style.left,'300px');assert.equal(first.style.top,'330px');
 h.setFocus({kind:'map',id:'next',step:'read',hint:'读取新点',strong:'读新点',goto:true,target:{x:500,y:400},dots:[{x:250,y:350}]});h.paint();
 assert.equal(h.nodes.get('path-dots').children[0],first);assert.equal(first.style.left,'350px');
 assert.equal(h.nodes.get('path-dots').children[1].hidden,true);assert.equal(h.nodes.get('engine-task-hint').textContent,'读取新点');
});
test('手动入口显示近邻标签，远处禁用，点击使用独立动作一次',()=>{
 const h=harness(),button=h.nodes.get('engine-action');h.paint();assert.equal(button.disabled,true);
 assert.equal(h.nodes.get('engine-action-help').textContent,'请先靠近目标');
 h.emit('lesson-interaction-target',{label:'交谈·老修',inRange:true});assert.equal(button.disabled,false);
 assert.equal(h.nodes.get('engine-action-label').textContent,'交谈·老修');button.click();assert.deepEqual(h.actions,['lesson:interact']);
 h.emit('lesson-interaction-target',{label:'操作·探头',inRange:false});button.click();assert.equal(button.disabled,true);assert.equal(h.actions.length,1);
});
test('对话、规则面板、状态、宿主遮挡和自动行走均禁用手动入口',()=>{
 const h=harness(),button=h.nodes.get('engine-action');h.emit('lesson-interaction-target',{label:'操作·探头',inRange:true});assert.equal(button.disabled,false);
 h.emit('lesson-dialog-state',{open:true});assert.equal(button.disabled,true);h.emit('lesson-dialog-state',{open:false});assert.equal(button.disabled,false);
 h.setStudio(true);assert.equal(button.disabled,true);h.setStudio(false);assert.equal(button.disabled,false);
 h.nodes.get('engine-status').hidden=false;h.paint();assert.equal(button.disabled,true);h.nodes.get('engine-status').hidden=true;h.paint();assert.equal(button.disabled,false);
 h.overlay(true);assert.equal(button.disabled,true);h.overlay(false);assert.equal(button.disabled,false);
 h.emit('lesson-walking',{moving:true});button.click();assert.equal(button.disabled,true);assert.equal(h.actions.length,0);
 h.emit('lesson-walking',{moving:false});assert.equal(button.disabled,false);
});
