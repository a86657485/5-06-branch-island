/** 流程图、拼句和预测表的纯规则。面板只负责点选，判断都在这里。 */

export type Card = { id: string; label: string; kind: 'condition' | 'action'; operator?: string; output?: string; illegal?: boolean };
export type Flow = { diamond: string; yes: string; no: string; locked: boolean; preset?: boolean };
export type Sentence = { slots: string[]; locked: boolean };
export type Predictions = { 29: string; 30: string; 31: string; locked: boolean };

export const THERMAL_CARDS: Card[] = [
  { id: 'ge30', label: '温度≥30℃？', kind: 'condition', operator: '>=' },
  { id: 'lt30', label: '温度＜30℃？', kind: 'condition', operator: '<' },
  { id: 'gt30', label: '温度＞30℃？', kind: 'condition', operator: '>' },
  { id: 'le30', label: '温度≤30℃？', kind: 'condition', operator: '<=' },
  { id: 'on', label: '启动风机', kind: 'action', output: 'on' },
  { id: 'off', label: '关闭风机', kind: 'action', output: 'off' }
];

export const CROSS_CARDS: Card[] = [
  { id: 'bridge-q', label: '附近有可用的过街天桥或地下通道吗？', kind: 'condition' },
  { id: 'green-q', label: '现在是绿灯吗？', kind: 'condition', illegal: true },
  { id: 'bridge', label: '走天桥', kind: 'action', output: 'bridge' },
  { id: 'crossing', label: '到斑马线按信号通行', kind: 'action', output: 'crossing' }
];

export const ENERGY_CARDS: Card[] = [
  { id: 'lt', label: '电量 a＜b？', kind: 'condition', operator: '<' },
  { id: 'gt', label: '电量 a＞b？', kind: 'condition', operator: '>' },
  { id: 'a', label: '电池A优先充电', kind: 'action', output: 'a' },
  { id: 'b', label: '电池B优先充电', kind: 'action', output: 'b' }
];

export const CONNECTORS = [
  { id: 'if', label: '如果' },
  { id: 'then', label: '那么' },
  { id: 'else', label: '否则' },
  { id: 'also', label: '然后也' },
  { id: 'ignore', label: '就不用管' }
];

export function cardsFor(mode: string): Card[] {
  if (mode === 'cross') return CROSS_CARDS;
  if (mode === 'minimum') return ENERGY_CARDS;
  return THERMAL_CARDS;
}

export function emptyFlow(): Flow { return { diamond: '', yes: '', no: '', locked: false }; }
export function repairPreset(): Flow { return { diamond: 'ge30', yes: 'off', no: 'on', locked: true, preset: true }; }
export function emptySentence(mode = 'sale'): Sentence { return { slots: Array(mode === 'cross' ? 4 : 6).fill(''), locked: false }; }
export function emptyPredictions(): Predictions { return { 29: '', 30: '', 31: '', locked: false }; }

export function placeCard(flow: Flow, slot: 'diamond' | 'yes' | 'no', cardId: string): Flow {
  return { ...flow, preset: false, locked: false, [slot]: cardId };
}

export function lockFlow(mode: string, flow: Flow) {
  const cards = cardsFor(mode);
  const diamond = cards.find(card => card.id === flow.diamond);
  const yes = cards.find(card => card.id === flow.yes);
  const no = cards.find(card => card.id === flow.no);
  const kept = { ...flow, locked: false, preset: false };
  if (!diamond || !yes || !no) return { ok: false, flow: kept, message: '三个槽都要放上卡片。' };
  if (diamond.illegal) return { ok: false, flow: kept, message: '这个判断不能用来决定路线，程序没有改。' };
  if (diamond.kind !== 'condition') return { ok: false, flow: kept, message: '菱形里要放能回答是/否的问题', mCodes: ['M8'] };
  if (yes.kind !== 'action' || no.kind !== 'action') return { ok: false, flow: kept, message: '两个出口要放会执行的动作。' };
  const config = mode === 'cross'
    ? { yes: yes.output, no: no.output }
    : { ...(mode === 'minimum' ? {} : { model: 'ventilation' }), operator: diamond.operator, yes: yes.output, no: no.output };
  return { ok: true, flow: { ...flow, locked: true, preset: false }, config, message: '流程图已锁定。' };
}

