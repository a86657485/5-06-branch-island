import layout from '../../tiled/layout.json';
import { Direction } from '@rpgjs/common';
import { type RpgPlayer, type RpgPlayerHooks } from '@rpgjs/server';
import { ready,subscribeContext,getContext } from '../../classroom-bridge';
import { clickWaypoints, movementTarget } from './click-path';
import { rpc,ctx } from './runtime';
import { checkRoute } from './routes';
import { mapForContext,registerActivePlayer,clearActivePlayer } from './active-player';
import { standBeside } from './approach';
import { ensureGreenhouseActors } from './thermal';
import { GREENHOUSE_ACTORS, actorIdOf } from './greenhouse-cast';
import { nearestInteraction, interactionLabel } from './interaction';
const spawn=Object.fromEntries(Object.entries(layout).map(([id,m])=>[id,{x:m.positions.start[0],y:m.positions.start[1]}]));
const mapFor=mapForContext;
type ActorSnapshot={player:RpgPlayer,map:any,levelId:string,deviceOutput:string,events:any[],positions:string};
type Runtime={map:string,lastSave:number,active:RpgPlayer,unsub?:()=>void,changing:boolean,checkpointTimer?:ReturnType<typeof setTimeout>,actorSync?:ActorSnapshot,actorQueue?:Promise<void>,enter:(c:any)=>Promise<void>};
// RPGJS rehydrates a new player object on room transfers; the stable id survives.
const sessions=new Map<string,Runtime>();
const directions = { up: Direction.Up, down: Direction.Down, left: Direction.Left, right: Direction.Right };
let lastInteraction = '';
function publishInteraction(player:RpgPlayer) {
 const map=player.getCurrentMap(),near=nearestInteraction(player,map,Infinity);
 const detail={mapId:map?.id||'',label:near?interactionLabel(near.event,ctx().levelId):'交谈 / 操作',inRange:!!near&&near.distance<=48};
 const key=JSON.stringify(detail);if(key===lastInteraction)return;lastInteraction=key;
 window.dispatchEvent(new CustomEvent('lesson-interaction-target',{detail}));
}
function actorEvents(map:any,player:RpgPlayer){return (map.getEvents?.()||[]).filter((event:any)=>map.isEventVisibleForPlayer?.(event,player)!==false);}
function actorPositions(events:any[]){return JSON.stringify(events.map(event=>[event.id,event.x?.(),event.y?.()]));}
async function syncActorContext(runtime:Runtime,c:any){
 const pending=(runtime.actorQueue||Promise.resolve()).catch(()=>undefined).then(async()=>{
  const player=runtime.active,map=player.getCurrentMap?.();if(!map||map.id!==mapFor(c))return;
  const levelId=c.levelId||'',deviceOutput=c.draft.scene?.deviceOutput||'off',events=actorEvents(map,player),previous=runtime.actorSync;
  const castReady=map.id!=='greenhouse'||GREENHOUSE_ACTORS.every(actor=>events.some((event:any)=>actorIdOf(event.id)===actor.id));
  if(castReady&&previous?.player===player&&previous.map===map&&previous.levelId===levelId&&previous.deviceOutput===deviceOutput&&previous.positions===actorPositions(events)&&previous.events.length===events.length&&events.every((event:any,index:number)=>event===previous.events[index])&&player.getVariable('lessonLevel')===levelId&&player.getVariable('deviceOutput')===deviceOutput)return;
  // RPGJS setVariable already synchronizes. Checkpoints do not change these values.
  if(player.getVariable('lessonLevel')!==levelId)player.setVariable('lessonLevel',levelId);
  if(player.getVariable('deviceOutput')!==deviceOutput)player.setVariable('deviceOutput',deviceOutput);
  await ensureGreenhouseActors(map,player,levelId);
  const synced=actorEvents(map,player);
  runtime.actorSync={player,map,levelId,deviceOutput,events:synced,positions:actorPositions(synced)};
  publishInteraction(player);
 });
 runtime.actorQueue=pending;await pending;
}
let pendingApproach: { mapId: string, direction: Direction } | null = null;
let navigation = 0;
if (typeof window !== 'undefined') window.addEventListener('lesson-goto', event => {
 const detail = (event as CustomEvent<{goto?:boolean,x?:number,y?:number,mapId?:string,place?:string}>).detail || {};
 if(!detail.goto || !Number.isFinite(detail.x) || !Number.isFinite(detail.y))return;
 const runtime=[...sessions.values()].find(item=>item.map===detail.mapId);
 if(!runtime || runtime.changing || runtime.active.getVariable('lessonBusy'))return;
 const token=++navigation;
 void clickToTarget(runtime,detail as {x:number,y:number,mapId:string,place:string},token).catch(error=>{
  window.dispatchEvent(new CustomEvent('lesson-bridge-error',{detail:error instanceof Error?error.message:'请再点一次下一步。'}));
 }).finally(()=>window.dispatchEvent(new CustomEvent('lesson-walking',{detail:{moving:false}})));
});
async function clickToTarget(runtime:Runtime,target:{x:number,y:number,mapId:string,place:string},token:number){
 const player=runtime.active;
 const levelId=ctx().levelId;
 const positions=layout[runtime.map]?.positions || {};
 const others=Object.entries(positions).filter(([id])=>id!==target.place && id!=='start').map(([,point])=>({x:(point as number[])[0],y:(point as number[])[1]}));
 const stand=standBeside(target,{x:player.x(),y:player.y()},others);
 const context=ctx();
 const points=clickWaypoints({x:player.x(),y:player.y()},{...stand,place:target.place},{levelId,scene:context.draft.scene});
 const returning=levelId==='cross' && player.x()>600 && target.x<590;
 if(returning){player.setVariable('returnToWest',true);if(!context.draft.scene.facility)await rpc('change',{patch:{scene:{...context.draft.scene,signal:'green'}}});player.syncChanges();}
 player.directionFixed=false;player.setVariable('faceLock','');
 window.dispatchEvent(new CustomEvent('lesson-walking',{detail:{moving:true}}));
 try{
  for(const point of points){
   if(token!==navigation || ctx().levelId!==levelId || runtime.map!==target.mapId)return;
   player.moveTo(movementTarget(point,player.hitbox()));
   // RPGJS moveTo defaults to a 48px arrival radius; devices need a closer approach.
   for(const movement of player.getActiveMovements()){
    const seek=movement as {setParameters?:(speed?:number,radius?:number,weight?:number,arrival?:number)=>void};
    if(typeof seek.setParameters==='function')seek.setParameters(undefined,undefined,undefined,8);
   }
   const begun=Date.now();
   while(Math.hypot(player.x()-point.x,player.y()-point.y)>14){
    if(token!==navigation || ctx().levelId!==levelId || runtime.map!==target.mapId)return;
    if(Date.now()-begun>12000){console.warn('点击导航未抵达',JSON.stringify({position:{x:player.x(),y:player.y()},point}));throw new Error('这段路暂时受阻，请再点下一步。');}
    await new Promise(resolve=>setTimeout(resolve,40));
   }
   player.clearMovements();
   await checkRoute(player);
  }
  const walked=levelId==='cross' && ctx().draft.scene.ticket && (ctx().draft.scene.actions||[]).includes('route');
  if(walked && ['bridgeEast','crossingEast','bridgeWest','crossingWest'].includes(target.place))return;
  holdFacing(player,directions[stand.direction],{x:player.x(),y:player.y()});
  await saveCheckpoint(runtime,player);
  const events=player.getCurrentMap()?.getEvents() || [];
  const hit=events.filter((item:any)=>typeof item.execMethod==='function' && Math.hypot(item.x()-target.x,item.y()-target.y)<24).sort((a:any,b:any)=>Math.hypot(a.x()-target.x,a.y()-target.y)-Math.hypot(b.x()-target.x,b.y()-target.y))[0];
  if(hit?.execMethod)await hit.execMethod('onAction',[player,{}]);
 }finally{player.clearMovements();if(returning)player.setVariable('returnToWest',false);}
}

