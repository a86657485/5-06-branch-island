import layout from '../../tiled/layout.json';
import { event,ctx,scene,input,rpc,patchScene,clearPending,say,configure,review,record,portal } from './runtime';
function events(repair:boolean){
 const p=layout[repair?'workshop':'greenhouse'].positions;
 const place=(id:string,event:any)=>({id,x:p[id][0],y:p[id][1],event});
 return [
 place('guide',event(repair?'维修工程师':'温室管理员',repair?'mechanic':'gardener',async player=>{
 const choice=await say(player,repair?'维修员老修':'园艺员阿绿',repair?'有人改过控制器，风机又乱了。我不能告诉你错在哪。先跑 30℃，亲眼看故障。找出条件与出口是否配合。请先用30°C看到故障，再修复并复验29、30、31°C。':'温室好热！菜苗都蔫了！风机不会自己判断，得靠你。告示写着达到30°C就开风机。设备要看情况决定这一次做哪件事。请补流程图，再测29、30、31°C。',[{id:'accept',label:'开始本站任务'},{id:'review',label:'根据运行记录汇报验收'}]);
 if(choice==='accept'&&scene().phase==='start')await patchScene(player,{phase:'assigned'});if(choice==='review')await review(player);
 })),
 place('sensor',event('温度探头','sensor',async player=>{
 if(scene().phase==='start'){await say(player,'温度探头','先与管理员交谈，了解设备任务。');return;}
 const choice=await say(player,'温度探头',`当前试验温度${input().temperature}°C。选择一个采样情境。温度数据为教学仿真。`,[29,30,31].map(t=>({id:String(t),label:`采样 ${t}°C`})));
 if(!choice)return;const t=Number(choice);await clearPending(player,{temperatureCase:t,actorId:`sensor${t}`});
 await patchScene(player,{phase:'measured',measured:true,actions:[repair?'inspect':'measure']});
 await say(player,'读数已采集',`探头读数：${t}°C。请走到控制柜，判断条件是否成立。`);
 })),
 place('control',event('规则控制柜','control',configure)),
 place('fan',{...event('通风风机','fan-off',async player=>{await say(player,'通风风机',`风机目前${scene().deviceOutput==='on'?'正在转动':'处于关闭状态'}。请在控制柜运行程序，再到核验仪观察本次结果。`);}),onChanges(player:any){this.setGraphic(player.getVariable('deviceOutput')==='on'?'fan-on':'fan-off');}}),
 place('verify',event('现场核验仪','monitor',async player=>{await record(player,'gate');})),
 place('portal',portal())
 ];
}
export const greenhouseEvents=events(false);
export const workshopEvents=events(true);