export function faultSeen(runs: Array<{ input?: { temperature?: number }; config?: { yes?: string; no?: string; operator?: string }; correct?: boolean }> = []) {
  return runs.some(run => run.input?.temperature === 30 && run.config?.operator === '>=' && run.config?.yes === 'off' && run.config?.no === 'on' && run.correct === false);
}

export function sentenceTokens(mode: string, flow: Flow) {
  if (!flow.locked) return CONNECTORS.map(token => ({ ...token }));
  const cards = cardsFor(mode);
  const own = [flow.diamond, flow.yes, flow.no].map(id => cards.find(card => card.id === id)).filter(Boolean) as Card[];
  return [...CONNECTORS, ...own.map(card => ({ id: card.id, label: card.label }))];
}

export function placeToken(sentence: Sentence, index: number, tokenId: string): Sentence {
  if (sentence.locked) return sentence;
  const slots = sentence.slots.slice();
  slots[index] = slots[index] === tokenId ? '' : tokenId;
  return { ...sentence, slots };
}

export function lockSentence(mode: string, sentence: Sentence, flow: Flow) {
  const expected = mode === 'cross'
    ? ['if', flow.diamond, 'else', flow.yes]
    : ['if', flow.diamond, 'then', flow.yes, 'else', flow.no];
  const same = expected.length === sentence.slots.length && expected.every((id, index) => sentence.slots[index] === id);
  if (!flow.locked) return { ok: false, sentence, message: '先锁定流程图，再用你自己的卡片拼句。' };
  if (!same) return { ok: false, sentence: { ...sentence, locked: false }, message: '句子要和你锁定的图一致：如果…那么…否则…。' };
  return { ok: true, sentence: { ...sentence, locked: true }, message: '句子已提交。' };
}

export function setPrediction(table: Predictions, temperature: 29 | 30 | 31, value: string): Predictions {
  if (table.locked) return table;
  return { ...table, [temperature]: value };
}

export function lockPredictions(table: Predictions) {
  if (![29, 30, 31].every(temperature => table[temperature as 29 | 30 | 31] === 'on' || table[temperature as 29 | 30 | 31] === 'off')) {
    return { ok: false, table, message: '三个温度都要选启动或关闭。' };
  }
  return { ok: true, table: { ...table, locked: true }, message: '预测已锁定。' };
}

export function conditionLine(result: { conditionText?: string; condition?: boolean }) {
  return `${String(result.conditionText || '').replace(/\s/g, '')} → ${result.condition ? '成立' : '不成立'}`;
}

export function repairEditMessage(repair: boolean, diagnosed: boolean) {
  return repair && !diagnosed ? '先用原程序跑一次 30℃，看到故障才能改。' : '';
}

/** 只改判断符号、出口不跟着换时，30℃仍然走错。改回 ＜ 且出口仍是故障程序的两边，则是接受的修法。 */
export function repairSymbolHint(config?: { operator?: string; yes?: string; no?: string }) {
  if (!config) return '';
  if (config.operator === '>' && config.no === 'off') return '只把 ≥ 改成 ＞，30℃不成立，会走“否”。否如果是关闭，风机仍然不转。';
  if (config.operator === '<' && config.yes === 'on' && config.no === 'off') return '只改成 ＜、出口仍按 ≥ 来接，30℃不小于 30，风机仍然不转。';
  if (config.operator === '<=') return '≤30 在 30℃成立。请对照告示，看成立时风机该不该转。';
  return '';
}

export function unlockPredictionsOnEdit(table: Predictions, changed: boolean): Predictions {
  if (!changed || !table.locked) return table;
  return { ...table, locked: false };
}

export function nextSlot(flow: Flow): 'diamond' | 'yes' | 'no' | '' {
  if (!flow.diamond) return 'diamond';
  if (!flow.yes) return 'yes';
  if (!flow.no) return 'no';
  return '';
}
