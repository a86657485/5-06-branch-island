import { Components, EventMode, type EventDefinition, type RpgPlayer } from '@rpgjs/server';
import { getContext, request, type BridgeMethod } from '../../classroom-bridge';
import { ask, type DialogChoice } from '../../gui/ask';
import { advance, resetTrial, evidenceFor } from './experiment';
import { conditionLine, emptyFlow, emptyPredictions, emptySentence, faultSeen, repairPreset } from '../../gui/flow-model';
import { waitForActivePlayer,mapForContext } from './active-player';
export const ctx=()=> {const value=getContext();if(!value)throw new Error('课堂正在连接，请稍候。');return value;};
export function scene():Record<string,any>{return ctx().draft.scene;}
export function input(){const s=scene(),id=ctx().levelId;return id==='cross'?{facility:!!s.facility}:id==='minimum'?(s.pair==='pair-b'?{a:9,b:2}:{a:3,b:8}):{temperature:s.temperatureCase||30};}
export async function rpc<T=any>(method:BridgeMethod,payload:Record<string,any>={}) {const levelId=ctx().levelId;const result=await request<T>(method,{levelId,...payload});if(ctx().levelId!==levelId&&method!=='next')throw new Error('任务已切换，请继续当前场景。');return result;}
export async function patchScene(player:RpgPlayer,patch:Record<string,any>){const next={...scene(),...patch};const result=await rpc('change',{patch:{scene:next,input:inputFor(next)}});player.syncChanges();return result;}
function inputFor(s:Record<string,any>){const id=ctx().levelId;return id==='cross'?{facility:!!s.facility}:id==='minimum'?(s.pair==='pair-b'?{a:9,b:2}:{a:3,b:8}):{temperature:s.temperatureCase||30};}
export async function clearPending(player:RpgPlayer,patch:Record<string,any>={}) {const s={...resetTrial(scene()),phase:'assigned',...patch};const result=await rpc('change',{patch:{scene:s,input:inputFor(s),prediction:''}});player.syncChanges();return result;}
export async function say(player:RpgPlayer,name:string,text:string,choices?:DialogChoice[]){const id=ctx().levelId,mapId=mapForContext(ctx());const current=await waitForActivePlayer(player.id,mapId);if(ctx().levelId!==id||mapForContext(ctx())!==mapId)return null;const answer=await ask(current,{name,text,choices});return ctx().levelId===id&&mapForContext(ctx())===mapId?answer:null;}
export function event(name:string,graphic:string,action:(player:RpgPlayer,event?:any)=>Promise<unknown>):EventDefinition{
 return {name,mode:EventMode.Scenario,onInit(){this.setGraphic(graphic);this.setHitbox(24,24);this.through=true;this.setComponentsTop(Components.text(name,{fill:'#163e31',fontSize:15,}));},async onAction(player:RpgPlayer){if(player.getVariable('lessonBusy'))return;player.setVariable('lessonBusy',true);try{await action(player,this);}catch(error){await say(player,name,error instanceof Error?error.message:'操作未完成，请重试。');}finally{player.setVariable('lessonBusy',false);}}};
}
export const outputChoices=()=>ctx().levelId==='cross'?[{id:'bridge',label:'走天桥'},{id:'crossing',label:'走人行横道'}]:ctx().levelId==='minimum'?[{id:'a',label:'先给电池A充电'},{id:'b',label:'先给电池B充电'}]:[{id:'on',label:'启动风机'},{id:'off',label:'关闭风机'}];
export async function predict(player:RpgPlayer){
 if(!scene().measured){await say(player,'控制柜','先去读取现场数据，再作预测。');return;}
 if(scene().ticket){await say(player,'控制柜','本次设备已执行。请先到核验点比较结果，再开始新测试。');return;}
 const value=await say(player,'先预测，再运行',`现场输入：${ctx().levelId==='cross'?(input().facility?'附近有可用天桥':'附近没有天桥'):ctx().levelId==='minimum'?`A剩余${input().a}%，B剩余${input().b}%`:`温度${input().temperature}°C`}。按你当前设置的条件和两个分支，设备会执行哪项操作？`,outputChoices());if(!value)return;
 await rpc('predict',{value,input:input(),config:ctx().draft.config});await patchScene(player,{...advance(scene(),'predict')});
}
export async function configure(player:RpgPlayer){
 if(scene().ticket){await say(player,'本次结果待核验','本次程序已执行，请先走到核验点保存实际结果，再修改程序。');return;}
 const id=ctx().levelId;
 if(!scene().measured && id!=='cross'){await say(player,'控制柜','先读取现场输入。');return;}
 const mode=id==='repair'?'repair':id==='cross'?'cross':id==='minimum'?'minimum':'sale';
 const diagnosed=faultSeen(ctx().runs);
 const result=await player.gui('flow-panel').open({
  mode,
  flow:ctx().draft.flow||(mode==='repair'?repairPreset():emptyFlow()),
  sentence:ctx().draft.sentence||emptySentence(mode),
  predictions:ctx().draft.predictionsLocked||emptyPredictions(),
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
 const message=`条件${result.condition?'成立':'不成立'}，只执行${result.branch==='yes'?'成立':'不成立'}分支。${result.correct?'符合任务目标。':'实际结果与任务目标不符，请检查条件及分支配置。'}${result.correct?'':`\n你的条件：${conditionLine(result)}`}`;
 const clean:Record<string,any>={...s,actions:[],phase:'assigned',measured:false,lastFeedback:message,visited:[...new Set([...(s.visited||[]),'verified'])]};delete clean.ticket;
 await rpc('change',{patch:{scene:clean,prediction:''}});player.syncChanges();await say(player,'现场核验',message);return result;
}
export async function review(player:RpgPlayer){
 const reasons=ctx().reasons.map((r:any)=>Array.isArray(r)?{id:r[0],label:r[1]}:{id:r.value,label:r.label});
 const value=await say(player,'验收负责人','请结合自己的运行记录，说明判断条件与执行分支的关系。不同情况都需要测试。',reasons);if(!value)return;
 await rpc('reason',{value});const result=await rpc('complete');
 const next=await say(player,'验收记录',result.feedback,result.passed?[{id:'next',label:ctx().levelId==='minimum'?'进入独立检测':'领取下一站委托'}]:undefined);if(next==='next')await rpc('next');
}
export function portal(){return event('下一站','portal',async player=>{if(!ctx().level.completed){await say(player,'任务通道','请先完成现场测试，并向负责人汇报。');return;}const value=await say(player,'任务通道','本项委托已完成，继续下一项巡检。',[{id:'next',label:'出发'}]);if(value==='next')await rpc('next');});}
