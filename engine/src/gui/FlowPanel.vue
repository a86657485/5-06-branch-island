<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { inject } from 'vue';
import SentencePanel from './SentencePanel.vue';
import { cardsFor, emptyFlow, emptyPredictions, emptySentence, lockFlow, lockPredictions, nextSlot, placeCard, repairPreset, setPrediction, type Flow, type Predictions, type Sentence } from './flow-model';

const props = defineProps<{
  mode?: string;
  flow?: Flow;
  sentence?: Sentence;
  predictions?: Predictions;
  diagnosed?: boolean;
  preview?: string;
  focusStrength?: number;
}>();
const close = inject<(name: string, data?: unknown) => void>('rpgGuiClose', () => undefined);
const mode = props.mode || 'sale';
const flow = ref<Flow>(props.flow || (mode === 'repair' ? repairPreset() : emptyFlow()));
const sentence = ref<Sentence>(props.sentence || emptySentence(mode));
const predictions = ref<Predictions>(props.predictions || emptyPredictions());
const view = ref(props.preview === 'sentence' ? 'sentence' : props.preview === 'predict' ? 'predict' : 'flow');
const picked = ref('');
const message = ref('');
const diagnose = ref('');
const cards = computed(() => cardsFor(mode));
const slotName = computed(() => nextSlot(flow.value));
const lockedOut = computed(() => mode === 'repair' && !props.diagnosed);
const alarm = computed(() => /菱形|不能用来/.test(message.value));
const labels: Record<string, string> = { diamond: '菱形 · 判断', yes: '是', no: '否' };

function publish(extra: Record<string, unknown> = {}) {
  window.dispatchEvent(new CustomEvent('lesson-artifact', { detail: { flow: flow.value, sentence: sentence.value, predictionsLocked: predictions.value, diagnoseAnswer: diagnose.value, panel: view.value, ...extra } }));
}
function show(next: 'flow' | 'sentence' | 'predict') { view.value = next; publish(); }
function choose(id: string) { picked.value = id; }
function fill(slot: 'diamond' | 'yes' | 'no') {
  if (lockedOut.value) { message.value = '先用原程序跑一次 30℃，看到故障才能改。'; return; }
  if (!picked.value) { message.value = '先点一张卡片，再点空格。'; return; }
  flow.value = placeCard(flow.value, slot, picked.value);
  picked.value = '';
  publish();
}
function onDrop(slot: 'diamond' | 'yes' | 'no', event: DragEvent) {
  const id = event.dataTransfer?.getData('text/plain');
  if (!id || lockedOut.value) return;
  flow.value = placeCard(flow.value, slot, id);
  publish();
}
function lock() {
  const result = lockFlow(mode, flow.value);
  message.value = result.message;
  flow.value = result.flow;
  if (result.ok && result.config) publish({ config: result.config });
}
function lockTable() {
  const result = lockPredictions(predictions.value);
  message.value = result.message;
  predictions.value = result.table;
  publish();
}
function finish(action: string) {
  publish({ panel: '' });
  close?.('flow-panel', { action, flow: flow.value, sentence: sentence.value, predictions: predictions.value });
}
onMounted(() => publish());
</script>

