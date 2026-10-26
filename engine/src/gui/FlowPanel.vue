<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { getContext, request, subscribeContext } from '../classroom-bridge';
import { assistedChoice, assistedField, assistedOperation, claimScaffold, scaffoldMatches, type Assistance, type AssistanceTarget } from './assisted-focus';
import { stationBrief } from '../../../public/task-guidance.mjs';
import { toPlain } from './plain';
import SentencePanel from './SentencePanel.vue';
import {
  buildMistakeModal, canUseTool, cardsFor, cardsForSlot, emptyFlow, emptyPredictions, emptySentence,
  flowLogicGuidance, guidedPanelStep, lockFlow, lockPredictions, lockSentence, nextSlot, panelEditSnapshot,
  placeCard, repairEditMessage, repairPreset, sentenceFromFlow, setPrediction, thermalTrials,
  visibleCardsForSlot, type Flow, type MistakeGuidanceModal, type PanelEdit, type Predictions, type Sentence
} from './flow-model';

const props = withDefaults(defineProps<{
  mode?: string; flow?: Flow; sentence?: Sentence; predictions?: Predictions;
  diagnosed?: boolean; diagnoseAnswer?: string; preview?: string; focusStrength?: number; measured?: boolean;
  initialMistakes?: number;
}>(), { measured: true, initialMistakes: 0 });
const close = inject<(name: string, data?: unknown) => void>('rpgGuiClose', () => undefined);
const mode = props.mode || 'sale';
const board = ref<Flow>(props.flow || (mode === 'repair' ? repairPreset() : emptyFlow()));
const sentence = ref<Sentence>(props.sentence || emptySentence(mode));
const predictions = ref<Predictions>(props.predictions || emptyPredictions());
const diagnose = ref(props.diagnoseAnswer || '');
const editingSlot = ref<'diamond' | 'yes' | 'no' | ''>('');
const lockedConfig = ref<Record<string, unknown> | null>(getContext()?.draft?.config || null);
const history = ref<PanelEdit[]>([]);
const message = ref('');
const mistakeCount = ref<number>(Number(props.initialMistakes || (getContext()?.draft as any)?.flowMistakes || 0));
const guideModal = ref<MistakeGuidanceModal | null>(null);
const support = ref(getContext()?.support);
const toolBusy = ref(false);
const toolAnswer = ref<({ key: string; action: string; why: string } & Assistance) | null>(null);
const thermal = mode === 'sale' || mode === 'repair';
const cards = computed(() => cardsFor(mode));
const step = computed(() => guidedPanelStep({ mode, flow: board.value, sentence: sentence.value, predictions: predictions.value, diagnosed: props.diagnosed, diagnose: diagnose.value, slot: editingSlot.value }));
const stepKey = computed(() => JSON.stringify(step.value));
watch(stepKey, () => { toolAnswer.value = null; });
const view = computed(() => step.value.phase === 'predict' ? 'predict' : step.value.phase === 'sentence' ? 'sentence' : 'flow');
const slotName = computed(() => step.value.slot || '');
const choices = computed(() => step.value.slot ? visibleCardsForSlot(mode, step.value.slot, mistakeCount.value) : []);
const inactiveChoices = computed(() => {
  if (!step.value.slot || mistakeCount.value < 2) return [];
  const otherSlot = step.value.slot === 'diamond' ? 'yes' : 'diamond';
  return cardsForSlot(mode, otherSlot);
});
const alarm = computed(() => /菱形|不能用来|提醒|未通过/.test(message.value));
const orderLine = computed(() => stationBrief(mode).purpose);
const stepTitle = computed(() => {
  if (step.value.phase === 'original') return '先看旧板怎样控制风机，暂时别改';
  if (step.value.phase === 'diagnose') return '刚才30℃时，风机为什么没转？';
  if (step.value.phase === 'flow') {
    const device = mode === 'cross' ? '导行屏' : mode === 'minimum' ? '充电柜' : '风机';
    return step.value.slot === 'diamond' ? `${device}要先判断什么？` : step.value.slot === 'yes' ? `回答“是”，${device}该做什么？` : `回答“否”，${device}该做什么？`;
  }
  if (step.value.phase === 'lock') return '三张卡齐了，请确认你的分支规则';
  if (step.value.phase === 'sentence') return mode === 'cross' ? '给小巡说说你的指路安排' : mode === 'minimum' ? '给小电说说你的充电安排' : mode === 'repair' ? '给老修说说修改后的安排' : '给阿绿说说你的风机安排';
  if (step.value.phase === 'predict') return step.value.temperature ? `先猜一猜：${step.value.temperature}℃时风机会怎样？` : '三种温度都猜好了，再到现场检验';
  return props.measured === false ? '程序准备好了，先去读取现场数据' : thermal ? '预测已记下，现在去现场运行' : '程序准备好了，回现场先作本次预测';
});
const companionName = computed(() => mode === 'repair' ? '🔧 维修员老修' : mode === 'cross' ? '👮 巡检员小巡' : mode === 'minimum' ? '⚡ 储能柜小电' : '👩‍🌾 园艺员阿绿');
const companionTip = computed(() => {
  const p = step.value.phase;
  if (p === 'original') return '先别改旧控制板！点下方按钮回现场，用 30℃ 跑一次旧程序，亲眼抓出它的故障。';
  if (mistakeCount.value <= 0) return '';
  if (p === 'diagnose') return '对照上方“故障放大镜”：30℃ 满足 ≥30℃，本来应该开风机，可旧程序却把【是】和【否】两个出口动作接反了！点下面前两项进入修板吧。';
  if (p === 'flow') {
    if (mistakeCount.value === 1) {
      return mode === 'sale' || mode === 'repair'
        ? '第 1 级引导（指方向）：先检查菱形框里是不是放了能回答“是/否”的温度判断条件（注意 30℃ 分界线），再看“是/否”两个出口动作是否相反！'
        : mode === 'cross'
          ? '第 1 级引导（指方向）：先在判断框里询问附近有没有可用天桥，再为“是（有天桥）”和“否（无天桥）”分别安排通行方式！'
          : '第 1 级引导（指方向）：先在判断框里比较 A、B 两块电池的电量大小，再把优先充电口接给电量更少的那块电池！';
    }
    if (slotName.value === 'diamond') {
      if (mode === 'sale') return '手把手引导 ① 填【菱形判断框】：温室告示说“达到 30℃ 就开风机”。30℃ 也要算达标，请选包含 30℃ 的【温度≥30℃？】（或选【温度＜30℃？】反过来接动作）！';
      if (mode === 'repair') return '手把手引导 ① 修【菱形判断框】：你可以选【温度≥30℃？】（下一步把是/否动作摆正），也可以选【温度＜30℃？】（保持原动作）！';
      if (mode === 'cross') return '手把手引导 ① 填【判断框】：过马路前，导行屏要先看“附近有没有可用的过街天桥或地下通道”！';
      return '手把手引导 ① 填【判断框】：我们要找出 A 和 B 谁的电量更少，请选【电量 a＜b？】或【电量 a＞b？】放进判断框比大小！';
    }
    if (slotName.value === 'yes') {
      const cond = cardLabel(board.value.diamond);
      if (mode === 'sale' || mode === 'repair') {
        const isLt = board.value.diamond === 'lt30' || board.value.diamond === 'le30';
        return `手把手引导 ② 填左边【是（条件成立）】格：你选了“${cond}”。当这个条件成立时，${isLt ? '温度低于 30℃，风机应该【关闭风机】' : '温度已达 30℃，风机应该【启动风机】'}！`;
      }
      if (mode === 'cross') return '手把手引导 ② 填【是（有天桥）】格：当附近有可用天桥时，游客应该【走天桥】安全过街！';
      const isLt = board.value.diamond === 'lt';
      return `手把手引导 ② 填【是（${cond}成立）】格：当 ${cond.replace('？', '')} 成立时，说明 ${isLt ? 'A 的电量更少，请选【电池A优先充电】' : 'B 的电量更少，请选【电池B优先充电】'}！`;
    }
    const yesLbl = cardLabel(board.value.yes);
    return `手把手引导 ③ 填右边【否（条件不成立）】格：左边“是”已经选了【${yesLbl}】，右边“否”请选剩下的另一个相反动作！`;
  }
  if (p === 'lock') {
    return '三张卡片已填好，请点击下方【✅ 确认分支卡片】检验你的规则！';
  }
  if (p === 'sentence') return '读一读下面这句“如果…那么…否则…”顺口溜，确认没问题就点【👍 我看懂了，下一步】！';
  if (p === 'predict') {
    const t = step.value.temperature;
    if (t) {
      const op = board.value.diamond;
      const tip30 = t === 30 ? '（注意：30℃ 正好在临界线上，“≥30℃”成立，“＜30℃”不成立哦！）' : '';
      return `手把手引导：把 ${t}℃ 代入“${cardLabel(op)}”${tip30}，成立就选“是”对应的动作，不成立就选“否”对应的动作！`;
    }
    return '29℃、30℃、31℃ 三种温度都猜好啦！快点下方【📝 记下预测，下一步】！';
  }
  return '';
});
const wizardStepIndex = computed(() => {
  const p = step.value.phase;
  if (p === 'original' || p === 'diagnose' || (p === 'flow' && slotName.value === 'diamond')) return 1;
  if ((p === 'flow' && (slotName.value === 'yes' || slotName.value === 'no')) || p === 'lock') return 2;
  if (p === 'sentence') return 3;
  return 4;
});
function cardSubHint(id: string) {
  if (mistakeCount.value <= 0) return '';
  if (mistakeCount.value === 1) {
    const card = cards.value.find(c => c.id === id);
    return card?.kind === 'condition' ? '类别：判断条件卡' : '类别：执行动作卡';
  }
  const tier3 = mistakeCount.value >= 3;
  const map: Record<string, string> = {
    ge30: `达到或超过30℃（含30℃）${tier3 ? ' 👆点这里修正' : ' ⭐推荐'}`,
    lt30: `低于30℃（不含30℃）${tier3 ? ' 👆可选修法' : ' ⭐推荐'}`,
    gt30: '超过30℃（不含刚好30℃）',
    le30: '不超过30℃（30℃及以下）',
    on: '🌀 吹风给温室菜苗降温',
    off: '🛑 停机省电休息',
    'bridge-q': `🌉 看附近有没有天桥${tier3 ? ' 👆点这里修正' : ' ⭐推荐'}`,
    'green-q': '⚠️ 绿灯不能用来决定走桥还是斑马线',
    bridge: '🚶 从过街天桥安全通行',
    crossing: '🚦 去斑马线按信号灯通行',
    lt: `🔋 判断 A 电量是不是比 B 少${tier3 ? ' 👆点这里修正' : ' ⭐推荐'}`,
    gt: '🔋 判断 A 电量是不是比 B 多',
    a: '⚡ 把优先充电口接给 A 电池',
    b: '⚡ 把优先充电口接给 B 电池'
  };
  return map[id] || '';
}
function isRecommendedCard(id: string) {
  if (mistakeCount.value < 3 || step.value.phase !== 'flow') return false;
  const s = slotName.value;
  if (mode === 'sale' || mode === 'repair') {
    if (s === 'diamond') return id === 'ge30' || id === 'lt30';
    if (s === 'yes') return id === (board.value.diamond === 'lt30' ? 'off' : 'on');
    if (s === 'no') return id === (board.value.yes === 'off' ? 'on' : 'off');
  }
  if (mode === 'cross') {
    if (s === 'diamond') return id === 'bridge-q';
    if (s === 'yes') return id === 'bridge';
    if (s === 'no') return id === 'crossing';
  }
  if (mode === 'minimum') {
    if (s === 'diamond') return id === 'lt';
    if (s === 'yes') return id === (board.value.diamond === 'gt' ? 'b' : 'a');
    if (s === 'no') return id === (board.value.yes === 'b' ? 'a' : 'b');
  }
  return false;
}
const dragLabel = ref('');
const dragPoint = ref<{ x: number; y: number } | null>(null);
let drag: { id: string; x: number; y: number; moved: boolean } | null = null;
let unsubscribe: (() => void) | undefined;

