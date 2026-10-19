import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import rules from '../public/rules.js';
import adventure from '../public/adventure-rules.js';
import { STATIONS, createPatrol, markStory, storyKey, storyScript, stationUnlocked, storyChangesLearning } from '../public/patrol.mjs';
import { pointsLabel } from '../public/scoreboard.mjs';

function appHarness(rpg = false) {
 const nodes = new Map();
 const node = key => { if (!nodes.has(key)) nodes.set(key, { innerHTML:'', textContent:'', hidden:false, classList:{add(){},remove(){},toggle(){}}, addEventListener(){}, showModal(){},close(){}, querySelector(){return null;}, querySelectorAll(){return [];} }); return nodes.get(key); };
 const storage = new Map(), scenes = [], events = [];
 const context = vm.createContext({ window:{BranchRules:rules,AdventureRules:adventure,addEventListener(){}}, location:{search:rpg?'':'?engine=legacy'},document:{querySelector:node,querySelectorAll:()=>[],addEventListener(){}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},URLSearchParams,AbortSignal,Date,JSON,crypto:{randomUUID:()=>`event-${events.length}`},setInterval(){},setTimeout(){},console,
  SyncQueue:class {constructor(){this.events=[];}pending(){return 0;}add(e){events.push(e);}async flush(){}},reconcileState:(_local,remote)=>remote,
  createIdleTimer:()=>({configure(){},setPaused(){},tick(){},reset(){},strength(){return 0}}),
  currentFocus:()=>({id:'guide',step:'1',hint:'先听园艺员说任务。',strong:'走到发光的圆圈上按 E。',thinking:false,goto:true,gotoReason:'',pause:false,kind:'map',target:{stationId:'sale',mapId:'greenhouse',x:1,y:1}}),
  STATIONS, createPatrol, markStory, storyKey, storyScript, stationUnlocked, storyChangesLearning, pointsLabel,
  createParkScene:host=>{ const scene={host,destroy(){host.onChange({scene:{version:1,x:20,y:30}});},refresh(){}};scenes.push(scene);return scene; },
  createRpgScene:host=>{const scene={engine:'rpgjs',host,destroy(){},refresh(){},navigate(id){this.host=host.forLevel(id);}};scenes.push(scene);return scene;}
 });
 let source = fs.readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/boot\(\)\.catch[\s\S]*$/,'');
 source += `\nglobalThis.testApp={render,renderTask,destroyScene,draft,quizDraft,setState(s){state=s;user={id:'student-a',classId:'501',name:'同学甲'};},setCurrent(id){current=id;},getState(){return state;},setQuizVersion(v){quizVersion=v;},setUser(u){user=u;}};`;
 vm.runInContext(source,context);
 return {app:context.testApp,scenes,events,storage,node};
}
const state = () => ({drafts:{},levels:{},runs:{},predictions:{},attempts:[],points:0});

test('场景读取温度模型，实验保存现场证据且不重建场景',()=>{
 const h=appHarness();h.app.setState(state());h.app.renderTask(0);
 const host=h.scenes[0].host;
 assert.equal(host.getDraft().config.model,'ventilation');
 host.onChange({config:{model:'ventilation',operator:'>=',yes:'on',no:'off'}});
 const result=host.onExperiment({input:{temperature:30},prediction:'on',sceneEvidence:{version:1,station:'sale',actorId:'sensor30',actions:['measure','predict','ticket','gate'],destination:'on',prediction:'on'}});
 assert.equal(result.correct,true);assert.equal(h.scenes.length,1);
 assert.equal(h.app.getState().runs.sale[0].scene.actorId,'sensor30');
 assert.deepEqual(h.events.filter(e=>e.type==='run')[0].payload.input,{temperature:30});
});

test('离开场景仍按捕获的关卡保存，身高旧稿迁移保留历史积分',()=>{
 const h=appHarness(),s=state();s.drafts.sale={config:{operator:'<',yes:'5',no:'10'},input:{height:120},reason:'boundary'};s.runs.sale=[{input:{height:120}}];s.levels.sale={completed:true,valid:true,points:25};s.points=25;
 h.app.setState(s);h.app.renderTask(0);assert.equal(h.app.getState().runs.sale.length,1);assert.equal(h.app.getState().points,25);assert.equal(h.app.getState().levels.sale.valid,false);assert.equal(h.app.getState().levels.sale.evidenceStart,1);
 h.app.setCurrent('repair');h.app.destroyScene();
 assert.equal(h.app.getState().drafts.sale.scene.x,20);assert.equal(h.app.getState().drafts.repair,undefined);
 assert.equal(h.events.at(-1).levelId,'sale');
});

test('旧检测未交稿独立归档，不套用新版题库答案索引',()=>{
 const h=appHarness(),s=state();s.drafts.quiz={answers:[0,...Array(19).fill(null)],index:1};h.app.setState(s);h.app.setQuizVersion('park-v2');
 const next=h.app.quizDraft();assert.equal(next.quizVersion,'park-v2');assert.equal(JSON.stringify(next.answers),'{}');
 const archive=[...h.storage.entries()].find(([key])=>key.startsWith('branch-island-quiz-archive:'));
 assert.equal(JSON.parse(archive[1]).draft.answers[0],0);
});

