<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { inject } from 'vue';
import SentencePanel from './SentencePanel.vue';
import { toPlain } from './plain';
import { canRunVerify, cardsFor, emptyFlow, emptyPredictions, emptySentence, lockFlow, lockPredictions, nextSlot, placeCard, releaseAfterProgramEdit, repairEditMessage, repairPreset, repairSymbolHint, setPrediction, thermalTrials, unlockPredictionsOnEdit, type Flow, type Predictions, type Sentence, type ThermalTrial } from './flow-model';

const props = defineProps<{
  mode?: string;
  flow?: Flow;
  sentence?: Sentence;
  predictions?: Predictions;
  diagnosed?: boolean;
  diagnoseAnswer?: string;
  preview?: string;
  focusStrength?: number;
}>();
const close = inject<(name: string, data?: unknown) => void>('rpgGuiClose', () => undefined);
const mode = props.mode || 'sale';
const board = ref<Flow>(props.flow || (mode === 'repair' ? repairPreset() : emptyFlow()));
const sentence = ref<Sentence>(props.sentence || emptySentence(mode));
const predictions = ref<Predictions>(props.predictions || emptyPredictions());
const view = ref(props.preview === 'sentence' ? 'sentence' : props.preview === 'predict' ? 'predict' : 'flow');
const picked = ref('');
const message = ref('');
const diagnose = ref(props.diagnoseAnswer || '');
const lockedConfig = ref<Record<string, unknown> | null>(null);
const cards = computed(() => cardsFor(mode));
const slotName = computed(() => nextSlot(board.value));
const nextTemperature = computed(() => {
  if (predictions.value.locked) return 0;
  return ([29, 30, 31] as const).find(temperature => predictions.value[temperature] !== 'on' && predictions.value[temperature] !== 'off') ?? null;
});
const lockedOut = computed(() => mode === 'repair' && !props.diagnosed);
const alarm = computed(() => /菱形|不能用来/.test(message.value));
const thermal = mode === 'sale' || mode === 'repair';
const showVerify = computed(() => canRunVerify(mode, board.value, predictions.value));
const trials = ref<ThermalTrial[] | null>(null);
const verifyStep = ref(-1);
const dragLabel = ref('');
const dragPoint = ref<{ x: number; y: number } | null>(null);
let verifyTimer = 0;
let drag: { id: string; x: number; y: number; moved: boolean } | null = null;

