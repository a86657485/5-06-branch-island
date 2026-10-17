<script setup lang="ts">
import { inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { DialogChoice } from './ask';

const props = defineProps<{
  dialogId: number;
  name: string;
  text: string;
  title?: string;
  hint?: string;
  choices?: DialogChoice[];
}>();

const close = inject<(name: string, data?: unknown) => void>('rpgGuiClose');
const panel = ref<HTMLElement>();
const submitted = ref(false);

watch(() => props.dialogId, async () => {
  submitted.value = false;
  await nextTick();
  panel.value?.focus();
});

function finish(value: string | null) {
  if (submitted.value) return;
  submitted.value = true;
  close?.('lesson-dialog', value);
}

function levelChanged() {
  finish(null);
}

function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    finish(null);
  } else if (event.key === 'Tab' && panel.value) {
    const buttons = Array.from(panel.value.querySelectorAll<HTMLButtonElement>('button'));
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  // CanvasEngine also listens at window level. Dialog keys belong to this panel.
  event.stopPropagation();
}

onMounted(async () => {
  window.dispatchEvent(new CustomEvent('lesson-dialog-state', { detail: { open: true } }));
  window.addEventListener('keydown', keyboard, true);
  window.addEventListener('lesson-level-changed', levelChanged);
  await nextTick();
  panel.value?.focus();
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', keyboard, true);
  window.removeEventListener('lesson-level-changed', levelChanged);
  window.dispatchEvent(new CustomEvent('lesson-dialog-state', { detail: { open: false } }));
});
</script>

<template>
  <div class="dialog-shade" @pointerdown.stop @click.stop>
    <section ref="panel" class="lesson-dialog" role="dialog" aria-modal="true" :aria-label="title || name" tabindex="-1">
      <button class="dialog-close" aria-label="关闭对话，继续探索" @click="finish(null)">×</button>
      <p class="dialog-speaker">{{ name }}</p>
      <h2 v-if="title">{{ title }}</h2>
      <p class="dialog-text">{{ text }}</p>
      <p v-if="hint" class="dialog-hint">{{ hint }}</p>
      <div v-if="choices?.length" class="dialog-choices">
        <button v-for="choice in choices" :key="choice.id" :disabled="submitted" @click="finish(choice.id)">{{ choice.label }}</button>
      </div>
      <button v-else class="dialog-return" @click="finish(null)">返回现场</button>
      <p class="dialog-footnote">随时关闭，当前进度会保留。</p>
    </section>
  </div>
</template>

<style scoped>
.dialog-shade { position: absolute; inset: 0; display: flex; align-items: flex-end; justify-content: center; padding: clamp(10px, 2.5vw, 28px); background: linear-gradient(transparent 20%, #102e2c55); pointer-events: auto; }
.lesson-dialog { position: relative; width: min(760px, 100%); max-height: 88%; overflow: auto; padding: 25px 28px 18px; border: 3px solid #184c3b; border-radius: 20px; background: #fffaf0; color: #1a3a31; box-shadow: 0 12px 0 #10342844, 0 20px 50px #061e2b55; font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif; outline: none; }
.dialog-speaker { margin: 0 48px 12px 0; font-size: 17px; font-weight: 800; color: #22694d; }
h2 { margin: 0 40px 12px 0; font-size: 22px; }
.dialog-text { margin: 0; white-space: pre-line; font-size: clamp(16px, 1.65vw, 20px); line-height: 1.65; }
.dialog-hint { margin: 14px 0 0; padding: 10px 14px; border-left: 4px solid #c5a048; background: #f4ebd4; font-size: 15px; line-height: 1.5; }
button { font: inherit; cursor: pointer; touch-action: manipulation; }
.dialog-close { position: absolute; top: 10px; right: 12px; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; background: #e8eedf; color: #183c30; font-size: 31px; line-height: 1; }
.dialog-choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(230px, 100%), 1fr)); gap: 10px; margin-top: 19px; }
.dialog-choices button, .dialog-return { padding: 12px 16px; min-height: 48px; border: 2px solid #73957a; border-radius: 11px; background: #fffef8; color: #163e31; text-align: left; line-height: 1.4; font-size: 16px; font-weight: 650; }
.dialog-choices button:hover, .dialog-return:hover { background: #e6eddb; }
button:focus-visible { outline: 3px solid #1175bb; outline-offset: 3px; }
.dialog-return { margin-top: 18px; }
.dialog-footnote { margin: 12px 0 0; color: #627468; font-size: 12px; }
@media (max-width: 600px) { .lesson-dialog { padding: 18px 17px 12px; border-radius: 15px; } .dialog-choices { grid-template-columns: 1fr; gap: 7px; margin-top: 12px; } .dialog-choices button { padding: 9px 12px; min-height: 44px; font-size: 15px; } .dialog-speaker { margin-bottom: 7px; } }
</style>
