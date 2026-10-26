<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { getContext, request, subscribeContext } from '../classroom-bridge';
import { assistedChoice, assistedField, assistedOperation, claimScaffold, scaffoldMatches, type Assistance, type AssistanceTarget } from './assisted-focus';
import { stationBrief } from '../../../public/task-guidance.mjs';
import { toPlain } from './plain';
import SentencePanel from './SentencePanel.vue';
import { canUseTool, cardsFor, cardsForSlot, emptyFlow, emptyPredictions, emptySentence, guidedPanelStep, lockFlow, lockPredictions, lockSentence, panelEditSnapshot, placeCard, repairEditMessage, repairPreset, sentenceFromFlow, setPrediction, thermalTrials, type Flow, type Predictions, type Sentence, type PanelEdit } from './flow-model';

const props = withDefaults(defineProps<{
  mode?: string; flow?: Flow; sentence?: Sentence; predictions?: Predictions;
  diagnosed?: boolean; diagnoseAnswer?: string; preview?: string; focusStrength?: number; measured?: boolean;
}>(), { measured: true });
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
const support = ref(getContext()?.support);
const toolBusy = ref(false);
const toolAnswer = ref<({ key: string; action: string; why: string } & Assistance) | null>(null);
const thermal = mode === 'sale' || mode === 'repair';
const sunTemp = ref<29 | 30 | 31>((getContext()?.draft?.scene?.temperatureCase as 29 | 30 | 31) || 30);
const cards = computed(() => cardsFor(mode));
const step = computed(() => guidedPanelStep({ mode, flow: board.value, sentence: sentence.value, predictions: predictions.value, diagnosed: props.diagnosed, diagnose: diagnose.value, slot: editingSlot.value }));
const stepKey=computed(()=>JSON.stringify(step.value));
watch(stepKey,()=>{toolAnswer.value=null;});
const view = computed(() => step.value.phase === 'predict' ? 'predict' : step.value.phase === 'sentence' ? 'sentence' : 'flow');
const slotName = computed(() => step.value.slot || '');
const choices = computed(() => step.value.slot ? cardsForSlot(mode, step.value.slot) : []);
const alarm = computed(() => /菱形|不能用来/.test(message.value));
const orderLine = computed(() => stationBrief(mode).purpose);
const trials = computed(() => {
  const cfg = lockedConfig.value || getContext()?.draft?.config || { operator: '>=', yes: 'on', no: 'off' };
  return thermal ? thermalTrials(cfg as { operator?: string; yes?: string; no?: string }) : [];
});
const activeTrial = computed(() => trials.value.find(item => item.temperature === sunTemp.value) || null);
const stepTitle = computed(() => {
  if (step.value.phase === 'original') return '先看旧板怎样控制风机，暂时别改';
  if (step.value.phase === 'diagnose') return '刚才30℃时，问题可能在哪里？';
  if (step.value.phase === 'flow') {
    const device=mode==='cross'?'导行屏':mode==='minimum'?'充电柜':'风机';
    return step.value.slot==='diamond'?`${device}要先判断什么？`:step.value.slot==='yes'?`回答“是”，${device}该做什么？`:`回答“否”，${device}该做什么？`;
  }
  if (step.value.phase === 'lock') return '三张卡齐了，检查一下你的程序';
  if (step.value.phase === 'sentence') return mode==='cross'?'给小巡说说你的指路安排':mode==='minimum'?'给小电说说你的充电安排':mode==='repair'?'给老修说说修改后的安排':'给阿绿说说你的风机安排';
  if (step.value.phase === 'predict') return step.value.temperature ? `先猜一猜：${step.value.temperature}℃时风机会怎样？` : '三种温度都猜好了，再到现场检验';
  return props.measured === false ? '程序准备好了，先去读取现场数据' : thermal ? '预测已记下，现在去现场运行' : '程序准备好了，回现场先作本次预测';
});
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
  window.dispatchEvent(new CustomEvent('lesson-artifact', { detail: toPlain({ flow: board.value, sentence: sentence.value, predictionsLocked: predictions.value, diagnoseAnswer: diagnose.value, panel: view.value, ...(lockedConfig.value ? { config: lockedConfig.value } : {}), ...extra }) }));
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
function selectDiagnosis(value: string) {
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
  remember(); board.value = result.flow; message.value = result.message;
  if (result.ok && result.config) { lockedConfig.value = result.config; sentence.value = sentenceFromFlow(mode, result.flow); }
  else { editingSlot.value = 'diamond'; }
  publish(!result.ok && 'mCodes' in result ? { mCodes: result.mCodes } : {});
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
function finish(action: string, extra: Record<string, unknown> = {}) {
  clearHelp(true);
  publish({ panel: '' });
  close?.('flow-panel', { action, flow: toPlain(board.value), sentence: toPlain(sentence.value), predictions: toPlain(predictions.value), ...extra });
}
function runQuickTemp(t: 29 | 30 | 31) {
  sunTemp.value = t;
  finish('quick-temp', { temperature: t });
}
function onKey(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  event.preventDefault(); event.stopPropagation(); finish('close');
}
onMounted(() => {
  const initial = lockFlow(mode, { ...board.value, locked: false });
  if (board.value.locked && initial.ok && initial.config) lockedConfig.value = initial.config;
  if (board.value.locked && !sentence.value.locked) sentence.value = sentenceFromFlow(mode, board.value);
  if (props.preview === 'predict') { sentence.value = lockSentence(mode, sentenceFromFlow(mode, board.value), board.value).sentence; }
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
        <button type="button" @click="reviewKnowledge">巡检手册</button>
        <button type="button" :disabled="!history.length || toolBusy" @click="undo">撤回上一步</button>
        <button type="button" :disabled="!canUseTool(support, toolBusy)" @click="useTool">通关法宝 · 还剩 {{ support?.remaining ?? '—' }} 次</button>
        <button type="button" class="guided-close" aria-label="关闭面板" @click="finish('close')">×</button>
      </header>
      <p class="studio-kicker">{{ mode === 'repair' ? '返修控制柜 · 芯片工作台' : mode === 'cross' ? '智能导行屏 · 分支芯片台' : mode === 'minimum' ? '节能配电柜 · 比较芯片台' : '规则控制柜 · 温室芯片台' }}</p>
      <p class="studio-order">{{ orderLine }}</p>
      <h2 class="guided-step" :class="{ 'clue-focus': highlightField('reading') || highlightField('input') }">{{ stepTitle }}</h2>
      <aside v-if="toolAnswer" class="tool-answer" role="status">
        <button type="button" aria-label="关闭法宝提示" @click="clearHelp(false)">×</button>
        <strong>{{ toolAnswer.origin === 'scaffold' ? '探究帮助：' : '法宝示范：' }}{{ toolAnswer.action }}</strong><p v-if="toolAnswer.why">为什么：{{ toolAnswer.why }}</p>
      </aside>
      <div v-if="step.phase === 'diagnose'" class="diagnose" data-focus="diagnose-cards">
        <button v-for="item in [['condition','判断条件不合适'],['exit','两个动作接反了'],['none','程序没有问题']]" :key="item[0]" type="button" :class="{ 'answer-demo': highlightChoice(item[0]) }" @click="selectDiagnosis(item[0])">{{ item[1] }}</button>
      </div>
      <div v-if="view === 'flow' && step.phase !== 'diagnose'" data-panel="flow">
        <div v-if="thermal" class="textbook" aria-label="教材式流程图">
          <div class="tb-terminal" >开始</div>
          <div class="tb-stem" aria-hidden="true"></div>
          <div class="tb-para" ><span>读取温度</span></div>
          <div class="tb-stem" aria-hidden="true"></div>
          <button type="button" class="flow-slot tb-diamond" data-slot="diamond" :class="{ next: slotName === 'diamond', 'clue-focus': highlightField('condition') }" :data-focus="slotName === 'diamond' ? 'slot-next' : undefined" @dragover.prevent @drop="onDrop('diamond', $event)">
            <svg viewBox="0 0 200 120" aria-hidden="true"><polygon points="100,6 194,60 100,114 6,60" /></svg>
            <span>{{ cardLabel(board.diamond) || '空' }}</span>
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
            <button v-for="slot in (['yes','no'] as const)" :key="slot" type="button" class="flow-slot tb-rect" :data-slot="slot" :class="{ next: slotName === slot, 'clue-focus': slot === 'diamond' && highlightField('condition') }" :data-focus="slotName === slot ? 'slot-next' : undefined" @dragover.prevent @drop="onDrop(slot, $event)">{{ cardLabel(board[slot]) || '空' }}</button>
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
          <button v-for="slot in (['diamond','yes','no'] as const)" :key="slot" type="button" class="flow-slot" :data-slot="slot" :class="{ next: slotName === slot }" :data-focus="slotName === slot ? 'slot-next' : undefined" @dragover.prevent @drop="onDrop(slot, $event)"><b>{{ slot === 'diamond' ? '判断' : slot === 'yes' ? '是' : '否' }}</b><span>{{ cardLabel(board[slot]) || '空' }}</span></button>
          <div class="flow-fixed">结束</div>
        </div>

        <div v-if="step.phase === 'flow'" class="card-tray" data-region="flow-cards">
          <button v-for="card in choices" :key="card.id" type="button" :class="{ 'answer-demo': highlightChoice(card.id) }" class="studio-card" draggable="true" @dragstart="$event.dataTransfer?.setData('text/plain', card.id)" @pointerdown="beginDrag(card.id, $event)" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="cancelDrag" @click="choose(card.id)">{{ card.label }}</button>
        </div>
        <p v-if="step.phase === 'flow'" class="guided-note">单击一张卡，就会放进亮着的格子。也可以拖进去。</p>
      </div>
      <SentencePanel v-if="step.phase === 'sentence'" :mode="mode" :flow="board" :sentence="sentence" :assisted-confirm="highlightOperation('sentence-confirm')" @locked="confirmSentence" />
      <div v-if="step.phase === 'predict'" class="predict-table" data-focus="predict-row-next">
        <p class="program-clue" :class="{ 'clue-focus': highlightField('condition') }">当前判断：{{ cardLabel(board.diamond) }}<br>是→{{ cardLabel(board.yes) }}；否→{{ cardLabel(board.no) }}</p>
        <div v-if="step.temperature" class="predict-row next">
          <button type="button" class="predict-option" :class="{ 'answer-demo': highlightChoice('on') }" @click="predict('on')">我猜：启动风机</button>
          <button type="button" class="predict-option" :class="{ 'answer-demo': highlightChoice('off') }" @click="predict('off')">我猜：关闭风机</button>
        </div>
        <ol class="prediction-log"><li v-for="temperature in ([29,30,31] as const)" :key="temperature">{{ temperature }}℃：{{ predictions[temperature] === 'on' ? '我猜启动' : predictions[temperature] === 'off' ? '我猜关闭' : '还没猜' }}</li></ol>
      </div>
      <div v-if="thermal && step.phase === 'run'" class="sun-lab" aria-label="现场阳光温度模拟实验台">
        <div class="sun-lab-head">
          <strong>☀️ 温室阳光调温实验台（免跑腿直测）</strong>
          <span>拖动滑块或点温度卡，直接在现场驱动探头、风机与核验仪！</span>
        </div>
        <div class="sun-slider-row">
          <label for="sun-range">阳光强度：<b>{{ sunTemp }}℃ {{ sunTemp === 29 ? '⛅ 多云凉爽' : sunTemp === 30 ? '🌤️ 30℃临界点' : '☀️ 烈日高温' }}</b></label>
          <input id="sun-range" v-model.number="sunTemp" type="range" min="29" max="31" step="1" />
        </div>
        <div v-if="activeTrial" class="sun-circuit-preview">
          <span>探头输入 <b>{{ activeTrial.temperature }}℃</b></span>
          <span>→ 判断 <b>{{ activeTrial.condition ? '成立（走“是”）' : '不成立（走“否”）' }}</b></span>
          <span>→ 风机 <b>{{ activeTrial.fan }}</b></span>
          <span :class="activeTrial.correct ? 'chip-ok' : 'chip-warn'">{{ activeTrial.correct ? '🌱 符合告示' : '🥀 与告示不符' }}</span>
        </div>
        <div class="sun-quick-btns">
          <button v-for="t in ([29,30,31] as const)" :key="t" type="button" class="sun-temp-btn" :class="{ active: sunTemp === t }" @click="runQuickTemp(t)">
            {{ t === 29 ? '⛅ 实测 29℃' : t === 30 ? '🌤️ 实测 30℃(临界)' : '☀️ 实测 31℃' }}
          </button>
          <button type="button" class="sun-sweep-btn" @click="finish('quick-sweep')">⚡ 一键连测 29/30/31℃ 并核验</button>
        </div>
      </div>
      <p v-if="step.phase === 'original'" class="guided-note">先记下你的预测，再让旧程序运行。亲眼看到问题以后，才能动手修。</p>
      <p v-if="message" class="studio-message" role="status">{{ message }}</p>
      <div v-if="dragLabel && dragPoint" class="drag-ghost" :style="{ left: `${dragPoint.x}px`, top: `${dragPoint.y}px` }">{{ dragLabel }}</div>
      <div class="studio-actions">
        <button v-if="step.phase === 'lock'" type="button" class="primary-next" data-focus="flow-lock" :class="{ 'answer-demo': highlightOperation('flow-lock') }" @click="lock">确认这份程序</button>
        <button v-else-if="step.phase === 'predict' && step.temperature === null" type="button" class="primary-next" data-focus="predict-lock" :class="{ 'answer-demo': highlightOperation('predict-lock') }" @click="lockTable">记下预测，下一步</button>
        <button v-else-if="step.phase === 'original'" type="button" class="primary-next" @click="finish('close')">回现场，先预测原程序</button>
        <button v-else-if="step.phase === 'run'" type="button" class="primary-next" data-focus="run-next" :class="{ 'answer-demo': highlightOperation('run-next') }" @click="finish(thermal && measured !== false ? 'run' : 'close')">{{ measured === false ? (thermal ? '保存修改，去读取温度' : '保存修改，去读取现场数据') : thermal ? '执行本次温度，去现场看结果' : '保存程序，回现场先预测' }}</button>
        <button v-if="(step.phase === 'lock' || step.phase === 'sentence' || step.phase === 'run') && !(mode === 'repair' && !diagnosed)" type="button" class="edit-program" @click="editFlow">重新选卡</button>
      </div>
    </section>
  </div>
</template>
<style scoped>
.studio-shade { position: absolute; inset: 0; display: flex; align-items: flex-end; justify-content: center; padding: 16px; background: #102e2c55; pointer-events: auto; font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif; }
.studio { position: relative; width: min(860px, 100%); max-height: 92%; overflow: auto; padding: 12px 16px 8px; border: 3px solid #184c3b; border-radius: 18px; background: #fffaf0; color: #1a3a31; }
.studio-alarm { background: #fff1f0; border-color: #a33b32; }
.studio-kicker { margin: 0 0 8px; font-weight: 800; color: #22694d; }
.studio-order { margin: 0 0 8px; font-size: 13px; line-height: 1.5; }
.diagnose, .studio-actions, .predict-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
.diagnose button, .studio-actions button, .predict-row button, .studio-lock, .studio-card, .flow-slot, .sentence-slot { font: inherit; min-height: 44px; border: 2px solid #73957a; border-radius: 10px; background: #fffef8; color: #163e31; }
.flow-board { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 10px 0; }
.flow-fixed, .flow-slot { padding: 8px; text-align: center; }
.flow-fixed { border: 2px dashed #8aa888; border-radius: 12px; }
.flow-slot.next, .sentence-slot.next { outline: 4px solid #e39b00; outline-offset: 3px; }
.textbook { display: flex; flex-direction: column; align-items: center; width: min(420px, 100%); margin: 0 auto 4px; }
.tb-terminal { border: 3px solid #184c3b; border-radius: 999px; background: #e7f2ea; min-width: 112px; padding: 5px 20px; text-align: center; font-weight: 800; }
.tb-stem { width: 3px; height: 10px; background: #184c3b; position: relative; }
.tb-stem::after { content: ''; position: absolute; left: -5px; bottom: -1px; border: 6px solid transparent; border-top-color: #184c3b; }
.tb-para { border: 3px solid #184c3b; background: #f4f8ea; transform: skewX(-16deg); min-width: 148px; padding: 8px 18px; text-align: center; }
.tb-para span { display: inline-block; transform: skewX(16deg); }
.tb-diamond { position: relative; width: 176px; height: 96px; margin: 2px 0; border: 0; background: transparent; }
.tb-diamond svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.tb-diamond polygon { fill: #fff6d8; stroke: #184c3b; stroke-width: 3; }
.tb-diamond span { position: relative; z-index: 1; pointer-events: none; font-size: 14px; line-height: 1.25; }
.tb-diamond.next { outline: none; }
.tb-diamond.next polygon { stroke: #e39b00; stroke-width: 6; }
.tb-fork, .tb-join { width: min(320px, 100%); height: 32px; display: block; }
.tb-fork text { font-size: 16px; font-weight: 800; fill: #184c3b; }
.tb-actions { display: flex; justify-content: center; gap: 28px; width: 100%; }
.tb-rect { min-width: 128px; min-height: 44px; border: 3px solid #184c3b; border-radius: 2px; background: #fff; padding: 6px 10px; }
.drag-ghost { position: fixed; z-index: 4000; transform: translate(-50%, -130%); pointer-events: none; background: #fffef8; border: 2px solid #184c3b; border-radius: 10px; padding: 8px 10px; font-weight: 700; }
.predict-table.focus-target { outline: 3px solid #1175bb; outline-offset: 4px; }
.studio-lock.next, .studio-lock.focus-target { outline: 4px solid #e39b00; outline-offset: 3px; }
.flow-slot b, .flow-slot span { display: block; }
.card-tray { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0; padding: 6px; border: 2px solid #d7e2cc; border-radius: 12px; }
.studio-card { padding: 8px 10px; touch-action: none; }
.studio-lock { margin-top: 8px; background: #1c624d; color: white; border-color: #1c624d; }
.studio-message { margin: 8px 0; padding: 8px 10px; background: #fff1f0; border-left: 4px solid #a33b32; }
.guided-tools { position: sticky; top: -12px; z-index: 20; display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; padding: 6px 0; margin: -4px 0 8px; background: #fffaf0; }
.guided-tools button { min-height: 40px; padding: 6px 10px; border: 2px solid #73957a; border-radius: 10px; background: #fffef8; color: #163e31; font: inherit; }
.guided-tools button:disabled { opacity: .55; }
.guided-tools .guided-close { min-width: 40px; font-size: 25px; padding: 0; }
.guided-step { margin: 8px 0 12px; font-size: 19px; line-height: 1.5; }
.guided-note { margin: 6px 0; font-size: 14px; line-height: 1.5; }
.tool-answer { padding: 12px 16px; border: 2px solid #73957a; border-radius: 12px; background: #edf4e5; line-height: 1.7; }
.tool-answer p { margin: 4px 0; }
.tool-answer { position: relative; padding-right: 48px; margin-bottom: 12px; background: #fff3cf; border-color: #ba8b28; }
.tool-answer button { position: absolute; right: 8px; top: 8px; width: 32px; height: 32px; border: 0; border-radius: 50%; background: #f2dfab; color: #163e31; font-size: 24px; }
.studio-actions .primary-next { background: #1c624d; color: #fff; border-color: #1c624d; padding: 10px 18px; font-weight: 750; }
.studio-actions .edit-program { padding: 8px 12px; font-size: 14px; }
.prediction-log { display: flex; flex-wrap: wrap; gap: 8px 24px; padding-left: 22px; line-height: 1.8; }
.answer-demo { outline:4px solid #ba8b28; outline-offset:3px; background:#fff3cf!important; } .clue-focus { outline:3px solid #1175bb; outline-offset:3px; }
.program-clue{padding:10px 14px;border:1px solid #a4b69b;border-radius:10px;line-height:1.65;background:#f3f6ee;}
.sun-lab { margin: 10px 0; padding: 12px 14px; border: 2px solid #e39b00; border-radius: 14px; background: linear-gradient(135deg, #fffbeb, #fef3c7); color: #183c30; }
.sun-lab-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px; margin-bottom: 8px; font-size: 14px; }
.sun-slider-row { display: flex; align-items: center; gap: 12px; margin: 6px 0; }
.sun-slider-row input[type=range] { flex: 1; accent-color: #d97706; cursor: pointer; }
.sun-circuit-preview { display: flex; flex-wrap: wrap; gap: 8px 14px; padding: 8px 10px; border-radius: 10px; background: #fffaf0; border: 1px dashed #d97706; font-size: 14px; margin-bottom: 8px; }
.chip-ok { color: #15803d; font-weight: 800; }
.chip-warn { color: #b91c1c; font-weight: 800; }
.sun-quick-btns { display: flex; flex-wrap: wrap; gap: 8px; }
.sun-temp-btn, .sun-sweep-btn { min-height: 40px; padding: 6px 12px; border-radius: 10px; border: 2px solid #d97706; background: #fffef8; color: #163e31; font-weight: 750; }
.sun-temp-btn.active { background: #fde68a; border-color: #b45309; }
.sun-sweep-btn { background: #d97706; color: #fff; border-color: #b45309; }
</style>
