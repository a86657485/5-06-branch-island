const editable = ['config','input','prediction','reason','scene','flow','sentence','predictionsLocked','diagnoseAnswer','panel'];
export function captureEdit(draft) {
 return Object.fromEntries(editable.map(key=>[key, draft[key] === undefined ? null : structuredClone(draft[key])]));
}
export function restoreEdit(current,snapshot) {
 const restored={...current};
 for(const key of editable)if(key in snapshot){if(snapshot[key]===null)delete restored[key];else restored[key]=structuredClone(snapshot[key]);}
 restored.sceneRev=(current.sceneRev||0)+1;
 return restored;
}
