import {distance,findRoute,moveTowards,nearestPointOnSegment} from './navigation.mjs';
const W=1200,H=800;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=v=>JSON.parse(JSON.stringify(v));
const SRC=[[115,10,160,328],[466,10,173,329],[815,10,172,328],[1184,11,159,328],[1534,9,190,333],[1896,11,166,333],[126,343,136,369],[450,349,211,369],[807,343,225,372],[1161,347,207,366],[1506,444,228,257],[1892,356,190,355]];
const PARK_NODES={entry:{x:600,y:730},gate:{x:600,y:585},south:{x:600,y:445},west:{x:380,y:380},room:{x:235,y:385},control:{x:235,y:435},sensor:{x:285,y:325},fan:{x:160,y:375},check:{x:360,y:375},guide:{x:380,y:465},nw:{x:380,y:220},garden:{x:300,y:175},batteryA:{x:215,y:165},batteryB:{x:375,y:165},charger:{x:300,y:235},north:{x:595,y:220},ne:{x:810,y:230},repair:{x:875,y:190},repairSensor:{x:760,y:210},repairFan:{x:965,y:185},repairCheck:{x:940,y:265},repairGuide:{x:800,y:280},east:{x:815,y:370}};
const PARK_EDGES=[['entry','gate'],['gate','south'],['south','west'],['west','room'],['room','control'],['room','sensor'],['room','fan'],['room','check'],['west','guide'],['west','nw'],['nw','garden'],['garden','batteryA'],['garden','batteryB'],['garden','charger'],['nw','north'],['north','ne'],['ne','repair'],['repair','repairSensor'],['repair','repairFan'],['repair','repairCheck'],['ne','repairGuide'],['ne','east'],['east','south']];
const ROAD_NODES={start:{x:270,y:650},npc:{x:275,y:480},observe:{x:335,y:405},sign:{x:320,y:465},light:{x:370,y:475},bridgeL:{x:355,y:295},bridgeM:{x:610,y:255},bridgeR:{x:865,y:295},zebraL:{x:355,y:532},zebraM:{x:610,y:532},zebraR:{x:865,y:532},right:{x:890,y:420},rightBottom:{x:900,y:650}};
const ROAD_EDGES=[['start','npc'],['npc','observe'],['npc','sign'],['sign','light'],['observe','bridgeL'],['npc','zebraL'],['bridgeR','right'],['zebraR','right'],['right','rightBottom']];
const labelOut=v=>({on:'启动风机',off:'停止风机',bridge:'天桥',crossing:'斑马线',a:'电池A',b:'电池B'})[v]||v;
export function createParkScene(host){
 const {root,levelId:id}=host;const cross=id==='cross',minimum=id==='minimum',repair=id==='repair';
 const start=cross?{x:270,y:650}:repair?{x:285,y:450}:minimum?{x:600,y:585}:{x:600,y:730};
 const d=()=>host.getDraft();const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 if(!d().scene||d().scene.version!==1)d().scene={version:1,...start,facing:'up',phase:'start',measured:false,actorId:cross?'cross-open':minimum?'pair-a':'sensor30',actions:[],visited:[],...(cross?{facility:true,signal:'red'}:minimum?{pair:'pair-a',collected:[]}:{temperatureCase:30})};
 const s=d().scene;
 let disposed=false,raf=0,path=[],afterMove=null,keys=new Set(),lastTime=0,walking=false,walkTime=0,scale=1,ox=0,oy=0,dialogueOpen=false,dirty=false,saveTimer=0;
 const assets={};
 const entries=[];let labelAnchors=[];let selectedRoute=cross&&s.phase==='travelling'?s.ticket?.output:null,lastHud=0;
 root.innerHTML=`<section class="adventure-heading"><div><p class="eyebrow">深圳智慧园林情境 · 教学仿真</p><h1>${esc(({sale:'生态温室：通风试运行',repair:'设备维修：找出反向指令',cross:'安全通行：现场核验指引',minimum:'节能配电：低电量优先'})[id])}</h1></div><div class="task-tools"><button id="scene-flow" class="quiet">查看执行过程图</button><button id="scene-help" class="quiet">怎么操作</button></div></section><div class="park-stage" id="park-stage"><canvas id="park-canvas" tabindex="0" aria-label="可行走的智慧公园，点击地点或使用方向键移动"></canvas><div class="scene-hud"><span class="role-badge">设备调试员</span><span id="scene-objective"></span><button id="stop-walk" title="停止当前行走">停下</button></div><div id="scene-hotspots"></div><div class="scene-readout" id="scene-readout"></div><div class="scene-toast" id="scene-toast" role="status"></div><section class="npc-dialogue" id="npc-dialogue" hidden aria-label="现场对话"><button id="close-dialogue" aria-label="关闭对话" class="dialogue-close">×</button><div id="npc-content"></div></section><div class="move-pad" aria-label="移动方向"><button data-direction="up" aria-label="向上移动">↑</button><button data-direction="left" aria-label="向左移动">←</button><button id="nearby-action">E</button><button data-direction="right" aria-label="向右移动">→</button><button data-direction="down" aria-label="向下移动">↓</button></div></div><div class="adventure-footer"><span>点击地点走近交互 · 方向键 / WASD移动 · E交谈</span><span id="scene-progress"></span><button id="scene-review" class="quiet">找NPC复盘与验收</button></div><details class="scene-log"><summary>我的现场实验记录</summary><div id="scene-log"></div></details>`;
 const stage=root.querySelector('#park-stage'),canvas=root.querySelector('canvas'),ctx=canvas.getContext('2d');
 const $=selector=>root.querySelector(selector);
 const baseGraph=()=>cross?ROAD_NODES:PARK_NODES;
 function edges(){let e=cross?[...ROAD_EDGES]:PARK_EDGES;if(cross){if(s.facility&&(!selectedRoute||selectedRoute==='bridge'))e.push(['bridgeL','bridgeM'],['bridgeM','bridgeR']);if(s.signal==='green'&&(!selectedRoute||selectedRoute==='crossing'))e.push(['zebraL','zebraM'],['zebraM','zebraR']);}return e;}
 function mark(value){if(!s.visited.includes(value))s.visited.push(value);s.visited=s.visited.slice(-20);}
 function persist(){if(disposed)return;dirty=false;host.onChange({scene:copy(s)});}
 function scheduleSave(){dirty=true;clearTimeout(saveTimer);saveTimer=setTimeout(persist,220);}
 function objective(){
  if(host.getLevel()?.valid)return '本轮验收通过，找NPC前往下一处任务。';
  if(s.phase==='start')return '先走近现场NPC，领取调试委托。';
  if(cross){if(!s.measured)return '到观察点，确认现场有没有可用天桥。';if(!s.ticket)return s.visited.includes('verified')?'回安全员处领取另一现场条件，再观察与核验。':'走近指引牌，设定两条路径并作出预测。';if(s.phase==='arrived')return '已到对岸，在核验点检查本次指引。';return `亲自走${labelOut(s.ticket.output)}，到对岸核验。`;}
  if(minimum){if((s.collected||[]).length<2)return '分别到电池A、B站，读取并领取两组电量样本。';if(!s.ticket)return s.visited.includes('verified')?'回能源工程师处领取另一组电量，检验另一种大小关系。':'到分配台设定比较条件、两个出口，并预测。';if(s.phase==='charging')return '把选出的电池带到充电口，核对是否低电量优先。';return `装置已选择${Number(s.ticket.output)===d().input.a?'电池A':'电池B'}，去对应出口取样。`;}
  if(!s.measured)return `到温度探头，读取${s.temperatureCase}℃试运行数据。`;
  if(!s.ticket)return '在控制柜设置规则、预测，再到风机执行。';
  return '风机已执行，到现场监测屏核验结果。';
 }
 function say(text){$('#scene-toast').textContent=text;s.lastFeedback=text;scheduleSave();}
 function closeDialogue(){dialogueOpen=false;$('#npc-dialogue').hidden=true;canvas.focus({preventScroll:true});}
 function dialogue(name,text,html='',handlers={}){
  if(disposed)return;path=[];afterMove=null;walking=false;dialogueOpen=true;$('#npc-dialogue').hidden=false;
  $('#npc-content').innerHTML=`<p class="npc-name">${esc(name)}</p><p class="npc-speech">${esc(text)}</p><div class="npc-choices">${html}</div>`;
  for(const [key,fn] of Object.entries(handlers))root.querySelectorAll(`[data-choice="${key}"]`).forEach(b=>b.onclick=fn);
  $('#close-dialogue').focus({preventScroll:true});scheduleSave();
 }
 const button=(key,text,cls='')=>`<button data-choice="${key}" class="${cls}">${esc(text)}</button>`;
 function input(){if(cross)return{facility:!!s.facility};if(minimum)return s.pair==='pair-b'?{a:9,b:2}:{a:3,b:8};return{temperature:s.temperatureCase||30};}
 function evaluated(){return window.BranchRules.evaluate(id,d().config,input());}
 function guide(){
  mark('npc');
  if(s.phase==='start'){
   s.phase='assigned';if(repair)mark('inspect');
   dialogue(repair?'维修员阿诚':cross?'安全员林姐':minimum?'能源工程师':'园区养护员',({sale:'欢迎加入智慧园区调试组。温室的试运行规则是：温度达到30℃就启动风机，否则停机。请你读取传感器、设置设备，再亲自核验29、30、31℃三种情况。',repair:'设备原本判断“温度＜30℃”，成立就停机，否则开机。有人把条件改成“≥30℃”，却保留了旧出口。先用30℃重现故障，再修复，别急着改。',cross:'园区规则：附近有可用天桥就走天桥；没有则到斑马线，按信号通行。你要在两种现场条件下核验指引。先到观察点，再设置指引牌。',minimum:'两组巡检电池只有一个充电口，低电量的一组应先充。请分别读取A、B电量，让分配器比较两个数，只送出较小的一组。'})[id],button('start','接受委托，去现场','primary'),{start:()=>{closeDialogue();say(objective());}});return;
  }
  const runs=host.getRuns();const ready=(()=>{try{return window.BranchRules.validateComplete(id,d().config,runs,({sale:'boundary',repair:'swap',cross:'one',minimum:'compare'})[id],host.getEvidenceStart()).passed;}catch{return false;}})();
  if(ready){explain();return;}
  const options=minimum?button('pair-a','领取样本一：A=3%，B=8%')+button('pair-b','领取样本二：A=9%，B=2%'):cross?button('open','核验东门：现场有天桥')+button('closed','核验西门：现场无天桥'):button('sensor','去温度探头读取下一组数据');
  dialogue(repair?'维修员阿诚':cross?'安全员林姐':minimum?'能源工程师':'园区养护员',repair&&!s.visited.includes('diagnosed')?'先读取30℃并让错误设备执行一次，监测屏会告诉你哪里不符。':minimum?'取完两个样本，到分配台设定条件。两种大小关系都要实际验证。':cross?'东门与西门使用同一条规则，现场设施不同。切换现场后请重新观察与预测。':'每个输入都是对同一规则的一次检验。30℃恰好在边界，需要特别核对。',options+button('review','我想说明原因并提交验收')+button('leave','继续巡检'),{
   'pair-a':()=>setPair('pair-a'),'pair-b':()=>setPair('pair-b'),open:()=>setFacility(true),closed:()=>setFacility(false),sensor:()=>{closeDialogue();navigate(point('sensor'));},review:explain,leave:closeDialogue
  });
 }
 function setPair(pair){s.pair=pair;s.actorId=pair;s.collected=[];s.measured=false;delete s.ticket;s.phase='assigned';s.actions=[];s.visited=s.visited.filter(v=>v!=='verified');host.onChange({input:input(),prediction:'',scene:copy(s)});closeDialogue();say('样本已准备。请到A、B两个采集台分别读取。');}
 function setFacility(value){s.facility=value;s.actorId=value?'cross-open':'cross-closed';s.measured=false;delete s.ticket;s.phase='assigned';s.actions=[];s.visited=s.visited.filter(v=>v!=='verified');host.onChange({input:input(),prediction:'',scene:copy(s)});closeDialogue();say(value?'已进入东门情境：天桥可见，请到观察点核对。':'已进入西门情境：没有天桥，请到观察点核对。');}
 function sensor(){
  if(s.phase==='start'){say('先与养护员交谈，领取试运行委托。');return;}
  const locked=repair&&!s.visited.includes('diagnosed');
  const choose=(t)=>{s.temperatureCase=t;s.actorId=`sensor${t}`;s.measured=false;delete s.ticket;host.onChange({input:input(),prediction:'',scene:copy(s)});sensor();};
  dialogue('温度传感器 · 试运行输入',`当前环境模拟为${s.temperatureCase}℃。站在探头旁读取数据，再决定设备应怎样运行。`,button('read',`读取探头：${s.temperatureCase}℃`,'primary')+(!locked?[29,30,31].map(t=>button('temp'+t,`切换到${t}℃试运行`)).join(''):'')+button('leave','关闭'),{
   read:()=>{delete s.ticket;s.measured=true;s.phase='measured';s.actions=[repair?'inspect':'measure'];mark('sensor');host.onChange({input:input(),prediction:'',scene:copy(s)});dialogue('温度传感器',`实读：${s.temperatureCase}℃。数据已送入控制柜。请你判断条件是否成立，设置设备指令并作出预测。`,button('control','去控制柜')+button('leave','继续观察'),{control:()=>{closeDialogue();navigate(point('control'));},leave:closeDialogue});},temp29:()=>choose(29),temp30:()=>choose(30),temp31:()=>choose(31),leave:closeDialogue
  });
 }
 function observe(){if(s.phase==='start'){say('先向安全员领取任务。');return;}delete s.ticket;s.measured=true;s.phase='measured';s.actions=['observe'];host.onChange({input:input(),prediction:'',scene:copy(s)});dialogue('现场观察',s.facility?'你看见一座可用的过街天桥，通向对面步道。':'这一处没有天桥。下方有斑马线与信号灯。',button('sign','去设置指引牌')+button('leave','继续观察'),{sign:()=>{closeDialogue();navigate(point('control'));},leave:closeDialogue});}
 function collect(which){
  if(s.phase==='start'){say('先向能源工程师领取任务。');return;}
  if(s.ticket){const selected=Number(s.ticket.output)===input().a?'a':'b';if(which!==selected){say('这个出口没有待充电电池。请根据分配器实际选中的出口去取样。');mark('route-mismatch');return;}s.phase='charging';mark('route');closeDialogue();say(`已取到电池${which.toUpperCase()}（${input()[which]}%），带到充电口核验。`);return;}
  s.collected||=[];if(!s.collected.includes(which))s.collected.push(which);s.measured=s.collected.length===2;s.phase=s.measured?'measured':'collecting';host.onChange({input:input(),scene:copy(s)});dialogue(`电池${which.toUpperCase()}采集台`,`巡检电池${which.toUpperCase()}剩余电量${input()[which]}%。${s.measured?'两组数据齐了，到分配台决定哪一组先充。':'还要到另一采集台读取另一组。'}`,button('leave','收好样本，继续'),{leave:closeDialogue});
 }
 function control(){
  if(!s.measured){say(minimum?'先到A、B两处读取电量样本。':cross?'先到观察点核对设施。':'先到温度探头读取本组数据。');return;}
  const config=d().config;const locked=repair&&!s.visited.includes('diagnosed');
  const values=cross?[['bridge','走天桥'],['crossing','走斑马线']]:minimum?[['a','选择电池A'],['b','选择电池B']]:[['on','启动风机'],['off','停止风机']];
  const operators=minimum?[['<','a＜b'],['>','a＞b']]:[['>=','温度≥30℃'],['<','温度＜30℃']];
  const handlers={};
  const chips=(field,choices)=>choices.map(([value,label],i)=>{const key=`${field}${i}`;handlers[key]=()=>{if(field==='prediction'){delete s.ticket;host.onChange({prediction:value,scene:copy(s)});s.phase='ready';}else{const next={...d().config,[field]:value};delete s.ticket;host.onChange({config:next,scene:copy(s)});}control();};return button(key,label,(field==='prediction'?d().prediction:config[field])===value?'chosen':'');}).join('');
  let html=locked?`<div class="device-rule">当前故障规则：温度≥30℃<br>是→停止风机　否→启动风机</div>`:`<div class="device-rule">${!cross?`<p>判断条件</p><div class="choice-row">${chips('operator',repair?[['>=','温度≥30℃']]:operators)}</div>`:'<b>附近有可用天桥吗？</b>'}<p>条件成立 → 是</p><div class="choice-row">${chips('yes',values)}</div><p>条件不成立 → 否</p><div class="choice-row">${chips('no',values)}</div></div>`;
  html+=`<p class="prediction-prompt">${minimum?`A=${input().a}%，B=${input().b}%，装置会选择哪组？`:cross?'按照你设定的规则，本次会指向哪条路？':`本次温度${input().temperature}℃，实际设备会怎样？`}</p><div class="choice-row">${chips('prediction',values)}</div>`;
  html+=button('execute',minimum?'启动分配器':cross?'应用这条指引':'去风机执行','primary')+button('leave','关闭，继续观察');
  handlers.execute=()=>{if(!d().prediction){say('先作出自己的预测，再执行设备。');return;}try{evaluated();}catch(e){say(e.message);return;}closeDialogue();if(cross||minimum)execute();else navigate(point('fan'));};handlers.leave=closeDialogue;
  dialogue(minimum?'电量分配台':cross?'现场指引牌':'通风控制柜',locked?'这是原错误设备。先保留当前规则，用30℃重现故障。':'这里设置的是设备会实际执行的规则。每条出口对应一个动作，选择后到现场观察。',html,handlers);
 }
 function execute(){
  if(!s.measured||!d().prediction){say('先读取输入，在控制柜预测，再执行。');return;}
  try{s.ticket=evaluated();if(!cross&&!minimum)s.deviceOutput=s.ticket.output;s.phase=cross?'route':minimum?'pickup':'verify';mark('execute');persist();closeDialogue();say(objective());}catch(e){say(e.message);}
 }
 function verify(outcome='arrived'){
  if(!s.ticket){say('还没有本次设备结果，请先操作控制柜和设备。');return;}
  if(cross&&outcome!=='blocked'&&distance(s,ROAD_NODES.right)>75){say('先亲自沿指引到达对岸，再来核验。');return;}
  if(cross&&outcome==='blocked'&&(s.facility||s.ticket.output!=='bridge')){say('本次没有通道受阻证据。');return;}
  if(minimum&&s.phase!=='charging'){say('先去分配器选中的出口取出电池，再接入充电口。');return;}
  const actions=minimum?['collect','predict','route','verify']:cross?['observe','predict','route',outcome==='blocked'?'blocked':'verify']:repair?['inspect','predict','ticket','gate']:['measure','predict','ticket','gate'];
  const result=host.onExperiment({input:input(),prediction:d().prediction,sceneEvidence:{version:1,station:id,actorId:s.actorId,actions,destination:s.ticket.output,prediction:d().prediction,...(cross?{outcome}:{}),}});
  if(!result)return;
  if(repair&&input().temperature===30&&!result.correct)mark('diagnosed');
  const text=minimum?`实际选中${result.output}%电量的电池。${result.correct?'确实是较低的一组，可以先充电。':'这不是较低的一组，充电口暂不接入，请检查比较条件与出口。'}`:cross?(outcome==='blocked'?'现场没有天桥，设备却指向天桥。你留在安全侧，未过街；这条指引不能执行，请修订条件对应的出口。':`现场条件${result.condition?'成立':'不成立'}，指引走${labelOut(result.output)}。${result.correct?'这次路线与园区规则一致。':'这次指引与园区规则不符，请修订。'}`):`${input().temperature}℃使条件${result.condition?'成立':'不成立'}，风机实际${result.output==='on'?'启动':'停机'}。${result.correct?'符合本园试运行规则。':'与规定结果不符，请检查对应出口。'}`;
  mark('verified');s.lastFeedback=text;s.phase='measured';delete s.ticket;s.actions=[];host.onChange({prediction:'',scene:copy(s)});refresh();
  dialogue(minimum?'充电口反馈':cross?'对岸核验员':'现场监测屏',text,button('continue','继续检验其他输入')+button('review','向NPC汇报与验收'),{continue:closeDialogue,review:explain});
 }
 function explain(){
  if(host.getLevel()?.valid){dialogue('验收负责人','你已经用不同输入检验了本轮方案，现场记录与理由都已保存。',button('next','前往下一项任务','primary')+button('leave','留在园区继续试验'),{next:()=>host.onNext(),leave:closeDialogue});return;}
  const choices=host.reasons||[];const handlers={leave:closeDialogue};
  const html=choices.map(([value,label],i)=>{handlers['reason'+i]=()=>{host.onReason(value);const result=host.onComplete();if(disposed)return;dialogue('验收负责人',result?.feedback||'已记录本次汇报。',button('leave','关闭，继续现场核验'),{leave:closeDialogue});};return button('reason'+i,label);}).join('')+button('leave','先回现场再检查');
  dialogue('验收负责人',({sale:'请结合29、30、31℃的现场结果，解释边界为什么这样处理。',repair:'你修改了什么？为什么改变条件方向后，出口也需要调整？',cross:'你怎样根据现场条件选择唯一一条指引？',minimum:'为什么比较后只给其中一组电池优先充电？'})[id],html,handlers);
 }
 function signal(){dialogue('信号控制箱 · 教学仿真',`现在是${s.signal==='green'?'绿灯':'红灯'}。此控制箱供试运行切换信号，现实过街须遵守现场信号。`,button('red','切换红灯')+button('green','切换绿灯')+button('leave','关闭'),{red:()=>{s.signal='red';persist();closeDialogue();say('红灯已亮，斑马线暂不可通行。');},green:()=>{s.signal='green';persist();closeDialogue();say('绿灯已亮，可到斑马线入口核验指引。');},leave:closeDialogue});}
 function route(which){
  if(!s.ticket){say('先观察现场，再在指引牌设置并预测。');return;}
  if(s.ticket.output!==which){say('你选择的通道与指引牌输出不同。先核对设备选择了哪个出口。');mark('route-mismatch');return;}
  if(which==='bridge'&&!s.facility){say('这里没有天桥，指引让你走到了断路。你留在安全侧。');verify('blocked');return;}
  if(which==='crossing'&&s.signal!=='green'){say('红灯，先停在人行道。可以到仿真信号控制箱切换后再测试。');return;}
  closeDialogue();selectedRoute=which;s.phase='travelling';
  const list=which==='bridge'?[ROAD_NODES.bridgeL,ROAD_NODES.bridgeM,ROAD_NODES.bridgeR,ROAD_NODES.right]:[ROAD_NODES.zebraL,ROAD_NODES.zebraM,ROAD_NODES.zebraR,ROAD_NODES.right];
  path=list.filter(p=>p.x>=s.x-25);afterMove=()=>{s.phase='arrived';mark('crossed');selectedRoute=null;persist();say('已到达对岸。点击核验点，检查现场结果。');};persist();
 }
 function point(kind){return entries.find(p=>p.kind===kind)||entries[0];}
 function buildEntries(){
  if(cross)entries.push({kind:'guide',x:275,y:480,label:'安全员',sprite:8,action:guide},{kind:'observe',x:335,y:405,label:'观察现场',action:observe},{kind:'control',x:320,y:465,label:'设置指引牌',action:control},{kind:'bridge',x:355,y:295,label:'天桥入口',action:()=>route('bridge')},{kind:'zebra',x:355,y:532,label:'斑马线入口',action:()=>route('crossing')},{kind:'signal',x:370,y:475,label:'信号控制箱',action:signal},{kind:'verify',x:890,y:420,label:'对岸核验',sprite:10,action:verify});
  else if(minimum)entries.push({kind:'guide',x:340,y:245,label:'能源工程师',sprite:9,action:guide},{kind:'a',x:215,y:165,label:'电池A采集台',action:()=>collect('a')},{kind:'b',x:375,y:165,label:'电池B采集台',action:()=>collect('b')},{kind:'control',x:300,y:175,label:'电量分配台',action:control},{kind:'verify',x:300,y:235,label:'充电口核验',action:verify});
  else if(repair)entries.push({kind:'guide',x:800,y:280,label:'维修员阿诚',sprite:7,action:guide},{kind:'sensor',x:760,y:210,label:'温度探头',action:sensor},{kind:'control',x:875,y:190,label:'故障控制柜',action:control},{kind:'fan',x:965,y:185,label:'执行风机',action:execute},{kind:'verify',x:940,y:265,label:'监测屏核验',action:verify});
  else entries.push({kind:'guide',x:380,y:465,label:'园区养护员',sprite:6,action:guide},{kind:'sensor',x:285,y:325,label:'温度探头',action:sensor},{kind:'control',x:235,y:435,label:'通风控制柜',action:control},{kind:'fan',x:160,y:375,label:'执行风机',action:execute},{kind:'verify',x:360,y:375,label:'监测屏核验',action:verify});
  $('#scene-hotspots').innerHTML=entries.map((p,i)=>`<button class="world-hotspot" data-place="${i}" data-kind="${p.kind}" aria-label="走近${esc(p.label)}">${esc(p.label)}</button>`).join('');
  root.querySelectorAll('[data-place]').forEach(b=>b.onclick=()=>{closeDialogue();const p=entries[Number(b.dataset.place)];if(cross&&p.kind==='verify'&&s.x<700){say('先从天桥或斑马线入口沿规则过街，不能直接跳到对岸。');return;}navigate(p,()=>p.action());});
 }
 function project(p){let best=null,dist=Infinity;const nodes=baseGraph();for(const[a,b]of edges()){const q=nearestPointOnSegment(p,nodes[a],nodes[b]);const d=distance(p,q);if(d<dist){best=q;dist=d;}}return best||start;}
 function walkable(p){return p.x>15&&p.x<W-15&&p.y>20&&p.y<H-10&&distance(p,project(p))<45&&(!cross||p.x<400||p.x>820||selectedRoute||s.phase==='travelling'||s.phase==='arrived'||s.visited.includes('crossed'));}
 function navigate(target,done){
  if(disposed)return;closeDialogue();keys.clear();
  if(cross&&s.x<400&&target.x>820&&!selectedRoute&&!s.visited.includes('crossed')){say('请先选择实际通道，沿安全路径到对岸。');return;}
  const targetPoint={x:target.x,y:target.y};path=findRoute(baseGraph(),edges(),s,targetPoint);afterMove=done||null;
  if(!path.length){say('这条路暂时不通，请留意设施和信号。');return;}say(`正在走向${target.label||'所选步道'}，可随时停下。`);
 }
 function layoutCamera(){
  const box=stage.getBoundingClientRect(),mobile=box.width<700;
  scale=mobile?Math.max(box.width/560,box.height/H):Math.min(box.width/W,box.height/H);ox=mobile?Math.min(0,Math.max(box.width-W*scale,box.width/2-s.x*scale)):(box.width-W*scale)/2;oy=(box.height-H*scale)/2;
  const placed=[];labelAnchors=[];const minY=mobile?145:100,maxY=box.height-125;
  root.querySelectorAll('[data-place]').forEach(b=>{
   const p=entries[Number(b.dataset.place)],anchorX=ox+p.x*scale,anchorY=oy+(p.y-74)*scale;
   if(anchorX<12||anchorX>box.width-12){b.style.visibility='hidden';return;}
   const width=b.offsetWidth||70,height=b.offsetHeight||24,candidates=[];
   for(const dy of [0,32,64,96,128,-32,-64,-96])for(const dx of [0,-85,85,-170,170]){const x=Math.max(width/2+8,Math.min(box.width-width/2-8,anchorX+dx)),y=Math.max(minY+height,Math.min(maxY,anchorY+dy));candidates.push({x,y,cost:Math.hypot(x-anchorX,y-anchorY)});}
   const fits=c=>!placed.some(r=>c.x-width/2<r.right+5&&c.x+width/2>r.left-5&&c.y>r.top-5&&c.y-height<r.bottom+5);
   const chosen=candidates.sort((a,b)=>a.cost-b.cost).find(fits)||candidates[0];
   b.style.left=`${chosen.x}px`;b.style.top=`${chosen.y}px`;b.style.visibility='visible';placed.push({left:chosen.x-width/2,right:chosen.x+width/2,top:chosen.y-height,bottom:chosen.y});labelAnchors.push({point:p,x:(chosen.x-ox)/scale,y:(chosen.y-oy)/scale});
  });
 }
 function resize(){const box=stage.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(box.width*ratio);canvas.height=Math.round(box.height*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);layoutCamera();}
 function sprite(index,x,y,height=80){if(!assets.people?.complete||!assets.people.naturalWidth){ctx.fillStyle='#147d78';ctx.beginPath();ctx.arc(x,y-22,17,0,Math.PI*2);ctx.fill();return;}const [sx,sy,sw,sh]=SRC[index];const width=height*sw/sh;ctx.fillStyle='#0003';ctx.beginPath();ctx.ellipse(x,y-2,width*.4,6,0,0,Math.PI*2);ctx.fill();ctx.drawImage(assets.people,sx,sy,sw,sh,x-width/2,y-height,width,height);}
 function text(value,x,y,color='#173c3a',size=16){ctx.font=`600 ${size}px "PingFang SC",sans-serif`;ctx.textAlign='center';ctx.fillStyle=color;ctx.fillText(value,x,y);}
 function drawDevice(x,y,type){ctx.save();ctx.translate(x,y);if(type==='fan'){ctx.fillStyle='#eef9f3';ctx.strokeStyle='#367265';ctx.lineWidth=4;ctx.fillRect(-32,-67,64,64);ctx.strokeRect(-32,-67,64,64);ctx.translate(0,-35);if((s.deviceOutput||s.ticket?.output||host.getRuns().at(-1)?.output)==='on')ctx.rotate(reducedMotion?Math.PI/4:walkTime*5);for(let i=0;i<4;i++){ctx.rotate(Math.PI/2);ctx.fillStyle='#399c87';ctx.beginPath();ctx.ellipse(0,-14,8,16,0,0,Math.PI*2);ctx.fill();}ctx.fillStyle='#183f3c';ctx.beginPath();ctx.arc(0,0,6,0,Math.PI*2);ctx.fill();}else if(type==='sensor'){ctx.fillStyle='#fff7d6';ctx.strokeStyle='#795c34';ctx.lineWidth=3;ctx.fillRect(-23,-55,46,48);ctx.strokeRect(-23,-55,46,48);text(`${s.temperatureCase}℃`,0,-25,'#174d4a',17);}else if(type==='battery'){ctx.fillStyle='#edf9fe';ctx.strokeStyle='#355b72';ctx.lineWidth=3;ctx.fillRect(-21,-55,42,45);ctx.strokeRect(-21,-55,42,45);ctx.fillStyle='#ffd76c';ctx.fillRect(-8,-62,16,7);}else{ctx.fillStyle='#ecf8ef';ctx.strokeStyle='#538276';ctx.lineWidth=3;ctx.fillRect(-27,-50,54,40);ctx.strokeRect(-27,-50,54,40);text(type==='verify'?'✓':'⚙',0,-23,'#147d78',22);}ctx.restore();}
 function draw(){
  const b=stage.getBoundingClientRect();ctx.clearRect(0,0,b.width,b.height);ctx.save();ctx.translate(ox,oy);ctx.scale(scale,scale);
  const background=cross?assets.road:assets.park;if(background?.complete&&background.naturalWidth)ctx.drawImage(background,0,0,W,H);else{ctx.fillStyle='#c5dbb0';ctx.fillRect(0,0,W,H);ctx.strokeStyle='#e9d9b4';ctx.lineWidth=85;for(const[a,b]of edges()){const nodes=baseGraph();ctx.beginPath();ctx.moveTo(nodes[a].x,nodes[a].y);ctx.lineTo(nodes[b].x,nodes[b].y);ctx.stroke();}}
  if(cross){if(s.facility){ctx.strokeStyle='#8c6e4f';ctx.lineWidth=44;ctx.beginPath();ctx.moveTo(350,295);ctx.lineTo(610,255);ctx.lineTo(870,295);ctx.stroke();ctx.strokeStyle='#e7d8b4';ctx.lineWidth=32;ctx.stroke();ctx.strokeStyle='#6c675e';ctx.lineWidth=4;for(const dy of[-21,21]){ctx.beginPath();ctx.moveTo(350,295+dy);ctx.lineTo(610,255+dy);ctx.lineTo(870,295+dy);ctx.stroke();}text('过街天桥',610,230,'#283832',23);}for(const x of[371,835]){ctx.fillStyle=s.signal==='red'?'#ec4949':'#3d3d3d';ctx.beginPath();ctx.arc(x,417,8,0,Math.PI*2);ctx.fill();ctx.fillStyle=s.signal==='green'?'#4de27e':'#3d3d3d';ctx.beginPath();ctx.arc(x,438,8,0,Math.PI*2);ctx.fill();}}
  const goal=s.phase==='start'?point('guide'):!s.measured?point(minimum?(s.collected?.includes('a')?'b':'a'):cross?'observe':'sensor'):!s.ticket?point((cross||minimum)&&s.visited.includes('verified')?'guide':!cross&&!minimum&&d().prediction?'fan':'control'):point(minimum?(s.phase==='charging'?'verify':Number(s.ticket.output)===input().a?'a':'b'):cross?(s.phase==='arrived'?'verify':s.ticket.output==='bridge'?'bridge':'zebra'):'verify');
  if(goal){ctx.strokeStyle='#ffdb67';ctx.lineWidth=4;ctx.beginPath();ctx.ellipse(goal.x,goal.y-2,29+Math.sin(walkTime*3)*3,12,0,0,Math.PI*2);ctx.stroke();}
  ctx.strokeStyle='#765d3eaa';ctx.lineWidth=1.5;for(const a of labelAnchors){if(distance({x:a.x,y:a.y},a.point)>78){ctx.beginPath();ctx.moveTo(a.point.x,a.point.y-42);ctx.lineTo(a.x,a.y+5);ctx.stroke();}}
  for(const p of entries){if(p.sprite!==undefined)sprite(p.sprite,p.x,p.y,86);else if(p.kind==='fan'||p.kind==='sensor')drawDevice(p.x,p.y,p.kind);else if(minimum&&['a','b'].includes(p.kind)){drawDevice(p.x,p.y,'battery');text(`${p.kind.toUpperCase()} ${input()[p.kind]}%`,p.x,p.y+16,'#173e3a',18);}else if(['control','verify'].includes(p.kind))drawDevice(p.x,p.y,p.kind);}
  if(path.length){ctx.strokeStyle='#fff9';ctx.lineWidth=3;ctx.setLineDash([9,9]);ctx.beginPath();ctx.moveTo(s.x,s.y);for(const p of path)ctx.lineTo(p.x,p.y);ctx.stroke();ctx.setLineDash([]);}
  const playerIndex={down:0,left:1,right:2,up:3}[s.facing]??0;const bob=walking&&!reducedMotion?Math.sin(walkTime*13)*2:0;sprite(walking&&s.facing==='down'&&Math.sin(walkTime*8)>0?11:playerIndex,s.x,s.y+bob,82);text('我 · 调试员',s.x,s.y+18,'#fff',16);
  if(minimum&&(s.collected||[]).length)text(s.phase==='charging'?`携带${s.ticket?.output}%电池`:`样本：${s.collected.join('、').toUpperCase()}`,s.x,s.y-92,'#fff',15);
  ctx.restore();
 }
 function refresh(){if(disposed)return;$('#scene-objective').textContent=objective();const runs=host.getRuns().slice(host.getEvidenceStart()).filter(r=>{try{return window.BranchRules.configKey(id,r.config)===window.BranchRules.configKey(id,d().config);}catch{return false;}});$('#scene-review').textContent=s.phase==='start'?'找到现场负责人':'找NPC汇报与验收';$('#scene-progress').textContent=`本方案已核验${runs.length}次 · 本关${host.getLevel()?.completed?'已获25积分':'待验收'}`;$('#scene-readout').textContent=cross?`${s.facility?'东门：有天桥':'西门：无天桥'} · ${s.signal==='green'?'绿灯':'红灯'}`:minimum?`样本组：A=${input().a}%，B=${input().b}%`:`试运行输入：${s.temperatureCase}℃ · ≥30℃启动，否则停机`;$('#scene-log').innerHTML=host.getRuns().slice().reverse().map(r=>`<p>${esc(window.AdventureRules?.evidenceSummary(id,r)||JSON.stringify(r.input))}<b class="${r.correct?'ok':'error'}">${r.correct?'符合规则':'需要修订'}</b></p>`).join('')||'<p>完成一次现场核验后，这里自动留下实验。</p>';}
 function tick(now){if(disposed)return;const dt=Math.min((now-lastTime)/1000||0,.05);lastTime=now;walkTime+=dt;let moved=false;
  if(!dialogueOpen&&keys.size){path=[];afterMove=null;const dx=(keys.has('right')?1:0)-(keys.has('left')?1:0),dy=(keys.has('down')?1:0)-(keys.has('up')?1:0);const len=Math.hypot(dx,dy)||1;const next={x:s.x+dx/len*210*dt,y:s.y+dy/len*210*dt};if(walkable(next)){s.x=next.x;s.y=next.y;moved=!!(dx||dy);}if(dx||dy)s.facing=Math.abs(dx)>Math.abs(dy)?dx>0?'right':'left':dy>0?'down':'up';
  }else if(!dialogueOpen&&path.length){const next=moveTowards(s,path[0],220*dt);const dx=next.x-s.x,dy=next.y-s.y;s.facing=Math.abs(dx)>Math.abs(dy)?dx>0?'right':'left':dy>0?'down':'up';s.x=next.x;s.y=next.y;moved=true;if(next.arrived){path.shift();if(!path.length){const fn=afterMove;afterMove=null;persist();if(fn)fn();}}}
  if(walking&&!moved){persist();}if(cross&&s.phase==='travelling'&&distance(s,ROAD_NODES.right)<45){s.phase='arrived';mark('crossed');selectedRoute=null;persist();}
  walking=moved;if(stage.clientWidth<700&&walking)layoutCamera();draw();if(now-lastHud>250){refresh();lastHud=now;}raf=requestAnimationFrame(tick);
 }
 function interactNearby(){const nearby=entries.filter(p=>distance(s,p)<65).sort((a,b)=>distance(s,a)-distance(s,b))[0];if(nearby)nearby.action();else say('先走近NPC或设备，再按E互动。');}
 const keyMap={ArrowUp:'up',w:'up',W:'up',ArrowDown:'down',s:'down',S:'down',ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right'};
 const keydown=e=>{if(disposed||/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)||document.querySelector('dialog[open]'))return;if(e.key==='Escape'){closeDialogue();return;}if(e.key==='e'||e.key==='E'){if(!dialogueOpen)interactNearby();return;}const key=keyMap[e.key];if(key&&!dialogueOpen){e.preventDefault();keys.add(key);}};
 const keyup=e=>{keys.delete(keyMap[e.key]);};
 const blur=()=>{keys.clear();path=[];afterMove=null;persist();};
 canvas.onclick=e=>{const box=canvas.getBoundingClientRect();const p=project({x:(e.clientX-box.left-ox)/scale,y:(e.clientY-box.top-oy)/scale});navigate(p);};
 $('#close-dialogue').onclick=closeDialogue;$('#stop-walk').onclick=()=>{path=[];afterMove=null;keys.clear();persist();say('已停下。当前输入和证据保留。');};$('#nearby-action').onclick=interactNearby;
 $('#scene-help').onclick=host.onHelp;$('#scene-flow').onclick=host.onFlow;$('#scene-review').onclick=()=>navigate(point('guide'),guide);
 root.querySelectorAll('[data-direction]').forEach(b=>{b.onpointerdown=e=>{e.preventDefault();closeDialogue();keys.add(b.dataset.direction);b.setPointerCapture(e.pointerId);};b.onpointerup=b.onpointercancel=()=>keys.delete(b.dataset.direction);});
 window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);window.addEventListener('blur',blur);
 const observer=new ResizeObserver(resize);observer.observe(stage);
 function image(name,file){const img=new Image();assets[name]=img;img.src=file;img.onerror=()=>say('部分场景图片未加载，操作与记录仍可继续。');}
 image('park','/assets/park-map.webp?v=2d-20261015');image('road','/assets/crossing-map.webp?v=2d-20261015');image('people','/assets/characters.webp?v=2d-20261015');
 buildEntries();resize();refresh();persist();raf=requestAnimationFrame(tick);
 return{refresh,destroy(){if(disposed)return;clearTimeout(saveTimer);persist();disposed=true;cancelAnimationFrame(raf);observer.disconnect();window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);window.removeEventListener('blur',blur);keys.clear();path=[];afterMove=null;}};
}