function holdFacing(player: RpgPlayer, direction: Direction, at: { x: number, y: number }) {
 player.changeDirection(direction);
 player.directionFixed = true;
 const name = direction === Direction.Up ? 'up' : direction === Direction.Left ? 'left' : direction === Direction.Right ? 'right' : 'down';
 player.setVariable('faceLock', name);
 player.setVariable('faceLockAt', { x: at.x, y: at.y });
}
async function saveCheckpoint(runtime:Runtime,player:RpgPlayer){
 if(runtime.map!==mapFor(ctx())||player.getCurrentMap()?.id!==runtime.map)return;
 const dir=player.direction(),direction=dir===Direction.Up?'up':dir===Direction.Left?'left':dir===Direction.Right?'right':'down';
 try{await rpc('checkpoint',{rpg:{version:1,engine:'rpgjs',mapId:runtime.map,position:{x:player.x(),y:player.y()},direction}});}catch(error){console.warn('位置尚未保存',error);}
}
export const player:RpgPlayerHooks={
 async onConnected(player){
 await ready();player.name='园区巡检员';player.setGraphic('engineer');player.setHitbox(24,24);
 if(!ctx().draft.scene){const c=ctx(),s={version:1,x:400,y:420,facing:'down',phase:'start',measured:false,actions:[],visited:[],actorId:c.levelId==='cross'?'cross-open':c.levelId==='minimum'?'pair-a':'sensor30',temperatureCase:30,facility:true,pair:'pair-a',collected:[],signal:'red'};await rpc('change',{patch:{scene:s}});}
 const runtime:Runtime={map:'',lastSave:0,active:player,changing:false,enter:async()=>{}};sessions.set(player.id,runtime);
 runtime.enter=async c=>{
 if(!c.draft.scene){const s={version:1,x:400,y:420,facing:'down',phase:'start',measured:false,actions:[],visited:[],actorId:c.levelId==='cross'?'cross-open':c.levelId==='minimum'?'pair-a':'sensor30',temperatureCase:30,facility:true,pair:'pair-a',collected:[],signal:'red'};await rpc('change',{patch:{scene:s}});return;}
 const map=mapFor(c);if(runtime.changing)return;if(runtime.map===map){await syncActorContext(runtime,c);return;}runtime.changing=true;
 try{runtime.map=map;const saved=c.draft.rpg;const pos=saved?.mapId===map?saved.position:spawn[map];await runtime.active.changeMap(map,pos);}
 catch(error){runtime.map='';console.error(error);window.dispatchEvent(new CustomEvent('lesson-bridge-error',{detail:'地图加载未完成，请刷新重试。'}));}
 finally{runtime.changing=false;const latest=getContext();if(latest&&mapFor(latest)!==runtime.map&&runtime.map)void runtime.enter(latest);}
 };
 runtime.unsub=subscribeContext(c=>{void runtime.enter(c);});await runtime.enter(ctx());
 window.addEventListener('pagehide',()=>{runtime.unsub?.();clearTimeout(runtime.checkpointTimer);clearActivePlayer(player.id);sessions.delete(player.id);},{once:true});
 },
 async onJoinMap(player,map){
 const runtime=sessions.get(player.id);if(!runtime)return;clearTimeout(runtime.checkpointTimer);runtime.active=player;runtime.map=map.id;runtime.actorSync=undefined;registerActivePlayer(player,map.id);
 lastInteraction='';window.dispatchEvent(new CustomEvent('lesson-map-changed'));
 map.setAutoTick(true);
 player.setHitbox(24,24);
 const saved=ctx().draft.rpg;if(saved?.mapId===map.id){const direction=directions[saved.direction as keyof typeof directions];if(direction)player.changeDirection(direction);}
 if(pendingApproach?.mapId===map.id)holdFacing(player,pendingApproach.direction,{x:player.x(),y:player.y()});
 if(player.getVariable('lessonBusy')!==false)player.setVariable('lessonBusy',false);
 await syncActorContext(runtime,ctx());publishInteraction(player);
 if(mapFor(ctx())!==map.id)void runtime.enter(ctx());
 },
 async onInput(player, input){
  const action=(input as {action?:string,input?:string})?.action ?? (input as {input?:string})?.input ?? input;
  if(!['action','lesson:interact'].includes(action as string) || player.getVariable('lessonBusy'))return;
  const here=player.getCurrentMap(); if(!here?.getEvents)return;
  if(action==='action'){
   // Default keyboard actions already dispatch collision events in RPGJS before this hook.
   const map=here as any,collisions=new Set<string>(map.getCollisions?.(player.id)||[]);
   for(const id of map.getInteractionCollisions?.(player.id,player.direction())||[])collisions.add(id);
   if(here.getEvents().some(event=>collisions.has(event.id)&&map.isEventVisibleForPlayer?.(event,player)!==false))return;
  }
  const nearest=nearestInteraction(player,here);
  if(nearest)await nearest.event.execMethod('onAction',[player,input]);
 },
 async onMove(player){
 const runtime=sessions.get(player.id);if(!runtime||runtime.changing||mapFor(ctx())!==runtime.map||!getContext()?.draft.scene)return;
 publishInteraction(player);
 const lock=player.getVariable('faceLock');
 if(lock){
  const at=player.getVariable('faceLockAt') as {x?:number,y?:number}|undefined;
  const ax=typeof at?.x==='number'?at.x:player.x(),ay=typeof at?.y==='number'?at.y:player.y();
  if(Math.hypot(player.x()-ax,player.y()-ay)>12){player.directionFixed=false;player.setVariable('faceLock','');}
  else{const direction=directions[lock as keyof typeof directions];if(direction)player.changeDirection(direction);player.directionFixed=true;}
 }
 pendingApproach=null;
 await checkRoute(player);
 clearTimeout(runtime.checkpointTimer);runtime.checkpointTimer=setTimeout(()=>{void saveCheckpoint(runtime,player);},250);
 if(Date.now()-runtime.lastSave<2000)return;runtime.lastSave=Date.now();
 await saveCheckpoint(runtime,player);
 },
};
