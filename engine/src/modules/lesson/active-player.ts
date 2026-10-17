import type { RpgPlayer } from '@rpgjs/server';
const active=new Map<string,{player:RpgPlayer,mapId:string}>();
const waiting=new Set<{id:string,mapId:string,resolve:(player:RpgPlayer)=>void,reject:(error:Error)=>void,timer:ReturnType<typeof setTimeout>}>();
export function mapForContext(c:any):string{return c.levelId==='sale'?'greenhouse':c.levelId==='repair'?'workshop':c.levelId==='minimum'?'energy':c.draft.scene?.facility===false?'crossing':'crossing-east';}
export function registerActivePlayer(player:RpgPlayer,mapId:string){
 active.set(player.id,{player,mapId});
 for(const entry of waiting)if(entry.id===player.id&&entry.mapId===mapId){clearTimeout(entry.timer);waiting.delete(entry);entry.resolve(player);}
}
export function waitForActivePlayer(id:string,mapId:string):Promise<RpgPlayer>{
 const current=active.get(id);if(current?.mapId===mapId)return Promise.resolve(current.player);
 return new Promise((resolve,reject)=>{const entry={id,mapId,resolve,reject,timer:setTimeout(()=>{waiting.delete(entry);reject(new Error('地图仍在切换，请稍候再交互。'));},8000)};waiting.add(entry);});
}
export function clearActivePlayer(id:string){active.delete(id);for(const entry of waiting)if(entry.id===id){clearTimeout(entry.timer);waiting.delete(entry);entry.reject(new Error('园区已关闭。'));}}