<template>
  <div class="studio-shade">
    <section class="studio" :class="{ 'studio-alarm': alarm }" role="dialog" aria-label="规则控制柜" tabindex="-1">
      <button class="studio-close" type="button" aria-label="关闭面板" @click="finish('close')">×</button>
      <p class="studio-kicker">{{ mode === 'repair' ? '返修控制柜' : mode === 'cross' ? '导行屏' : mode === 'minimum' ? '配电柜' : '规则控制柜' }}</p>
      <div class="studio-tabs">
        <button type="button" :class="{ on: view === 'flow' }" @click="show('flow')">流程图</button>
        <button type="button" :class="{ on: view === 'sentence' }" @click="show('sentence')">拼句</button>
        <button v-if="mode === 'sale' || mode === 'repair'" type="button" :class="{ on: view === 'predict' }" @click="show('predict')">预测</button>
      </div>
      <div v-if="mode === 'repair'" class="diagnose" data-focus="diagnose-cards">
        <button v-for="item in [['condition','错在条件'],['exit','错在出口'],['none','都没错']]" :key="item[0]" type="button" :class="{ on: diagnose === item[0] }" @click="diagnose = item[0]; publish()">{{ item[1] }}</button>
      </div>
      <div v-if="view === 'flow'" data-panel="flow">
        <div class="flow-board">
          <div class="flow-fixed">开始</div>
          <div class="flow-fixed">输入</div>
          <button v-for="slot in (['diamond','yes','no'] as const)" :key="slot" type="button" class="flow-slot" :class="{ next: slotName === slot }" :data-focus="slotName === slot ? 'slot-next' : undefined" @click="fill(slot)" @dragover.prevent @drop="onDrop(slot, $event)"><b>{{ labels[slot] }}</b><span>{{ cards.find(card => card.id === flow[slot])?.label || '空' }}</span></button>
          <div class="flow-fixed">结束</div>
        </div>
        <div class="card-tray" data-region="flow-cards">
          <button v-for="card in cards" :key="card.id" type="button" class="studio-card" draggable="true" @dragstart="$event.dataTransfer?.setData('text/plain', card.id)" @click="choose(card.id)">{{ card.label }}</button>
        </div>
        <button type="button" class="studio-lock" data-focus="flow-lock" @click="lock">锁定流程图</button>
      </div>
      <SentencePanel v-else-if="view === 'sentence'" :mode="mode" :flow="flow" :sentence="sentence" @save="sentence = $event; publish()" @locked="sentence = $event; publish()" />
      <div v-else class="predict-table" data-focus="predict-row-next">
        <div v-for="temperature in ([29,30,31] as const)" :key="temperature" class="predict-row">
          <b>{{ temperature }}℃</b>
          <button type="button" :class="{ on: predictions[temperature] === 'on' }" @click="predictions = setPrediction(predictions, temperature, 'on'); publish()">启动</button>
          <button type="button" :class="{ on: predictions[temperature] === 'off' }" @click="predictions = setPrediction(predictions, temperature, 'off'); publish()">关闭</button>
        </div>
        <button type="button" class="studio-lock" data-focus="predict-lock" @click="lockTable">锁定预测</button>
      </div>
      <p v-if="message" class="studio-message" role="status">{{ message }}</p>
      <div class="studio-actions">
        <button type="button" @click="finish('run')">执行本次温度</button>
        <button type="button" @click="finish('close')">返回现场</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.studio-shade { position: absolute; inset: 0; display: flex; align-items: flex-end; justify-content: center; padding: 16px; background: #102e2c55; pointer-events: auto; font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif; }
.studio { width: min(860px, 100%); max-height: 92%; overflow: auto; padding: 18px 20px 14px; border: 3px solid #184c3b; border-radius: 18px; background: #fffaf0; color: #1a3a31; }
.studio-alarm { background: #fff1f0; border-color: #a33b32; }
.studio-close { position: absolute; margin-left: calc(min(860px, 100%) - 64px); width: 44px; height: 44px; border: 0; border-radius: 50%; background: #e8eedf; font-size: 28px; }
.studio-kicker { margin: 0 48px 8px 0; font-weight: 800; color: #22694d; }
.studio-tabs, .diagnose, .studio-actions, .predict-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
.studio-tabs button, .diagnose button, .studio-actions button, .predict-row button, .studio-lock, .studio-card, .flow-slot, .sentence-slot { font: inherit; min-height: 44px; border: 2px solid #73957a; border-radius: 10px; background: #fffef8; color: #163e31; }
.studio-tabs button.on, .diagnose button.on, .predict-row button.on { background: #dcead0; }
.flow-board { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 10px 0; }
.flow-fixed, .flow-slot { padding: 8px; text-align: center; }
.flow-fixed { border: 2px dashed #8aa888; border-radius: 12px; }
.flow-slot.next, .sentence-slot.next { outline: 4px solid #e39b00; }
.flow-slot b, .flow-slot span { display: block; }
.card-tray { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; padding: 8px; border: 2px solid #d7e2cc; border-radius: 12px; }
.studio-card { padding: 8px 10px; }
.studio-lock { margin-top: 8px; background: #1c624d; color: white; border-color: #1c624d; }
.studio-message { margin: 8px 0; padding: 8px 10px; background: #fff1f0; border-left: 4px solid #a33b32; }
.sentence-slots { display: flex; flex-wrap: wrap; gap: 6px; }
.sentence-slot { padding: 8px; }
</style>