function showScaffold(context: any) {
 const help=context.scaffold;
 if(!help || context.levelId!==mode || !scaffoldMatches(help,step.value))return;
 const key=String(help.key || help.eventKey || help.at || JSON.stringify(help));
 const target=help.target || {};
 const phase=step.value.phase;
 const matches=help.kind==='reason'?false:target.cardId?phase==='flow' && choices.value.some(card=>card.id===target.cardId):phase==='predict'||phase==='flow'||phase==='diagnose';
 if(!matches)return;
 if(!claimScaffold(`flow:${mode}`,key))return;
 toolAnswer.value={key,action:help.action || help.lines?.[0] || '看看刚才的结果。',why:help.why || help.lines?.slice(1).join('') || help.message || '',origin:'scaffold',level:help.level,stepKey:stepKey.value,target};
}
function clearHelp(retire=false){
 if(retire){const help=getContext()?.scaffold;if(help)claimScaffold(`flow:${mode}`,String(help.key || help.eventKey || help.at || JSON.stringify(help)));}
 toolAnswer.value=null;
}
function highlightChoice(id:string){return assistedChoice(toolAnswer.value,stepKey.value,id);}
function highlightOperation(key:string){return assistedOperation(toolAnswer.value,stepKey.value,key);}
function highlightField(field:string){return assistedField(toolAnswer.value,String(stepKey.value),field);}
async function reviewKnowledge(){try{await request('learn');}catch(error){message.value=error instanceof Error?error.message:'知识卡暂时没打开。';}}
function cardLabel(id: string) { return cards.value.find(card => card.id === id)?.label || ''; }
function publish(extra: Record<string, unknown> = {}) {
  window.dispatchEvent(new CustomEvent('lesson-artifact', { detail: toPlain({ flow: board.value, sentence: sentence.value, predictionsLocked: predictions.value, diagnoseAnswer: diagnose.value, flowMistakes: mistakeCount.value, panel: view.value, ...(lockedConfig.value ? { config: lockedConfig.value } : {}), ...extra }) }));
}
function remember() {
  history.value.push(panelEditSnapshot({ flow: board.value, sentence: sentence.value, predictions: predictions.value, diagnose: diagnose.value, slot: editingSlot.value, config: lockedConfig.value }));
  clearHelp(true);
}
function undo() {
  const previous = history.value.pop();
  if (!previous || toolBusy.value) return;
  clearHelp(true);
  board.value = previous.flow; sentence.value = previous.sentence; predictions.value = previous.predictions;
  diagnose.value = previous.diagnose; editingSlot.value = previous.slot; lockedConfig.value = previous.config;
  message.value = '已撤回上一步，可以重新选择。'; toolAnswer.value = null;
  publish();
}
function selectSlot(slot: 'diamond' | 'yes' | 'no') {
  if (mode === 'repair' && !props.diagnosed) return;
  if (step.value.phase !== 'flow' && step.value.phase !== 'lock') return;
  editingSlot.value = slot;
  board.value = { ...board.value, locked: false, preset: false };
}
function choose(id: string) { if (step.value.phase === 'flow' && step.value.slot) putCard(step.value.slot, id); }
function putCard(slot: 'diamond' | 'yes' | 'no', cardId: string) {
  const blocked = repairEditMessage(mode === 'repair', !!props.diagnosed);
  if (blocked) { message.value = blocked; return; }
  if (step.value.phase !== 'flow' || slot !== step.value.slot || !cardId) return;
  remember();
  board.value = placeCard(board.value, slot, cardId);
  predictions.value = emptyPredictions(); sentence.value = emptySentence(mode);
  editingSlot.value = slot === 'diamond' ? 'yes' : slot === 'yes' ? 'no' : '';
  message.value = ''; publish();
}
function onDrop(slot: 'diamond' | 'yes' | 'no', event: DragEvent) {
  const id = event.dataTransfer?.getData('text/plain') || '';
  if (id) putCard(slot, id);
}
function beginDrag(id: string, event: PointerEvent) {
  if (event.button !== 0 || step.value.phase !== 'flow') return;
  drag = { id, x: event.clientX, y: event.clientY, moved: false };
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
}
function moveDrag(event: PointerEvent) {
  if (drag && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 8) {
    drag.moved = true; dragLabel.value = cardLabel(drag.id); dragPoint.value = { x: event.clientX, y: event.clientY };
  }
}
function endDrag(event: PointerEvent) {
  if (!drag) return;
  const current = drag; cancelDrag();
  if (!current.moved) return;
  const card = event.currentTarget as HTMLElement | null;
  const swallow = (click: Event) => { click.preventDefault(); click.stopImmediatePropagation(); };
  card?.addEventListener('click', swallow, { capture: true, once: true });
  window.setTimeout(() => card?.removeEventListener('click', swallow, { capture: true }), 0);
  const slot = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-slot]')?.getAttribute('data-slot');
  if (slot === 'diamond' || slot === 'yes' || slot === 'no') putCard(slot, current.id);
}
function cancelDrag() { drag = null; dragLabel.value = ''; dragPoint.value = null; }
function triggerMistakeModal(kind: 'flow' | 'diagnose' = 'flow', extraPublish: Record<string, unknown> = {}) {
  mistakeCount.value += 1;
  const modal = buildMistakeModal(mode, board.value, mistakeCount.value, kind);
  guideModal.value = modal;
  if (kind === 'flow') {
    board.value = { ...board.value, locked: false, preset: false };
    editingSlot.value = modal.targetSlot;
  }
  message.value = modal.summary;
  publish(extraPublish);
}
function closeGuideModal() {
  guideModal.value = null;
}
function selectDiagnosis(value: string) {
  if (value === 'none') {
    triggerMistakeModal('diagnose');
    return;
  }
  remember(); diagnose.value = value; editingSlot.value = 'diamond';
  board.value = { ...board.value, locked: false, preset: false }; message.value = ''; publish();
}
function editFlow() {
  if (mode === 'repair' && !props.diagnosed) return;
  remember(); editingSlot.value = 'diamond'; board.value = { ...board.value, locked: false, preset: false };
  sentence.value = emptySentence(mode); predictions.value = emptyPredictions(); message.value = ''; publish();
}
function lock() {
  const result = lockFlow(mode, board.value);
  remember();
  if (!result.ok) {
    board.value = result.flow;
    triggerMistakeModal('flow', 'mCodes' in result ? { mCodes: result.mCodes } : {});
    return;
  }
  const logicCheck = flowLogicGuidance(mode, board.value);
  if (!logicCheck.ok) {
    triggerMistakeModal('flow');
    return;
  }
  board.value = result.flow; message.value = result.message;
  if (result.config) { lockedConfig.value = result.config; sentence.value = sentenceFromFlow(mode, result.flow); }
  publish();
}
function confirmSentence(next: Sentence) {
  remember(); sentence.value = next; message.value = ''; publish();
}
function predict(value: string) {
  const temperature = step.value.temperature;
  if (temperature !== 29 && temperature !== 30 && temperature !== 31) return;
  remember(); predictions.value = setPrediction(predictions.value, temperature, value); message.value = ''; publish();
}
function lockTable() {
  const result = lockPredictions(predictions.value);
  remember(); predictions.value = result.table; message.value = result.ok ? '' : result.message; publish();
}
async function useTool() {
  if (!canUseTool(support.value, toolBusy.value)) return;
  toolBusy.value = true;
  try {
    const current = step.value;
    const phase = current.phase === 'lock' ? { phase: 'confirm' } : current.phase === 'original' ? { phase: 'predict', temperature: 30 } : current.phase === 'predict' && current.temperature === null ? { phase: 'confirm-predictions' } : current;
    const requestedStep=stepKey.value;
    const result = await request<{ hint: { key: string; action: string; why: string; target?: AssistanceTarget }; remaining: number; used: number }>('toolHint', { step: phase });
    if(requestedStep===stepKey.value)toolAnswer.value = {...result.hint,origin:'tool',stepKey:requestedStep};
    support.value = { ...support.value, remaining: result.remaining, used: result.used };
  } catch (error) { message.value = error instanceof Error ? error.message : '法宝暂时没打开，请再试一次。'; }
  finally { toolBusy.value = false; }
}
function finish(action: string) {
  if (action !== 'close') {
    const logicCheck = flowLogicGuidance(mode, board.value);
    if (!logicCheck.ok && !(mode === 'repair' && !props.diagnosed)) {
      sentence.value = emptySentence(mode);
      predictions.value = emptyPredictions();
      triggerMistakeModal('flow');
      return;
    }
  } else if (board.value.locked && !(mode === 'repair' && !props.diagnosed)) {
    const logicCheck = flowLogicGuidance(mode, board.value);
    if (!logicCheck.ok) {
      sentence.value = emptySentence(mode);
      predictions.value = emptyPredictions();
      triggerMistakeModal('flow');
      return;
    }
  }
  clearHelp(true);
  publish({ panel: '' });
  close?.('flow-panel', { action, flow: toPlain(board.value), sentence: toPlain(sentence.value), predictions: toPlain(predictions.value) });
}
function onKey(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  event.preventDefault(); event.stopPropagation();
  if (guideModal.value) {
    guideModal.value = null;
    return;
  }
  clearHelp(true);
  publish({ panel: '' });
  close?.('flow-panel', { action: 'close', flow: toPlain(board.value), sentence: toPlain(sentence.value), predictions: toPlain(predictions.value) });
}
onMounted(() => {
  const initial = lockFlow(mode, { ...board.value, locked: false });
  if (board.value.locked && initial.ok && initial.config) lockedConfig.value = initial.config;
  if (board.value.locked && !sentence.value.locked) sentence.value = sentenceFromFlow(mode, board.value);
  if (props.preview === 'predict') { sentence.value = lockSentence(mode, sentenceFromFlow(mode, board.value), board.value).sentence; }
  const ctxRuns = (getContext()?.runs || []).slice(getContext()?.evidenceStart || 0);
  const wrongRunCount = ctxRuns.filter((r: any) => r.correct === false).length;
  const hadWrong = wrongRunCount > 0;
  if (hadWrong && mistakeCount.value < wrongRunCount) {
    mistakeCount.value = wrongRunCount;
  }
  const logicCheck = flowLogicGuidance(mode, board.value);
  if (board.value.locked && !board.value.preset && (hadWrong || !logicCheck.ok) && (mode !== 'repair' || props.diagnosed)) {
    board.value = { ...board.value, locked: false, preset: false };
    sentence.value = emptySentence(mode);
    predictions.value = emptyPredictions();
    editingSlot.value = logicCheck.ok ? 'diamond' : logicCheck.slot;
    if (!logicCheck.ok) {
      if (mistakeCount.value === 0) mistakeCount.value = 1;
      guideModal.value = buildMistakeModal(mode, board.value, mistakeCount.value, 'flow');
      message.value = logicCheck.message;
    }
  }
  unsubscribe = subscribeContext(context => { support.value = context.support; showScaffold(context); });
  publish(); window.addEventListener('keydown', onKey, true);
  void nextTick(() => document.querySelector<HTMLElement>('.studio')?.focus());
});
onUnmounted(() => { unsubscribe?.(); window.removeEventListener('keydown', onKey, true); });
</script>

