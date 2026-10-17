type Scene = Record<string, any>;
const sequences = [ ['measure','predict','ticket','gate'], ['inspect','predict','ticket','gate'], ['observe','predict','route','verify'], ['collect','predict','route','verify'] ];
export function resetTrial(scene: Scene): Scene {
 if(scene.ticket)throw new Error('本次程序已执行，请先到核验点比较并保存结果，再开始新测试。');
 const next:Scene={...scene,actions:[],measured:false};delete next.ticket;delete next.prediction;return next;
}
export function advance(scene: Scene, action: string): Scene {
 const actions=[...(scene.actions||[])];
 if(action==='predict' && actions.length===2 && actions[1]==='predict')return {...scene,actions};
 const sequence=sequences.find(list=>list[0]===(actions[0]||action));
 if(!sequence || (sequence[actions.length]!==action && !(action==='blocked'&&sequence[0]==='observe'&&actions.length===3)))throw new Error('现场操作顺序尚未完整，请先采集数据、预测，再执行和核验。');
 return {...scene,actions:[...actions,action]};
}
export function evidenceFor(id:string, scene:Scene, destination:string, prediction=scene.prediction, outcome?:string) {
 const expected=id==='sale'?sequences[0]:id==='repair'?sequences[1]:id==='cross'?sequences[2]:sequences[3];
 const actions=scene.actions||[];
 if(actions.length!==4||!expected.every((step,i)=>step===actions[i]||(i===3&&id==='cross'&&outcome==='blocked'&&actions[i]==='blocked')))throw new Error('请走到现场核验点，完成本次核验。');
 return {version:1,station:id,actorId:scene.actorId,actions:[...actions],destination,prediction,...(id==='cross'?{outcome:outcome||'arrived'}:{})};
}
