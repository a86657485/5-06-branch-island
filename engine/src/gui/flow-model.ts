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

/** 图已经解开时，句子和预测恢复可改；预置故障图仍锁定，不会在这里放开。 */
export function releaseAfterProgramEdit(flow: Flow, predictions: Predictions, sentence: Sentence) {
  if (flow.locked) return { predictions, sentence };
  return { predictions: unlockPredictionsOnEdit(predictions, true), sentence: { ...sentence, locked: false } };
}

/** S1 要先锁定 29/30/31 的预测。S2 预置故障程序例外，改过之后重新要求预测。 */
export function canRunVerify(mode: string, flow: Flow, predictions: Predictions) {
  if (!flow.locked || (mode !== 'sale' && mode !== 'repair')) return false;
  if (mode === 'repair' && flow.preset) return true;
  return predictions.locked && ([29, 30, 31] as const).every(temperature => predictions[temperature] === 'on' || predictions[temperature] === 'off');
}

export function nextSlot(flow: Flow): 'diamond' | 'yes' | 'no' | '' {
  if (!flow.diamond) return 'diamond';
  if (!flow.yes) return 'yes';
  if (!flow.no) return 'no';
  return '';
}

export type ThermalTrial = {
  temperature: 29 | 30 | 31;
  condition: boolean;
  branch: 'yes' | 'no';
  output: string;
  fan: '启动' | '关闭';
  correct: boolean;
};

/** 只解释学生已经锁定的图。比较方式和任务目标与 rules.js 的通风模型一致，不另判对错。 */
export function thermalTrials(config: { operator?: string; yes?: string; no?: string }): ThermalTrial[] {
  const operator = config.operator || '>=';
  const holds = (temperature: number) => operator === '<' ? temperature < 30 : operator === '>' ? temperature > 30 : operator === '<=' ? temperature <= 30 : temperature >= 30;
  return ([29, 30, 31] as const).map(temperature => {
    const condition = holds(temperature);
    const branch = condition ? 'yes' as const : 'no' as const;
    const output = branch === 'yes' ? String(config.yes || '') : String(config.no || '');
    const expected = temperature >= 30 ? 'on' : 'off';
    return { temperature, condition, branch, output, fan: output === 'on' ? '启动' : '关闭', correct: output === expected };
  });
}

/** 面板只显示当前一步；选择是否正确仍交给原流程图和现场核验规则。 */
export function guidedPanelStep(state: {
  mode: string; flow: Flow; sentence: Sentence; predictions: Predictions;
  diagnosed?: boolean; diagnose?: string; slot?: 'diamond' | 'yes' | 'no' | '';
}): { phase: 'original' | 'diagnose' | 'flow' | 'lock' | 'sentence' | 'predict' | 'run'; slot?: 'diamond' | 'yes' | 'no'; temperature?: 29 | 30 | 31 | null } {
  if (state.mode === 'repair' && !state.diagnosed) return { phase: 'original' };
  if (state.mode === 'repair' && state.flow.preset && !state.diagnose) return { phase: 'diagnose' };
  const slot = state.slot || (!state.flow.locked ? nextSlot(state.flow) : '');
  if (slot) return { phase: 'flow', slot };
  if (!state.flow.locked) return { phase: 'lock' };
  if (!state.sentence.locked) return { phase: 'sentence' };
  if ((state.mode === 'sale' || state.mode === 'repair') && !state.predictions.locked) {
    return { phase: 'predict', temperature: ([29, 30, 31] as const).find(t => state.predictions[t] !== 'on' && state.predictions[t] !== 'off') ?? null };
  }
  return { phase: 'run' };
}

/** 由学生自己的图同步成句，仍使用原 lockSentence 核对。 */
export function sentenceFromFlow(mode: string, flow: Flow): Sentence {
  return { slots: mode === 'cross' ? ['if', flow.diamond, 'else', flow.yes] : ['if', flow.diamond, 'then', flow.yes, 'else', flow.no], locked: false };
}

export type PanelEdit = {
  flow: Flow; sentence: Sentence; predictions: Predictions; diagnose: string;
  slot: 'diamond' | 'yes' | 'no' | ''; config: Record<string, unknown> | null;
};

