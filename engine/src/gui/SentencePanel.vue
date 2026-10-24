<script setup lang="ts">
import { computed, ref } from 'vue';
import { cardsFor, lockSentence, sentenceFromFlow, type Flow, type Sentence } from './flow-model';

const props = defineProps<{ mode: string; flow: Flow; sentence?: Sentence; focusStrength?: number }>();
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
    <p class="sentence-line">{{ sentenceLine }}</p>
    <p class="sentence-note">这句话由你刚才选的卡片组成。想改安排，可以点“重新选卡”。</p>
    <p v-if="message" class="studio-message" role="status">{{ message }}</p>
    <button type="button" class="studio-lock" data-focus="sentence-lock" @click="lock">我看懂了，下一步</button>
  </section>
</template>

<style scoped>
.studio-panel { margin-top: 8px; }
.sentence-line { margin: 8px 0; padding: 12px 16px; border: 2px solid #73957a; border-radius: 12px; background: #edf4e5; line-height: 1.7; }
.sentence-note { font-size: 14px; line-height: 1.5; }
.studio-lock { min-height: 44px; padding: 10px 18px; border: 2px solid #1c624d; border-radius: 10px; background: #1c624d; color: white; font: inherit; font-weight: 750; }
.studio-message { margin: 8px 0; }
</style>
