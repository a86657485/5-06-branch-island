import { Components, EventMode, type EventDefinition, type RpgPlayer } from '@rpgjs/server';
import { getContext, request, type BridgeMethod } from '../../classroom-bridge';
import { ask, type DialogChoice, type LessonDialogData } from '../../gui/ask';
import { advance, resetTrial, evidenceFor } from './experiment';
import { emptyFlow, emptyPredictions, emptySentence, faultSeen, repairPreset } from '../../gui/flow-model';
import { waitForActivePlayer,mapForContext } from './active-player';
export const ctx=()=> {const value=getContext();if(!value)throw new Error('课堂正在连接，请稍候。');return value;};
export function scene():Record<string,any>{return ctx().draft.scene;}
export function input(){const s=scene(),id=ctx().levelId;return id==='cross'?{facility:!!s.facility}:id==='minimum'?(s.pair==='pair-b'?{a:9,b:2}:{a:3,b:8}):{temperature:s.temperatureCase||30};}
export function currentRuns(){const config=ctx().draft.config||{};return ctx().runs.slice(ctx().evidenceStart||0).filter(run=>['model','operator','yes','no'].every(key=>run.config?.[key]===config[key]));}
export function canReview(){
 const id=ctx().levelId,runs=currentRuns();
 if(!runs.length||runs.some(run=>run.correct!==true))return false;
 if(id==='sale'||id==='repair')return (id!=='repair'||faultSeen(ctx().runs))&&[29,30,31].every(temperature=>runs.some(run=>run.input?.temperature===temperature));
 if(id==='cross')return [true,false].every(facility=>runs.some(run=>run.input?.facility===facility&&run.scene?.outcome==='arrived'));
 return [true,false].every(smaller=>runs.some(run=>((run.input?.a??0)<(run.input?.b??0))===smaller));
}
export async function rpc<T=any>(method:BridgeMethod,payload:Record<string,any>={}) {const levelId=ctx().levelId;const result=await request<T>(method,{levelId,...payload});if(ctx().levelId!==levelId&&method!=='next')throw new Error('任务已切换，请继续当前场景。');return result;}
function inputFor(s:Record<string,any>){const id=ctx().levelId;return id==='cross'?{facility:!!s.facility}:id==='minimum'?(s.pair==='pair-b'?{a:9,b:2}:{a:3,b:8}):{temperature:s.temperatureCase||30};}
function stageScene(next:Record<string,any>){const draft=ctx().draft;const snapshot={scene:draft.scene,sceneRev:draft.sceneRev||0};draft.scene=next;draft.sceneRev=snapshot.sceneRev+1;return snapshot;}
function restoreScene(snapshot:{scene:any,sceneRev:number}){const draft=ctx().draft;if((draft.sceneRev||0)===snapshot.sceneRev+1){draft.scene=snapshot.scene;draft.sceneRev=snapshot.sceneRev;}}
async function commitScene(player:RpgPlayer,next:Record<string,any>,extra:Record<string,any>={}){const snapshot=stageScene(next);try{const result=await rpc('change',{patch:{scene:next,input:inputFor(next),...extra}});player.syncChanges();return result;}catch(error){restoreScene(snapshot);throw error;}}
export async function patchScene(player:RpgPlayer,patch:Record<string,any>){return commitScene(player,{...scene(),...patch});}
export async function clearPending(player:RpgPlayer,patch:Record<string,any>={}){const s={...resetTrial(scene()),phase:'assigned',...patch};return commitScene(player,s,{prediction:''});}
export function feedback(text:string,detail:Record<string,any>={}){if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('lesson-feedback',{detail:{...detail,text}}));}
function supportDetail(scaffold:any){if(!scaffold)return {};const lines=scaffold.lines||[];return {...scaffold,action:scaffold.action||lines[0]||'先看看刚才的结果。',why:scaffold.why||lines.slice(1).join('')||'对照条件和现场结果，再试一次。'};}
export async function say(player:RpgPlayer,name:string,text:string,choices?:DialogChoice[],hint?:string,extra:Pick<LessonDialogData,'program'>={}){const id=ctx().levelId,mapId=mapForContext(ctx());const current=await waitForActivePlayer(player.id,mapId);if(ctx().levelId!==id||mapForContext(ctx())!==mapId)return null;const answer=await ask(current,{name,text,choices,hint,...extra});return ctx().levelId===id&&mapForContext(ctx())===mapId?answer:null;}
export function event(name:string,graphic:string,action:(player:RpgPlayer,event?:any)=>Promise<unknown>):EventDefinition{
 return {name,mode:EventMode.Scenario,onInit(){this.setGraphic(graphic);this.setHitbox(24,24);this.through=true;this.setComponentsTop(Components.text(name,{fill:'#163e31',fontSize:15,}));},async onAction(player:RpgPlayer){if(player.getVariable('lessonBusy'))return;player.setVariable('lessonBusy',true);try{await action(player,this);}catch(error){await say(player,name,error instanceof Error?error.message:'操作未完成，请重试。');}finally{player.setVariable('lessonBusy',false);}}};
}
export const outputChoices=()=>ctx().levelId==='cross'?[{id:'bridge',label:'走天桥'},{id:'crossing',label:'走人行横道'}]:ctx().levelId==='minimum'?[{id:'a',label:'先给电池A充电'},{id:'b',label:'先给电池B充电'}]:[{id:'on',label:'启动风机'},{id:'off',label:'关闭风机'}];
export async function predict(player:RpgPlayer){
 if(!scene().measured){await say(player,'控制柜','先去读取现场数据，再作预测。');return;}
 if(scene().ticket){await say(player,'控制柜','本次设备已执行。请先到核验点比较结果，再开始新测试。');return;}
 const id=ctx().levelId,config=ctx().draft.config||{},choices=outputChoices();
 const symbols:Record<string,string>={'>=':'≥','<':'＜','>':'＞','<=':'≤'};
 const condition=id==='cross'?'附近有可用设施吗':id==='minimum'?`电量A${symbols[config.operator]||config.operator}B吗`:`温度${symbols[config.operator]||config.operator}30℃吗`;
 const label=(value:string)=>choices.find(choice=>choice.id===value)?.label||'尚未设置';
 const prompt=id==='cross'?`现场${input().facility?'有':'没有'}可用设施。按屏上程序，游客会走哪一路？`:id==='minimum'?`A电量${input().a}%，B电量${input().b}%。按程序，哪块先接入？`:id==='repair'?`${faultSeen(ctx().runs)?'修后探头':'旧板'}读到${input().temperature}℃。按屏上程序，风机会怎样？`:`探头读到${input().temperature}℃。按你设的程序，风机会怎样？`;
 const program={condition,yes:label(config.yes),no:label(config.no)};
 const value=await say(player,'先预测，再运行',prompt,choices,undefined,{program});if(!value)return;
 await rpc('predict',{value,input:input(),config:ctx().draft.config});await patchScene(player,{...advance(scene(),'predict')});
}
export async function quickThermalRun(player:RpgPlayer,temperature:29|30|31,predValue?:string){
 const id=ctx().levelId;if(!['sale','repair'].includes(id))return null;
 const repair=id==='repair';
 if(scene().ticket)await record(player,'gate');
 await clearPending(player,{temperatureCase:temperature,actorId:`sensor${temperature}`});
 await patchScene(player,{phase:'measured',measured:true,actions:[repair?'inspect':'measure']});
 const lockedPred=predValue||(ctx().draft.predictionsLocked?.[temperature] as string)||ctx().draft.prediction||((ctx().draft.config?.operator==='<'?temperature<30:ctx().draft.config?.operator==='>'?temperature>30:ctx().draft.config?.operator==='<='?temperature<=30:temperature>=30)?ctx().draft.config?.yes:ctx().draft.config?.no)||'on';
 await rpc('predict',{value:lockedPred,input:{temperature},config:ctx().draft.config});
 await patchScene(player,{...advance(scene(),'predict')});
 await apply(player);
 return record(player,'gate');
}
export async function quickThermalSweep(player:RpgPlayer,predictions?:Record<string,unknown>){
 const id=ctx().levelId;if(!['sale','repair'].includes(id))return;
 const temps:Array<29|30|31>=[29,30,31];
 for(const t of temps){
  if(currentRuns().some(run=>run.input?.temperature===t&&run.correct))continue;
  const p=predictions?.[t] as string|undefined;
  const res=await quickThermalRun(player,t,p);
  if(res&&res.correct===false)break;
 }
}
export async function configure(player:RpgPlayer){
 if(scene().ticket){await say(player,'本次结果待核验','本次程序已执行，请先走到核验点保存实际结果，再修改程序。');return;}
 const id=ctx().levelId;
 const diagnosed=faultSeen(ctx().runs);
 if(id==='repair'&&!diagnosed){
  if(!scene().measured){await say(player,'控制柜','先点温度探头读取30℃，保留原程序，看看风机为什么不转。');return;}
  return scene().actions?.[1]==='predict'?apply(player):predict(player);
 }
 if(!scene().measured && id!=='cross'&&!ctx().runs.length&&!(scene().visited||[]).includes('verified')){await say(player,'控制柜','先读取现场输入。');return;}
 const mode=id==='repair'?'repair':id==='cross'?'cross':id==='minimum'?'minimum':'sale';
 const result=await player.gui('flow-panel').open({
  mode,
  measured:!!scene().measured,
  flow:ctx().draft.flow||(mode==='repair'?repairPreset():emptyFlow()),
  sentence:ctx().draft.sentence||emptySentence(mode),
  predictions:ctx().draft.predictionsLocked||emptyPredictions(),
  diagnoseAnswer:ctx().draft.diagnoseAnswer||'',
  diagnosed:mode!=='repair'||diagnosed
 },{waitingAction:true,blockPlayerInput:true}) as {action?:string,temperature?:29|30|31,predictions?:{locked?:boolean,[key:string]:unknown}} | null;
 if(!result||result.action==='close')return;
 if(result.action==='quick-temp'&&result.temperature){
  await quickThermalRun(player,result.temperature,result.predictions?.[result.temperature] as string|undefined);
  return;
 }
 if(result.action==='quick-sweep'){
  await quickThermalSweep(player,result.predictions);
  return;
 }
 if(result.action==='run'){
  if(result.predictions?.locked&&['sale','repair'].includes(id)){
   const temperature=input().temperature;
   const value=result.predictions[temperature];
   if(value){
    await rpc('predict',{value,input:input(),config:ctx().draft.config});
    if((scene().actions||[])[1]!=='predict')await patchScene(player,{...advance(scene(),'predict')});
   }
  }
  await apply(player);
 }
}
export async function apply(player:RpgPlayer){
 if(!scene().measured||!ctx().draft.prediction||scene().actions?.[1]!=='predict'){await say(player,'设备尚未执行','请先读数，并在控制柜作出本次预测。');return false;}
 if(scene().ticket){await say(player,'设备已执行','请到核验点观察本次结果。');return false;}
 const result=await rpc('evaluate',{input:input(),config:ctx().draft.config});
 const thermal=['sale','repair'].includes(ctx().levelId);
 const s=thermal?advance(scene(),'ticket'):scene();
 await patchScene(player,{...s,ticket:{output:result.output,expected:result.expected,condition:result.condition,correct:result.correct,branch:result.branch},phase:'executed',...(thermal?{deviceOutput:result.output}:{})});
 player.setVariable('deviceOutput',result.output);player.syncChanges();
 const selected=ctx().draft.config[result.branch];
 const message=thermal?`风机${result.output==='on'?'启动':'关闭'}了。去核验仪对照预测。`:ctx().levelId==='cross'?`程序选中了${result.output==='bridge'?'天桥':'人行横道'}。沿这一路去核验。`:`程序选中了电池${String(selected).toUpperCase()}。去接入它，再核验。`;
 feedback(message);return true;
}
export async function record(player:RpgPlayer,finalStep:string,outcome?:string){
 const s=scene(),id=ctx().levelId;if(!s.ticket)throw new Error('当前还没有执行结果。先读取、预测并运行。');
 const next=advance(s,finalStep);const evidence=evidenceFor(id,next,s.ticket.output,ctx().draft.prediction,outcome);
 const result=await rpc('experiment',{input:input(),prediction:ctx().draft.prediction,sceneEvidence:evidence});
 if(!result)throw new Error('本次实验没有保存，请重试核验。');
 let nextStep=result.correct?'换一种现场，再判断一次。':'回控制柜改一处，再重新测试。';
 if(canReview())nextStep='测试齐了，去找负责人。';
 else if(result.correct&&(id==='sale'||id==='repair')){const temperature=[29,30,31].find(value=>!currentRuns().some(run=>run.input?.temperature===value&&run.correct));nextStep=`再读${temperature||'一个新温度'}℃，检验另一种情况。`;}
 const selected=id==='minimum'?ctx().draft.config[result.branch]:result.output;
 const comparison=`与预测${ctx().draft.prediction===selected?'一致':'不同'}`;
 const actual=id==='cross'?`${outcome==='blocked'?'通道受阻，先留在安全侧':`实际沿${result.output==='bridge'?'天桥':'人行横道'}走到对岸`}；${comparison}，${result.correct?'符合':'不符合'}路口约定。`:id==='minimum'?`实际接入电池${String(selected).toUpperCase()}（${result.output}%）；${comparison}，${result.correct?'符合':'不符合'}低电量优先约定。`:`风机实际${result.output==='on'?'启动':'关闭'}；${comparison}，${result.correct?'符合':'不符合'}告示。`;
 const message=`${actual}${nextStep}`;
 const clean:Record<string,any>={...s,actions:[],phase:'assigned',measured:false,lastFeedback:message,visited:[...new Set([...(s.visited||[]),'verified'])],...(id==='minimum'?{collected:[]}:{})};delete clean.ticket;
 await commitScene(player,clean,{prediction:''});feedback(message,supportDetail(result.scaffold));return result;
}