function cardLabel(id: string) {
  return cards.value.find(card => card.id === id)?.label || '';
}
function clearVerify() {
  window.clearInterval(verifyTimer);
  verifyTimer = 0;
  trials.value = null;
  verifyStep.value = -1;
}
function publish(extra: Record<string, unknown> = {}) {
  const detail: Record<string, unknown> = { flow: board.value, sentence: sentence.value, predictionsLocked: predictions.value, panel: view.value, ...extra };
  if (!('diagnoseAnswer' in extra) && diagnose.value) detail.diagnoseAnswer = diagnose.value;
  window.dispatchEvent(new CustomEvent('lesson-artifact', { detail: toPlain(detail) }));
}
function syncLocks() {
  const released = releaseAfterProgramEdit(board.value, predictions.value, sentence.value);
  predictions.value = released.predictions;
  sentence.value = released.sentence;
}
function show(next: 'flow' | 'sentence' | 'predict') { view.value = next; publish(); }
function choose(id: string) {
  picked.value = id;
  message.value = '';
}
function putCard(slot: 'diamond' | 'yes' | 'no', cardId: string) {
  const blocked = repairEditMessage(mode === 'repair', !!props.diagnosed);
  if (blocked) { message.value = blocked; return; }
  if (!cardId) { message.value = '先点一张卡片，再点空格。'; return; }
  board.value = placeCard(board.value, slot, cardId);
  syncLocks();
  picked.value = '';
  message.value = '';
  clearVerify();
  publish();
}
function fill(slot: 'diamond' | 'yes' | 'no') { putCard(slot, picked.value); }
function onDrop(slot: 'diamond' | 'yes' | 'no', event: DragEvent) {
  const id = event.dataTransfer?.getData('text/plain') || '';
  if (!id) return;
  putCard(slot, id);
}
function beginDrag(id: string, event: PointerEvent) {
  if (event.button !== 0) return;
  drag = { id, x: event.clientX, y: event.clientY, moved: false };
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
}
function moveDrag(event: PointerEvent) {
  if (!drag) return;
  if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 8) {
    drag.moved = true;
    dragLabel.value = cardLabel(drag.id);
    dragPoint.value = { x: event.clientX, y: event.clientY };
  }
}
function endDrag(event: PointerEvent) {
  if (!drag) return;
  const current = drag;
  drag = null;
  dragLabel.value = '';
  dragPoint.value = null;
  if (!current.moved) return;
  const card = event.currentTarget as HTMLElement | null;
  if (card) {
    const swallow = (click: Event) => {
      click.preventDefault();
      click.stopImmediatePropagation();
    };
    card.addEventListener('click', swallow, { capture: true, once: true });
    window.setTimeout(() => card.removeEventListener('click', swallow, { capture: true }), 0);
  }
  const slot = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-slot]')?.getAttribute('data-slot');
  if (slot === 'diamond' || slot === 'yes' || slot === 'no') putCard(slot, current.id);
}
function cancelDrag() {
  drag = null;
  dragLabel.value = '';
  dragPoint.value = null;
}
function lit(id: 'start' | 'input' | 'diamond' | 'yes' | 'no' | 'end') {
  const trial = trials.value && verifyStep.value >= 0 ? trials.value[verifyStep.value] : null;
  if (!trial) return false;
  if (id === 'yes' || id === 'no') return trial.branch === id;
  return true;
}
function runVerify() {
  if (!board.value.locked || !lockedConfig.value || !thermal) return;
  trials.value = thermalTrials(lockedConfig.value as { operator?: string; yes?: string; no?: string });
  verifyStep.value = 0;
  window.clearInterval(verifyTimer);
  verifyTimer = window.setInterval(() => {
    if (verifyStep.value >= 2) { window.clearInterval(verifyTimer); return; }
    verifyStep.value += 1;
  }, 800);
}
function lock() {
  const blocked = repairEditMessage(mode === 'repair', !!props.diagnosed);
  if (blocked) { message.value = blocked; return; }
  const result = lockFlow(mode, board.value);
  const symbol = mode === 'repair' ? repairSymbolHint(result.config as { operator?: string; yes?: string; no?: string }) : '';
  message.value = symbol ? `${result.message} ${symbol}` : result.message;
  board.value = result.flow;
  if (!result.ok && 'mCodes' in result && Array.isArray(result.mCodes) && result.mCodes.length) publish({ mCodes: result.mCodes });
  if (result.ok && result.config) {
    clearVerify();
    const changed = !!lockedConfig.value && JSON.stringify(lockedConfig.value) !== JSON.stringify(result.config);
    predictions.value = unlockPredictionsOnEdit(predictions.value, changed);
    if (changed) sentence.value = { ...sentence.value, locked: false };
    lockedConfig.value = result.config;
    if (mode === 'sale' && !predictions.value.locked) view.value = 'predict';
    publish({ config: result.config });
  }
}
function lockTable() {
  const result = lockPredictions(predictions.value);
  message.value = result.message;
  predictions.value = result.table;
  publish();
}
function finish(action: string) {
  publish({ panel: '' });
  close?.('flow-panel', { action, flow: toPlain(board.value), sentence: toPlain(sentence.value), predictions: toPlain(predictions.value) });
}
function onKey(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  finish('close');
}
onMounted(() => {
  const initial = lockFlow(mode, { ...board.value, locked: false });
  if (board.value.locked && initial.ok && initial.config) lockedConfig.value = initial.config;
  syncLocks();
  publish();
  window.addEventListener('keydown', onKey, true);
  void nextTick(() => document.querySelector<HTMLElement>('.studio')?.focus());
});
onUnmounted(() => { window.clearInterval(verifyTimer); window.removeEventListener('keydown', onKey, true); });
</script>