test('旧路口与配电成绩保留，再次进入现场不取消已验证',()=>{
 for(const [idx,id,config,input] of [[2,'cross',{yes:'bridge',no:'crossing'},{facility:true}],[3,'minimum',{operator:'<',yes:'a',no:'b'},{a:3,b:8}]]){
  const h=appHarness(),s=state();s.drafts[id]={config,input};s.runs[id]=[{input}];s.levels[id]={completed:true,valid:true,points:25,evidenceStart:0};s.points=25;
  h.app.setState(s);h.app.setCurrent(id);h.app.renderTask(idx);
  assert.equal(h.app.getState().levels[id].valid,true);assert.equal(h.app.getState().levels[id].evidenceStart,0);assert.equal(h.app.getState().points,25);
 }
});

test('温度模型遗留游客场景重置，避免角色与温度输入不符',()=>{
 const h=appHarness(),s=state();s.drafts.sale={config:{model:'ventilation',operator:'>=',yes:'on',no:'off'},input:{temperature:30},scene:{version:1,actorId:'visitor120'}};s.runs.sale=[{}];s.levels.sale={completed:true,valid:true,evidenceStart:0};
 h.app.setState(s);h.app.renderTask(0);assert.equal(h.scenes[0].host.getDraft().scene,undefined);assert.equal(s.levels.sale.valid,true);assert.equal(s.levels.sale.evidenceStart,0);
});

test('RPGJS 在选择时保存首预测，核验不重复记预测，验收后同实例进入下一地图',()=>{
 const h=appHarness(true),s=state();h.app.setState(s);h.app.renderTask(0);
 const host=h.scenes[0].host;
 assert.equal(typeof host.onPrediction,'function','需要场景实时预测接口');
 const config={model:'ventilation',operator:'>=',yes:'on',no:'off'};host.onChange({config});
 host.onPrediction({value:'off',input:{temperature:30},config});
 host.onPrediction({value:'on',input:{temperature:30},config});
 assert.equal(s.predictions.sale[0].value,'off');
 host.onExperiment({input:{temperature:30},prediction:'on',sceneEvidence:{version:1,station:'sale',actorId:'sensor30',actions:['measure','predict','ticket','gate'],destination:'on',prediction:'on'}});
 assert.equal(h.events.filter(event=>event.type==='prediction').length,2);
 for(const temperature of [29,31])host.onExperiment({input:{temperature},prediction:temperature<30?'off':'on',sceneEvidence:{version:1,station:'sale',actorId:`sensor${temperature}`,actions:['measure','predict','ticket','gate'],destination:temperature<30?'off':'on',prediction:temperature<30?'off':'on'}});
 host.onReason('boundary');assert.equal(host.onComplete({deferRender:true}).passed,true);
 host.onNext();assert.equal(h.scenes.length,1);assert.equal(h.scenes[0].host.levelId,'repair');assert.equal(s.points,25);
});

test('未通过的验收也会提交，方便之后把概念提示和独立完成分开',()=>{
 const h=appHarness(true),s=state();
 s.drafts.cross={config:{yes:'bridge',no:'bridge'},reason:'none',input:{facility:false}};
 s.runs.cross=[{config:{yes:'bridge',no:'bridge'},input:{facility:false},correct:false}];
 s.levels.cross={evidenceStart:0,submissions:0,hinted:false};
 h.app.setState(s);h.app.setCurrent('cross');h.app.renderTask(2);
 const result=h.scenes.at(-1).host.onComplete({deferRender:true});
 assert.equal(result.passed,false);
 assert.equal(h.events.filter(event=>event.type==='complete'&&event.levelId==='cross').length,1);
 assert.equal(h.app.getState().levels.cross.completed,undefined);
});

test('同一身份重新挂载后，旧引擎回调不再写入新场景',()=>{
 const h=appHarness(true),s=state();h.app.setState(s);h.app.renderTask(0);const old=h.scenes[0].host;
 h.app.renderTask(0);const before=h.events.length;
 old.onChange({prediction:'off'});
 assert.equal(h.events.length,before);assert.notEqual(s.drafts.sale?.prediction,'off');
});

test('再次进入已通过的站不提交默认配置',()=>{
 const h=appHarness(true);
 const config={model:'ventilation',operator:'>=',yes:'on',no:'off'};
 const s=state();
 s.drafts.sale={config,input:{temperature:30},scene:{version:1,x:10,y:20,facing:'down',phase:'assigned',measured:true,actions:[],visited:[],actorId:'sensor30',temperatureCase:30}};
 s.levels.sale={completed:true,valid:true,points:25,evidenceStart:0};
 s.runs.sale=[{config,input:{temperature:30}}];
 h.app.setState(s);h.app.renderTask(0);
 assert.equal(h.events.length,0);
 assert.equal(h.app.getState().levels.sale.valid,true);
 assert.equal(h.app.getState().drafts.sale.config.yes,'on');
 assert.equal(h.app.getState().drafts.sale.config.no,'off');
});

test('开考前能看到缺的站，回到该站按钮可以点',()=>{
 const h=appHarness(true);
 const s=state();
 s.levels={sale:{completed:true,valid:true},repair:{completed:false,valid:false},cross:{completed:false,valid:false},minimum:{completed:false,valid:false}};
 h.app.setState(s);h.app.setCurrent('quiz');h.app.render();
 const html=h.node('#exam-body').innerHTML;
 assert.match(html,/温室控制器返修/);
 assert.match(html,/回到该站（温室控制器返修）/);
 assert.equal(html.includes('data-back="repair" disabled'),false);
 assert.match(html,/考核还没开放/);
 assert.match(h.node('#app').innerHTML,/id="exam-overlay"/);
 assert.match(h.node('#app').innerHTML,/巡检单/);
});
