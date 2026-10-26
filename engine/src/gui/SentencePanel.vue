<script setup lang="ts">
import { computed, ref } from 'vue';
import { cardsFor, lockSentence, sentenceFromFlow, type Flow, type Sentence } from './flow-model';

const props = defineProps<{ mode: string; flow: Flow; sentence?: Sentence; focusStrength?: number; assistedConfirm?: boolean }>();
const emit = defineEmits<{ save: [Sentence]; locked: [Sentence] }>();
const message = ref('');
const sentenceLine = computed(() => {
  const cards = cardsFor(props.mode);
  const label = (id: string) => cards.find(card => card.id === id)?.label || '';
  return `如果${label(props.flow.diamond).replace(/[？?]/g, '').replace(/吗$/, '')}，那么${label(props.flow.yes)}；否则${label(props.flow.no)}。`;
});
function lock() {
  const result = lockSentence(props.mode, sentenceFromFlow(props.mode, props.flow), props.flow);
  message.value = result.ok ? '' : result.message;
  if (result.ok) emit('locked', result.sentence);
}
</script>

<template>
  <section class="studio-panel" data-panel="sentence" data-focus="sentence-slot-next">
    <p class="sentence-line">📖 <b>分支顺口溜：</b>{{ sentenceLine }}</p>
    <p class="sentence-note">这句话由你刚才选的三张卡片自动组成。如果觉得不对，可以点下方“重新选卡”；确认一致就点下面绿色按钮！</p>
    <p v-if="message" class="studio-message" role="status">{{ message }}</p>
    <button type="button" class="studio-lock" :class="{ 'answer-demo': assistedConfirm }" data-focus="sentence-lock" @click="lock">👍 我看懂了，下一步 · 👆点这里</button>
  </section>
</template>

<style scoped>
.studio-panel { margin-top: 8px; }
.sentence-line { margin: 8px 0; padding: 14px 18px; border: 2.5px solid #1c624d; border-radius: 12px; background: #edf4e5; font-size: 18px; line-height: 1.7; }
.sentence-note { font-size: 14px; line-height: 1.5; color: #334155; }
.studio-lock { min-height: 48px; padding: 10px 20px; border: 3px solid #ffd166; border-radius: 10px; background: linear-gradient(135deg, #1c624d, #0f766e); color: white; font: inherit; font-weight: 800; box-shadow: 0 4px 14px #0f766e55; }
.studio-message { margin: 8px 0; }
.answer-demo{outline:4px solid #ba8b28;outline-offset:3px;}
</style>
