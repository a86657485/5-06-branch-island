export type AssistanceTarget = { cardId?: string; choiceId?: string; focusKey?: string };
export type Assistance = { origin: 'tool' | 'scaffold'; level?: number; stepKey: string; target?: AssistanceTarget };

/** 候选只有在当前步骤收到答案帮助后才标示，普通引导始终不标答案。 */
export function assistedChoice(help: Assistance | null | undefined, stepKey: string, id: string): boolean {
 if(!help || help.stepKey!==stepKey || (help.origin==='scaffold' && help.level!==3))return false;
 return (help.target?.cardId || help.target?.choiceId) === id;
}

/** 第二级帮助只定位关键读数或条件字段，不标正确候选。 */
export function assistedField(help: Assistance | null | undefined, stepKey: string, field: string): boolean {
 return !!help && help.stepKey===stepKey && help.origin==='scaffold' && help.level===2 && help.target?.focusKey===field;
}

export function assistedOperation(help: Assistance | null | undefined, stepKey: string, key: string): boolean {
 return !!help && help.stepKey===stepKey && (help.origin==='tool' || help.level===3) && help.target?.focusKey===key;
}

// 跨面板重开保留本页已经展示过的事件，关闭帮助后不自动重亮。
const shownScaffolds=new Set<string>();
export function claimScaffold(surface:string,eventKey:string):boolean {
 const key=`${surface}:${eventKey}`;
 if(shownScaffolds.has(key))return false;
 shownScaffolds.add(key);return true;
}

export function scaffoldMatches(help:{step?:{phase?:string;slot?:string}},step:{phase?:string;slot?:string}):boolean {
 const from=help.step;
 return !!from && from.phase===step.phase && (!from.slot || from.slot===step.slot);
}
