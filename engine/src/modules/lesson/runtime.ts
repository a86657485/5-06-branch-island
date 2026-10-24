import { Components, EventMode, type EventDefinition, type RpgPlayer } from '@rpgjs/server';
import { getContext, request, type BridgeMethod } from '../../classroom-bridge';
import { ask, type DialogChoice } from '../../gui/ask';
import { advance, resetTrial, evidenceFor } from './experiment';
import { conditionLine, emptyFlow, emptyPredictions, emptySentence, faultSeen, repairPreset, repairSymbolHint } from '../../gui/flow-model';
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
export async function say(player:RpgPlayer,name:string,text:string,choices?:DialogChoice[]){const id=ctx().levelId,mapId=mapForContext(ctx());const current=await waitForActivePlayer(player.id,mapId);if(ctx().levelId!==id||mapForContext(ctx())!==mapId)return null;const answer=await ask(current,{name,text,choices});return ctx().levelId===id&&mapForContext(ctx())===mapId?answer:null;}
export function event(name:string,graphic:string,action:(player:RpgPlayer,event?:any)=>Promise<unknown>):EventDefinition{
 return {name,mode:EventMode.Scenario,onInit(){this.setGraphic(graphic);this.setHitbox(24,24);this.through=true;this.setComponentsTop(Components.text(name,{fill:'#163e31',fontSize:15,}));},async onAction(player:RpgPlayer){if(player.getVariable('lessonBusy'))return;player.setVariable('lessonBusy',true);try{await action(player,this);}catch(error){await say(player,name,error instanceof Error?error.message:'操作未完成，请重试。');}finally{player.setVariable('lessonBusy',false);}}};
}
export const outputChoices=()=>ctx().levelId==='cross'?[{id:'bridge',label:'走天桥'},{id:'crossing',label:'走人行横道'}]:ctx().levelId==='minimum'?[{id:'a',label:'先给电池A充电'},{id:'b',label:'先给电池B充电'}]:[{id:'on',label:'启动风机'},{id:'off',label:'关闭风机'}];
export async function predict(player:RpgPlayer){
 if(!scene().measured){await say(player,'控制柜','先去读取现场数据，再作预测。');return;}
 if(scene().ticket){await say(player,'控制柜','本次设备已执行。请先到核验点比较结果，再开始新测试。');return;}
 const id=ctx().levelId,config=ctx().draft.config||{},choices=outputChoices();
 const symbols:Record<string,string>={'>=':'≥','<':'＜','>':'＞','<=':'≤'};
 const condition=id==='cross'?'附近有可用天桥或地下通道吗':id==='minimum'?`电量A${symbols[config.operator]||config.operator}B吗`:`温度${symbols[config.operator]||config.operator}30℃吗`;
 const label=(value:string)=>choices.find(choice=>choice.id===value)?.label||'尚未设置';
 const value=await say(player,'先预测，再运行',`当前程序：判断“${condition}”；成立时${label(config.yes)}，不成立时${label(config.no)}。\n现场输入：${id==='cross'?(input().facility?'附近有可用天桥':'附近没有天桥'):id==='minimum'?`A剩余${input().a}%，B剩余${input().b}%`:`温度${input().temperature}℃`}。\n沿当前程序想一想：这次会执行哪项操作？`,choices);if(!value)return;
 await rpc('predict',{value,input:input(),config:ctx().draft.config});await patchScene(player,{...advance(scene(),'predict')});
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
 },{waitingAction:true,blockPlayerInput:true}) as {action?:string,predictions?:{locked?:boolean,[key:string]:unknown}} | null;
 if(!result||result.action==='close')return;
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
 await say(player,'程序已执行',`${result.trace.join('\n')}\n${thermal?'请走到核验仪旁比较任务目标。':'请按选中分支亲自完成操作，再去核验。'}`);return true;
}
export async function record(player:RpgPlayer,finalStep:string,outcome?:string){
 const s=scene(),id=ctx().levelId;if(!s.ticket)throw new Error('当前还没有执行结果。先读取、预测并运行。');
 const next=advance(s,finalStep);const evidence=evidenceFor(id,next,s.ticket.output,ctx().draft.prediction,outcome);
 const result=await rpc('experiment',{input:input(),prediction:ctx().draft.prediction,sceneEvidence:evidence});
 if(!result)throw new Error('本次实验没有保存，请重试核验。');
 const hint=!result.correct&&input().temperature===30?repairSymbolHint(ctx().draft.config):'';
 let feedbackNext=result.correct?'到负责人那里换下一种现场，再读取、预测和运行。':'回控制柜检查条件和两个出口，再重新测试。';
 if(canReview())feedbackNext='本站需要的情况已经测齐，到负责人那里说明你的发现。';
 else if(result.correct&&(id==='sale'||id==='repair')){const temperature=[29,30,31].find(value=>!currentRuns().some(run=>run.input?.temperature===value&&run.correct));feedbackNext=`到温度探头${temperature?`采样${temperature}℃`:'重新读数'}，继续检验当前程序。`;}
 const message=`${outcome==='blocked'?'通道受阻，你留在安全侧。':''}条件${result.condition?'成立':'不成立'}，只执行${result.branch==='yes'?'成立':'不成立'}分支。${result.correct?'符合任务约定。':'这次结果与任务约定不符。'}${result.correct?'':`\n你的条件：${conditionLine(result)}`}${hint?`\n${hint}`:''}\n下一步：${feedbackNext}`;
 const clean:Record<string,any>={...s,actions:[],phase:'assigned',measured:false,lastFeedback:message,visited:[...new Set([...(s.visited||[]),'verified'])],...(id==='minimum'?{collected:[]}:{})};delete clean.ticket;
 await commitScene(player,clean,{prediction:''});await say(player,'现场核验',message);return result;
}
export async function review(player:RpgPlayer){
 const reasons=ctx().reasons.map((r:any)=>Array.isArray(r)?{id:r[0],label:r[1]}:{id:r.value,label:r.label});
 const value=await say(player,'验收负责人','请结合自己的运行记录，说明判断条件与执行分支的关系。不同情况都需要测试。',reasons);if(!value)return;
 await rpc('reason',{value});const result=await rpc('complete');
 const next=await say(player,'验收记录',result.feedback,result.passed?[{id:'next',label:ctx().levelId==='minimum'?'进入独立检测':'领取下一站委托'}]:undefined);if(next==='next')await rpc('next');
}
export function portal(){return event('下一站','portal',async player=>{if(ctx().levelId==='sale'){await say(player,'任务通道',ctx().level.completed?'返修就在这间温室。沿箭头走到维修员那里，不用传送。':'请先完成现场测试，并向负责人汇报。');return;}if(!ctx().level.completed){await say(player,'任务通道','请先完成现场测试，并向负责人汇报。');return;}const value=await say(player,'任务通道','本项委托已完成，继续下一项巡检。',[{id:'next',label:'出发'}]);if(value==='next')await rpc('next');});}
