export function distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
export function nearestPointOnSegment(p,a,b){const dx=b.x-a.x,dy=b.y-a.y;const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return{x:a.x+t*dx,y:a.y+t*dy};}
export function moveTowards(p,target,step){const d=distance(p,target);if(d<=step)return{...target,arrived:true};return{x:p.x+(target.x-p.x)*step/d,y:p.y+(target.y-p.y)*step/d,arrived:false};}
export function findRoute(nodes,edges,start,target){
 const entries=Object.entries(nodes);const closest=p=>entries.reduce((best,v)=>distance(p,v[1])<distance(p,best[1])?v:best)[0];
 const first=closest(start),last=closest(target),cost={[first]:0},previous={},todo=new Set(entries.map(v=>v[0]));
 while(todo.size){let id=[...todo].sort((a,b)=>(cost[a]??Infinity)-(cost[b]??Infinity))[0];todo.delete(id);if(id===last)break;if(!Number.isFinite(cost[id]))break;
  for(const [a,b] of edges){const other=a===id?b:b===id?a:null;if(!other||!todo.has(other))continue;const next=cost[id]+distance(nodes[id],nodes[other]);if(next<(cost[other]??Infinity)){cost[other]=next;previous[other]=id;}}
 }
 const path=[];let at=last;if(first!==last&&!previous[last])return[];while(at!==first){path.unshift(nodes[at]);at=previous[at];}if(distance(start,nodes[first])>12)path.unshift(nodes[first]);if(!path.length||distance(path.at(-1),target)>4)path.push(target);return path;
}
