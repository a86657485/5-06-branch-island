<script setup lang="ts">
import { computed, ref } from 'vue';
import { emptySentence, lockSentence, placeToken, sentenceTokens, type Flow, type Sentence } from './flow-model';

const props = defineProps<{ mode: string; flow: Flow; sentence?: Sentence; focusStrength?: number }>();
const emit = defineEmits<{ save: [Sentence]; locked: [Sentence] }>();
const sentence = ref<Sentence>(props.sentence || emptySentence(props.mode));
const picked = ref('');
const message = ref('');
const tokens = computed(() => sentenceTokens(props.mode, props.flow));
const nextIndex = computed(() => sentence.value.slots.findIndex(slot => !slot));

function choose(id: string) { picked.value = id; }
function fill(index: number) {
  if (!picked.value) { message.value = '先点一个词块，再点空格。'; return; }
  sentence.value = placeToken(sentence.value, index, picked.value);
  picked.value = '';
  emit('save', sentence.value);
}
function lock() {
  const result = lockSentence(props.mode, sentence.value, props.flow);
  message.value = result.message;
  sentence.value = result.sentence;
  if (result.ok) emit('locked', result.sentence);
}
function onDrop(index: number, event: DragEvent) {
  const id = event.dataTransfer?.getData('text/plain');
  if (!id) return;
  sentence.value = placeToken(sentence.value, index, id);
  emit('save', sentence.value);
}
</script>

<template>
  <section class="studio-panel" data-panel="sentence">
    <p class="studio-kicker">工作日志 · 先点词块，再点空格</p>
    <div class="sentence-slots" :data-focus="nextIndex >= 0 ? 'sentence-slot-next' : undefined">
      <button v-for="(slot, index) in sentence.slots" :key="index" type="button" class="sentence-slot" :class="{ next: index === nextIndex }" :data-slot-index="index" @click="fill(index)" @dragover.prevent @drop="onDrop(index, $event)">{{ tokens.find(token => token.id === slot)?.label || '空格' }}</button>
    </div>
    <div class="card-tray" data-region="sentence-cards">
      <button v-for="token in tokens" :key="token.id" type="button" draggable="true" class="studio-card" @dragstart="$event.dataTransfer?.setData('text/plain', token.id)" @click="choose(token.id)">{{ token.label }}</button>
    </div>
    <p v-if="message" class="studio-message">{{ message }}</p>
    <button type="button" class="studio-lock" data-focus="sentence-lock" @click="lock">提交句子</button>
  </section>
</template>

<style scoped>
.studio-panel { margin-top: 8px; }
.sentence-slots, .card-tray { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
.sentence-slot, .studio-card, .studio-lock { font: inherit; min-height: 44px; border: 2px solid #73957a; border-radius: 10px; background: #fffef8; color: #163e31; padding: 8px 10px; }
.sentence-slot.next { outline: 4px solid #e39b00; }
.card-tray { padding: 8px; border: 2px solid #d7e2cc; border-radius: 12px; }
.studio-lock { background: #1c624d; color: white; border-color: #1c624d; }
.studio-message { margin: 8px 0; }
.studio-kicker { font-weight: 800; color: #22694d; }
</style>