export async function review(player:RpgPlayer){
 const id=ctx().levelId;
 const reasons=ctx().reasons.map((r:any)=>Array.isArray(r)?{id:r[0],label:r[1]}:{id:r.value,label:r.label});
 const prompt=id==='sale'?'阿绿问：为何测试不能漏掉刚好30℃？':id==='repair'?'老修问：旧板30℃关闭，修后能开。你改了哪里，为何这样改？':id==='cross'?'小巡问：为何每次只走选中的一路？':'小电问：为何不能一直先接电池A？';
 const value=await say(player,'验收负责人',prompt,reasons);if(!value)return;
 await rpc('reason',{value});const result=await rpc('complete');
 if(!result.passed){feedback('这次还没验收通过。对照记录再试一次。',supportDetail(result.scaffold));return;}
 const choices=id==='cross'?[{id:'next',label:'进入基础检测'},{id:'optional',label:'去储能柜选做'}]:[{id:'next',label:id==='minimum'?'进入基础检测':'领取下一站委托'}];
 const next=await say(player,'验收记录',id==='cross'?'有桥、没桥都走到对岸。三站完成，进入基础检测。':id==='minimum'?'两组都选中低电量电池。选做完成，可以回基础检测。':id==='repair'?'旧故障已留下，修后三个温度都重验通过。小巡在路口等你帮忙。':'29、30、31℃都符合告示。老修的备用板还等着验收。',choices);
 if(next==='next')await rpc('next');else if(next==='optional')await rpc('next',{optional:true});
}

export function portal(){return event('下一站','portal',async player=>{if(ctx().levelId==='sale'){await say(player,'任务通道',ctx().level.completed?'返修就在这间温室。沿箭头走到维修员那里，不用传送。':'请先完成现场测试，并向负责人汇报。');return;}if(!ctx().level.completed){await say(player,'任务通道','请先完成现场测试，并向负责人汇报。');return;}const value=await say(player,'任务通道','本项委托已完成，继续下一项巡检。',[{id:'next',label:'出发'}]);if(value==='next')await rpc('next');});}