/** 撤回只恢复编辑草稿，现场记录、法宝次数、分数和场景版本均不在快照中。 */
export function panelEditSnapshot(state: PanelEdit): PanelEdit {
  return {
    flow: { ...state.flow }, sentence: { ...state.sentence, slots: [...state.sentence.slots] },
    predictions: { ...state.predictions }, diagnose: state.diagnose, slot: state.slot,
    config: state.config ? { ...state.config } : null
  };
}

export function cardsForSlot(mode: string, slot: 'diamond' | 'yes' | 'no') {
  return cardsFor(mode).filter(card => card.kind === (slot === 'diamond' ? 'condition' : 'action'));
}

export function canUseTool(support?: { remaining?: number }, busy = false) {
  return !busy && typeof support?.remaining === 'number' && support.remaining > 0;
}

export function flowLogicGuidance(mode: string, flow: Flow): { ok: boolean; slot: 'diamond' | 'yes' | 'no'; message: string } {
  if (!flow.diamond || !flow.yes || !flow.no) {
    return { ok: false, slot: nextSlot(flow) || 'diamond', message: '请先把三个格子都放上卡片。' };
  }
  if (mode === 'sale' || mode === 'repair') {
    if ((flow.diamond === 'ge30' && flow.yes === 'on' && flow.no === 'off') || (flow.diamond === 'lt30' && flow.yes === 'off' && flow.no === 'on')) {
      return { ok: true, slot: 'diamond', message: '' };
    }
    if (flow.yes === flow.no) {
      return { ok: false, slot: 'no', message: '💡 阿绿提醒：“是”和“否”两个分支出口不能做同一个动作哦！请把右边“否”改成另一个动作。' };
    }
    if (flow.diamond === 'gt30') {
      return { ok: false, slot: 'diamond', message: '💡 阿绿提醒：温室告示说“达到30℃就开风机”，【温度＞30℃？】漏掉了刚好30℃！请把菱形条件换成【温度≥30℃？】。' };
    }
    if (flow.diamond === 'le30') {
      return { ok: false, slot: 'diamond', message: '💡 阿绿提醒：30℃已经达到开启标准，不能算在低温关闭里！请把菱形条件换成【温度≥30℃？】或【温度＜30℃？】。' };
    }
    if (flow.diamond === 'lt30' && flow.yes === 'on') {
      return { ok: false, slot: 'diamond', message: '💡 阿绿提醒：现在选的是“温度＜30℃ → 是：启动风机”，变成天冷才吹风啦！请把菱形条件换成【温度≥30℃？】（或者对调下面两个动作）！' };
    }
    if (flow.diamond === 'ge30' && flow.yes === 'off') {
      return { ok: false, slot: 'yes', message: '💡 阿绿提醒：温度达到30℃（≥30℃成立）时应该吹风降温，现在“是”却接了关闭风机！请把“是”改成【启动风机】，“否”改成【关闭风机】！' };
    }
    return { ok: false, slot: 'diamond', message: '💡 阿绿提醒：请对照告示“达到30℃启动风机，否则关闭风机”检查条件与是/否动作是否配合！' };
  }
  if (mode === 'cross') {
    if (flow.diamond === 'bridge-q' && flow.yes === 'bridge' && flow.no === 'crossing') {
      return { ok: true, slot: 'diamond', message: '' };
    }
    if (flow.diamond !== 'bridge-q') {
      return { ok: false, slot: 'diamond', message: '💡 小巡提醒：指路牌要先判断【附近有可用的过街天桥或地下通道吗？】哦！' };
    }
    if (flow.yes !== 'bridge') {
      return { ok: false, slot: 'yes', message: '💡 小巡提醒：当附近有可用天桥（回答“是”）时，应该优先【走天桥】哦！' };
    }
    return { ok: false, slot: 'no', message: '💡 小巡提醒：当没有天桥（回答“否”）时，应该选择【到斑马线按信号通行】！' };
  }
  if (mode === 'minimum') {
    if ((flow.diamond === 'lt' && flow.yes === 'a' && flow.no === 'b') || (flow.diamond === 'gt' && flow.yes === 'b' && flow.no === 'a')) {
      return { ok: true, slot: 'diamond', message: '' };
    }
    if (flow.yes === flow.no) {
      return { ok: false, slot: 'no', message: '💡 小电提醒：不能不管谁少都充同一块电池哦！“是”和“否”要分别接不同的电池。' };
    }
    if (flow.diamond === 'lt' && flow.yes === 'b') {
      return { ok: false, slot: 'yes', message: '💡 小电提醒：当“电量 a＜b”成立时，说明 A 剩得更少，所以“是”应该选【电池A优先充电】！' };
    }
    return { ok: false, slot: 'yes', message: '💡 小电提醒：当“电量 a＞b”成立时，说明 B 剩得更少，所以“是”应该选【电池B优先充电】！' };
  }
  return { ok: true, slot: 'diamond', message: '' };
}