<template>
  <div class="studio-shade">
    <section class="studio" :class="{ 'studio-alarm': alarm }" role="dialog" aria-label="规则控制柜" tabindex="-1">
      <header class="guided-tools">
        <button type="button" @click="reviewKnowledge">📖 巡检手册</button>
        <button type="button" :disabled="!history.length || toolBusy" @click="undo">↶ 撤回上一步</button>
        <button type="button" :disabled="!canUseTool(support, toolBusy)" @click="useTool">✨ 通关法宝 · 还剩 {{ support?.remaining ?? '—' }} 次</button>
        <button type="button" class="guided-close" aria-label="关闭面板" @click="onKey({ key: 'Escape', preventDefault(){}, stopPropagation(){} } as KeyboardEvent)">×</button>
      </header>
      <p class="studio-kicker">{{ mode === 'repair' ? '返修控制柜 · 分步向导工作台' : mode === 'cross' ? '智能导行屏 · 分步向导工作台' : mode === 'minimum' ? '节能配电柜 · 分步向导工作台' : '规则控制柜 · 分步向导工作台' }}</p>
      <ol class="wizard-steps" aria-label="控制柜四步向导">
        <li :class="{ done: wizardStepIndex > 1, active: wizardStepIndex === 1 }"><span>①</span> 选判断条件</li>
        <li :class="{ done: wizardStepIndex > 2, active: wizardStepIndex === 2 }"><span>②</span> 选“是/否”动作</li>
        <li :class="{ done: wizardStepIndex > 3, active: wizardStepIndex === 3 }"><span>③</span> 读顺口溜确认</li>
        <li :class="{ done: step.phase === 'run', active: wizardStepIndex === 4 }"><span>④</span> {{ thermal ? '猜结果并启动' : '回现场预测运行' }}</li>
      </ol>
      <div v-if="companionTip" class="companion-banner" role="note" data-testid="companion-banner">
        <strong>{{ companionName }}手把手引导（已点错 {{ mistakeCount }} 次）：</strong>
        <span>{{ companionTip }}</span>
        <button v-if="mistakeCount > 0 && !guideModal" type="button" class="reopen-guide-btn" @click="guideModal = buildMistakeModal(mode, board, mistakeCount, step.phase === 'diagnose' ? 'diagnose' : 'flow')">💡 查看引导弹窗</button>
      </div>
      <div v-if="mode === 'repair' && mistakeCount >= 1 && (step.phase === 'diagnose' || step.phase === 'flow')" class="fault-magnifier" aria-label="故障放大镜对比">
        <div><b>📋 温室告示约定：</b>达到或超过 30℃（≥30℃）→ <b>启动风机</b>；低于 30℃ → <b>关闭风机</b></div>
        <div><b>🔍 刚才旧板故障：</b>条件写了“温度≥30℃？”，但【是】出口却连了<b>关闭风机</b>（两个出口动作装反了，或条件符号写反了）！</div>
      </div>
      <p class="studio-order">{{ orderLine }}</p>
      <h2 class="guided-step" :class="{ 'clue-focus': highlightField('reading') || highlightField('input') }">{{ stepTitle }}</h2>
      <aside v-if="toolAnswer" class="tool-answer" role="status">
        <button type="button" aria-label="关闭法宝提示" @click="clearHelp(false)">×</button>
        <strong>{{ toolAnswer.origin === 'scaffold' ? '探究帮助：' : '法宝示范：' }}{{ toolAnswer.action }}</strong><p v-if="toolAnswer.why">为什么：{{ toolAnswer.why }}</p>
      </aside>
      <div v-if="step.phase === 'diagnose'" class="diagnose" data-focus="diagnose-cards">
        <button
          v-for="item in [
            ['condition','🔍 判断条件不合适（或需要配合调整）'],
            ['exit', mistakeCount >= 2 ? '🔄 两个分支出口的动作接反了（⭐推荐）' : '🔄 两个分支出口的动作接反了'],
            ['none','❓ 程序没有问题']
          ]"
          :key="item[0]"
          type="button"
          :class="{ 'answer-demo': highlightChoice(item[0]), 'recommend-choice': mistakeCount >= 2 && item[0] === 'exit' }"
          @click="selectDiagnosis(item[0])"
        >{{ item[1] }}</button>
      </div>
      <div v-if="view === 'flow' && step.phase !== 'diagnose'" data-panel="flow">
        <div v-if="thermal" class="textbook" aria-label="教材式流程图">
          <div class="tb-terminal" >开始</div>
          <div class="tb-stem" aria-hidden="true"></div>
          <div class="tb-para" ><span>读取温度</span></div>
          <div class="tb-stem" aria-hidden="true"></div>
          <button type="button" class="flow-slot tb-diamond" data-slot="diamond" :class="{ next: slotName === 'diamond', 'clue-focus': highlightField('condition') }" :data-focus="slotName === 'diamond' ? 'slot-next' : undefined" @click="selectSlot('diamond')" @dragover.prevent @drop="onDrop('diamond', $event)">
            <svg viewBox="0 0 200 120" aria-hidden="true"><polygon points="100,6 194,60 100,114 6,60" /></svg>
            <span>{{ cardLabel(board.diamond) || '🔶 待填判断条件' }}</span>
          </button>
          <svg class="tb-fork" viewBox="0 0 320 52" aria-hidden="true">
            <defs>
              <marker id="tb-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill="#184c3b" />
              </marker>
            </defs>
            <path d="M160 2 V14 L78 44" fill="none" stroke="#184c3b" stroke-width="3" marker-end="url(#tb-arrow)"  />
            <path d="M160 14 L242 44" fill="none" stroke="#184c3b" stroke-width="3" marker-end="url(#tb-arrow)"  />
            <text x="92" y="26">是</text>
            <text x="206" y="26">否</text>
          </svg>
          <div class="tb-actions">
            <button v-for="slot in (['yes','no'] as const)" :key="slot" type="button" class="flow-slot tb-rect" :data-slot="slot" :class="{ next: slotName === slot, 'clue-focus': slot === 'diamond' && highlightField('condition') }" :data-focus="slotName === slot ? 'slot-next' : undefined" @click="selectSlot(slot)" @dragover.prevent @drop="onDrop(slot, $event)">{{ cardLabel(board[slot]) || (slot === 'yes' ? '🟩 待填“是”动作' : '🟧 待填“否”动作') }}</button>
          </div>
          <svg class="tb-join" viewBox="0 0 320 36" aria-hidden="true">
            <path d="M78 2 L160 28 L242 2" fill="none" stroke="#184c3b" stroke-width="3" />
          </svg>
          <div class="tb-stem" aria-hidden="true"></div>
          <div class="tb-terminal" >结束</div>
        </div>
        <div v-else class="flow-board">
          <div class="flow-fixed">开始</div>
          <div class="flow-fixed">输入</div>
          <button v-for="slot in (['diamond','yes','no'] as const)" :key="slot" type="button" class="flow-slot" :data-slot="slot" :class="{ next: slotName === slot }" :data-focus="slotName === slot ? 'slot-next' : undefined" @click="selectSlot(slot)" @dragover.prevent @drop="onDrop(slot, $event)"><b>{{ slot === 'diamond' ? '🔶 判断条件' : slot === 'yes' ? '🟩 是（成立）' : '🟧 否（不成立）' }}</b><span>{{ cardLabel(board[slot]) || '👆 待填卡片' }}</span></button>
          <div class="flow-fixed">结束</div>
        </div>

        <div v-if="step.phase === 'flow' && mistakeCount >= 2" class="tray-guide-banner" data-testid="recommend-category-banner">
          <strong v-if="slotName === 'diamond'">⭐ 推荐类别：判断条件卡 · 请从下方选一张能回答“是/否”的条件卡放进【菱形判断框】！</strong>
          <strong v-else-if="slotName === 'yes'">⭐ 推荐类别：执行动作卡 · 请从下方选一张动作卡放进左边【“是”（条件成立）动作格】！</strong>
          <strong v-else>⭐ 推荐类别：执行动作卡 · 请从下方选另一张动作卡放进右边【“否”（条件不成立）动作格】！</strong>
        </div>
        <div v-else-if="step.phase === 'flow'" class="tray-neutral-banner">
          <span>当前正在填写：<b>{{ slotName === 'diamond' ? '① 菱形判断框' : slotName === 'yes' ? '② 左边“是”出口格' : '③ 右边“否”出口格' }}</b>（请自己思考并从下方卡片池点选一张卡片放入）</span>
        </div>
        <div v-if="step.phase === 'flow'" class="card-tray" data-region="flow-cards">
          <button v-for="card in choices" :key="card.id" type="button" :class="{ 'answer-demo': highlightChoice(card.id), 'recommend-card': isRecommendedCard(card.id) }" class="studio-card" draggable="true" @dragstart="$event.dataTransfer?.setData('text/plain', card.id)" @pointerdown="beginDrag(card.id, $event)" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="cancelDrag" @click="choose(card.id)">
            <span class="card-main-label">{{ card.label }}</span>
            <small v-if="cardSubHint(card.id)" class="card-sub-hint">{{ cardSubHint(card.id) }}</small>
          </button>
        </div>
        <div v-if="step.phase === 'flow' && inactiveChoices.length" class="inactive-tray" aria-hidden="true">
          <span>🔒 另一类卡片（当前空格不放这类卡）：</span>
          <span v-for="item in inactiveChoices" :key="item.id" class="inactive-chip">{{ item.label }}</span>
        </div>
        <p v-if="step.phase === 'flow'" class="guided-note">单击一张卡，就会放进当前格子；也可以点击流程图里的格子重新修改。</p>
      </div>
      <SentencePanel v-if="step.phase === 'sentence'" :mode="mode" :flow="board" :sentence="sentence" :assisted-confirm="highlightOperation('sentence-confirm')" @locked="confirmSentence" />
      <div v-if="step.phase === 'predict'" class="predict-table" data-focus="predict-row-next">
        <p class="program-clue" :class="{ 'clue-focus': highlightField('condition') }">当前判断：{{ cardLabel(board.diamond) }}<br>是（条件成立）→ {{ cardLabel(board.yes) }}；否（条件不成立）→ {{ cardLabel(board.no) }}</p>
        <div v-if="step.temperature" class="predict-row next">
          <span class="predict-call-badge">当温度是 <b>{{ step.temperature }}℃</b> 时，请根据你的规则预测结果：</span>
          <button type="button" class="predict-option" :class="{ 'answer-demo': highlightChoice('on') }" @click="predict('on')">🌀 我猜：启动风机</button>
          <button type="button" class="predict-option" :class="{ 'answer-demo': highlightChoice('off') }" @click="predict('off')">🛑 我猜：关闭风机</button>
        </div>
        <ol class="prediction-log"><li v-for="temperature in ([29,30,31] as const)" :key="temperature" :class="{ 'active-temp': step.temperature === temperature, 'done-temp': !!predictions[temperature] }">{{ temperature }}℃：{{ predictions[temperature] === 'on' ? '✅ 我猜启动' : predictions[temperature] === 'off' ? '✅ 我猜关闭' : '⏳ 还没猜' }}</li></ol>
      </div>
      <p v-if="step.phase === 'original'" class="guided-note">先记下你的预测，再让旧程序运行。亲眼看到问题以后，才能动手修。</p>
      <p v-if="message" class="studio-message" role="status">{{ message }}</p>
      <div v-if="dragLabel && dragPoint" class="drag-ghost" :style="{ left: `${dragPoint.x}px`, top: `${dragPoint.y}px` }">{{ dragLabel }}</div>
      <div class="studio-actions">
        <button v-if="step.phase === 'lock' || (step.phase === 'flow' && board.diamond && board.yes && board.no)" type="button" class="primary-next pulse-cta" data-focus="flow-lock" :class="{ 'answer-demo': highlightOperation('flow-lock') }" @click="lock">✅ 确认分支卡片</button>
        <button v-else-if="step.phase === 'predict' && step.temperature === null" type="button" class="primary-next pulse-cta" data-focus="predict-lock" :class="{ 'answer-demo': highlightOperation('predict-lock') }" @click="lockTable">📝 记下预测，下一步</button>
        <button v-else-if="step.phase === 'original'" type="button" class="primary-next pulse-cta" @click="finish('close')">👉 回现场，先预测原程序</button>
        <button v-else-if="step.phase === 'run'" type="button" class="primary-next pulse-cta" data-focus="run-next" :class="{ 'answer-demo': highlightOperation('run-next') }" @click="finish(measured !== false ? 'run' : 'close')">{{ measured === false ? (thermal ? '✅ 保存修改，去温度探头采样' : '✅ 保存修改，去读取现场数据') : thermal ? '🚀 执行本次温度，去现场看结果' : '🚀 保存程序，立即预测并运行' }}</button>
        <button v-if="(step.phase === 'lock' || step.phase === 'sentence' || step.phase === 'run') && !(mode === 'repair' && !diagnosed)" type="button" class="edit-program" @click="editFlow">🔄 重新选卡</button>
      </div>

      <div v-if="guideModal" class="guide-modal-backdrop" role="alertdialog" aria-modal="true" aria-label="手把手引导对话框" data-testid="mistake-guide-modal" @click.self="closeGuideModal">
        <div class="guide-modal-card">
          <header class="guide-modal-header">
            <span class="guide-modal-badge">{{ guideModal.tierBadge }}</span>
            <strong class="guide-modal-speaker">{{ guideModal.speaker }} · 手把手引导对话框</strong>
          </header>
          <h3 class="guide-modal-title">{{ guideModal.title }}</h3>
          <div class="guide-modal-summary">
            <strong>🧐 刚才点错的原因：</strong>
            <p>{{ guideModal.summary }}</p>
          </div>
          <div class="guide-modal-direction">
            <p>{{ guideModal.directionHint }}</p>
          </div>
          <div v-if="guideModal.showFaultMagnifier" class="fault-magnifier modal-magnifier">
            <div><b>📋 温室告示约定：</b>达到或超过 30℃（≥30℃）→ <b>启动风机</b>；低于 30℃ → <b>关闭风机</b></div>
            <div><b>🔍 旧板故障对比：</b>旧板条件是“温度≥30℃？”，但【是】出口却连了<b>关闭风机</b>！</div>
          </div>
          <div v-if="guideModal.tier >= 2" class="guide-modal-steps">
            <strong>{{ guideModal.tier === 2 ? '⭐ 第 2 级引导（缩范围 + 开启推荐类别）：' : '👆 第 3 级引导（手把手三步示范）：' }}</strong>
            <ol>
              <li v-for="(line, idx) in guideModal.steps" :key="idx">{{ line }}</li>
            </ol>
          </div>
          <footer class="guide-modal-footer">
            <button type="button" class="guide-modal-confirm" data-testid="close-guide-modal" @click="closeGuideModal">💡 我知道了，继续尝试</button>
          </footer>
        </div>
      </div>
    </section>
  </div>
