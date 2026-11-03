import { assistedTarget, toolHint } from './task-guidance.mjs';
const STATIONS = ['sale','repair','cross','minimum'];
const OPERATORS = {'>=':'ge30','<':'lt30','>':'gt30','<=':'le30'};

function validInput(id,input) {
 if(!input || typeof input!=='object')return false;
 if(id==='cross')return typeof input.facility==='boolean';
 if(id==='minimum')return Number.isFinite(input.a)&&Number.isFinite(input.b)&&input.a!==input.b;
 return Number.isFinite(input.temperature);
}
function inputKey(id,input) {
 return JSON.stringify(id==='cross'?{facility:input.facility}:id==='minimum'?{a:input.a,b:input.b}:{temperature:input.temperature});
}
function presetFault(state,id,{input,config,result}) {
 const draft=state.drafts?.repair||{};
 return id==='repair'&&input.temperature===30&&config.operator==='>='&&config.yes==='off'&&config.no==='on'&&result.correct===false&&!draft.diagnoseAnswer&&draft.flow?.preset!==false;
}
function shortLines(text) {
 const clauses=String(text).split(/(?<=[。！？；，])/u).filter(Boolean);
 return clauses.flatMap(clause=>{const letters=[...clause],parts=[];for(let i=0;i<letters.length;i+=25)parts.push(letters.slice(i,i+25).join(''));return parts;});
}
function scaffoldContent(id,input,config,result,kind,level) {
 if(kind==='reason') {
  if(level===1)return {lines:['对照刚才的运行，想想理由是否一致。'],target:{focusKey:'result'},step:{phase:'reason'}};
  if(level===2)return {lines:['先看条件成立没有。','再看这次只执行了哪一个动作。'],target:{focusKey:'condition'},step:{phase:'reason'}};
  const step={phase:'reason'},hint=toolHint(id,{config,input},step);
  return {lines:[...shortLines(hint.action),...shortLines(hint.why)],target:assistedTarget(id,{config,input},step),step};
 }
 if(level===1)return {lines:[id==='cross'?'看看选中的路在这里能不能走。':id==='minimum'?'看看先充的是不是电量更少的一块。':'看看风机动作和告示哪里不同。'],target:{focusKey:'result'},step:{phase:'flow'}};
 const cue=id==='cross'?(input.facility?'这里只看：附近有可用设施。':'这里只看：附近没有可用设施。'):id==='minimum'?`先比较A=${input.a}%、B=${input.b}%。`:`先比较${input.temperature}℃与30℃。`;
 if(level===2)return {lines:[cue,'先看判断句，再检查这一边的动作。'],target:{focusKey:'condition'},step:{phase:'flow'}};
 const badOperator=(id==='sale'||id==='repair')&&!['>=','<'].includes(config.operator);
 const slot=badOperator?'diamond':result.branch==='no'?'no':'yes';
 const flow={diamond:id==='cross'?'bridge-q':id==='minimum'?(config.operator==='>'?'gt':'lt'):OPERATORS[config.operator],yes:config.yes,no:config.no,locked:true};
 const draft={config,input,flow},step={phase:'flow',slot};
 const hint=toolHint(id,draft,step);
 return {lines:[...shortLines(hint.action),...shortLines(hint.why)],target:assistedTarget(id,draft,step),step};
}

/** 只接受已经发生并由规则核验的运行或理由；不扣法宝、不改学生方案。 */
export function recordScaffold(state,levelId,event) {
 if(!STATIONS.includes(levelId)||!event||!['run','reason'].includes(event.kind))return null;
 const {kind,input={},config={},result={}}=event;
 if(kind==='run'&&(!validInput(levelId,input)||typeof result.correct!=='boolean'||presetFault(state,levelId,event)))return null;
 if(kind==='reason'&&(!event.testsSatisfied||typeof result.passed!=='boolean'))return null;
 state.support||={hints:[]};state.support.hints||=[];state.support.scaffolds||=[];
 const history=state.support.scaffolds;
 const eventKey=String(event.eventKey||`${levelId}:${kind}:${history.length}`);
 const kept=history.find(entry=>entry.eventKey===eventKey);
 if(kept)return kept.level>0?kept:null;
 const caseKey=`${levelId}|${kind}|${kind==='reason'?'reason':inputKey(levelId,input)}`;
 const previous=history.findLast(entry=>entry.caseKey===caseKey);
 const correct=kind==='run'?result.correct:result.passed;
 if(correct){
  if(previous?.count)history.push({key:eventKey,eventKey,caseKey,levelId,kind,input:structuredClone(input),config:structuredClone(config),count:0,level:0,conceptual:false,at:event.at||new Date().toISOString(),lines:[],target:{},step:{phase:kind==='reason'?'reason':'flow'}});
  return null;
 }
 const count=(previous?.count||0)+1,level=Math.min(3,count);
 const entry={key:eventKey,eventKey,caseKey,levelId,kind,input:structuredClone(input),config:structuredClone(config),count,level,conceptual:level>=2,at:event.at||new Date().toISOString(),...scaffoldContent(levelId,input,config,result,kind,level)};
 history.push(entry);
 if(entry.conceptual){
  state.levels||={};state.levels[levelId]||={};state.levels[levelId].hinted=true;
  state.conceptHints||=[];state.conceptHints.push({levelId,level,evidenceKind:'scaffold',eventKey,key:caseKey,at:entry.at});
 }
 return entry;
}

/** 最新重置事件必须挡住之前的帮助，不向后捞旧的第3级答案。 */
export function currentScaffold(state,levelId,input,kind) {
 const entry=(state.support?.scaffolds||[]).findLast(item=>item.levelId===levelId&&(!kind||item.kind===kind)&&(item.kind==='reason'||!input||validInput(levelId,input)&&inputKey(levelId,item.input)===inputKey(levelId,input)));
 return entry?.level>0?entry:null;
}
