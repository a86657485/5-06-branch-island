import { learnCard } from './learn-card.mjs';
import { nextTask, resumeTask, learnDue, learnKey } from './learning-flow.mjs';
import { recordScaffold, currentScaffold } from './scaffold.mjs';
import { stationBrief, toolHint } from './task-guidance.mjs';
import { captureEdit, restoreEdit } from './task-history.mjs';
import { SyncQueue, reconcileState } from './sync.mjs';
import { createParkScene } from './scene.mjs';
import { createRpgScene } from './rpg-scene.mjs';
import { createIdleTimer } from './idle-timer.mjs';
import { currentFocus } from './focus.mjs';
import { quizSubmittedNotice } from './quiz-board.mjs';
import { pointsLabel } from './scoreboard.mjs';
import { STATIONS, createPatrol, markStory, storyKey, storyScript, stationUnlocked, storyChangesLearning } from './patrol.mjs';
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
let lastStation = 'sale';
let storySession = null, learnStation = null;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = v => JSON.parse(JSON.stringify(v));
const eventId = () => globalThis.crypto?.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2,'0')).join('');
const SKIN_OPTIONS = [
 {id:'engineer',name:'小阳·男巡检员',avatar:'/assets/avatars/skin-boy.png',need:0,badge:'默认可用'},
 {id:'engineer-girl',name:'小星·女巡检员',avatar:'/assets/avatars/skin-girl.png',need:0,badge:'默认可用'},
 {id:'engineer-mecha-boy',name:'未来机甲·男',avatar:'/assets/avatars/skin-mecha-boy.png',need:1,badge:'🔒 通1站解锁'},
 {id:'engineer-mecha-girl',name:'未来机甲·女',avatar:'/assets/avatars/skin-mecha-girl.png',need:1,badge:'🔒 通1站解锁'},
 {id:'engineer-explorer-boy',name:'生态探险·男',avatar:'/assets/avatars/skin-explorer-boy.png',need:2,badge:'🔒 通2站解锁'},
 {id:'engineer-explorer-girl',name:'生态探险·女',avatar:'/assets/avatars/skin-explorer-girl.png',need:2,badge:'🔒 通2站解锁'}
];
function passedStationCount(){return ['sale','repair','cross','minimum'].filter(k=>state.levels?.[k]?.completed).length;}
function isSkinUnlocked(id){const item=SKIN_OPTIONS.find(o=>o.id===id);return !!item && passedStationCount()>=item.need;}
function getSkin(){
 let saved='engineer';
 try{const s=localStorage.getItem('branch-island-skin');if(SKIN_OPTIONS.some(o=>o.id===s))saved=s;}catch{}
 if(!isSkinUnlocked(saved)){
  const fallback=saved.includes('girl')?'engineer-girl':'engineer';
  try{localStorage.setItem('branch-island-skin',fallback);}catch{}
  return fallback;
 }
 return saved;
}
function setSkinChoice(id){
 if(!isSkinUnlocked(id))return false;
 try{localStorage.setItem('branch-island-skin',id);}catch{}
 activeScene?.setSkin?.(id);
 const cur=SKIN_OPTIONS.find(o=>o.id===id)||SKIN_OPTIONS[0];
 const btn=$('#open-skin');if(btn)btn.innerHTML=`<img src="${cur.avatar}" alt="" class="skin-mini-avatar"> 换装`;
 document.querySelectorAll('[data-skin-id]').forEach(el=>el.classList.toggle('selected',el.getAttribute('data-skin-id')===id));
 return true;
}
function skinCardsMarkup(){
 const cur=getSkin(),done=passedStationCount();
 return SKIN_OPTIONS.map(item=>{
  const unlocked=done>=item.need;
  return `<button type="button" class="skin-card ${cur===item.id?'selected':''} ${unlocked?'':'locked'}" data-skin-id="${item.id}" ${unlocked?'':'disabled'} aria-disabled="${!unlocked}"><img src="${item.avatar}" alt="${esc(item.name)}"><strong>${esc(item.name)}</strong><small class="${unlocked?'skin-unlocked':'skin-locked'}">${unlocked?'✨ 已解锁可穿戴':esc(item.badge)}</small></button>`;
 }).join('');
}
const ids = ['sale','repair','cross','minimum'];
function rememberStation(id){ if(ids.includes(id)) lastStation=id; }
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
 sale:[['both','达到30℃，两个动作都做'],['boundary','达到30℃就开，低于才关'],['small','30比30小，所以关风机']],
 repair:[['symbol','改回低于30℃，出口动作保留'],['swap','保留达到30℃，对调开关出口'],['both','把两边设成同一个动作就能修好']],
 cross:[['one','先看设施，再走选中的一路'],['none','没有天桥，就可以随便过街'],['both','先走天桥，再走斑马线']],
 minimum:[['always','A排在前面，每次都先充A'],['compare','先比电量，剩得少的先充'],['both','一次把两块都接入优先充电口']]
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
  if(event.type==='quiz') {quizReview=true; questions=[]; notice=quizSubmittedNotice(event.payload?.tier);render();}
  updateHeader();
 }
},(event,error)=>{
 if(user&&event.studentId===user.id){state.drafts.quiz={tier:'base',answers:{},index:0,confirmed:{},quizVersion};questions=[];quizReview=false;notice='旧版待提交答卷已完整保留在本机未评分存档，请按新版重新作答。';saveLocal();if(current==='quiz')renderQuiz();updateHeader();}
},(event,error)=>{
 if(user&&event.studentId===user.id){const reason=error?.message||'请按提示修改';queue.error=`这条记录没有保存：${reason}。请按提示修改后继续，后面的操作仍会保存。`;setNotice(queue.error);updateHeader();}
});
function syncStatus(){if(demo)return '独立演示 · 不计入班级';const n=queue.pending(user?.id);if(n)return `${n}条待同步 · ${queue.error?'连接未完成，记录已保留':'正在保存'}`;if(queue.error)return queue.error;return '已同步保存';}
function updateHeader(){if($('#save-status'))$('#save-status').textContent=syncStatus();if($('#points'))$('#points').textContent=pointsLabel(state);updateRoutes();}
function examOpened(){return !!(state.quizOpenedAt||state.exam?.openedAt);}
function canEnter(id){return stationUnlocked(id, state.levels, demo);}
function updateRoutes(){document.querySelectorAll('[data-route]').forEach(button=>{const id=button.dataset.route;button.disabled=!canEnter(id);button.classList.toggle('selected',current===id);if(id!=='quiz'&&button.classList.contains('route-item')){const level=state.levels[id],stop=button.querySelector('.stop'),small=button.querySelector('small');if(stop)stop.textContent=level?.completed?'✓':ids.indexOf(id)+1;if(small)small.textContent=level?.completed?(level.valid?'已完成 · 当前已验证':'曾完成 · 当前待重验'):(canEnter(id)?'可开始探索':'完成上一站解锁');}});}
function goToTask(id){
 if(!canEnter(id))throw new Error('请先完成前面的主线任务。');
 if(id==='quiz'){ if(current!=='quiz') rememberStation(current); }
 else rememberStation(id);
 current=id;lastRun=null;notice='';quizReview=false;
 if(id==='quiz'){saveLocal();openExam();return {levelId:'quiz'};}
 closeExam(false);
 if(activeScene?.engine==='rpgjs'){prepareSceneDraft(id);saveLocal();activeScene.navigate(id);activeScene.setOverlay?.('');updateChrome();showStationStory(id);return {levelId:id};}
 saveLocal();render();return {levelId:id};
}
function send(type,levelId,payload,eventKey=eventId()){
 if(!user)return;
 saveLocal();
 if(demo){updateHeader();return;}
 queue.add({studentId:user.id,round,eventId:eventKey,type,levelId,payload:clone(payload),editedAt:Date.now()});
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
function setNotice(text){notice=text;const target=$('#notice')||$('#scene-toast')||$('#sync-notice');if(target){target.textContent=text;target.hidden=!text;}}
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
 $('#app').innerHTML=`<main class="landing"><section class="welcome"><p class="eyebrow">五年级 · 身边的算法 · 第6课</p><h1>分支<span>冒险岛</span></h1><p class="welcome-copy">走进智慧园区，亲自调试设备。<br>让判断有依据，让每条指令执行正确。</p><div class="landing-world" aria-hidden="true"><div class="landing-role">园区巡检员 / 调试员</div></div><p class="landing-note">读取传感器 · 修复设备 · 核验通行 · 节能配电</p></section><section class="login-card"><p class="eyebrow">调试员报到</p><h2>选择你的身份</h2><p class="muted">本课次的进度会保存。老师开始新课次后，要从头做。</p><label>班级<select id="class-select">${roster.classes.map(c=>option(c.id,`${c.id}班`,loginClass)).join('')}</select></label><label>搜索姓名<input id="name-search" value="${esc(loginSearch)}" placeholder="输入姓名中的字" autocomplete="off"></label><label>名单姓名<select id="student-select">${option('','请选择自己的姓名',selectedStudent)}${names.map(s=>option(s.id,s.name,selectedStudent)).join('')}</select></label><details><summary>名单中没有我</summary><label>补充姓名<input id="manual-name" maxlength="30" value="${esc(manual)}" placeholder="输入姓名，归入当前班级"></label></details><div class="login-skin-pick"><span class="small muted">选择你的巡检员形象（进入园区后也可随时换装）：</span><div class="skin-grid compact">${skinCardsMarkup()}</div></div><div class="identity-confirm">请确认：<strong id="chosen-identity">${esc(loginClass)}班 · ${esc(manual || cls.students.find(s=>s.id===selectedStudent)?.name || '尚未选择姓名')}</strong></div><button id="login" class="primary wide">确认身份，进入园区 →</button><p id="login-error" class="error" role="alert"></p><p class="small muted">请用自己的姓名进入。课堂选名用于记录学习进度。</p></section></main>`;
 $('#class-select').onchange=e=>{loginClass=e.target.value;selectedStudent='';manual='';login();};
 $('#name-search').oninput=e=>{loginSearch=e.target.value;const sel=$('#student-select');sel.innerHTML=option('','请选择自己的姓名','')+cls.students.filter(s=>s.name.includes(loginSearch)).map(s=>option(s.id,s.name,selectedStudent)).join('');};
 $('#student-select').onchange=e=>{selectedStudent=e.target.value;manual='';$('#manual-name').value='';$('#chosen-identity').textContent=`${loginClass}班 · ${cls.students.find(s=>s.id===selectedStudent)?.name || '尚未选择姓名'}`;};
 $('#manual-name').oninput=e=>{manual=e.target.value;selectedStudent='';$('#student-select').value='';$('#chosen-identity').textContent=`${loginClass}班 · ${manual || '尚未填写姓名'}`;};
 document.querySelectorAll('[data-skin-id]').forEach(btn=>{btn.onclick=()=>setSkinChoice(btn.getAttribute('data-skin-id'));});
 $('#login').onclick=async()=>{try{if(!selectedStudent&&!manual.trim())throw new Error('先选择自己的姓名，或在“名单中没有我”填写。');const data=await api('/api/login',{classId:loginClass,...(manual.trim()?{name:manual.trim()}:{studentId:selectedStudent})});attach(data);}catch(e){$('#login-error').textContent=e.message;}};
}
function attach(data){destroyScene();user=data.student;if(data.round!==round)queue.retire(user.id,data.round);round=data.round;state=data.state;const local=JSON.parse(localStorage.getItem(cacheKey())||'null');const pendingThisRound=queue.events.some(event=>event.studentId===user.id&&event.round===round);if(pendingThisRound&&local)state=local.state;current=pendingThisRound&&local?.current?local.current:resumeTask(state.levels);if(current!=='quiz')rememberStation(current);if(new URLSearchParams(location.search).get('task')==='quiz')current='quiz';if(!demo)localStorage.setItem('branch-island-identity',JSON.stringify({user,round}));saveLocal();render();queue.flush().then(updateHeader);}
const patrolKey = () => `branch-island-patrol:${demo?'demo':user?.id}:${round}`;
function loadPatrol(){ try { const saved = JSON.parse(localStorage.getItem(patrolKey()) || 'null'); if (saved && typeof saved === 'object') return { briefSeen: !!saved.briefSeen, seen: saved.seen || {}, skipped: Array.isArray(saved.skipped) ? saved.skipped : [] }; } catch { /* 旧稿损坏就当没看过 */ } return createPatrol(); }
function savePatrol(patrol){ localStorage.setItem(patrolKey(), JSON.stringify(patrol)); }
function checked(id){ return !!(state.levels[id]?.completed && state.levels[id]?.valid); }
function routeMarkup(){
 return `<ol id="route-ribbon" class="route-ribbon" aria-label="巡检路线">${STATIONS.filter(item=>item.required).map((item,index,list)=>{
  const open=canEnter(item.id);
  const mark=checked(item.id)?'✓':item.code;
  const arrow=index<list.length-1?'<span class="route-arrow" aria-hidden="true">→</span>':'';
  return `<li class="${current===item.id?'current':''} ${checked(item.id)?'done':''}"><button type="button" data-route="${item.id}" ${open?'':'disabled'}><b>${mark}</b> ${esc(item.title)}</button></li>${arrow}`;
 }).join('')}</ol>`;
}
function checklistMarkup(){
 return STATIONS.map(item=>{
  const open=canEnter(item.id);
  const status=checked(item.id)?'已勾选':item.required?(open?'当前可做':'按顺序，先完成上一站'):'选做，随时可进';
  return `<button type="button" class="check-row ${current===item.id?'current':''}" data-route="${item.id}" ${open?'':'disabled'} data-focus="${current===item.id?'patrol-checklist':''}"><span class="stop">${checked(item.id)?'✓':item.code}</span><span><b>${esc(item.title)}</b><small>${esc(status)}</small></span></button>`;
 }).join('');
}
function bindChrome(){
 document.querySelectorAll('[data-route]').forEach(btn=>{ btn.onclick=()=>{ if(btn.disabled)return; closePatrol(); goToTask(btn.dataset.route); }; });
 const brand=$('.brand'); if(brand) brand.onclick=e=>{ e.preventDefault(); closePatrol(); goToTask(lastStation==='quiz'?'sale':(current==='quiz'?lastStation:'sale')); };
 const switcher=$('#switch-user'); if(switcher) switcher.onclick=()=>{ destroyScene(); saveLocal(); localStorage.removeItem('branch-island-identity'); user=null; selectedStudent=''; manual=''; notice=''; lastRun=null; storySession=null; if(demo){ location.href='/teacher.html'; return; } login(); };
 const patrolBtn=$('#open-patrol'); if(patrolBtn) patrolBtn.onclick=()=>openPatrol();
 const skinBtn=$('#open-skin'); if(skinBtn) skinBtn.onclick=()=>openSkinModal();
 const helpBtn=$('#open-help'); if(helpBtn) helpBtn.onclick=()=>showHelp('<h2>怎么操作</h2><ol><li>你是园区巡检员。巡检单按温室→返修→路口，不能跳站。</li><li>可以用摇杆走近，再点交谈或操作；也可点“自动前往”。</li><li>对白、流程图、预测和巡检单都是浮层，右上角 × 或 Esc 可关闭。</li><li>关掉浮层不会替你提交没确认的答案。</li></ol>');
 const learnBtn=$('#open-learn');if(learnBtn){learnBtn.hidden=current==='quiz';learnBtn.onclick=()=>showLearnCard(current,true);}
 const missionBtn=$('#review-mission');if(missionBtn){missionBtn.hidden=current==='quiz';missionBtn.onclick=()=>{closePatrol();showStory(current,'opening',true);};}
 const examBtn=$('#open-exam'); if(examBtn) examBtn.onclick=()=>{ closePatrol(); goToTask('quiz'); };
}
function updateChrome(){
 const ribbon=$('#route-ribbon'); if(ribbon) ribbon.outerHTML=routeMarkup();
 const list=$('#patrol-list'); if(list) list.innerHTML=checklistMarkup();
 bindChrome();
 updateHeader();
}
function renderLegacy(){
 const idx=ids.indexOf(current);
 $('#app').innerHTML=`${demo?'<div class="demo-banner">教师独立演示：可跳关、查看参考操作；所有操作只保存在演示区。<a href="/teacher.html">返回班级大屏</a></div>':''}<header class="topbar"><a class="brand" href="#">分支冒险岛<span>判断选择用分支</span></a><div class="identity"><span>${demo?'演示调试员':`${esc(user.classId)}班 · ${esc(user.name)}`}</span><strong id="points">${esc(pointsLabel(state))}</strong><button id="switch-user" class="quiet">切换身份</button></div></header><div class="app-shell"><aside class="map"><p class="eyebrow">原版场景</p><h2>让判断驱动行动</h2><nav aria-label="任务路线">${ids.map((id,i)=>`<button data-route="${id}" class="route-item ${current===id?'selected':''}" ${canEnter(id)?'':'disabled'}><span class="stop">${state.levels[id]?.completed?'✓':i+1}</span><span><b>${titles[i]}</b><small>${state.levels[id]?.completed?(state.levels[id].valid?'已完成 · 当前已验证':'曾完成 · 当前待重验'):(canEnter(id)?'可开始探索':'完成上一站解锁')}</small></span></button>`).join('')}<button data-route="quiz" class="route-item ${current==='quiz'?'selected':''}"><span class="stop">Q</span><span><b>独立检测</b><small>${examOpened()?'可以开始':'还差哪一站'}</small></span></button></nav><div id="save-status" class="save-status" role="status">${syncStatus()}</div></aside><main id="workbench" class="workbench"></main></div>`;
 bindChrome();
 if(current==='quiz')renderQuiz(); else renderTask(idx);
}
function renderPlay(){
 const app = $('#app');
 const mounted = app?.querySelector?.('#play-shell') || String(app?.innerHTML || '').includes('id="play-shell"');
 if(!mounted){
  $('#app').innerHTML=`<div id="play-shell" class="play-shell">${demo?'<div class="demo-banner">教师独立演示：可跳关、查看参考操作；所有操作只保存在演示区。<a href="/teacher.html">返回班级大屏</a></div>':''}<header class="topbar slim"><a class="brand" href="#">分支冒险岛<span>园区巡检</span></a>${routeMarkup()}<div class="identity"><span>${demo?'演示巡检员':`${esc(user.classId)}班 · ${esc(user.name)}`}</span><strong id="points">${esc(pointsLabel(state))}</strong><button id="open-skin" type="button" class="skin-btn"><img src="${(SKIN_OPTIONS.find(o=>o.id===getSkin())||SKIN_OPTIONS[0]).avatar}" alt="" class="skin-mini-avatar"> 换装</button><button id="open-patrol" type="button">巡检单</button><button id="open-learn" type="button" class="quiet">巡检手册</button><button id="open-help" type="button" class="quiet">帮助</button><button id="switch-user" class="quiet">切换身份</button></div></header><div class="stage-full"><main id="workbench" class="workbench game-workbench"></main><p id="sync-notice" class="save-status stage-notice" role="status" ${notice?'':'hidden'}>${esc(notice)}</p><div id="save-status" class="save-status stage-save" role="status">${syncStatus()}</div></div><div id="patrol-overlay" class="screen-overlay" hidden><section class="overlay-card" role="dialog" aria-modal="true" aria-label="巡检单"><button type="button" id="patrol-close" class="overlay-close" aria-label="关闭巡检单">×</button><p class="eyebrow">园区巡检员</p><h2>巡检单</h2><p>固定顺序：温室 → 返修 → 路口。储能柜是选做。</p><div id="patrol-list" class="patrol-list">${checklistMarkup()}</div><button type="button" id="review-mission" type="button" class="quiet">回看当前委托</button><button type="button" id="open-exam" class="primary">考核入口</button></section></div><div id="story-overlay" class="screen-overlay" hidden><section class="overlay-card story-card" role="dialog" aria-modal="true" aria-label="剧情"><button type="button" id="story-skip" class="overlay-close" data-focus="story-skip" aria-label="关闭回放" hidden>×</button><img id="story-art" alt="" /><p id="story-speaker" class="eyebrow"></p><p id="story-line" class="story-line"></p><div class="story-actions"><button type="button" id="story-next" class="primary">继续</button><button type="button" id="story-direct-close" class="quiet" hidden>关闭回放，回到现场</button></div></section></div><div id="skin-overlay" class="screen-overlay" hidden><section class="overlay-card skin-modal" role="dialog" aria-modal="true" aria-label="角色换装"><button type="button" id="skin-close" class="overlay-close" aria-label="关闭换装">×</button><p class="eyebrow">智慧园区 · 个性形象</p><h2>选择巡检员角色与皮肤</h2><p class="muted">男女巡检员默认可用；完成 1 站解锁未来机甲服，完成 2 站解锁生态探险服，解锁后方可穿戴！</p><div id="skin-list" class="skin-grid">${skinCardsMarkup()}</div><button type="button" id="skin-confirm" class="primary">穿戴完毕，返回园区</button></section></div><div id="learn-overlay" class="screen-overlay learn-overlay" hidden><section class="overlay-card learn-card" role="dialog" aria-modal="true" aria-label="巡检手册"><button type="button" id="learn-close" class="overlay-close" aria-label="关闭巡检手册">×</button><div id="learn-content"></div><button type="button" id="learn-continue" class="primary">回到现场继续</button></section></div><div id="exam-overlay" class="screen-overlay" hidden><section class="overlay-card exam-card" role="dialog" aria-modal="true" aria-label="考核"><button type="button" id="exam-close" class="overlay-close" aria-label="关闭考核">×</button><div id="exam-body"></div></section></div></div>`;
  $('#patrol-close').onclick=()=>closePatrol();
  $('#story-skip').onclick=()=>closeStory(true);
  if($('#story-direct-close'))$('#story-direct-close').onclick=()=>closeStory(true);
  $('#story-next').onclick=()=>advanceStory();
  if($('#skin-close'))$('#skin-close').onclick=()=>closeSkinModal();
  if($('#skin-confirm'))$('#skin-confirm').onclick=()=>closeSkinModal();
  $('#exam-close').onclick=()=>closeExam(true);
  $('#learn-close').onclick=()=>closeLearnCard();
  $('#learn-continue').onclick=()=>closeLearnCard();
 }
 bindChrome();
 updateChrome();
 if(current==='quiz'){ openExam(); return; }
 if(!activeScene) renderTask(ids.indexOf(current));
 else if(activeScene.host?.levelId!==current) activeScene.navigate?.(current);
 showStationStory(current);
}
function render(){
 if(!user){ destroyScene(); return login(); }
 if(legacy){ destroyScene(); return renderLegacy(); }
 renderPlay();
}
function openPatrol(){
 const overlay=$('#patrol-overlay'); if(!overlay)return;
 overlay.hidden=false;
 activeScene?.setOverlay?.('checklist');
 updateChrome();
}
function openSkinModal(){
 const overlay=$('#skin-overlay'); if(!overlay)return;
 const list=$('#skin-list'); if(list) list.innerHTML=skinCardsMarkup();
 overlay.querySelectorAll('[data-skin-id]').forEach(btn=>{btn.onclick=()=>setSkinChoice(btn.getAttribute('data-skin-id'));});
 overlay.hidden=false;
 activeScene?.setOverlay?.('skin');
}
function closeSkinModal(){
 const overlay=$('#skin-overlay'); if(overlay) overlay.hidden=true;
 if(!storySession && ($('#exam-overlay')?.hidden!==false) && ($('#patrol-overlay')?.hidden!==false)) activeScene?.setOverlay?.('');
}
function closePatrol(){
 const overlay=$('#patrol-overlay'); if(overlay) overlay.hidden=true;
 if(!storySession && ($('#exam-overlay')?.hidden!==false)) activeScene?.setOverlay?.('');
}
function showStory(levelId, beat, replay=false){
 if(legacy)return;
 const script=storyScript(levelId, beat); if(!script)return;
 const baseKey=storyKey(levelId, beat);
 const key=beat==='opening'?`story-v2:${baseKey}`:baseKey;
 const patrol=loadPatrol();
 if(!replay && beat==='result_fail' && patrol.seen[key])return;
 if(!replay && beat!=='result_fail' && beat!=='result_ok' && patrol.seen[key])return;
 if(!replay && beat==='result_ok' && patrol.seen[key])return;
 const canSkip=!!(replay || patrol.seen[key]);
 const overlay=$('#story-overlay'); if(!overlay)return;
 storySession={ key, lines: script.lines, index: 0, image: script.image, npc: script.npc, beat, replay: canSkip };
 overlay.hidden=false;
 const skipBtn=$('#story-skip'); if(skipBtn){ skipBtn.hidden=!canSkip; skipBtn.disabled=!canSkip; }
 const directBtn=$('#story-direct-close'); if(directBtn){ directBtn.hidden=!canSkip; directBtn.disabled=!canSkip; }
 $('#story-art').src=script.image;
 $('#story-art').alt=script.npc;
 $('#story-speaker').textContent=script.npc;
 paintStoryLine();
 activeScene?.setOverlay?.('story');
}
function paintStoryLine(){
 if(!storySession)return;
 const canSkip=!!storySession.replay;
 const skipBtn=$('#story-skip'); if(skipBtn){ skipBtn.hidden=!canSkip; skipBtn.disabled=!canSkip; }
 const directBtn=$('#story-direct-close'); if(directBtn){ directBtn.hidden=!canSkip; directBtn.disabled=!canSkip; }
 $('#story-line').textContent=storySession.lines.slice(storySession.index,storySession.index+2).join('\n');
 $('#story-next').textContent=storySession.index+2<storySession.lines.length?'继续了解':'去现场调查';
}
function advanceStory(){ if(!storySession)return; if(storySession.index+2<storySession.lines.length){ storySession.index+=2; paintStoryLine(); return; } closeStory(false); }
function closeStory(skipped){
 if(!storySession)return false;
 if(skipped && !storySession.replay && storySession.index+2<storySession.lines.length)return false;
 const finished=storySession;
 savePatrol(markStory(loadPatrol(), finished.key, skipped));
 if(storyChangesLearning()) throw new Error('剧情不应写入学习达成');
 storySession=null;
 const overlay=$('#story-overlay'); if(overlay) overlay.hidden=true;
 activeScene?.setOverlay?.($('#exam-overlay')?.hidden===false?'exam':($('#patrol-overlay')?.hidden===false?'checklist':''));
 if(finished.key==='brief') showStory(current==='quiz'?lastStation:current,'opening');
 return true;
}
function showStationStory(id){
 if(legacy||!id||id==='quiz'||storySession)return;
 const patrol=loadPatrol();
 if(!patrol.briefSeen){ showStory('brief','brief'); return; }
 showStory(id,'opening');
}
function showLearnCard(id, replay=false){
 if(legacy||!ids.includes(id)||(!replay&&!learnDue(loadPatrol(),id)))return {opened:false};
 const card=learnCard(id),brief=stationBrief(id),overlay=$('#learn-overlay');if(!overlay)return {opened:false};
 learnStation=id;
 $('#learn-content').innerHTML=`<p class="eyebrow">${esc(storyScript(id,'opening')?.npc||'园区委托')} · 巡检手册</p><h2>${esc(card.title)}</h2><p class="learn-mission">${esc(brief.problem)}<br>${esc(card.purpose)}</p><div class="learn-columns"><figure><img src="${esc(card.image.src)}" alt="${esc(card.image.alt)}"><figcaption>${esc(card.image.page)} · 教材局部图</figcaption></figure><ol>${card.lines.map(line=>`<li>${esc(line)}</li>`).join('')}</ol></div><p class="learn-success"><b>这站做到：</b>${esc(brief.success.replace('，','。'))}</p><p class="muted learn-footnote">需要时翻手册，再回现场试一试。</p>`;
 overlay.hidden=false;activeScene?.setOverlay?.('learn');return {opened:true};
}
function closeLearnCard(){
 const overlay=$('#learn-overlay');if(overlay)overlay.hidden=true;
 if(learnStation)savePatrol(markStory(loadPatrol(),learnKey(learnStation),false));
 learnStation=null;
 activeScene?.setOverlay?.($('#exam-overlay')?.hidden===false?'exam':($('#patrol-overlay')?.hidden===false?'checklist':''));
}
function showResultStory(id, passed){ showStory(id, passed?'result_ok':'result_fail'); }
function openExam(){
 if(legacy){ if(current!=='quiz'){ lastStation=current; current='quiz'; } renderQuiz(); return; }
 if(!$('#exam-overlay')) return;
 if(current!=='quiz'){ lastStation=current; current='quiz'; }
 $('#exam-overlay').hidden=false;
 closePatrol();
 activeScene?.setOverlay?.('exam');
 renderQuiz();
}
function closeExam(restore){
 const overlay=$('#exam-overlay'); if(overlay) overlay.hidden=true;
 activeScene?.setOverlay?.('');
 if(restore && current==='quiz'){ current=lastStation||'sale'; saveLocal(); updateChrome(); }
}
function renderTask(idx){
 destroyScene();
 const initialId=ids[idx],ownerId=user.id,ownerRound=round,generation=sceneGeneration;
 prepareSceneDraft(initialId);
 $('#workbench').classList.add('game-workbench');
 const undoStacks = new Map();
 let restoring = false;
 const rememberEdit = id => { const stack=undoStacks.get(id)||[]; stack.push(captureEdit(draft(id))); undoStacks.set(id,stack.slice(-30)); };
 const makeHost=id=>{
  if(!ids.includes(id))throw new Error('找不到这个任务场景。');
  const idx=ids.indexOf(id),sameOwner=()=>user?.id===ownerId&&round===ownerRound&&sceneGeneration===generation&&(legacy||current===id);
  const save=()=>{if(sameOwner())send('draft',id,draft(id));};
  return {
  root:$('#workbench'),levelId:id,demo,forLevel:makeHost,getDraft:()=>state.drafts[id]||clone(defaults[id]),getRuns:()=>state.runs[id]||[],getLevel:()=>state.levels[id],getScaffold:()=>currentScaffold(state,id,draft(id).input),getSupport:()=>state.support||{hints:[]},getUndoAvailable:()=>!!undoStacks.get(id)?.length,getEvidenceStart:()=>state.levels[id]?.evidenceStart||0,reasons:reasonOptions[id],
  onChange(patch){
   if(!sameOwner())return;
   if('rpg' in patch){patch={...patch,rpg:window.AdventureRules.validateRpgDraft(patch.rpg)};const maps={sale:['greenhouse'],repair:['greenhouse','workshop'],cross:['crossing','crossing-east'],minimum:['energy'],gate:['greenhouse']};if(!maps[id].includes(patch.rpg.mapId))throw new Error('当前位置与任务场景不一致。');}
   if(!restoring && patch.input && state.drafts[id] && JSON.stringify(patch.input)!==JSON.stringify(draft(id).input))rememberEdit(id);
   const editing=['config','flow','sentence','predictionsLocked','input','prediction','reason'].some(key=>key in patch);
   if(!state.drafts[id] && !editing){state.drafts[id]=clone(defaults[id]);for(const key of ['scene','rpg','panel'])if(key in patch)state.drafts[id][key]=clone(patch[key]);updateHeader();save();updateHeader();return {saved:true};}
   const d=state.drafts[id]||(state.drafts[id]={});
   if(patch.config&&d.config&&JSON.stringify(R.normalizeConfig(id,d.config,true))!==JSON.stringify(R.normalizeConfig(id,{...d.config,...patch.config},true))){state.levels[id]||={completed:false,points:0};state.levels[id].evidenceStart=(state.runs[id]||[]).length;state.levels[id].valid=false;lastRun=null;}
   if(patch.input&&JSON.stringify(patch.input)!==JSON.stringify(d.input))lastRun=null;
   for(const key of ['config','input'])if(patch[key])d[key]={...(d[key]||{}),...patch[key]};
   for(const key of ['prediction','scene','reason','rpg','flow','sentence','predictionsLocked','diagnoseAnswer','flowMistakes','panel'])if(key in patch)d[key]=clone(patch[key]);
   if(Array.isArray(patch.mCodes)&&patch.mCodes.includes('M8')){
    const diamond=typeof patch.flow?.diamond==='string'?patch.flow.diamond:(typeof d.flow?.diamond==='string'?d.flow.diamond:'');
    d.flowRejections=[...(Array.isArray(d.flowRejections)?d.flowRejections:[]),{mCodes:['M8'],diamond,at:Date.now()}].slice(-20);
   }
   if('scene' in patch)d.sceneRev=(d.sceneRev||0)+1;
   save();updateHeader();return {saved:true};
  },
  onEvaluate({input,config}){if(!sameOwner())throw new Error('当前任务已切换。');return R.evaluate(id,config||draft(id).config,input||draft(id).input);},
  onPrediction({value,input,config}){
   if(!sameOwner())return null;
   rememberEdit(id);
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
    const key=eventId();result.scaffold=recordScaffold(state,id,{kind:'run',input,config,result,eventKey:key,at});
    send('run',id,{config,input,prediction,sceneEvidence},key);
    notice='';activeScene?.refresh();return result;
   }catch(error){setNotice(error.message);return null;}
  },
  onReason(value){if(!sameOwner())return;draft(id).reason=value;save();},
  onComplete({deferRender=false}={}){
   if(!sameOwner())return {passed:false,feedback:'身份已切换，请在当前身份下继续。'};
   try{
    const d=draft(id),result=R.validateComplete(id,d.config,state.runs[id]||[],d.reason,state.levels[id]?.evidenceStart||0);
    const key=eventId(),correctReason=id==='repair'&&d.config.operator==='<'&&d.config.yes==='off'&&d.config.no==='on'?'symbol':R.solutions[id].reason;
    const testsSatisfied=R.validateComplete(id,d.config,state.runs[id]||[],correctReason,state.levels[id]?.evidenceStart||0).passed;
    result.scaffold=recordScaffold(state,id,{kind:'reason',input:d.input,config:d.config,result,testsSatisfied,eventKey:key});
    if(!result.passed){send('complete',id,{config:d.config,reason:d.reason},key);if(!deferRender)showResultStory(id,false);return result;}
    const earned=!state.levels[id]?.completed;
    const award=R.levels.find(level=>level.id===id)?.points||25;
    state.levels[id]={...state.levels[id],completed:true,valid:true,points:award,reason:d.reason};
    const quizPoints=(state.awards?.['quiz-base']?.points||0)+(state.awards?.['quiz-challenge']?.points||0);
    state.points=['sale','repair','cross'].reduce((n,key)=>n+(state.levels[key]?.completed?(state.levels[key].points||25):0),0)+quizPoints;
    if(state.levels.minimum?.completed)state.bonusPoints=state.levels.minimum.points||25;
    send('complete',id,{config:d.config,reason:d.reason},key);
    notice=earned?(id==='minimum'?'现场验收通过，获得选做加分 25！':'现场验收通过，获得25积分！向NPC领取下一项委托。'):'当前方案已重新验证，历史积分保留。';
    if(deferRender){updateHeader();activeScene?.refresh();}else render();
    if(!deferRender)showResultStory(id,true);
    return {...result,feedback:notice};
   }catch(error){return {passed:false,feedback:error.message};}
  },
  onNext(options={}){if(!sameOwner())return;const next=nextTask(id,!!options.optional);if(!legacy&&next==='quiz'){setTimeout(()=>{if(sameOwner())goToTask('quiz');},0);return {levelId:'quiz'};}return goToTask(next);},
  onLearn(){if(!sameOwner())return {opened:false};return showLearnCard(id,true);},
  onFlow(){showHelp(`<h2>${titles[idx]} · 当前执行过程</h2><div class="scene-flow-preview">${flow()}</div><p>根据条件是否成立，一次只执行“是”或“否”对应的一条路径。</p>`);},
  onHelp(){showHelp(`<h2>智慧园区 · 怎么操作</h2><ol><li>${legacy?'点击NPC或设备的名称，角色会沿步道走近，抵达后交谈或操作。':'用摇杆走近人物或设备，点交谈或操作；也可点“自动前往”。'}</li><li>按任务卡依次选择，错误可撤回上一步。</li><li>先领取委托、读取现场输入，在设备旁设置规则并预测。</li><li>亲自执行、到核验点观察结果，再向NPC汇报。不同情况都要验证。</li></ol><p>对话右上角的×可随时关闭，进度会保留。帮助不扣积分。</p><p class="muted">场景参考深圳智慧园林；地图、人物和30℃规则均为教学仿真。</p>`);},
  onNavHelp(data){if(!sameOwner())return null;send('nav_help',id,{trigger:data.trigger||'button',strength:data.strength??0,idleMs:data.idleMs||0,step:data.step||'',focusId:data.focusId||'',mapId:data.mapId||'',levelId:id});return {saved:true};},
  async onToolHint({step}={}){
   if(!sameOwner())throw new Error('身份已切换，请继续当前任务。');
   if(demo){
    const hint=toolHint(id,draft(id),step||{});
    state.support||={hints:[]};
    const previous=state.support.hints.find(item=>item.key===hint.key);
    if(!previous && state.support.hints.length>=5)throw new Error('全课法宝用完了，点错了可以撤回。');
    if(!previous){state.support.hints.push({...hint,levelId:id,at:new Date().toISOString()});if(hint.conceptual!==false){state.levels[id]||={};state.levels[id].hinted=true;}}
    saveLocal();updateHeader();
    return {hint:previous||hint,used:state.support.hints.length,remaining:5-state.support.hints.length,reused:!!previous};
   }
   await queue.flush();
   if(!sameOwner())throw new Error('身份已切换，请继续当前任务。');
   if(queue.pending(user.id))throw new Error('先等学习记录保存，再用法宝。次数还没扣。');
   const data=await api('/api/events',{studentId:user.id,round,eventId:eventId(),type:'tool_hint',levelId:id,payload:{step:step||{}}});
   if(!sameOwner())return null;
   state=reconcileState(state,data.state,true);saveLocal();updateHeader();
   return {...data.result,used:state.support?.hints?.length||0,remaining:Math.max(0,5-(state.support?.hints?.length||0))};
  },
  onUndo(){
   if(!sameOwner())return null;
   const stack=undoStacks.get(id)||[];const snapshot=stack.pop();
   if(!snapshot)return {undone:false};
   const restored=restoreEdit(draft(id),snapshot);
   restoring=true;
   try{makeHost(id).onChange(restored);}finally{restoring=false;}
   send('nav_help',id,{trigger:'button',step:'undo',focusId:'undo',strength:0,idleMs:0,levelId:id});
   return {undone:true};
  },
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
function showHelp(html){$('#help-content').innerHTML=html;$('#help').showModal();window.dispatchEvent(new CustomEvent('branch-process-panel',{detail:{open:String(html).includes('当前执行过程')}}));}
function closeTopOverlay(){
 if($('#skin-overlay')?.hidden===false){closeSkinModal();return true;}
 if($('#learn-overlay')?.hidden===false){closeLearnCard();return true;}
 if($('#story-overlay') && $('#story-overlay').hidden===false){ closeStory(true); return true; }
 if($('#patrol-overlay') && $('#patrol-overlay').hidden===false){ closePatrol(); return true; }
 if($('#exam-overlay') && $('#exam-overlay').hidden===false){ closeExam(true); return true; }
 return false;
}
document.addEventListener('keydown',event=>{
 if(event.key!=='Escape')return;
 if(closeTopOverlay()) event.preventDefault();
});
window.addEventListener('message',event=>{
 if(event.origin!==location.origin || event.data?.type!=='rpgjs-overlay-close')return;
 closeTopOverlay();
});
$('#close-help').onclick=()=>$('#help').close();$('#help').addEventListener('click',e=>{if(e.target===$('#help'))$('#help').close();});
$('#help').addEventListener('close',()=>window.dispatchEvent(new CustomEvent('branch-process-panel',{detail:{open:false}})));
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
 const quizRoot=(!legacy && $('#exam-body')) || $('#workbench');
 if(legacy) quizRoot.classList.remove('game-workbench');
 const gateOpen=demo||examOpened();
 if(!gateOpen){
  const required=(R.levels||[]).filter(level=>level.required!==false);
  const missing=required.filter(level=>!state.levels[level.id]?.valid).map(level=>({id:level.id,title:STATIONS.find(item=>item.id===level.id)?.title||level.title}));
  const closedFocus=currentFocus({levelId:'quiz',exam:{open:false,missing},overlay:legacy?null:'exam'});
  quizRoot.innerHTML=`<p id="quiz-focus-hint" class="focus-hint" role="status">${esc(closedFocus.hint)}</p><h1>考核还没开放</h1><p>温室、返修和路口三站都当前通过后，考核会自动打开。选做的储能柜不参与。</p><ul id="exam-missing">${missing.map(level=>`<li>${esc(level.title)}</li>`).join('')}</ul>${missing.map((level,index)=>`<button class="primary${index===0&&canEnter(level.id)?' focus-target':''}" data-back="${level.id}" ${canEnter(level.id)?'':'disabled'} ${index===0&&canEnter(level.id)?'data-focus="exam-missing"':''}>回到该站（${esc(level.title)}）</button>`).join(' ')}`;
  quizRoot.querySelectorAll('[data-back]').forEach(button=>button.onclick=()=>{ if(button.disabled||!canEnter(button.dataset.back))return; closeExam(false); goToTask(button.dataset.back); });
  if(!gateInfoSent){gateInfoSent=true;send('nav_help','quiz',{trigger:'gate_info',strength:0,idleMs:0,step:closedFocus.step,focusId:closedFocus.id,levelId:'quiz'});}
  quizIdle.configure({key:`quiz:${closedFocus.id}`,thinking:false});
  return;
 }
 if(!questions.length){try{const data=await api('/api/quiz'+(demo?'':'?studentId='+encodeURIComponent(user.id)));questions=data.questions||[];quizVersion=data.quizVersion||quizVersion;if(demo&&!questions.length&&answerKey.length){questions=answerKey.map(question=>{const interaction=question.interaction?{...question.interaction}:undefined;if(interaction)delete interaction.note;return {id:question.id,goal:question.goal,prompt:question.prompt,options:question.options,tier:question.tier,type:question.type,interaction};});}state.quizOpenedAt=data.examGate?.openedAt||state.quizOpenedAt;if(data.challengeUnlocked||(demo&&questions.some(question=>question.tier==='challenge'))){state.quiz||={};state.quiz.challenge||={};state.quiz.challenge.unlockedAt||='open';}localStorage.setItem('branch-island-questions',JSON.stringify({quizVersion,questions,reward:!!data.rewardUnlocked}));}catch(e){const cached=JSON.parse(localStorage.getItem('branch-island-questions')||'null');questions=cached?.quizVersion&&Array.isArray(cached.questions)?cached.questions:[];quizVersion=cached?.quizVersion||'';if(!questions.length){quizRoot.innerHTML=`<h1>独立检测</h1><p class="notice">${esc(e.message)}。请恢复连接后再次进入，学习记录已保留。</p>`;return;}}}
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
  const focus=currentFocus({levelId:'quiz',overlay:legacy?null:'exam',exam:{open:true,tier,allFilled,baseSubmitted:!!state.quiz?.base?.first,challengeSubmitted:!!state.quiz?.challenge?.first,challengeUnlocked:!!state.quiz?.challenge?.unlockedAt,showResult:quizReview}});
  quizIdle.configure({key:`quiz:${tier}:${focus.id}:${draft.index}`,thinking:focus.thinking});
  mountQuiz(quizRoot,{questions,tier,draft,pending,notice,review,focus,focusStrength:quizStrength,challengeUnlocked:!!state.quiz?.challenge?.unlockedAt,rewardUnlocked:reward,onSave:saveQuiz,onRender:renderQuiz,onTier(next){quizIdle.reset();quizStrength=0;draft.tier=next;draft.index=0;saveQuiz();renderQuiz();},onNotice:setNotice,onSubmit(submitTier,answers){if(demo){notice='演示模式的作答只留在这台设备上。';quizReview=true;saveLocal();renderQuiz();return;}send('quiz','quiz',{tier:submitTier,answers,quizVersion:draft.quizVersion});setNotice('检测正在提交；连接未完成时会保留，恢复后自动提交。');renderQuiz();}});
  quizRoot.onpointerdown=()=>{quizIdle.reset();if(!quizStrength)return;quizStrength=0;quizRoot.querySelectorAll('.focus-target').forEach(node=>{node.dataset.strength='0';node.classList.remove('tap-hand');});};
}
async function boot(){
 try{const config=await api('/api/config');round=config.round;roster=await api('/api/roster');localStorage.setItem('branch-island-roster',JSON.stringify(roster));}catch(e){roster=JSON.parse(localStorage.getItem('branch-island-roster')||'null');if(!roster){$('#app').innerHTML=`<main class="loading"><h1>课堂连接还没有准备好</h1><p>${esc(e.message)}</p><a href="/">重新连接</a></main>`;return;}}
 if(demo){const solutions=await api('/api/teacher/solutions');answerKey=solutions.questions||solutions.quiz||solutions.answers;user={id:'demo',classId:'演示',name:'演示调试员'};const saved=JSON.parse(localStorage.getItem(cacheKey())||'null');state=saved?.state||emptyState();current=saved?.current||'sale';if(current!=='quiz')rememberStation(current);render();return;}
 const saved=JSON.parse(localStorage.getItem('branch-island-identity')||'null');if(saved){try{attach(await api(`/api/state?studentId=${encodeURIComponent(saved.user.id)}`));return;}catch(e){user=saved.user;round=saved.round;const local=JSON.parse(localStorage.getItem(cacheKey())||'null');if(local){state=local.state;current=local.current;if(current!=='quiz')rememberStation(current);render();return;}user=null;}}
 login();
}
window.addEventListener('online',()=>queue.flush().then(updateHeader));window.addEventListener('beforeunload',()=>{destroyScene();saveLocal();});setInterval(()=>{if(!demo)queue.flush().then(updateHeader);},5000);
boot().catch(e=>{$('#app').innerHTML=`<main class="loading"><h1>页面暂未打开</h1><p>${esc(e.message)}</p><a href="/">重新连接</a></main>`;});
