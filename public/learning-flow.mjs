const required = ['sale','repair','cross'];
export function nextTask(id, optional = false) {
 if(id==='cross')return optional?'minimum':'quiz';
 if(id==='minimum')return 'quiz';
 const index=required.indexOf(id);
 if(index<0)throw new Error('找不到这个探究站。');
 return required[index+1];
}
export const learnKey=id=>`learn-v1:${id}`;
export function learnDue(patrol,id) {return [...required,'minimum'].includes(id)&&!patrol?.seen?.[learnKey(id)];}

export const resumeTask=levels=>required.find(id=>!levels?.[id]?.completed)||'quiz';