export type MistakeGuidanceModal = {
  mistakeCount: number;
  tier: 1 | 2 | 3;
  tierBadge: string;
  speaker: string;
  title: string;
  summary: string;
  directionHint: string;
  steps: string[];
  targetSlot: 'diamond' | 'yes' | 'no';
  recommendedCategory: string;
  recommendedCardIds: string[];
  showFaultMagnifier: boolean;
};

/** 初始（0错）展示全部可选卡片，不预先过滤类别；第2次点错起再按槽位过滤推荐类别。 */
export function visibleCardsForSlot(mode: string, slot: 'diamond' | 'yes' | 'no', mistakeCount = 0): Card[] {
  if (mistakeCount < 2) return cardsFor(mode);
  return cardsForSlot(mode, slot);
}

export function buildMistakeModal(
  mode: string,
  flow: Flow,
  mistakeCount: number,
  kind: 'flow' | 'diagnose' = 'flow'
): MistakeGuidanceModal {
  const count = Math.max(1, mistakeCount);
  const tier: 1 | 2 | 3 = count === 1 ? 1 : count === 2 ? 2 : 3;
  const speaker = mode === 'repair' ? '🔧 维修员老修' : mode === 'cross' ? '👮 巡检员小巡' : mode === 'minimum' ? '⚡ 储能柜小电' : '👩‍🌾 园艺员阿绿';
  const tierBadge = tier === 1
    ? `💡 第 ${count} 次点错 · 启发思考（指方向）`
    : tier === 2
      ? `💡 第 ${count} 次点错 · 分步引导（缩范围 + 开启推荐类别）`
      : `💡 第 ${count} 次点错 · 手把手示范支架`;

  if (kind === 'diagnose') {
    return {
      mistakeCount: count,
      tier,
      tierBadge,
      speaker,
      title: '先别急！回想刚才 30℃ 时的现场表现：',
      summary: '刚才探头读到 30℃ 时，按照温室告示本来应该启动风机降温，可旧控制板却让风机保持关闭，说明旧程序确实有故障哦！',
      directionHint: '想一想：旧板条件写的是“温度≥30℃？”，30℃ 时条件已经成立（走“是”分支），为什么风机反而关了呢？',
      steps: [
        '① 观察旧板【菱形判断框】：写着“温度≥30℃？”（30℃ 时成立）',
        '② 观察旧板【“是”与“否”出口】：“是”连了关闭风机、“否”连了启动风机（两个出口动作接反了，或者需要调整判断条件）',
        '③ 请选择【两个分支出口的动作接反了】或【判断条件不合适】进入修板！'
      ],
      targetSlot: 'diamond',
      recommendedCategory: '故障原因诊断',
      recommendedCardIds: ['exit', 'condition'],
      showFaultMagnifier: true
    };
  }

  const cards = cardsFor(mode);
  const dCard = cards.find(c => c.id === flow.diamond);
  const yCard = cards.find(c => c.id === flow.yes);
  const nCard = cards.find(c => c.id === flow.no);
  const lockCheck = lockFlow(mode, flow);
  const logicCheck = flowLogicGuidance(mode, flow);

  let targetSlot: 'diamond' | 'yes' | 'no' = 'diamond';
  let summary = '';

  if (!dCard || !yCard || !nCard) {
    targetSlot = nextSlot(flow) || 'diamond';
    summary = '还有空白的格子没有放上卡片哦！分支结构需要把【判断条件】、【是】、【否】三个位置都填满。';
  } else if (dCard.kind !== 'condition') {
    targetSlot = 'diamond';
    summary = `你在【菱形判断框】里放了“${dCard.label}”，但这是一张执行动作卡！菱形框里必须放能回答“是”或“否”的判断条件卡。`;
  } else if (dCard.illegal) {
    targetSlot = 'diamond';
    summary = `你选了“${dCard.label}”，但红绿灯只管斑马线什么时候走，不能用来决定“走天桥还是走斑马线”哦！`;
  } else if (yCard.kind !== 'action') {
    targetSlot = 'yes';
    summary = `你在左边【“是”出口】里放了“${yCard.label}”，这是判断条件卡！分支出口必须放设备具体执行的动作卡。`;
  } else if (nCard.kind !== 'action') {
    targetSlot = 'no';
    summary = `你在右边【“否”出口】里放了“${nCard.label}”，这是判断条件卡！分支出口必须放设备具体执行的动作卡。`;
  } else {
    targetSlot = logicCheck.slot;
    if (mode === 'sale' || mode === 'repair') {
      if (flow.yes === flow.no) {
        summary = `刚才你把“是”和“否”两个出口都选成了【${yCard.label}】！这样不管温度高不高，风机都做同一件事，就失去分支判断的意义啦。`;
      } else if (flow.diamond === 'gt30') {
        summary = `刚才选的【温度＞30℃？】在 31℃ 时能吹风，但遇到刚好 30℃ 时，“30＞30”不成立，风机会走“否”保持关闭，30℃ 高温下菜苗就受热啦！`;
      } else if (flow.diamond === 'le30') {
        summary = `刚才选的【温度≤30℃？】把刚好 30℃ 算进了同一边，导致 30℃ 临界温度或高温下风机做出相反动作哦！`;
      } else if (flow.diamond === 'lt30' && flow.yes === 'on') {
        summary = `刚才选的规则“温度＜30℃ → 是：启动风机”，在 29℃ 凉爽天反而开机吹风，到了 30℃、31℃ 高温下反而停机，动作完全反过来啦！`;
      } else if (flow.diamond === 'ge30' && flow.yes === 'off') {
        summary = `刚才选的规则在 30℃、31℃ 高温下（满足 ≥30℃）会走“是：关闭风机”，做出相反动作哦！`;
      } else {
        summary = lockCheck.ok ? logicCheck.message.replace(/^💡\s*[^：]+：/, '') : lockCheck.message;
      }
    } else if (mode === 'cross') {
      if (flow.yes === flow.no) {
        summary = `刚才“是”和“否”两个出口都选了【${yCard.label}】，不管有没有天桥都走同一条路啦！`;
      } else {
        summary = `刚才选的规则“${dCard.label} → 是：${yCard.label}，否：${nCard.label}”把有天桥和没天桥的路线接反啦！`;
      }
    } else {
      if (flow.yes === flow.no) {
        summary = `刚才“是”和“否”两个出口都选了【${yCard.label}】，不能不管哪块电池少都充同一块电池哦！`;
      } else {
        summary = `刚才选的规则“${dCard.label} → 是：${yCard.label}，否：${nCard.label}”会把优先充电口接给电量更多的那块电池，做反啦！`;
      }
    }
  }

  const directionHint = mode === 'sale' || mode === 'repair'
    ? '🧭 思考方向（判断条件 + 双路分支）：先看温室告示——“达到或超过 30℃ 启动风机，低于 30℃ 关闭风机”。想一想：① 菱形框要先判断什么温度条件（注意 30℃ 本身算不算达标）？② 当条件成立（是）与不成立（否）时，分别该选哪张动作卡？'
    : mode === 'cross'
      ? '🧭 思考方向（先看设施 + 双路分流）：过马路前要先判断附近有没有可用天桥。想一想：有天桥（是）走哪条路？没有天桥（否）走哪条路？'
      : '🧭 思考方向（比大小 + 少者优先）：只有一个优先充电口，要先比较 A 和 B 谁的电量更少。想一想：当 a＜b 成立（是）时谁更少？不成立（否）时谁更少？';

  const steps = mode === 'sale' || mode === 'repair'
    ? (tier === 2
      ? [
          '① 【菱形判断框】请从“⭐ 推荐类别：判断条件卡”里选包含 30℃ 临界值的条件（如【温度≥30℃？】或【温度＜30℃？】）',
          '② 【“是”出口格】从“⭐ 推荐类别：执行动作卡”里选该条件成立时风机的动作',
          '③ 【“否”出口格】选相反的另一个动作（两边动作不能相同）'
        ]
      : [
          '① 第 1 格【菱形判断条件】：直接点选【温度≥30℃？】（或选【温度＜30℃？】）',
          '② 第 2 格【“是”分支出口】：若选了 ≥30℃，请点选【启动风机】（若选了 ＜30℃ 则选【关闭风机】）',
          '③ 第 3 格【“否”分支出口】：请点选剩下的相反动作【关闭风机】（若“是”为关闭则选【启动风机】）'
        ])
    : mode === 'cross'
      ? (tier === 2
        ? [
            '① 【判断条件格】从“⭐ 推荐类别：判断条件卡”里选询问过街天桥设施的卡片',
            '② 【“是”出口格】有可用天桥时，选安全过桥的动作卡',
            '③ 【“否”出口格】没有天桥时，选按信号灯走斑马线的动作卡'
          ]
        : [
            '① 第 1 格【判断条件】：请点选【附近有可用的过街天桥或地下通道吗？】',
            '② 第 2 格【“是”分支出口】：请点选【走天桥】',
            '③ 第 3 格【“否”分支出口】：请点选【到斑马线按信号通行】'
          ])
      : (tier === 2
        ? [
            '① 【判断条件格】从“⭐ 推荐类别：判断条件卡”里选比较 A、B 电量的卡片',
            '② 【“是”出口格】根据比较符号，选当前电量更少的那块电池',
            '③ 【“否”出口格】选另一块电池优先充电'
          ]
        : [
            '① 第 1 格【判断条件】：请点选【电量 a＜b？】',
            '② 第 2 格【“是”分支出口】：请点选【电池A优先充电】',
            '③ 第 3 格【“否”分支出口】：请点选【电池B优先充电】'
          ]);

  const recommendedCategory = targetSlot === 'diamond' ? '判断条件卡（能回答“是/否”的问题）' : '执行动作卡（设备具体执行的动作）';
  let recommendedCardIds: string[] = [];
  if (mode === 'sale' || mode === 'repair') {
    if (targetSlot === 'diamond') recommendedCardIds = ['ge30', 'lt30'];
    else if (targetSlot === 'yes') recommendedCardIds = [flow.diamond === 'lt30' ? 'off' : 'on'];
    else recommendedCardIds = [flow.yes === 'off' ? 'on' : 'off'];
  } else if (mode === 'cross') {
    if (targetSlot === 'diamond') recommendedCardIds = ['bridge-q'];
    else if (targetSlot === 'yes') recommendedCardIds = ['bridge'];
    else recommendedCardIds = ['crossing'];
  } else {
    if (targetSlot === 'diamond') recommendedCardIds = ['lt', 'gt'];
    else if (targetSlot === 'yes') recommendedCardIds = [flow.diamond === 'gt' ? 'b' : 'a'];
    else recommendedCardIds = [flow.yes === 'b' ? 'a' : 'b'];
  }

  return {
    mistakeCount: count,
    tier,
    tierBadge,
    speaker,
    title: tier === 1
      ? '别灰心！我们先想一想刚才这套规则会怎样运行：'
      : tier === 2
        ? '再进一步！已为你开启【⭐ 推荐类别】与分步线索：'
        : '手把手带你过关！请按下面三步修正卡片：',
    summary,
    directionHint,
    steps,
    targetSlot,
    recommendedCategory,
    recommendedCardIds,
    showFaultMagnifier: mode === 'repair' && count >= 1
  };
}
