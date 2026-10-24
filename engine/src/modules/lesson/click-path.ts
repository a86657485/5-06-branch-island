/** 点击导航只安排真实行走的路点；实验与路线证据仍由原事件产生。 */
type Point = {x:number,y:number};
type Target = Point & {place?:string};
export function clickWaypoints(from:Point,target:Target,context:{levelId:string,scene?:Record<string,any>}):Point[]{
 const s=context.scene || {};
 if(context.levelId!=='cross')return [target];
 const route=s.ticket?.output || (s.facility?'bridge':'crossing');
 const y=route==='bridge'?336:680;
 const walking=s.ticket && !(s.actions || []).includes('route') && !(route==='bridge' && !s.facility) && target.place!=='signal';
 if(walking)return [{x:410,y:from.y},{x:450,y},{x:500,y},{x:760,y},{x:1080,y}];
 if(from.x>600 && target.x<590)return [{x:1100,y:from.y},{x:1100,y},{x:760,y},{x:460,y},{x:410,y},{x:410,y:target.y},target];
 return [target];
}

/** SDK moveTo compares physical centres; scene coordinates remain top-left. */
export function movementTarget(point:Point,hitbox:{w:number,h:number}):Point { return {x:point.x+hitbox.w/2,y:point.y+hitbox.h/2}; }
