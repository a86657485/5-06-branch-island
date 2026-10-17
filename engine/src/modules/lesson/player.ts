import layout from '../../tiled/layout.json';
import { Direction } from '@rpgjs/common';
import { type RpgPlayer, type RpgPlayerHooks } from '@rpgjs/server';
import { ready,subscribeContext,getContext } from '../../classroom-bridge';
import { rpc,ctx } from './runtime';
import { checkRoute } from './routes';
import { mapForContext,registerActivePlayer,clearActivePlayer } from './active-player';
const spawn=Object.fromEntries(Object.entries(layout).map(([id,m])=>[id,{x:m.positions.start[0],y:m.positions.start[1]}]));
const mapFor=mapForContext;
type Runtime={map:string,lastSave:number,active:RpgPlayer,unsub?:()=>void,changing:boolean,checkpointTimer?:ReturnType<typeof setTimeout>,enter:(c:any)=>Promise<void>};
// RPGJS rehydrates a new player object on room transfers; the stable id survives.
const sessions=new Map<string,Runtime>();
if (typeof window !== 'undefined') window.addEventListener('lesson-goto', event => {
 const detail = (event as CustomEvent<{ goto?: boolean, x?: number, y?: number, mapId?: string, place?: string }>).detail || {};
 const x = detail.x;
 const y = detail.y;
 if (!detail.goto || typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return;
 const runtime = [...sessions.values()].find(item => item.map === detail.mapId) || [...sessions.values()][0];
 const player = runtime?.active;
 if (!player || !runtime || runtime.changing || runtime.map !== detail.mapId) return;
 const dx = x - player.x();
 const dy = y - player.y();
 const dist = Math.hypot(dx, dy) || 1;
 const nx = Math.round(x - dx / dist * 32);
 const ny = Math.round(y - dy / dist * 32);
 const direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? Direction.Right : Direction.Left) : (dy > 0 ? Direction.Down : Direction.Up);
 player.setVariable('focusTarget', detail.place || '');
 void player.changeMap(runtime.map, { x: nx, y: ny }).then(() => player.changeDirection(direction)).catch(error => console.warn('前往下一目标未完成', error));
});
async function saveCheckpoint(runtime:Runtime,player:RpgPlayer){
 if(runtime.map!==mapFor(ctx())||player.getCurrentMap()?.id!==runtime.map)return;
 const dir=player.direction(),direction=dir===Direction.Up?'up':dir===Direction.Left?'left':dir===Direction.Right?'right':'down';
 try{await rpc('checkpoint',{rpg:{version:1,engine:'rpgjs',mapId:runtime.map,position:{x:player.x(),y:player.y()},direction}});}catch(error){console.warn('位置尚未保存',error);}
}
export const player:RpgPlayerHooks={
 async onConnected(player){
 await ready();player.name='设备调试员';player.setGraphic('engineer');player.setHitbox(24,24);
 if(!ctx().draft.scene){const c=ctx(),s={version:1,x:400,y:420,facing:'down',phase:'start',measured:false,actions:[],visited:[],actorId:c.levelId==='cross'?'cross-open':c.levelId==='minimum'?'pair-a':'sensor30',temperatureCase:30,facility:true,pair:'pair-a',collected:[],signal:'red'};await rpc('change',{patch:{scene:s}});}
 const runtime:Runtime={map:'',lastSave:0,active:player,changing:false,enter:async()=>{}};sessions.set(player.id,runtime);
 runtime.enter=async c=>{
 if(!c.draft.scene){const s={version:1,x:400,y:420,facing:'down',phase:'start',measured:false,actions:[],visited:[],actorId:c.levelId==='cross'?'cross-open':c.levelId==='minimum'?'pair-a':'sensor30',temperatureCase:30,facility:true,pair:'pair-a',collected:[],signal:'red'};await rpc('change',{patch:{scene:s}});return;}
 const map=mapFor(c);if(runtime.map===map||runtime.changing)return;runtime.changing=true;
 try{runtime.map=map;const saved=c.draft.rpg;const pos=saved?.mapId===map?saved.position:spawn[map];await runtime.active.changeMap(map,pos);}
 catch(error){runtime.map='';console.error(error);window.dispatchEvent(new CustomEvent('lesson-bridge-error',{detail:'地图加载未完成，请刷新重试。'}));}
 finally{runtime.changing=false;const latest=getContext();if(latest&&mapFor(latest)!==runtime.map&&runtime.map)void runtime.enter(latest);}
 };
 runtime.unsub=subscribeContext(c=>{void runtime.enter(c);});await runtime.enter(ctx());
 window.addEventListener('pagehide',()=>{runtime.unsub?.();clearTimeout(runtime.checkpointTimer);clearActivePlayer(player.id);sessions.delete(player.id);},{once:true});
 },
 onJoinMap(player,map){
 const runtime=sessions.get(player.id);if(!runtime)return;clearTimeout(runtime.checkpointTimer);runtime.active=player;runtime.map=map.id;registerActivePlayer(player,map.id);
 window.dispatchEvent(new CustomEvent('lesson-map-changed'));
 map.setAutoTick(true);
 player.setHitbox(24,24);
 const saved=ctx().draft.rpg;if(saved?.mapId===map.id){const direction={up:Direction.Up,down:Direction.Down,left:Direction.Left,right:Direction.Right}[saved.direction];if(direction)player.changeDirection(direction);}
 player.setVariable('lessonBusy',false);player.setVariable('deviceOutput',ctx().draft.scene?.deviceOutput||'off');player.syncChanges();
 if(mapFor(ctx())!==map.id)void runtime.enter(ctx());
 },
 async onMove(player){
 const runtime=sessions.get(player.id);if(!runtime||runtime.changing||mapFor(ctx())!==runtime.map||!getContext()?.draft.scene)return;
 await checkRoute(player);
 clearTimeout(runtime.checkpointTimer);runtime.checkpointTimer=setTimeout(()=>{void saveCheckpoint(runtime,player);},250);
 if(Date.now()-runtime.lastSave<2000)return;runtime.lastSave=Date.now();
 await saveCheckpoint(runtime,player);
 },
};