</template>
<style scoped>
.studio-shade { position: absolute; inset: 0; display: flex; align-items: flex-end; justify-content: center; padding: 14px; background: #102e2c66; pointer-events: auto; font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif; }
.studio { position: relative; width: min(880px, 100%); max-height: 94%; overflow: auto; padding: 12px 18px 10px; border: 3px solid #184c3b; border-radius: 18px; background: #fffaf0; color: #1a3a31; box-shadow: 0 14px 40px #061e2b66; }
.studio-alarm { background: #fff1f0; border-color: #a33b32; }
.studio-kicker { margin: 0 0 6px; font-weight: 800; color: #22694d; }
.wizard-steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; list-style: none; margin: 0 0 8px; padding: 0; }
.wizard-steps li { padding: 6px 8px; border-radius: 10px; border: 2px solid #cbd5e1; background: #f8fafc; color: #64748b; font-size: 13px; font-weight: 700; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wizard-steps li.done { border-color: #16a34a; background: #dcfce7; color: #166534; }
.wizard-steps li.active { border-color: #1c624d; background: #eef6e5; color: #163e31; font-weight: 900; }
.companion-banner { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 9px 12px; margin-bottom: 8px; border-radius: 12px; border: 2px solid #f59e0b; background: #fffbeb; color: #183c30; font-size: 15px; line-height: 1.5; }
.companion-banner strong { color: #b45309; }
.reopen-guide-btn { margin-left: auto; padding: 4px 10px; border-radius: 999px; border: 1.5px solid #d97706; background: #fef3c7; color: #92400e; font-size: 13px; font-weight: 800; }
.fault-magnifier { padding: 8px 12px; margin-bottom: 8px; border-radius: 12px; border: 2px dashed #dc2626; background: #fef2f2; color: #7f1d1d; font-size: 14px; line-height: 1.55; }
.studio-order { margin: 0 0 6px; font-size: 13px; line-height: 1.45; color: #475569; }
.diagnose, .studio-actions, .predict-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
.diagnose button, .studio-actions button, .predict-row button, .studio-lock, .studio-card, .flow-slot, .sentence-slot { font: inherit; min-height: 44px; border: 2px solid #73957a; border-radius: 10px; background: #fffef8; color: #163e31; }
.diagnose .recommend-choice { border-color: #ff1493; background: #fdf2f8; font-weight: 800; }
.flow-board { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 10px 0; }
.flow-fixed, .flow-slot { padding: 8px; text-align: center; }
.flow-fixed { border: 2px dashed #8aa888; border-radius: 12px; }
.flow-slot.next, .sentence-slot.next { outline: 4px solid #0f766e; outline-offset: 3px; background: #eef6e5 !important; }
.textbook { display: flex; flex-direction: column; align-items: center; width: min(420px, 100%); margin: 0 auto 4px; }
.tb-terminal { border: 3px solid #184c3b; border-radius: 999px; background: #e7f2ea; min-width: 112px; padding: 5px 20px; text-align: center; font-weight: 800; }
.tb-stem { width: 3px; height: 10px; background: #184c3b; position: relative; }
.tb-stem::after { content: ''; position: absolute; left: -5px; bottom: -1px; border: 6px solid transparent; border-top-color: #184c3b; }
.tb-para { border: 3px solid #184c3b; background: #f4f8ea; transform: skewX(-16deg); min-width: 148px; padding: 8px 18px; text-align: center; }
.tb-para span { display: inline-block; transform: skewX(16deg); }
.tb-diamond { position: relative; width: 186px; height: 96px; margin: 2px 0; border: 0; background: transparent; }
.tb-diamond svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.tb-diamond polygon { fill: #fff6d8; stroke: #184c3b; stroke-width: 3; }
.tb-diamond span { position: relative; z-index: 1; pointer-events: none; font-size: 14px; line-height: 1.25; font-weight: 800; }
.tb-diamond.next { outline: none; background: transparent !important; }
.tb-diamond.next polygon { fill: #eef6e5; stroke: #0f766e; stroke-width: 6; }
.tb-fork, .tb-join { width: min(320px, 100%); height: 32px; display: block; }
.tb-fork text { font-size: 16px; font-weight: 800; fill: #184c3b; }
.tb-actions { display: flex; justify-content: center; gap: 28px; width: 100%; }
.tb-rect { min-width: 136px; min-height: 44px; border: 3px solid #184c3b; border-radius: 6px; background: #fff; padding: 6px 10px; font-weight: 800; }
.drag-ghost { position: fixed; z-index: 4000; transform: translate(-50%, -130%); pointer-events: none; background: #fffef8; border: 2px solid #184c3b; border-radius: 10px; padding: 8px 10px; font-weight: 700; }
.predict-table.focus-target { outline: 3px solid #1175bb; outline-offset: 4px; }
.studio-lock.next, .studio-lock.focus-target { outline: 4px solid #ff1493; outline-offset: 3px; }
.flow-slot b, .flow-slot span { display: block; }
.tray-guide-banner { margin: 6px 0 4px; padding: 6px 12px; border-radius: 10px; background: #fdf2f8; border: 2px solid #ff80ab; color: #9d174d; font-size: 15px; }
.tray-neutral-banner { margin: 6px 0 4px; padding: 6px 12px; border-radius: 10px; background: #f1f5f9; border: 1.5px solid #94a3b8; color: #1e293b; font-size: 14px; }
.card-tray { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px; margin: 4px 0; padding: 8px; border: 2px solid #d7e2cc; border-radius: 12px; background: #f8fbf4; }
.studio-card { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; padding: 9px 12px; touch-action: none; border: 2.5px solid #1c624d; background: #ffffff; text-align: left; transition: transform 0.1s ease, border-color 0.1s ease; }
.studio-card:hover { transform: translateY(-2px); border-color: #0f766e; background: #fffdf5; }
.studio-card.recommend-card { border: 3px solid #ff1493; background: #fdf2f8; box-shadow: 0 0 0 3px #ff149333; }
.card-main-label { font-size: 17px; font-weight: 800; color: #163e31; }
.card-sub-hint { font-size: 12px; font-weight: 700; color: #be185d; }
.inactive-tray { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 4px 0; padding: 5px 10px; border-radius: 8px; background: #f1f5f9; color: #64748b; font-size: 12px; opacity: 0.78; }
.inactive-chip { padding: 2px 8px; border-radius: 6px; border: 1px dashed #94a3b8; background: #e2e8f0; }
.studio-lock { margin-top: 8px; background: #1c624d; color: white; border-color: #1c624d; }
.studio-message { margin: 8px 0; padding: 10px 14px; background: #fff1f0; border: 2px solid #dc2626; border-left: 6px solid #dc2626; border-radius: 10px; color: #7f1d1d; font-size: 16px; font-weight: 800; }
.guided-tools { position: sticky; top: -12px; z-index: 20; display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; padding: 6px 0; margin: -4px 0 8px; background: #fffaf0; }
.guided-tools button { min-height: 40px; padding: 6px 10px; border: 2px solid #73957a; border-radius: 10px; background: #fffef8; color: #163e31; font: inherit; }
.guided-tools button:disabled { opacity: .55; }
.guided-tools .guided-close { min-width: 40px; font-size: 25px; padding: 0; }
.guided-step { margin: 4px 0 8px; font-size: 19px; line-height: 1.45; }
.guided-note { margin: 4px 0; font-size: 13px; line-height: 1.45; color: #475569; }
.tool-answer { position: relative; padding: 12px 48px 12px 16px; margin-bottom: 10px; border: 2px solid #ba8b28; border-radius: 12px; background: #fff3cf; line-height: 1.65; }
.tool-answer p { margin: 4px 0; }
.tool-answer button { position: absolute; right: 8px; top: 8px; width: 32px; height: 32px; border: 0; border-radius: 50%; background: #f2dfab; color: #163e31; font-size: 24px; }
.studio-actions .primary-next { background: linear-gradient(135deg, #1c624d, #0f766e); color: #fff; border: 3px solid #ffd166; padding: 10px 20px; font-weight: 800; box-shadow: 0 4px 14px #0f766e55; }
.pulse-cta { animation: cta-bounce 1.2s ease-in-out infinite; }
@keyframes cta-bounce { 0%, 100% { box-shadow: 0 4px 14px #0f766e55; } 50% { box-shadow: 0 0 0 5px #ff149366, 0 6px 20px #0f766e99; border-color: #ff1493; } }
.studio-actions .edit-program { padding: 8px 12px; font-size: 14px; }
.predict-call-badge { width: 100%; font-size: 15px; color: #163e31; background: #eef6e5; padding: 6px 10px; border-radius: 8px; border: 1.5px solid #73957a; }
.predict-option { padding: 10px 18px; font-weight: 800; border: 2.5px solid #1c624d !important; }
.predict-option:hover { border-color: #0f766e !important; background: #eef6e5 !important; }
.prediction-log { display: flex; flex-wrap: wrap; gap: 8px 20px; padding-left: 20px; line-height: 1.7; }
.prediction-log .active-temp { font-weight: 900; color: #0f766e; text-decoration: underline; }
.prediction-log .done-temp { color: #15803d; font-weight: 700; }
.answer-demo { outline:4px solid #ba8b28; outline-offset:3px; background:#fff3cf!important; } .clue-focus { outline:3px solid #1175bb; outline-offset:3px; }
.program-clue{padding:10px 14px;border:2px solid #7ba06f;border-radius:10px;line-height:1.65;background:#eef6e5;font-weight:700;}

.guide-modal-backdrop { position: fixed; inset: 0; z-index: 3500; display: flex; align-items: center; justify-content: center; padding: 18px; background: #071f18b8; backdrop-filter: blur(2px); }
.guide-modal-card { width: min(640px, 100%); max-height: 90vh; overflow: auto; padding: 20px 24px 18px; border-radius: 20px; border: 4px solid #f59e0b; background: #fffef8; color: #1a3a31; box-shadow: 0 20px 55px #00000099; }
.guide-modal-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.guide-modal-badge { padding: 4px 12px; border-radius: 999px; background: #fef3c7; border: 2px solid #f59e0b; color: #92400e; font-size: 14px; font-weight: 900; }
.guide-modal-speaker { font-size: 15px; color: #1c624d; font-weight: 800; }
.guide-modal-title { margin: 0 0 10px; font-size: 20px; color: #78350f; }
.guide-modal-summary { padding: 10px 14px; margin-bottom: 10px; border-radius: 12px; border: 2px solid #fca5a5; background: #fef2f2; color: #7f1d1d; font-size: 16px; line-height: 1.55; }
.guide-modal-summary p { margin: 4px 0 0; font-weight: 700; }
.guide-modal-direction { padding: 10px 14px; margin-bottom: 10px; border-radius: 12px; border: 2px solid #fcd34d; background: #fffbeb; color: #78350f; font-size: 15px; line-height: 1.55; font-weight: 650; }
.guide-modal-direction p { margin: 0; }
.modal-magnifier { margin-bottom: 10px; }
.guide-modal-steps { padding: 10px 14px; margin-bottom: 12px; border-radius: 12px; border: 2px solid #86efac; background: #f0fdf4; color: #14532d; font-size: 15px; line-height: 1.6; }
.guide-modal-steps ol { margin: 6px 0 0; padding-left: 20px; font-weight: 700; }
.guide-modal-footer { display: flex; justify-content: flex-end; margin-top: 8px; }
.guide-modal-confirm { min-height: 48px; padding: 10px 24px; border-radius: 12px; border: 3px solid #ffd166; background: linear-gradient(135deg, #be185d, #ff1493); color: #ffffff; font-size: 17px; font-weight: 900; box-shadow: 0 6px 18px #be185d55; }
</style>
