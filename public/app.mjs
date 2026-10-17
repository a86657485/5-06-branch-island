import { SyncQueue, reconcileState } from './sync.mjs';
import { createParkScene } from './scene.mjs';
import { createRpgScene } from './rpg-scene.mjs';
import { createIdleTimer } from './idle-timer.mjs';
import { currentFocus } from './focus.mjs';
import { createIntro, introAct, TESTERS } from './intro.mjs';
const R = window.BranchRules;
let quizStrength = 0;
let gateInfoSent = false;
const quizIdle = createIdleTimer({
  onStrength(detail) {
    quizStrength = detail.strength;
    if (!demo && user) send('nav_help', 'quiz', { trigger: 'idle', strength: detail.strength, idleMs: detail.idleMs, step: detail.stepKey, focusId: detail.stepKey, levelId: 'quiz' });
    if (current === 'quiz') renderQuiz();
  }
});
setInterval(() => { if (current === 'quiz') quizIdle.tick(); }, 1000);
const $ = s => document.querySelector(s);
let gateTicketOpen = false;
let gateSignTimer = 0;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = v => JSON.parse(JSON.stringify(v));
const eventId = () => globalThis.crypto?.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2,'0')).join('');
const ids = ['sale','repair','cross','minimum'];
const titles = ['温室风机调试','温室控制器返修','路口导行屏调试','储能柜配电'];
const demo = new URLSearchParams(location.search).has('demo');
const legacy = new URLSearchParams(location.search).get('engine') === 'legacy';
const emptyState = () => ({drafts:{},levels:{},runs:{},predictions:{},attempts:[],points:0});
let activeScene = null, sceneGeneration = 0, quizVersion = '', user = null, round = 1, state = emptyState(), current = 'sale', roster = null, questions = [], answerKey = [], quizIndex = 0, quizReview = false, notice = '', lastRun = null, loginClass = '501', loginSearch = '', manual = '', selectedStudent = '';
const defaults = {
 sale:{config:{model:'ventilation',operator:'>=',yes:'',no:''},input:{temperature:30},prediction:'',reason:'',hint:0},
 repair:{config:{model:'ventilation',operator:'>=',yes:'off',no:'on'},input:{temperature:30},prediction:'',reason:'',hint:0},
 cross:{config:{yes:'',no:''},input:{facility:true},prediction:'',reason:'',hint:0},
 minimum:{config:{operator:'',yes:'',no:''},input:{a:3,b:8},prediction:'',reason:'',hint:0}
};
const reasonOptions = {
 sale:[['both','达到阈值时，两条出口都执行'],['boundary','30℃达到启动阈值，应启动；低于30℃才停机'],['small','30比30小，所以停机']],
 repair:[['symbol','只改判断方向，出口可以不变'],['swap','判断方向改变，要交换两个出口才能保持原来的设备规则'],['both','两条出口设成同一个动作就能修好']],
 cross:[['one','条件成立与否决定路径，一次只执行对应的一条'],['none','没有天桥就不用考虑其他通行方式'],['both','先走天桥，再走斑马线']],
 minimum:[['always','A排在前面，每次都优先充A'],['compare','先比较两组电量，沿对应路径让较低电量的一组优先充电'],['both','一次将两组都接入唯一充电口']]
};
async function api(path, body) {
 const response = await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(8000)});
 const data = await response.json();
 if(!response.ok) throw Object.assign(new Error(data.error || data.message || `保存未成功（${response.status}）`),{status:response.status,code:data.code});
 return data;
}
const cacheKey = () => `branch-island-state:${demo?'demo':user.id}:${round}`;
function saveLocal(){ if(user) localStorage.setItem(cacheKey(),JSON.stringify({state,current})); }
const queue = new SyncQueue(localStorage,e => api('/api/events',e),(event,data)=>{
 if(user && event.studentId===user.id && event.round===round && !queue.pending(user.id)) {
  state=reconcileState(state,data.state,event.type!=='quiz');
  saveLocal();
  if(event.type==='complete' && !data.result.passed) {notice=data.result.feedback;if(activeScene?.engine==='rpgjs'){setNotice(notice);activeScene.refresh();}else render();}
  if(data.rewardUnlocked!=null){const cached=JSON.parse(localStorage.getItem('branch-island-questions')||'{}');cached.reward=!!data.rewardUnlocked;localStorage.setItem('branch-island-questions',JSON.stringify(cached));}
  if(event.type==='quiz') {quizReview=true; questions=[]; notice='检测已提交。看看错题，再决定要不要做挑战层。';render();}
  updateHeader();
 }
},(event,error)=>{
 if(user&&event.studentId===user.id){state.drafts.quiz={tier:'base',answers:{},index:0,confirmed:{},quizVersion};questions=[];quizReview=false;notice='旧版待提交答卷已完整保留在本机未评分存档，请按新版重新作答。';saveLocal();if(current==='quiz')renderQuiz();updateHeader();}
});
function syncStatus(){if(demo)return '独立演示 · 不计入班级';const n=queue.pending(user?.id);return n?`${n}条待同步 · ${queue.error?'连接未完成，记录已保留':'正在保存'}`:'已同步保存';}
function updateHeader(){if($('#save-status'))$('#save-status').textContent=syncStatus();if($('#points'))$('#points').textContent=`${state.points || 0} 积分`;updateRoutes();}
function examOpened(){return !!(state.quizOpenedAt||state.exam?.openedAt);}
function canEnter(id){return demo || (id==='quiz'?true:ids.includes(id)&&(ids.indexOf(id)===0||state.levels[ids[ids.indexOf(id)-1]]?.completed));}
function updateRoutes(){document.querySelectorAll('[data-route]').forEach(button=>{const id=button.dataset.route;button.disabled=!canEnter(id);button.classList.toggle('selected',current===id);if(id!=='quiz'){const level=state.levels[id],stop=button.querySelector('.stop'),small=button.querySelector('small');if(stop)stop.textContent=level?.completed?'✓':ids.indexOf(id)+1;if(small)small.textContent=level?.completed?(level.valid?'已完成 · 当前已验证':'曾完成 · 当前待重验'):(canEnter(id)?'可开始探索':'完成上一站解锁');}});}
function goToTask(id){
 if(!canEnter(id))throw new Error('请先完成前面的主线任务。');
 current=id;lastRun=null;notice='';quizReview=false;
 if(activeScene?.engine==='rpgjs'&&id!=='quiz'){prepareSceneDraft(id);saveLocal();activeScene.navigate(id);updateRoutes();return {levelId:id};}
 saveLocal();render();return {levelId:id};
}
function send(type,levelId,payload){
 if(!user)return;
 saveLocal();
 if(demo){updateHeader();return;}
 queue.add({studentId:user.id,round,eventId:eventId(),type,levelId,payload:clone(payload),editedAt:Date.now()});
 updateHeader();queue.flush().then(updateHeader);
}
function draft(id=current){if(!state.drafts[id])state.drafts[id]=clone(defaults[id]);return state.drafts[id];}
function destroyScene(){const scene=activeScene;activeScene=null;scene?.destroy();sceneGeneration++;}
function prepareSceneDraft(id){
 const d=state.drafts[id];
 if(!d) return null;
 const oldModel=['sale','repair'].includes(id)&&d.config?.model!=='ventilation';
 if(oldModel){localStorage.setItem(`branch-island-task-archive:${user.id}:${round}:${id}:${Date.now()}`,JSON.stringify(d));state.drafts[id]=clone(defaults[id]);}
 if(['sale','repair'].includes(id)&&state.drafts[id]?.scene?.version===1&&!Number.isFinite(state.drafts[id].scene.temperatureCase)){delete state.drafts[id].scene;}
 if(oldModel){state.levels[id]||={completed:false,points:0};state.levels[id].evidenceStart=(state.runs[id]||[]).length;state.levels[id].valid=false;}
 return state.drafts[id];
}
function setNotice(text){notice=text;const target=$('#notice')||$('#scene-toast');if(target){target.textContent=text;target.hidden=!text;}}
function option(value,label,selected){return `<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(label)}</option>`;}
function outputLabel(value){return ({on:'启动风机',off:'停止风机',bridge:'走天桥',crossing:'到斑马线按信号通行',a:'电池A优先充电',b:'电池B优先充电'})[value] || '选择执行的动作';}
function conditionLabel(id=current){const d=draft(id);if(id==='cross')return '附近有可用天桥吗？';if(id==='minimum')return d.config.operator?`电量 a ${d.config.operator} b 吗？`:'两组电量怎样比较？';return `温度 ${d.config.operator==='>='?'≥':'＜'} 30℃？`;}
function flow(){
 const c=draft().config;const br=lastRun?.branch;
 return `<svg viewBox="0 0 720 354" role="img" aria-label="分支流程图：先判断，沿是或否执行一个出口，再汇合结束"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8" fill="#68849c"/></marker><marker id="hot" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8" fill="#147d78"/></marker></defs><g class="park-art"><path d="M0 280Q130 230 240 277T720 260V300H0" fill="#d7eee5"/><path d="M30 263v-45m-12 24l12-25 14 25m-32 6l18-31 21 31M673 266v-51m-17 28l17-28 19 28" stroke="#9bc6b3" stroke-width="9" fill="none"/><circle cx="658" cy="42" r="20" fill="#ffdc82"/><path d="M36 66h78m-65-10h51" stroke="#fff" stroke-width="10" stroke-linecap="round"/></g><ellipse cx="360" cy="24" rx="50" ry="18" fill="#153758"/><text x="360" y="29" text-anchor="middle" fill="white">开始</text><path d="M360 42V58" class="wire"/><path d="M273 60H465L447 96H255Z" fill="#f5f8fb" stroke="#a4bbcd"/><text x="360" y="83" text-anchor="middle">${esc(current==='minimum'?`输入电量 A=${draft().input.a}%，B=${draft().input.b}%`:current==='cross'?`输入：${draft().input.facility?'有设施':'无设施'}`:`输入温度${draft().input.temperature}℃`)}</text><path d="M360 96V115" class="wire"/><path d="M360 115L487 163 360 211 233 163Z" fill="#fff3cb" stroke="#d0ad49" stroke-width="2"/><text x="360" y="169" text-anchor="middle" class="condition-text">${esc(conditionLabel())}</text><path d="M233 163H165V235" class="wire ${br==='yes'?'active-wire':''}"/><path d="M487 163H555V235" class="wire ${br==='no'?'active-wire':''}"/><text x="194" y="150" class="branch-label">是</text><text x="510" y="150" class="branch-label">否</text><path d="M47 238H307L283 290H23Z" class="flow-output ${br==='yes'?'active-output':''}"/><path d="M437 238H697L673 290H413Z" class="flow-output ${br==='no'?'active-output':''}"/><text x="165" y="269" text-anchor="middle">${esc(outputLabel(c.yes))}</text><text x="555" y="269" text-anchor="middle">${esc(outputLabel(c.no))}</text><path d="M165 290V318H360M555 290V318H360V330" class="wire"/><ellipse cx="360" cy="337" rx="50" ry="16" fill="#edf2f7" stroke="#68849c"/><text x="360" y="342" text-anchor="middle">结束</text>${br?`<g transform="translate(${br==='yes'?150:540} 205)"><rect width="30" height="25" rx="8" fill="#147d78"/><circle cx="9" cy="11" r="3" fill="white"/><circle cx="21" cy="11" r="3" fill="white"/><path d="M15 0v-7m-4 0h8" stroke="#147d78" stroke-width="3"/></g>`:''}</svg>`;
}
function login(){
 const cls=roster.classes.find(c=>c.id===loginClass) || roster.classes[0];loginClass=cls.id;
 const names=cls.students.filter(s=>s.name.includes(loginSearch));
 $('#app').innerHTML=`<main class="landing"><section class="welcome"><p class="eyebrow">五年级 · 身边的算法 · 第6课</p><h1>分支<span>冒险岛</span></h1><p class="welcome-copy">走进智慧园区，亲自调试设备。<br>让判断有依据，让每条指令执行正确。</p><div class="landing-world" aria-hidden="true"><div class="landing-role">智慧园区设备调试员</div></div><p class="landing-note">读取传感器 · 修复设备 · 核验通行 · 节能配电</p></section><section class="login-card"><p class="eyebrow">调试员报到</p><h2>选择你的身份</h2><p class="muted">本课次的进度会保存。老师开始新课次后，要从头做。</p><label>班级<select id="class-select">${roster.classes.map(c=>option(c.id,`${c.id}班`,loginClass)).join('')}</select></label><label>搜索姓名<input id="name-search" value="${esc(loginSearch)}" placeholder="输入姓名中的字" autocomplete="off"></label><label>名单姓名<select id="student-select">${option('','请选择自己的姓名',selectedStudent)}${names.map(s=>option(s.id,s.name,selectedStudent)).join('')}</select></label><details><summary>名单中没有我</summary><label>补充姓名<input id="manual-name" maxlength="30" value="${esc(manual)}" placeholder="输入姓名，归入当前班级"></label></details><div class="identity-confirm">请确认：<strong id="chosen-identity">${esc(loginClass)}班 · ${esc(manual || cls.students.find(s=>s.id===selectedStudent)?.name || '尚未选择姓名')}</strong></div><button id="login" class="primary wide">确认身份，进入园区 →</button><p id="login-error" class="error" role="alert"></p><p class="small muted">请用自己的姓名进入。课堂选名用于记录学习进度。</p></section></main>`;
 $('#class-select').onchange=e=>{loginClass=e.target.value;selectedStudent='';manual='';login();};
 $('#name-search').oninput=e=>{loginSearch=e.target.value;const sel=$('#student-select');sel.innerHTML=option('','请选择自己的姓名','')+cls.students.filter(s=>s.name.includes(loginSearch)).map(s=>option(s.id,s.name,selectedStudent)).join('');};
 $('#student-select').onchange=e=>{selectedStudent=e.target.value;manual='';$('#manual-name').value='';$('#chosen-identity').textContent=`${loginClass}班 · ${cls.students.find(s=>s.id===selectedStudent)?.name || '尚未选择姓名'}`;};
 $('#manual-name').oninput=e=>{manual=e.target.value;selectedStudent='';$('#student-select').value='';$('#chosen-identity').textContent=`${loginClass}班 · ${manual || '尚未填写姓名'}`;};
 $('#login').onclick=async()=>{try{if(!selectedStudent&&!manual.trim())throw new Error('先选择自己的姓名，或在“名单中没有我”填写。');const data=await api('/api/login',{classId:loginClass,...(manual.trim()?{name:manual.trim()}:{studentId:selectedStudent})});attach(data);}catch(e){$('#login-error').textContent=e.message;}};
}
function attach(data){destroyScene();user=data.student;if(data.round!==round)queue.retire(user.id,data.round);round=data.round;state=data.state;const local=JSON.parse(localStorage.getItem(cacheKey())||'null');const pendingThisRound=queue.events.some(event=>event.studentId===user.id&&event.round===round);if(pendingThisRound&&local)state=local.state;current=pendingThisRound&&local?.current?local.current:(ids.find(id=>!state.levels[id]?.completed)||'quiz');if(new URLSearchParams(location.search).get('task')==='quiz')current='quiz';if(!demo)localStorage.setItem('branch-island-identity',JSON.stringify({user,round}));saveLocal();render();queue.flush().then(updateHeader);}
function render(){
 destroyScene();
 if(!user)return login();
 if(!legacy && state.intro && state.intro.done!==true && state.intro.skipped!==true)return renderIntro();
 const idx=ids.indexOf(current);const unlocked=id=>demo || ids.indexOf(id)===0 || state.levels[ids[ids.indexOf(id)-1]]?.completed;
 $('#app').innerHTML=`${demo?'<div class="demo-banner">教师独立演示：可跳关、查看参考操作；所有操作只保存在演示区。<a href="/teacher.html">返回班级大屏</a></div>':''}<header class="topbar"><a class="brand" href="#">分支冒险岛<span>判断选择用分支</span></a><div class="identity"><span>${demo?'演示调试员':`${esc(user.classId)}班 · ${esc(user.name)}`}</span><strong id="points">${state.points||0} 积分</strong><button id="switch-user" class="quiet">切换身份</button></div></header><div class="app-shell"><aside class="map"><p class="eyebrow">园区巡检路线</p><h2>让判断驱动行动</h2><nav aria-label="任务路线">${ids.map((id,i)=>`<button data-route="${id}" class="route-item ${current===id?'selected':''}" ${unlocked(id)?'':'disabled'}><span class="stop">${state.levels[id]?.completed?'✓':i+1}</span><span><b>${titles[i]}</b><small>${state.levels[id]?.completed?(state.levels[id].valid?'已完成 · 当前已验证':'曾完成 · 当前待重验'):(unlocked(id)?'可开始探索':'完成上一站解锁')}</small></span></button>`).join('')}<button data-route="quiz" class="route-item ${current==='quiz'?'selected':''}" ${canEnter('quiz')?'':'disabled'}><span class="stop">Q</span><span><b>独立检测</b><small>${state.quiz?.base?.first?`基础层 ${state.quiz.base.firstScore}/${state.quiz.base.first.total}`:(examOpened()?'可以开始':'还差哪一站')}</small></span></button></nav><div class="map-note">每站25积分，合理试错不扣分。<br>检测成绩与通关积分分开记录。</div><div id="save-status" class="save-status" role="status">${syncStatus()}</div></aside><main id="workbench" class="workbench"></main></div>`;
 $('[data-route]') && document.querySelectorAll('[data-route]').forEach(btn=>btn.onclick=()=>goToTask(btn.dataset.route));
 $('.brand').onclick=e=>{e.preventDefault();goToTask('sale');};
 $('#switch-user').onclick=()=>{destroyScene();saveLocal();localStorage.removeItem('branch-island-identity');user=null;selectedStudent='';manual='';notice='';lastRun=null;if(demo){location.href='/teacher.html';return;}login();};
 if(current==='quiz')renderQuiz();else renderTask(idx);
}
function renderTask(idx){
 destroyScene();
 const initialId=ids[idx],ownerId=user.id,ownerRound=round,generation=sceneGeneration;
 prepareSceneDraft(initialId);
 $('#workbench').classList.add('game-workbench');
 const makeHost=id=>{
  if(!ids.includes(id))throw new Error('找不到这个任务场景。');
  const idx=ids.indexOf(id),sameOwner=()=>user?.id===ownerId&&round===ownerRound&&sceneGeneration===generation&&(legacy||current===id);
  const save=()=>{if(sameOwner())send('draft',id,draft(id));};
  return {
  root:$('#workbench'),levelId:id,demo,forLevel:makeHost,getDraft:()=>state.drafts[id]||clone(defaults[id]),getRuns:()=>state.runs[id]||[],getLevel:()=>state.levels[id],getEvidenceStart:()=>state.levels[id]?.evidenceStart||0,reasons:reasonOptions[id],
  onChange(patch){
   if(!sameOwner())return;
   if('rpg' in patch){patch={...patch,rpg:window.AdventureRules.validateRpgDraft(patch.rpg)};const maps={sale:['greenhouse'],repair:['workshop'],cross:['crossing','crossing-east'],minimum:['energy'],gate:['greenhouse']};if(!maps[id].includes(patch.rpg.mapId))throw new Error('当前位置与任务场景不一致。');}
   const editing=['config','flow','sentence','predictionsLocked','input','prediction','reason'].some(key=>key in patch);
   if(!state.drafts[id] && !editing){state.drafts[id]={};for(const key of ['scene','rpg','panel'])if(key in patch)state.drafts[id][key]=clone(patch[key]);updateHeader();save();updateHeader();return {saved:true};}
   const d=state.drafts[id]||(state.drafts[id]={});
   if(patch.config&&d.config&&JSON.stringify(R.normalizeConfig(id,d.config,true))!==JSON.stringify(R.normalizeConfig(id,{...d.config,...patch.config},true))){state.levels[id]||={completed:false,points:0};state.levels[id].evidenceStart=(state.runs[id]||[]).length;state.levels[id].valid=false;lastRun=null;}
   if(patch.input&&JSON.stringify(patch.input)!==JSON.stringify(d.input))lastRun=null;
   for(const key of ['config','input'])if(patch[key])d[key]={...(d[key]||{}),...patch[key]};
   for(const key of ['prediction','scene','reason','rpg','flow','sentence','predictionsLocked','diagnoseAnswer','panel'])if(key in patch)d[key]=clone(patch[key]);
   save();updateHeader();return {saved:true};
  },
  onEvaluate({input,config}){if(!sameOwner())throw new Error('当前任务已切换。');return R.evaluate(id,config||draft(id).config,input||draft(id).input);},
  onPrediction({value,input,config}){
   if(!sameOwner())return null;
   const d=draft(id),normalized=R.normalizeConfig(id,config||d.config),reading=clone(input||d.input);
   R.evaluate(id,normalized,reading);
   const choices=id==='cross'?['bridge','crossing']:id==='minimum'?['a','b']:['on','off'];
   if(!choices.includes(value))throw new Error('请选择当前任务的输出预测。');
   d.prediction=value;const at=new Date().toISOString();state.predictions[id]||=[];state.predictions[id].push({value,input:reading,config:normalized,at});
   save();send('prediction',id,{value,input:reading,config:normalized});return {saved:true};
  },
  onExperiment({input,prediction,sceneEvidence}){
   if(!sameOwner())return null;
   try{
    const d=draft(id),config=clone(d.config),result=R.evaluate(id,config,input),at=new Date().toISOString();
    window.AdventureRules.validateEvidence(id,sceneEvidence,input,result);
    lastRun={...result,input:clone(input),config,scene:clone(sceneEvidence),prediction,at};
    state.runs[id]||=[];state.runs[id].push(clone(lastRun));
    if(legacy){state.predictions[id]||=[];state.predictions[id].push({value:prediction,input:clone(input),config:clone(config),at});send('prediction',id,{value:prediction,input,config});}
    send('run',id,{config,input,prediction,sceneEvidence});
    notice='';activeScene?.refresh();return result;
   }catch(error){setNotice(error.message);return null;}
  },
  onReason(value){if(!sameOwner())return;draft(id).reason=value;save();},
  onComplete({deferRender=false}={}){
   if(!sameOwner())return {passed:false,feedback:'身份已切换，请在当前身份下继续。'};
   try{
    const d=draft(id),result=R.validateComplete(id,d.config,state.runs[id]||[],d.reason,state.levels[id]?.evidenceStart||0);
    if(!result.passed){send('complete',id,{config:d.config,reason:d.reason});return result;}
    const earned=!state.levels[id]?.completed;
    state.levels[id]={...state.levels[id],completed:true,valid:true,points:25,reason:d.reason};state.points=ids.reduce((n,key)=>n+(state.levels[key]?.completed?25:0),0);
    send('complete',id,{config:d.config,reason:d.reason});
    notice=earned?'现场验收通过，获得25积分！向NPC领取下一项委托。':'当前方案已重新验证，历史积分保留。';
    if(deferRender){updateHeader();activeScene?.refresh();}else render();return {...result,feedback:notice};
   }catch(error){return {passed:false,feedback:error.message};}
  },
  onNext(){if(!sameOwner())return;const next=ids[idx+1]||'quiz';if(!legacy&&next==='quiz'){setTimeout(()=>{if(sameOwner())goToTask('quiz');},0);return {levelId:'quiz'};}return goToTask(next);},
  onFlow(){showHelp(`<h2>${titles[idx]} · 当前执行过程</h2><div class="scene-flow-preview">${flow()}</div><p>根据条件是否成立，一次只执行“是”或“否”对应的一条路径。</p>`);},
  onHelp(){showHelp(`<h2>智慧园区 · 怎么操作</h2><ol><li>${legacy?'点击NPC或设备的名称，角色会沿步道走近，抵达后交谈或操作。':'使用方向键、WASD或屏幕方向按钮行走，走近并面向NPC或设备。'}</li><li>按E、空格或屏幕交互按钮，与面前的对象交谈。</li><li>先领取委托、读取现场输入，在设备旁设置规则并预测。</li><li>亲自执行、到核验点观察结果，再向NPC汇报。不同情况都要验证。</li></ol><p>对话右上角的×可随时关闭，进度会保留。帮助不扣积分。</p><p class="muted">场景参考深圳智慧园林；地图、人物和30℃规则均为教学仿真。</p>`);},
  onNavHelp(data){if(!sameOwner())return null;send('nav_help',id,{trigger:data.trigger||'button',strength:data.strength??0,idleMs:data.idleMs||0,step:data.step||'',focusId:data.focusId||'',mapId:data.mapId||'',levelId:id});return {saved:true};},
  onConceptHint(){
   if(!sameOwner())return null;
   const level=state.levels[id]||{};
   const focus=currentFocus({levelId:id,scene:draft(id).scene,level,draft:draft(id)});
   if(!level.submissions){showHelp('<h2>怎么操作</h2><p>走到发光标记前，按 E 打开面前的人或设备。第一次提交前，求助只说明操作，不会记成概念提示。</p>');send('nav_help',id,{trigger:'button',strength:0,idleMs:0,step:focus.step,focusId:focus.id,mapId:focus.target?.mapId||'',levelId:id});return {kind:'operation'};}
   showHelp('<h2>概念提示</h2><p>第一次提交已经做过。同意之后，这一站再完成会记为在提示下完成。操作帮助不会这样记。</p><button type="button" id="accept-concept">我同意看概念提示</button>');
   const accept=$('#accept-concept');
   if(accept)accept.onclick=()=>{send('concept_hint',id,{level:1,evidenceKind:'station'});state.levels[id].hinted=true;const note=document.createElement('p');note.textContent='概念提示：菱形里要放能用“是”或“否”回答的问题。成立只走一边，不成立走另一边。';$('#help-content').append(note);accept.disabled=true;};
   return {kind:'offer'};
  }
  };
 };
 const host=makeHost(initialId);
 activeScene=(legacy?createParkScene:createRpgScene)(host);
}
function renderIntro(){
 const intro=state.intro||createIntro();
 const focus=currentFocus({levelId:'gate',intro});
 const judgedLabel=intro.judged==='half'?'半价':intro.judged==='full'?'全价':'还没判';
 const compare=intro.ticket?`<p class="gate-compare" data-focus="gate-sign">你判：${esc(judgedLabel)}｜闸机：全价 ${esc(intro.ticket)} 元</p>`:'';
 const ticketView=gateTicketOpen?`<section id="gate-readonly" class="gate-readonly" role="dialog" aria-label="故障单"><h2>故障单（只读）</h2><p>运维主管：半价票判错了。告示写身高不足 120 厘米收半价，否则全价 10 元。闸机现在每次都出全价 10 元。</p><p>这张单只供再看，不会改身高、判定或已经出的票。</p><button type="button" id="gate-ticket-close">回到现场</button></section>`:'';
 const hot=(id,step)=>focus.id===id&&focus.step===step?' focus-target':'';
 const statusText=intro.blocked?esc(intro.blocked):intro.ticket?`闸机出票：全价 ${esc(intro.ticket)} 元。请和告示比一比。`:'测试者已经站在量高立柱旁，不会跟着你走。';
 $('#app').innerHTML=`<header class="topbar"><a class="brand" href="#">分支冒险岛<span>判断选择用分支</span></a><div class="identity"><span>${esc(user.classId)}班 · ${esc(user.name)}</span><strong id="points">${state.points||0} 积分</strong></div></header><main class="gate-page"><p id="gate-hint" class="focus-hint">${esc(focus.hint)}</p><h1>闸机故障单</h1><p id="gate-status">${statusText}</p><svg class="gate-map" viewBox="0 0 640 360" role="img" aria-label="入口闸机示意"><rect width="640" height="360" fill="#e7f2ea"/><rect x="40" y="250" width="560" height="36" fill="#d7c4a2"/><rect x="300" y="40" width="70" height="150" fill="#c9d7c2"/><text x="312" y="120">通道</text><rect x="150" y="168" width="120" height="70" fill="#fff" stroke="#184c3b"/><text x="168" y="208">量高立柱</text>${TESTERS.map(tester=>`<g transform="translate(${tester.x} ${tester.y})"><circle r="16" fill="${tester.height===116?'#f2c14e':'#7eb6d9'}"/><text y="36" text-anchor="middle">${tester.height}</text></g>`).join('')}<rect x="430" y="150" width="90" height="80" fill="#173b31"/><text x="446" y="195" fill="white">闸机</text><rect x="40" y="40" width="180" height="70" fill="#fffaf0" stroke="#c5a048"/><text x="52" y="70">告示：＜120 半价</text><text x="52" y="92">否则全价 10 元</text></svg>${compare}${ticketView}<div class="gate-actions"><button type="button" id="gate-lead" data-focus="gate-lead" class="${hot('gate-lead','1')}">我去试一试</button><button type="button" id="gate-measure" data-focus="gate-ruler" class="${hot('gate-ruler','2')}">量 116 厘米</button><div class="gate-judge${hot('i0-judge','3')}" data-focus="i0-judge"><button type="button" id="gate-half">判半价</button><button type="button" id="gate-full">判全价</button></div><button type="button" id="gate-ticket" data-focus="gate-turnstile" class="${hot('gate-turnstile','4')}">闸机出票</button><button type="button" id="gate-sign" data-focus="gate-sign" class="${hot('gate-sign','5')}">看告示</button><button type="button" id="gate-idea" data-focus="gate-idea" class="${hot('gate-lead','6')}">看情况收费</button><button type="button" id="gate-leave" class="primary${hot('gate-portal','7')}" data-focus="gate-portal">去温室</button><button type="button" id="gate-skip">跳过导入</button><button type="button" id="gate-review">重看故障单</button></div></main>`;
 const act=name=>extra=>{const next=introAct(intro,name,extra);state.intro=next;saveLocal();send('draft','intro',next);render();};
 $('#gate-lead').onclick=()=>act('lead')();
 $('#gate-measure').onclick=()=>act('measure')(116);
 $('#gate-half').onclick=()=>act('judge')('half');
 $('#gate-full').onclick=()=>act('judge')('full');
 $('#gate-ticket').onclick=()=>act('ticket')();
 $('#gate-sign').onclick=()=>act('sign')();
 $('#gate-idea').onclick=()=>act('idea')('看情况收费');
 $('#gate-leave').onclick=()=>act('leave')();
 $('#gate-skip').onclick=()=>act('skip')();
 $('#gate-review').onclick=()=>{gateTicketOpen=true;act('review')();};
 if($('#gate-ticket-close'))$('#gate-ticket-close').onclick=()=>{gateTicketOpen=false;render();};
 clearTimeout(gateSignTimer);
 if(intro.ticket&&!intro.sawSign&&!intro.done&&!intro.skipped)gateSignTimer=setTimeout(()=>{const current=state.intro;if(!current?.ticket||current.sawSign||current.done)return;const next=introAct(current,'sign');state.intro=next;saveLocal();send('draft','intro',next);render();},20000);
}
function showHelp(html){$('#help-content').innerHTML=html;$('#help').showModal();}
$('#close-help').onclick=()=>$('#help').close();$('#help').addEventListener('click',e=>{if(e.target===$('#help'))$('#help').close();});
function quizDraft(){
 const old=state.drafts.quiz;
 const legacy=Array.isArray(old?.answers)?old.answers.some(Number.isInteger):old?.answers&&Object.keys(old.answers).length>0;
 if(old&&old.quizVersion!==quizVersion){if(legacy)localStorage.setItem(`branch-island-quiz-archive:${user.id}:${round}:${Date.now()}`,JSON.stringify({quizVersion:old.quizVersion||'legacy',draft:old}));state.drafts.quiz=null;}
 if(!state.drafts.quiz||Array.isArray(state.drafts.quiz.answers))state.drafts.quiz={tier:'base',answers:{},index:0,confirmed:{},quizVersion};
 state.drafts.quiz.quizVersion=quizVersion;
 return state.drafts.quiz;
}
function saveQuiz(){saveLocal();send('draft','quiz',quizDraft());}
async function renderQuiz(){
 const ownerId=user?.id;
 $('#workbench').classList.remove('game-workbench');
 const gateOpen=demo||examOpened();
 if(!gateOpen){
  const required=(R.levels||[]).filter(level=>level.required!==false);
  const missing=required.filter(level=>!state.levels[level.id]?.valid);
  const closedFocus=currentFocus({levelId:'quiz',exam:{open:false,missing:missing.map(level=>({id:level.id,title:level.title}))}});
  $('#workbench').innerHTML=`<p id="quiz-focus-hint" class="focus-hint" role="status">${esc(closedFocus.hint)}</p><h1>考核还没开放</h1><p>温室、返修和路口三站都当前通过后，考核会自动打开。选做的储能柜不参与。</p><ul id="exam-missing">${missing.map(level=>`<li>${esc(level.title)}</li>`).join('')}</ul>${missing.map((level,index)=>`<button class="primary${index===0?' focus-target':''}" data-back="${level.id}" ${index===0?'data-focus="exam-missing"':''}>回到该站（${esc(level.title)}）</button>`).join(' ')}`;
  document.querySelectorAll('[data-back]').forEach(button=>button.onclick=()=>goToTask(button.dataset.back));
  if(!gateInfoSent){gateInfoSent=true;send('nav_help','quiz',{trigger:'gate_info',strength:0,idleMs:0,step:closedFocus.step,focusId:closedFocus.id,levelId:'quiz'});}
  quizIdle.configure({key:`quiz:${closedFocus.id}`,thinking:false});
  return;
 }
 if(!questions.length){try{const data=await api('/api/quiz'+(demo?'':'?studentId='+encodeURIComponent(user.id)));questions=data.questions||[];quizVersion=data.quizVersion||quizVersion;if(demo&&!questions.length&&answerKey.length){questions=answerKey.map(question=>{const interaction=question.interaction?{...question.interaction}:undefined;if(interaction)delete interaction.note;return {id:question.id,goal:question.goal,prompt:question.prompt,options:question.options,tier:question.tier,type:question.type,interaction};});}state.quizOpenedAt=data.examGate?.openedAt||state.quizOpenedAt;if(data.challengeUnlocked||(demo&&questions.some(question=>question.tier==='challenge'))){state.quiz||={};state.quiz.challenge||={};state.quiz.challenge.unlockedAt||='open';}localStorage.setItem('branch-island-questions',JSON.stringify({quizVersion,questions,reward:!!data.rewardUnlocked}));}catch(e){const cached=JSON.parse(localStorage.getItem('branch-island-questions')||'null');questions=cached?.quizVersion&&Array.isArray(cached.questions)?cached.questions:[];quizVersion=cached?.quizVersion||'';if(!questions.length){$('#workbench').innerHTML=`<h1>独立检测</h1><p class="notice">${esc(e.message)}。请恢复连接后再次进入，学习记录已保留。</p>`;return;}}}
 if(current!=='quiz'||user?.id!==ownerId)return;
 const {mountQuiz}=await import('./quiz-board.mjs');
 const draft=quizDraft();
 const tier=draft.tier==='challenge'&&state.quiz?.challenge?.unlockedAt?'challenge':'base';
 draft.tier=tier;
 const reward=!!JSON.parse(localStorage.getItem('branch-island-questions')||'{}').reward;
 const pending=!demo&&queue.events.some(event=>event.studentId===user.id&&event.round===round&&event.type==='quiz');
 const latest=state.quiz?.base?.latest||state.attempts.at(-1);
 const review=quizReview&&latest?`<section class="records"><h2>最近一次：${latest.score}/${latest.total}</h2>${(latest.details||[]).filter(detail=>detail.status==='incorrect'||detail.correct===false).map(detail=>`<article class="wrong-question"><b>${esc(detail.id)}</b><p>${esc(detail.explanation||'')}</p><p>${esc(detail.review||'')}</p></article>`).join('')||'<p>这次没有要回看的错题。</p>'}</section>`:'';
  const list=questions.filter(question=>question.tier===tier);
  const allFilled=list.length>0&&list.every(question=>question.type==='single_choice'?Number.isInteger(draft.answers?.[question.id]):!!draft.confirmed?.[question.id]);
  const focus=currentFocus({levelId:'quiz',exam:{open:true,tier,allFilled,baseSubmitted:!!state.quiz?.base?.first,challengeSubmitted:!!state.quiz?.challenge?.first,challengeUnlocked:!!state.quiz?.challenge?.unlockedAt,showResult:quizReview}});
  quizIdle.configure({key:`quiz:${tier}:${focus.id}:${draft.index}`,thinking:focus.thinking});
  mountQuiz($('#workbench'),{questions,tier,draft,pending,notice,review,focus,focusStrength:quizStrength,challengeUnlocked:!!state.quiz?.challenge?.unlockedAt,rewardUnlocked:reward,onSave:saveQuiz,onRender:renderQuiz,onTier(next){quizIdle.reset();quizStrength=0;draft.tier=next;draft.index=0;saveQuiz();renderQuiz();},onNotice:setNotice,onSubmit(submitTier,answers){if(demo){notice='演示模式的作答只留在这台设备上。';quizReview=true;saveLocal();renderQuiz();return;}send('quiz','quiz',{tier:submitTier,answers,quizVersion:draft.quizVersion});setNotice('检测正在提交；连接未完成时会保留，恢复后自动提交。');renderQuiz();}});
  $('#workbench').onpointerdown=()=>{quizIdle.reset();if(!quizStrength)return;quizStrength=0;document.querySelectorAll('#workbench .focus-target').forEach(node=>{node.dataset.strength='0';node.classList.remove('tap-hand');});};
}
async function boot(){
 try{const config=await api('/api/config');round=config.round;roster=await api('/api/roster');localStorage.setItem('branch-island-roster',JSON.stringify(roster));}catch(e){roster=JSON.parse(localStorage.getItem('branch-island-roster')||'null');if(!roster){$('#app').innerHTML=`<main class="loading"><h1>课堂连接还没有准备好</h1><p>${esc(e.message)}</p><a href="/">重新连接</a></main>`;return;}}
 if(demo){const solutions=await api('/api/teacher/solutions');answerKey=solutions.questions||solutions.quiz||solutions.answers;user={id:'demo',classId:'演示',name:'演示调试员'};const saved=JSON.parse(localStorage.getItem(cacheKey())||'null');state=saved?.state||emptyState();current=saved?.current||'sale';render();return;}
 const saved=JSON.parse(localStorage.getItem('branch-island-identity')||'null');if(saved){try{attach(await api(`/api/state?studentId=${encodeURIComponent(saved.user.id)}`));return;}catch(e){user=saved.user;round=saved.round;const local=JSON.parse(localStorage.getItem(cacheKey())||'null');if(local){state=local.state;current=local.current;render();return;}user=null;}}
 login();
}
window.addEventListener('online',()=>queue.flush().then(updateHeader));window.addEventListener('beforeunload',()=>{destroyScene();saveLocal();});setInterval(()=>{if(!demo)queue.flush().then(updateHeader);},5000);
boot().catch(e=>{$('#app').innerHTML=`<main class="loading"><h1>页面暂未打开</h1><p>${esc(e.message)}</p><a href="/">重新连接</a></main>`;});
