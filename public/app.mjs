import { SyncQueue, reconcileState } from './sync.mjs';
const R = window.BranchRules;
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = v => JSON.parse(JSON.stringify(v));
const eventId = () => globalThis.crypto?.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2,'0')).join('');
const ids = ['sale','repair','cross','minimum'];
const titles = ['售票站','规则维修站','路口指挥站','双数能量站'];
const demo = new URLSearchParams(location.search).has('demo');
const emptyState = () => ({drafts:{},levels:{},runs:{},predictions:{},attempts:[],points:0});
let user = null, round = 1, state = emptyState(), current = 'sale', roster = null, questions = [], answerKey = [], quizIndex = 0, quizReview = false, notice = '', lastRun = null, loginClass = '501', loginSearch = '', manual = '', selectedStudent = '';
const defaults = {
 sale:{config:{operator:'<',yes:'',no:''},input:{height:120},prediction:'',reason:'',hint:0},
 repair:{config:{operator:'>=',yes:'5',no:'10'},input:{height:120},prediction:'',reason:'',hint:0},
 cross:{config:{yes:'',no:''},input:{facility:true},prediction:'',reason:'',hint:0},
 minimum:{config:{operator:'',yes:'',no:''},input:{a:8,b:3},prediction:'',reason:'',hint:0}
};
const story = {
 sale:{mission:'小机器人收到公园售票任务：身高小于120厘米，票价5元；否则10元。请让售票机对不同身高都出票正确。',focus:'先在流程图下选择“是”和“否”的票价，再预测并运行。',standard:'两侧和边界都测过，票价符合规则；能解释120厘米走哪条路。'},
 repair:{mission:'维修员把判断改成了“身高≥120厘米”，却没有调整出口。先用120厘米试出问题，再修好两条出口。',focus:'先预测并运行一次初始程序，观察哪里不符合售票规则。',standard:'留下修前证据；修后重测119、120、121厘米，并说清修改依据。'},
 cross:{mission:'给公园路口设置过街指引：有过街天桥或地下通道，就走那里；没有，就到有信号灯的人行横道，按信号通行。',focus:'设置两条出口，再切换“有／没有设施”分别运行。',standard:'两种情况都有合适去处；每次只沿条件对应的一条路径执行。'},
 minimum:{mission:'给双数能量机设计新算法：输入两个不同的自然数a、b，只输出较小的数。判断符号与出口由你决定。',focus:'自己补全判断和两条出口，用a较小、b较小两种情况检验。',standard:'不同大小关系都测过，输出始终较小；能说明为什么要先比较。'}
};
const reasonOptions = {
 sale:[['both','“是”和“否”都要执行'],['boundary','120不享半价，判断与出口配合后应输出10元'],['small','120比120小，走5元路径']],
 repair:[['symbol','只改符号，出口可以不变'],['swap','判断方向相反，交换两条出口才能保持原规则'],['both','把两条出口改成相同票价']],
 cross:[['one','“是／否”表示条件成立与否，一次只选对应路径'],['none','没有天桥，就不需要考虑另一种过街方式'],['both','先走天桥，再走人行横道']],
 minimum:[['always','a排在前面，每次都输出a'],['compare','先比较a和b，再沿对应路径输出较小数'],['both','将两个数按输入顺序都输出']]
};
async function api(path, body) {
 const response = await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(8000)});
 const data = await response.json();
 if(!response.ok) throw new Error(data.error || data.message || `保存未成功（${response.status}）`);
 return data;
}
const cacheKey = () => `branch-island-state:${demo?'demo':user.id}:${round}`;
function saveLocal(){ if(user) localStorage.setItem(cacheKey(),JSON.stringify({state,current})); }
const queue = new SyncQueue(localStorage,e => api('/api/events',e),(event,data)=>{
 if(user && event.studentId===user.id && event.round===round && !queue.pending(user.id)) {
  state=reconcileState(state,data.state,event.type!=='quiz');
  saveLocal();
  if(event.type==='complete' && !data.result.passed) {notice=data.result.feedback;render();}
  if(event.type==='quiz') {quizReview=true; notice='检测已提交。看看错题，再回到对应任务试一试。';render();}
  updateHeader();
 }
});
function syncStatus(){if(demo)return '独立演示 · 不计入班级';const n=queue.pending(user?.id);return n?`${n}条待同步 · ${queue.error?'连接未完成，记录已保留':'正在保存'}`:'已同步保存';}
function updateHeader(){if($('#save-status'))$('#save-status').textContent=syncStatus();if($('#points'))$('#points').textContent=`${state.points || 0} 积分`;}
function send(type,levelId,payload){
 if(!user)return;
 saveLocal();
 if(demo){updateHeader();return;}
 queue.add({studentId:user.id,round,eventId:eventId(),type,levelId,payload:clone(payload),editedAt:Date.now()});
 updateHeader();queue.flush().then(updateHeader);
}
function draft(){if(!state.drafts[current])state.drafts[current]=clone(defaults[current]);return state.drafts[current];}
function saveDraft(){saveLocal();send('draft',current,draft());}
function setNotice(text){notice=text;if($('#notice')){$('#notice').textContent=text;$('#notice').hidden=!text;}}
function option(value,label,selected){return `<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(label)}</option>`;}
function pick(name,label,options,value){return `<label>${label}<select id="${name}">${option('','请选择',value)}${options.map(([v,t])=>option(v,t,value)).join('')}</select></label>`;}
function outputLabel(value){return ({'5':'票价5元','10':'票价10元',bridge:'走天桥／地下通道',crossing:'到人行横道按信号通行',a:'输出a',b:'输出b'})[value] || '选择执行的动作';}
function conditionLabel(){const d=draft();if(current==='cross')return '有过街设施吗？';if(current==='minimum')return d.config.operator?`a ${d.config.operator} b 吗？`:'a 与 b 怎样比较？';return `身高 ${d.config.operator==='>='?'≥':'＜'} 120厘米？`;}
function flow(){
 const c=draft().config;const br=lastRun?.branch;
 return `<svg viewBox="0 0 720 354" role="img" aria-label="分支流程图：先判断，沿是或否执行一个出口，再汇合结束"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8" fill="#68849c"/></marker><marker id="hot" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8" fill="#147d78"/></marker></defs><g class="park-art"><path d="M0 280Q130 230 240 277T720 260V300H0" fill="#d7eee5"/><path d="M30 263v-45m-12 24l12-25 14 25m-32 6l18-31 21 31M673 266v-51m-17 28l17-28 19 28" stroke="#9bc6b3" stroke-width="9" fill="none"/><circle cx="658" cy="42" r="20" fill="#ffdc82"/><path d="M36 66h78m-65-10h51" stroke="#fff" stroke-width="10" stroke-linecap="round"/></g><ellipse cx="360" cy="24" rx="50" ry="18" fill="#153758"/><text x="360" y="29" text-anchor="middle" fill="white">开始</text><path d="M360 42V58" class="wire"/><path d="M273 60H465L447 96H255Z" fill="#f5f8fb" stroke="#a4bbcd"/><text x="360" y="83" text-anchor="middle">${esc(current==='minimum'?`输入 a=${draft().input.a}，b=${draft().input.b}`:current==='cross'?`输入：${draft().input.facility?'有设施':'无设施'}`:`输入身高${draft().input.height}厘米`)}</text><path d="M360 96V115" class="wire"/><path d="M360 115L487 163 360 211 233 163Z" fill="#fff3cb" stroke="#d0ad49" stroke-width="2"/><text x="360" y="169" text-anchor="middle" class="condition-text">${esc(conditionLabel())}</text><path d="M233 163H165V235" class="wire ${br==='yes'?'active-wire':''}"/><path d="M487 163H555V235" class="wire ${br==='no'?'active-wire':''}"/><text x="194" y="150" class="branch-label">是</text><text x="510" y="150" class="branch-label">否</text><path d="M47 238H307L283 290H23Z" class="flow-output ${br==='yes'?'active-output':''}"/><path d="M437 238H697L673 290H413Z" class="flow-output ${br==='no'?'active-output':''}"/><text x="165" y="269" text-anchor="middle">${esc(outputLabel(c.yes))}</text><text x="555" y="269" text-anchor="middle">${esc(outputLabel(c.no))}</text><path d="M165 290V318H360M555 290V318H360V330" class="wire"/><ellipse cx="360" cy="337" rx="50" ry="16" fill="#edf2f7" stroke="#68849c"/><text x="360" y="342" text-anchor="middle">结束</text>${br?`<g transform="translate(${br==='yes'?150:540} 205)"><rect width="30" height="25" rx="8" fill="#147d78"/><circle cx="9" cy="11" r="3" fill="white"/><circle cx="21" cy="11" r="3" fill="white"/><path d="M15 0v-7m-4 0h8" stroke="#147d78" stroke-width="3"/></g>`:''}</svg>`;
}
function inputLabel(input){return current==='cross'?(input.facility?'有过街设施':'没有过街设施'):current==='minimum'?`a=${input.a}，b=${input.b}`:`${input.height}厘米`;}
function login(){
 const cls=roster.classes.find(c=>c.id===loginClass) || roster.classes[0];loginClass=cls.id;
 const names=cls.students.filter(s=>s.name.includes(loginSearch));
 $('#app').innerHTML=`<main class="landing"><section class="welcome"><p class="eyebrow">五年级 · 身边的算法 · 第6课</p><h1>分支<span>冒险岛</span></h1><p class="welcome-copy">一个判断，两条道路。<br>让机器人每次都走对。</p><div class="island-art" aria-hidden="true"><div class="sun"></div><div class="route route-left"></div><div class="route route-right"></div><div class="sign">条件成立吗？</div><div class="island-booth left">是</div><div class="island-booth right">否</div><div class="robot"><i></i><i></i></div><div class="grass"></div></div><p class="landing-note">修好售票规则 · 指挥路口 · 设计双数能量机</p></section><section class="login-card"><p class="eyebrow">调度员报到</p><h2>选择你的身份</h2><p class="muted">进度会自动保存，下次可以接着探索。</p><label>班级<select id="class-select">${roster.classes.map(c=>option(c.id,`${c.id}班`,loginClass)).join('')}</select></label><label>搜索姓名<input id="name-search" value="${esc(loginSearch)}" placeholder="输入姓名中的字" autocomplete="off"></label><label>名单姓名<select id="student-select">${option('','请选择自己的姓名',selectedStudent)}${names.map(s=>option(s.id,s.name,selectedStudent)).join('')}</select></label><details><summary>名单中没有我</summary><label>补充姓名<input id="manual-name" maxlength="30" value="${esc(manual)}" placeholder="输入姓名，归入当前班级"></label></details><div class="identity-confirm">请确认：<strong id="chosen-identity">${esc(loginClass)}班 · ${esc(manual || cls.students.find(s=>s.id===selectedStudent)?.name || '尚未选择姓名')}</strong></div><button id="login" class="primary wide">确认身份，进入小岛 →</button><p id="login-error" class="error" role="alert"></p><p class="small muted">请用自己的姓名进入。课堂选名用于记录学习进度。</p></section></main>`;
 $('#class-select').onchange=e=>{loginClass=e.target.value;selectedStudent='';manual='';login();};
 $('#name-search').oninput=e=>{loginSearch=e.target.value;const sel=$('#student-select');sel.innerHTML=option('','请选择自己的姓名','')+cls.students.filter(s=>s.name.includes(loginSearch)).map(s=>option(s.id,s.name,selectedStudent)).join('');};
 $('#student-select').onchange=e=>{selectedStudent=e.target.value;manual='';$('#manual-name').value='';$('#chosen-identity').textContent=`${loginClass}班 · ${cls.students.find(s=>s.id===selectedStudent)?.name || '尚未选择姓名'}`;};
 $('#manual-name').oninput=e=>{manual=e.target.value;selectedStudent='';$('#student-select').value='';$('#chosen-identity').textContent=`${loginClass}班 · ${manual || '尚未填写姓名'}`;};
 $('#login').onclick=async()=>{try{if(!selectedStudent&&!manual.trim())throw new Error('先选择自己的姓名，或在“名单中没有我”填写。');const data=await api('/api/login',{classId:loginClass,...(manual.trim()?{name:manual.trim()}:{studentId:selectedStudent})});attach(data);}catch(e){$('#login-error').textContent=e.message;}};
}
function attach(data){user=data.student;round=data.round;state=data.state;const local=JSON.parse(localStorage.getItem(cacheKey())||'null');if(queue.pending(user.id)&&local)state=local.state;current=local?.current || ids.find(id=>!state.levels[id]?.completed) || 'quiz';if(!demo)localStorage.setItem('branch-island-identity',JSON.stringify({user,round}));saveLocal();render();queue.flush().then(updateHeader);}
function render(){
 if(!user)return login();
 const idx=ids.indexOf(current);const unlocked=id=>demo || ids.indexOf(id)===0 || state.levels[ids[ids.indexOf(id)-1]]?.completed;
 $('#app').innerHTML=`${demo?'<div class="demo-banner">教师独立演示：可跳关、查看参考操作；所有操作只保存在演示区。<a href="/teacher.html">返回班级大屏</a></div>':''}<header class="topbar"><a class="brand" href="#">分支冒险岛<span>判断选择用分支</span></a><div class="identity"><span>${demo?'演示调度员':`${esc(user.classId)}班 · ${esc(user.name)}`}</span><strong id="points">${state.points||0} 积分</strong><button id="switch-user" class="quiet">切换身份</button></div></header><div class="app-shell"><aside class="map"><p class="eyebrow">公园调度路线</p><h2>让规则运转起来</h2><nav aria-label="任务路线">${ids.map((id,i)=>`<button data-route="${id}" class="route-item ${current===id?'selected':''}" ${unlocked(id)?'':'disabled'}><span class="stop">${state.levels[id]?.completed?'✓':i+1}</span><span><b>${titles[i]}</b><small>${state.levels[id]?.completed?(state.levels[id].valid?'已完成 · 当前已验证':'曾完成 · 当前待重验'):(unlocked(id)?'可开始探索':'完成上一站解锁')}</small></span></button>`).join('')}<button data-route="quiz" class="route-item ${current==='quiz'?'selected':''}" ${demo||ids.every(id=>state.levels[id]?.completed)?'':'disabled'}><span class="stop">20</span><span><b>独立检测</b><small>${state.attempts.length?`已检测${state.attempts.length}次`:'完成四站后开始'}</small></span></button></nav><div class="map-note">每站25积分，合理试错不扣分。<br>检测成绩与通关积分分开记录。</div><div id="save-status" class="save-status" role="status">${syncStatus()}</div></aside><main id="workbench" class="workbench"></main></div>`;
 $('[data-route]') && document.querySelectorAll('[data-route]').forEach(btn=>btn.onclick=()=>{current=btn.dataset.route;lastRun=null;notice='';quizReview=false;saveLocal();render();});
 $('.brand').onclick=e=>{e.preventDefault();current='sale';render();};
 $('#switch-user').onclick=()=>{saveLocal();localStorage.removeItem('branch-island-identity');user=null;selectedStudent='';manual='';notice='';lastRun=null;if(demo){location.href='/teacher.html';return;}login();};
 if(current==='quiz')renderQuiz();else renderTask(idx);
}
function renderTask(idx){
 const d=draft(), meta=story[current];
 const valueOptions=current==='cross'?[['bridge','走天桥／地下通道'],['crossing','到人行横道按信号通行']]:current==='minimum'?[['a','输出a'],['b','输出b']]:[['5','票价5元'],['10','票价10元']];
 const runs=state.runs[current]||[];
 const tested=runs.slice(state.levels[current]?.evidenceStart||0).filter(r=>JSON.stringify(r.config)===JSON.stringify(d.config));
 const focusText=state.levels[current]?.valid?'本关已完成！点击右上角，前往下一站。':lastRun?(lastRun.correct?'这次符合目标。继续测试其他情况，然后选择解释并检查本关。':'这次结果与目标不同。看高亮出口，修改判断或出口后再测试。'):current==='repair'&&runs.some(r=>!r.correct)?'已经发现错误：调整两条出口，再用三种身高重验。':meta.focus;
 $('#workbench').innerHTML=`<div class="task-heading"><div><p class="eyebrow">任务 ${idx+1} / 4</p><h1>${titles[idx]}</h1></div><div class="task-tools"><button id="help-open" class="quiet">操作帮助</button>${state.levels[current]?.valid?`<button id="next-top" class="primary">${idx<3?'前往下一站 →':'开始20题检测 →'}</button>`:''}</div></div><p class="mission">${meta.mission}</p><div class="focus"><span>现在做</span><p>${focusText}</p></div><details class="success"><summary>怎样算完成？</summary><p>${meta.standard}</p><p>找对条件 · 连对是与否 · 用不同情况检验 · 说清理由</p></details><section class="experiment"><div class="flow-heading"><h2>我的分支规则</h2><span>沿着高亮路径看执行过程</span></div><div id="flow">${flow()}</div><div class="rule-controls">${current==='sale'?pick('operator','判断条件',[['<','身高＜120厘米'],['>=','身高≥120厘米']],d.config.operator):current==='minimum'?pick('operator','判断条件',[['<','a＜b 吗？'],['>','a＞b 吗？']],d.config.operator):`<div class="fixed-condition"><span>判断条件</span><strong>${esc(conditionLabel())}</strong></div>`}${pick('yes','条件成立 → 是',valueOptions,d.config.yes)}${pick('no','条件不成立 → 否',valueOptions,d.config.no)}</div><div class="test-area"><div class="input-controls">${current==='cross'?`<label>现场情况<select id="facility">${option('true','有天桥／地下通道',String(d.input.facility))}${option('false','没有天桥／地下通道',String(d.input.facility))}</select></label>`:current==='minimum'?`<label>自然数a<input id="number-a" type="number" min="0" max="999" step="1" value="${esc(d.input.a)}"></label><label>自然数b<input id="number-b" type="number" min="0" max="999" step="1" value="${esc(d.input.b)}"></label>`:`<label>测试身高（厘米）<input id="height" type="number" min="50" max="250" step="1" value="${esc(d.input.height)}"></label><div class="quick-inputs">${[119,120,121].map(n=>`<button data-height="${n}" class="chip">${n}</button>`).join('')}</div>`}</div><div class="prediction">${pick('prediction','运行前预测：这次会输出什么？',current==='minimum'?[['a','a这个数'],['b','b这个数']]:valueOptions,d.prediction)}<button id="run" class="primary">运行这次测试 ▶</button></div></div><div id="run-result" class="run-result" aria-live="polite">${lastRun?resultHTML(lastRun):'选择输入与预测，然后运行。你的实验会自动记录。'}</div></section><div id="notice" class="notice" role="status" ${notice?'':'hidden'}>${esc(notice)}</div><section class="finish-panel"><div><h2>检验后，说清理由</h2><p class="muted">${current==='minimum'?'至少测试a＜b和a＞b两种情况。':current==='cross'?'两种现场情况都要测试。':'用119、120、121厘米检查两侧与边界。'}</p><p class="evidence-count">本方案已有 ${tested.length} 次测试 · 全部实验 ${runs.length} 次</p></div>${pick('reason','选择与你的实验相符的解释',reasonOptions[current],d.reason)}<div class="finish-actions"><button id="hint" class="quiet">${d.hint?'再给一点思路':'我需要一点思路'}</button><button id="complete" class="primary">检查本关是否完成</button></div>${state.levels[current]?.completed?`<div class="award">★ 本关已获25积分 · 累计${state.points}积分 <button id="next" class="primary">${idx<3?'前往下一站 →':'开始20题检测 →'}</button></div>`:''}</section><details class="records"><summary>查看自动记录的实验（${runs.length}）</summary><div class="record-list">${runs.slice().reverse().map(r=>`<div><span>${esc(inputLabel(r.input))}</span><span>${esc(r.config.operator||'有无设施')} → ${r.branch==='yes'?'是':'否'} → ${esc(current==='minimum'?`数值${r.output}`:outputLabel(r.output))}</span><b class="${r.correct?'ok':'error'}">${r.correct?'符合目标':'需要修订'}</b></div>`).join('')||'<p>还没有实验，先运行一次。</p>'}</div></details>${demo?'<button id="reference" class="quiet">查看本关参考操作</button>':''}`;
 for(const field of ['operator','yes','no'])if($('#'+field))$('#'+field).onchange=e=>{if(d.config[field]!==e.target.value){state.levels[current]||={completed:false,points:0};state.levels[current].evidenceStart=(state.runs[current]||[]).length;state.levels[current].valid=false;}d.config[field]=e.target.value;const routeLabel=document.querySelector(`[data-route="${current}"] small`);if(routeLabel&&state.levels[current]?.completed)routeLabel.textContent='曾完成 · 当前待重验';lastRun=null;$('#flow').innerHTML=flow();$('#run-result').textContent='规则改变了。请用不同输入重新验证，历史证据仍然保留。';saveDraft();};
 $('#prediction').onchange=e=>{d.prediction=e.target.value;saveDraft();};$('#reason').onchange=e=>{d.reason=e.target.value;saveDraft();};
 function inputChanged(){lastRun=null;$('#flow').innerHTML=flow();$('#run-result').textContent='输入已改变，请先预测再运行。';saveLocal();}
 if($('#height')){$('#height').oninput=e=>{d.input.height=Number(e.target.value);inputChanged();};$('#height').onchange=saveDraft;document.querySelectorAll('[data-height]').forEach(b=>b.onclick=()=>{d.input.height=Number(b.dataset.height);$('#height').value=d.input.height;d.prediction='';$('#prediction').value='';inputChanged();saveDraft();});}
 if($('#facility'))$('#facility').onchange=e=>{d.input.facility=e.target.value==='true';d.prediction='';$('#prediction').value='';inputChanged();saveDraft();};
 for(const key of ['a','b'])if($('#number-'+key)){$('#number-'+key).oninput=e=>{d.input[key]=Number(e.target.value);inputChanged();};$('#number-'+key).onchange=saveDraft;}
 $('#run').onclick=()=>run();$('#complete').onclick=()=>complete();$('#hint').onclick=()=>{d.hint=Math.min(3,(d.hint||0)+1);saveDraft();const hints={sale:['观察：119、120、121中哪些让判断成立？','“是”只表示条件成立，票价要与公园规则核对。','先写出每个输入应收多少钱，再比较程序实际走的出口。'],repair:['比较修改后的判断和旧判断，120厘米会走哪边？','条件的方向改变了，原出口是否还匹配？','分别核对“条件成立”和“不成立”时应收的票价。'],cross:['先看有无设施，再考虑应该从哪里走。','“没有设施”也需要一条可执行的路径。','把两个输入分别代入，逐条核对出口。'],minimum:['把a较小和b较小的情况分别代入你写的判断。','条件成立时，较小的是哪个？不成立时呢？','两个数不同，所以比较后只输出其中一个。']};showHelp(`<h2>一点思路</h2><p>${hints[current][d.hint-1]}</p><p class="muted">使用帮助不扣积分。修改以后再用实际输入验证。</p>`);};
 $('#help-open').onclick=()=>showHelp(`<h2>${titles[idx]} · 操作帮助</h2><ol><li>在流程图下方选择判断和两条出口。</li><li>选择或输入测试数据，选好你的预测。</li><li>点“运行这次测试”，观察高亮的“是／否”路径。</li><li>修改后继续测试，选理由，再检查本关。</li></ol><p>这个窗口随时可以关闭，不会清空输入或进度。</p>`);
 const goNext=()=>{current=ids[idx+1]||'quiz';lastRun=null;notice='';quizReview=false;saveLocal();render();};
 if($('#next'))$('#next').onclick=goNext;if($('#next-top'))$('#next-top').onclick=goNext;
 if($('#reference'))$('#reference').onclick=()=>showHelp(`<h2>教师参考操作</h2><p>${({sale:'可用“＜120”：是→5元，否→10元；或“≥120”：是→10元，否→5元。',repair:'先以原错误配置运行120厘米，再调整为：是→10元，否→5元。',cross:'是→走天桥／地下通道；否→到有信号灯人行横道按信号通行。',minimum:'a＜b：是→a、否→b；a＞b：是→b、否→a。两种等价方案均接受。'})[current]}</p><p>测试要求与学生一致。参考操作不自动通关。</p>`);
}
function resultHTML(r){return `<strong>${esc(inputLabel(r.input||draft().input))} → 条件${r.condition?'成立':'不成立'} → ${r.branch==='yes'?'是':'否'} → ${esc(current==='minimum'?`数值${r.output}`:outputLabel(r.output))}</strong><p>${r.correct?'这次结果符合目标。继续检查其他情况。':`这次结果与任务要求不同。目标应为${esc(current==='minimum'?r.expected:outputLabel(r.expected))}，检查判断与出口后重试。`}</p>`;}
function run(){
 const d=draft();if(!d.prediction){setNotice('先选择本次输出预测，再运行测试。预测错了也不扣分。');$('#prediction').focus();return;}
 try {const result=R.evaluate(current,d.config,d.input);lastRun={...result,input:clone(d.input),config:clone(d.config),at:new Date().toISOString()};state.runs[current]||=[];state.runs[current].push(clone(lastRun));state.predictions[current]||=[];state.predictions[current].push({value:d.prediction,input:clone(d.input),config:clone(d.config)});send('prediction',current,{value:d.prediction,input:d.input,config:d.config});send('run',current,{config:d.config,input:d.input});notice='';renderTask(ids.indexOf(current));}catch(e){setNotice(e.message);}
}
function complete(){
 try {
 const d=draft();const result=R.validateComplete(current,d.config,state.runs[current]||[],d.reason,state.levels[current]?.evidenceStart||0);
 if(!result.passed){setNotice(result.feedback);return;}
 const earned=!state.levels[current]?.completed;state.levels[current]={...state.levels[current],completed:true,valid:true,points:25,reason:d.reason};state.points=ids.reduce((n,id)=>n+(state.levels[id]?.completed?25:0),0);send('complete',current,{config:d.config,reason:d.reason});notice=earned?'本关已完成，获得25积分！现在可以进入下一站。':'当前方案已重新验证，历史积分保留。';render();
 } catch(error){setNotice(error.message);}
}
function showHelp(html){$('#help-content').innerHTML=html;$('#help').showModal();}
$('#close-help').onclick=()=>$('#help').close();$('#help').addEventListener('click',e=>{if(e.target===$('#help'))$('#help').close();});
function quizDraft(){state.drafts.quiz||={answers:Array(20).fill(null),index:0};return state.drafts.quiz;}
function saveQuiz(){saveLocal();send('draft','quiz',quizDraft());}
async function renderQuiz(){
 if(!questions.length){try{const data=await api('/api/quiz');questions=data.questions||data;localStorage.setItem('branch-island-questions',JSON.stringify(questions));}catch(e){questions=JSON.parse(localStorage.getItem('branch-island-questions')||'[]');if(!questions.length){$('#workbench').innerHTML=`<h1>独立检测</h1><p class="notice">${esc(e.message)}。请恢复连接后再次进入，学习记录已保留。</p>`;return;}}}
 if(current!=='quiz')return;
 const quizPending=!demo&&queue.events.some(e=>e.studentId===user.id&&e.round===round&&e.type==='quiz');
 const qd=quizDraft();quizIndex=Math.min(19,qd.index||0);const q=questions[quizIndex], answered=qd.answers.filter(v=>Number.isInteger(v)).length;
 if(quizReview&&state.attempts.length){const first=state.attempts[0],last=state.attempts.at(-1);$('#workbench').innerHTML=`<p class="eyebrow">检测反馈</p><h1>看看自己的理解</h1><div class="score-row"><div><strong>${last.score*5}</strong><span>最近成绩 / 100</span></div><div><strong>${first.score*5}</strong><span>首次成绩 / 100</span></div><div><strong>${state.attempts.length}</strong><span>已完成次数</span></div></div><p>重做成绩表示修订后的表现。首次成绩和任务实验仍然保留。</p><button id="retry-quiz" class="primary" ${quizPending?'disabled':''}>重新进行20题检测</button><details class="records"><summary>历史成绩</summary>${state.attempts.map((a,i)=>`<p>第${i+1}次：${a.score*5}分 · ${esc(new Date(a.at).toLocaleString('zh-CN'))}</p>`).join('')}</details><h2>错题与回学建议</h2>${last.details.filter(a=>!a.correct).map(a=>{const question=questions.find(q=>q.id===a.id);return `<article class="wrong-question"><b>${esc(question?.prompt||a.id)}</b><p>你的选择：${esc(question?.options[a.answer])}</p><p>正确答案：${esc(question?.options[a.correctAnswer])}</p><p>${esc(a.explanation)}</p></article>`;}).join('')||'<div class="award">本次20题全部答对。可以回到双数能量站，换一种等价方案再检验。</div>'}`;$('#retry-quiz').onclick=()=>{state.drafts.quiz={answers:Array(20).fill(null),index:0};quizReview=false;saveQuiz();renderQuiz();};return;}
 $('#workbench').innerHTML=`<div class="task-heading"><div><p class="eyebrow">独立检测 · 提交后查看反馈</p><h1>20题，检验你的理解</h1></div>${state.attempts.length?'<button id="history" class="quiet">看已交检测</button>':''}</div><p class="muted">已答${answered}/20。可以前后检查，提交前不显示正误。</p><div class="question-nav">${questions.map((q,i)=>`<button data-question="${i}" ${quizPending?'disabled':''} class="${i===quizIndex?'current':''} ${Number.isInteger(qd.answers[i])?'answered':''}" aria-label="第${i+1}题${Number.isInteger(qd.answers[i])?'已答':'未答'}">${i+1}</button>`).join('')}</div><article class="question"><p class="eyebrow">第${quizIndex+1}题 · ${esc(q.goal)}</p><h2>${esc(q.prompt)}</h2><div class="answers">${q.options.map((o,i)=>`<button data-answer="${i}" ${quizPending?'disabled':''} class="answer ${qd.answers[quizIndex]===i?'chosen':''}" aria-pressed="${qd.answers[quizIndex]===i}"><span>${'ABCD'[i]}</span>${esc(o)}${qd.answers[quizIndex]===i?'<small>已选择</small>':''}</button>`).join('')}</div></article><div class="quiz-actions"><button id="previous" class="quiet" ${quizIndex===0||quizPending?'disabled':''}>← 上一题</button><button id="next-question" class="primary" ${quizIndex===19||quizPending?'disabled':''}>下一题 →</button><button id="submit-quiz" class="primary" ${quizPending?'disabled':''}>${quizPending?'检测待同步，请保留记录':'检查并提交20题'}</button></div><div id="notice" class="notice" ${notice?'':'hidden'} role="status">${esc(notice)}</div>${demo?'<button id="quiz-key" class="quiet">查看20题标准答案与解析</button>':''}`;
 document.querySelectorAll('[data-question]').forEach(b=>b.onclick=()=>{qd.index=Number(b.dataset.question);saveQuiz();renderQuiz();});
 document.querySelectorAll('[data-answer]').forEach(b=>b.onclick=()=>{qd.answers[quizIndex]=Number(b.dataset.answer);saveQuiz();renderQuiz();});
 $('#previous').onclick=()=>{qd.index--;saveQuiz();renderQuiz();};$('#next-question').onclick=()=>{qd.index++;saveQuiz();renderQuiz();};
 if($('#history'))$('#history').onclick=()=>{quizReview=true;renderQuiz();};
 $('#submit-quiz').onclick=async()=>{if(!demo&&queue.events.some(e=>e.studentId===user.id&&e.round===round&&e.type==='quiz'))return;const missing=qd.answers.flatMap((v,i)=>Number.isInteger(v)?[]:[i+1]);if(missing.length){setNotice(`还有${missing.length}题未答：${missing.join('、')}。请检查后再提交。`);return;}if(demo){const details=questions.map((q,i)=>({id:q.id,answer:qd.answers[i],correctAnswer:answerKey[i].answer,correct:qd.answers[i]===answerKey[i].answer,explanation:answerKey[i].explanation}));state.attempts.push({id:eventId(),score:details.filter(d=>d.correct).length,total:20,at:new Date().toISOString(),details});quizReview=true;saveLocal();renderQuiz();}else{send('quiz','quiz',{answers:qd.answers});setNotice('检测正在提交；连接未完成时会保留，恢复后自动提交，请勿重复点击。');renderQuiz();}};
 if($('#quiz-key'))$('#quiz-key').onclick=()=>showHelp(`<h2>检测参考答案</h2>${questions.map((q,i)=>`<p><b>${i+1}. ${esc(q.prompt)}</b><br>${'ABCD'[answerKey[i].answer]}：${esc(q.options[answerKey[i].answer])}<br>${esc(answerKey[i].explanation)}</p>`).join('')}`);
}
async function boot(){
 try{const config=await api('/api/config');round=config.round;roster=await api('/api/roster');localStorage.setItem('branch-island-roster',JSON.stringify(roster));}catch(e){roster=JSON.parse(localStorage.getItem('branch-island-roster')||'null');if(!roster){$('#app').innerHTML=`<main class="loading"><h1>课堂连接还没有准备好</h1><p>${esc(e.message)}</p><a href="/">重新连接</a></main>`;return;}}
 if(demo){const solutions=await api('/api/teacher/solutions');answerKey=solutions.questions||solutions.quiz||solutions.answers;user={id:'demo',classId:'演示',name:'演示调度员'};const saved=JSON.parse(localStorage.getItem(cacheKey())||'null');state=saved?.state||emptyState();current=saved?.current||'sale';render();return;}
 const saved=JSON.parse(localStorage.getItem('branch-island-identity')||'null');if(saved){try{attach(await api(`/api/state?studentId=${encodeURIComponent(saved.user.id)}`));return;}catch(e){user=saved.user;round=saved.round;const local=JSON.parse(localStorage.getItem(cacheKey())||'null');if(local){state=local.state;current=local.current;render();return;}user=null;}}
 login();
}
window.addEventListener('online',()=>queue.flush().then(updateHeader));window.addEventListener('beforeunload',saveLocal);setInterval(()=>{if(!demo)queue.flush().then(updateHeader);},5000);
boot().catch(e=>{$('#app').innerHTML=`<main class="loading"><h1>页面暂未打开</h1><p>${esc(e.message)}</p><a href="/">重新连接</a></main>`;});