<template>
  <div class="studio-shade">
    <section class="studio" :class="{ 'studio-alarm': alarm }" role="dialog" aria-label="规则控制柜" tabindex="-1">
      <button class="studio-close" type="button" aria-label="关闭面板" @click="finish('close')">×</button>
      <p class="studio-kicker">{{ mode === 'repair' ? '返修控制柜' : mode === 'cross' ? '导行屏' : mode === 'minimum' ? '配电柜' : '规则控制柜' }}</p>
      <div class="studio-tabs">
        <button type="button" :class="{ on: view === 'flow' }" @click="show('flow')">流程图</button>
        <button type="button" :class="{ on: view === 'sentence' }" @click="show('sentence')">拼句</button>
        <button v-if="mode === 'sale' || mode === 'repair'" type="button" :class="{ on: view === 'predict' }" data-focus="predict-tab" @click="show('predict')">预测</button>
      </div>
      <div v-if="mode === 'repair'" class="diagnose" data-focus="diagnose-cards">
        <button v-for="item in [['condition','错在条件'],['exit','错在出口'],['none','都没错']]" :key="item[0]" type="button" :class="{ on: diagnose === item[0] }" @click="diagnose = item[0]; publish()">{{ item[1] }}</button>
      </div>
      <div v-if="view === 'flow'" data-panel="flow">
        <div v-if="thermal" class="textbook" aria-label="教材式流程图">
          <div class="tb-terminal" :class="{ lit: lit('start') }">开始</div>
          <div class="tb-stem" aria-hidden="true"></div>
          <div class="tb-para" :class="{ lit: lit('input') }"><span>{{ trials && verifyStep >= 0 ? `读取温度 ${trials[verifyStep].temperature}℃` : '读取温度' }}</span></div>
          <div class="tb-stem" aria-hidden="true"></div>
          <button type="button" class="flow-slot tb-diamond" data-slot="diamond" :class="{ next: slotName === 'diamond', lit: lit('diamond') }" :data-focus="slotName === 'diamond' ? 'slot-next' : undefined" @click="fill('diamond')" @dragover.prevent @drop="onDrop('diamond', $event)">
            <svg viewBox="0 0 200 120" aria-hidden="true"><polygon points="100,6 194,60 100,114 6,60" /></svg>
            <span>{{ cardLabel(board.diamond) || '空' }}</span>
          </button>
          <svg class="tb-fork" viewBox="0 0 320 52" aria-hidden="true">
            <defs>
              <marker id="tb-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill="#184c3b" />
              </marker>
            </defs>
            <path d="M160 2 V14 L78 44" fill="none" stroke="#184c3b" stroke-width="3" marker-end="url(#tb-arrow)" :class="{ hot: lit('yes') }" />
            <path d="M160 14 L242 44" fill="none" stroke="#184c3b" stroke-width="3" marker-end="url(#tb-arrow)" :class="{ hot: lit('no') }" />
            <text x="92" y="26">是</text>
            <text x="206" y="26">否</text>
          </svg>
          <div class="tb-actions">
            <button v-for="slot in (['yes','no'] as const)" :key="slot" type="button" class="flow-slot tb-rect" :data-slot="slot" :class="{ next: slotName === slot, lit: lit(slot) }" :data-focus="slotName === slot ? 'slot-next' : undefined" @click="fill(slot)" @dragover.prevent @drop="onDrop(slot, $event)">{{ cardLabel(board[slot]) || '空' }}</button>
          </div>
          <svg class="tb-join" viewBox="0 0 320 36" aria-hidden="true">
            <path d="M78 2 L160 28 L242 2" fill="none" stroke="#184c3b" stroke-width="3" />
          </svg>
          <div class="tb-stem" aria-hidden="true"></div>
          <div class="tb-terminal" :class="{ lit: lit('end') }">结束</div>
        </div>
        <div v-else class="flow-board">
          <div class="flow-fixed">开始</div>
          <div class="flow-fixed">输入</div>
          <button v-for="slot in (['diamond','yes','no'] as const)" :key="slot" type="button" class="flow-slot" :data-slot="slot" :class="{ next: slotName === slot }" :data-focus="slotName === slot ? 'slot-next' : undefined" @click="fill(slot)" @dragover.prevent @drop="onDrop(slot, $event)"><b>{{ slot === 'diamond' ? '判断' : slot === 'yes' ? '是' : '否' }}</b><span>{{ cardLabel(board[slot]) || '空' }}</span></button>
          <div class="flow-fixed">结束</div>
        </div>
        <div class="card-tray" data-region="flow-cards">
          <button v-for="card in cards" :key="card.id" type="button" class="studio-card" :class="{ on: picked === card.id }" draggable="true" @dragstart="$event.dataTransfer?.setData('text/plain', card.id)" @pointerdown="beginDrag(card.id, $event)" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="cancelDrag" @click="choose(card.id)">{{ card.label }}</button>
        </div>
        <button type="button" class="studio-lock" data-focus="flow-lock" @click="lock">锁定流程图</button>
        <button v-if="showVerify" type="button" class="studio-lock verify-run" @click="runVerify">运行验证</button>
        <ol v-if="trials" class="verify-list">
          <li v-for="(trial, index) in trials" :key="trial.temperature" :class="{ on: index === verifyStep, wait: index > verifyStep }">
            <template v-if="index <= verifyStep">{{ trial.temperature }}℃ · 风机{{ trial.fan }} · {{ trial.correct ? '符合' : '不符合' }}</template>
            <template v-else>{{ trial.temperature }}℃</template>
          </li>
        </ol>
      </div>
      <SentencePanel v-else-if="view === 'sentence'" :mode="mode" :flow="board" :sentence="sentence" @save="sentence = $event; publish()" @locked="sentence = $event; publish()" />
      <div v-else class="predict-table" data-focus="predict-row-next">
        <div v-for="temperature in ([29,30,31] as const)" :key="temperature" class="predict-row" :class="{ next: temperature === nextTemperature }">
          <b>{{ temperature }}℃</b>
          <button type="button" class="predict-option" :class="{ on: predictions[temperature] === 'on' }" @click="predictions = setPrediction(predictions, temperature, 'on'); publish()">启动</button>
          <button type="button" class="predict-option" :class="{ on: predictions[temperature] === 'off' }" @click="predictions = setPrediction(predictions, temperature, 'off'); publish()">关闭</button>
        </div>
        <button type="button" class="studio-lock" :class="{ next: nextTemperature === null }" data-focus="predict-lock" @click="lockTable">锁定预测</button>
      </div>
      <p v-if="message" class="studio-message" role="status">{{ message }}</p>
      <div v-if="dragLabel && dragPoint" class="drag-ghost" :style="{ left: `${dragPoint.x}px`, top: `${dragPoint.y}px` }">{{ dragLabel }}</div>
      <div class="studio-actions">
        <button type="button" @click="finish('run')">执行本次温度</button>
        <button type="button" @click="finish('close')">返回现场</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.studio-shade { position: absolute; inset: 0; display: flex; align-items: flex-end; justify-content: center; padding: 16px; background: #102e2c55; pointer-events: auto; font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif; }
.studio { width: min(860px, 100%); max-height: 92%; overflow: auto; padding: 12px 16px 8px; border: 3px solid #184c3b; border-radius: 18px; background: #fffaf0; color: #1a3a31; }
.studio-alarm { background: #fff1f0; border-color: #a33b32; }
.studio-close { position: absolute; margin-left: calc(min(860px, 100%) - 64px); width: 44px; height: 44px; border: 0; border-radius: 50%; background: #e8eedf; font-size: 28px; }
.studio-kicker { margin: 0 48px 8px 0; font-weight: 800; color: #22694d; }
.studio-tabs, .diagnose, .studio-actions, .predict-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
.studio-tabs button, .diagnose button, .studio-actions button, .predict-row button, .studio-lock, .studio-card, .flow-slot, .sentence-slot { font: inherit; min-height: 44px; border: 2px solid #73957a; border-radius: 10px; background: #fffef8; color: #163e31; }
.studio-tabs button.on, .diagnose button.on, .predict-row button.on, .studio-card.on { background: #dcead0; outline: 3px solid #1175bb; }
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
.tb-diamond.lit polygon { fill: #b7e3c4; stroke: #147d78; stroke-width: 5; }
.tb-fork, .tb-join { width: min(320px, 100%); height: 32px; display: block; }
.tb-fork text { font-size: 16px; font-weight: 800; fill: #184c3b; }
.tb-fork .hot { stroke: #147d78; stroke-width: 5; }
.tb-actions { display: flex; justify-content: center; gap: 28px; width: 100%; }
.tb-rect { min-width: 128px; min-height: 44px; border: 3px solid #184c3b; border-radius: 2px; background: #fff; padding: 6px 10px; }
.tb-terminal.lit, .tb-para.lit, .tb-rect.lit { background: #b7e3c4; box-shadow: 0 0 0 4px #147d78; }
.verify-run { margin-left: 8px; background: #8a5a12; border-color: #8a5a12; }
.verify-list { margin: 4px 0; padding-left: 18px; }
.verify-list .on { font-weight: 800; }
.verify-list .wait { color: #6d7f74; }
.drag-ghost { position: fixed; z-index: 4000; transform: translate(-50%, -130%); pointer-events: none; background: #fffef8; border: 2px solid #184c3b; border-radius: 10px; padding: 8px 10px; font-weight: 700; }
.predict-row.next button { outline: 3px solid #1175bb; outline-offset: 2px; }
.studio-lock.next, .studio-lock.focus-target { outline: 4px solid #e39b00; outline-offset: 3px; }
.flow-slot b, .flow-slot span { display: block; }
.card-tray { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0; padding: 6px; border: 2px solid #d7e2cc; border-radius: 12px; }
.studio-card { padding: 8px 10px; touch-action: none; }
.studio-lock { margin-top: 8px; background: #1c624d; color: white; border-color: #1c624d; }
.studio-message { margin: 8px 0; padding: 8px 10px; background: #fff1f0; border-left: 4px solid #a33b32; }
.sentence-slots { display: flex; flex-wrap: wrap; gap: 6px; }
.sentence-slot { padding: 8px; }
</style>
