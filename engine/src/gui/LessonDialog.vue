<script setup lang="ts">
import { assistedChoice, assistedField, claimScaffold, type Assistance, type AssistanceTarget } from './assisted-focus';
import { inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { DialogChoice, LessonDialogData } from './ask';
import { DIALOG_DISMISS_EVENTS, dialogCloseValue, dialogTaskStep } from './dialog-policy';
import { getContext, request, subscribeContext } from '../classroom-bridge';
import { canUseTool } from './flow-model';

const props = defineProps<{
  dialogId: number;
  name: string;
  text: string;
  title?: string;
  hint?: string;
  program?: LessonDialogData['program'];
  choices?: DialogChoice[];
}>();

const close = inject<(name: string, data?: unknown) => void>('rpgGuiClose');
const panel = ref<HTMLElement>();
const submitted = ref(false);
const support = ref(getContext()?.support);
const toolBusy = ref(false);
const undoBusy = ref(false);
const undoAvailable = ref(!!getContext()?.undoAvailable);
const toolAnswer = ref<({ action: string; why: string } & Assistance) | null>(null);
const toolError = ref('');
let unsubscribe: (() => void) | undefined;

watch(() => props.dialogId, async () => {
  submitted.value = false;
  toolAnswer.value = null;
  toolError.value = '';
  await nextTick();
  panel.value?.focus();
});

function showScaffold(context:any){
 const help=context.scaffold;
 if(!help || help.kind!=='reason' || props.name!=='验收负责人')return;
 const key=String(help.key || help.eventKey || help.at || JSON.stringify(help));
 if(!claimScaffold(`dialog:${context.levelId}`,key))return;
 toolAnswer.value={origin:'scaffold',level:help.level,stepKey:String(props.dialogId),target:help.target,action:help.action || help.lines?.[0] || '对照刚才的结果。',why:help.why || help.lines?.slice(1).join('') || help.message || ''};
}
function highlightChoice(id:string){return assistedChoice(toolAnswer.value,String(props.dialogId),id);}
function highlightField(field:string){return assistedField(toolAnswer.value,String(props.dialogId),field);}
async function reviewKnowledge(){try{await request('learn');}catch(error){toolError.value=error instanceof Error?error.message:'知识卡暂时没打开。';}}
function finish(value: string | null) {
  if (submitted.value) return;
  submitted.value = true;
  toolAnswer.value = null;
  close?.('lesson-dialog', value);
}

async function useTool() {
  if (!canUseTool(support.value, toolBusy.value)) return;
  toolBusy.value = true;
  toolError.value = '';
  const dialogId = props.dialogId;
  try {
    const context = getContext();
    const temperature = ['sale', 'repair'].includes(context?.levelId || '') ? context?.draft?.scene?.temperatureCase : undefined;
    const step = dialogTaskStep((props.choices || []).map(choice => choice.id), temperature, props.name);
    const result = await request<{ hint: { action: string; why: string; target?: AssistanceTarget }; remaining: number; used: number }>('toolHint', { step });
    support.value = { ...support.value, remaining: result.remaining, used: result.used };
    if (props.dialogId === dialogId) toolAnswer.value = {...result.hint,origin:'tool',stepKey:String(dialogId)};
  } catch (error) { toolError.value = error instanceof Error ? error.message : '法宝暂时没打开，请再试一次。'; }
  finally { toolBusy.value = false; }
}

async function undo() {
  if (undoBusy.value || !undoAvailable.value) return;
  undoBusy.value = true;
  toolError.value = '';
  try {
    const result = await request<{ undone: boolean }>('undo');
    if (result.undone) finish(null);
    else toolError.value = '没有可撤回的步骤了。';
  } catch (error) { toolError.value = error instanceof Error ? error.message : '还没撤回，请再试一次。'; }
  finally { undoBusy.value = false; }
}

function levelChanged() {
  submitted.value = false;
  finish(dialogCloseValue('map'));
}

function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    finish(dialogCloseValue('escape'));
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
  unsubscribe = subscribeContext(context => { support.value = context.support; undoAvailable.value = !!context.undoAvailable; showScaffold(context); });
  window.dispatchEvent(new CustomEvent('lesson-dialog-state', { detail: { open: true } }));
  window.addEventListener('keydown', keyboard, true);
  for (const name of DIALOG_DISMISS_EVENTS) window.addEventListener(name, levelChanged);
  await nextTick();
  panel.value?.focus();
});
onBeforeUnmount(() => {
  unsubscribe?.();
  window.removeEventListener('keydown', keyboard, true);
  for (const name of DIALOG_DISMISS_EVENTS) window.removeEventListener(name, levelChanged);
  window.dispatchEvent(new CustomEvent('lesson-dialog-state', { detail: { open: false } }));
});
</script>

<template>
  <div class="dialog-shade" @pointerdown.stop @click.stop>
    <section ref="panel" class="lesson-dialog" role="dialog" aria-modal="true" :aria-label="title || name" tabindex="-1">
      <header class="dialog-tools"><button type="button" @click="reviewKnowledge">巡检手册</button>
      <button class="dialog-undo" type="button" :disabled="undoBusy || toolBusy || !undoAvailable" @click="undo">撤回上一步</button>
      <button class="dialog-tool" type="button" :disabled="!canUseTool(support, toolBusy)" @click="useTool">通关法宝 · 还剩 {{ support?.remaining ?? '—' }} 次</button>
      <button class="dialog-close" data-focus="story-skip" aria-label="跳过剧情" @click="finish(null)">×</button></header>
      <p class="dialog-speaker">{{ name }}</p>
      <h2 v-if="title">{{ title }}</h2>
      <p class="dialog-text" :class="{ 'clue-focus': highlightField('condition') || highlightField('reading') || highlightField('input') }">{{ text }}</p>
      <section v-if="program" class="dialog-program" aria-label="当前程序">
        <strong>当前程序</strong>
        <p :class="{ 'clue-focus': highlightField('condition') }">判断：{{ program.condition }}</p>
        <div><span>是 → {{ program.yes }}</span><span>否 → {{ program.no }}</span></div>
      </section>
      <p v-if="hint" class="dialog-hint">{{ hint }}</p>
      <aside v-if="toolAnswer" class="dialog-tool-answer" role="status"><button type="button" aria-label="关闭法宝提示" @click="toolAnswer = null">×</button><strong>{{ toolAnswer.origin === 'scaffold' ? '探究帮助：' : '法宝示范：' }}{{ toolAnswer.action }}</strong><p v-if="toolAnswer.why">为什么：{{ toolAnswer.why }}</p></aside>
      <p v-if="toolError" class="dialog-hint" role="status">{{ toolError }}</p>
      <div v-if="choices?.length" class="dialog-choices">
        <button v-for="choice in choices" :key="choice.id" :disabled="submitted" :class="{ 'answer-demo': highlightChoice(choice.id) }" @click="finish(choice.id)">{{ choice.label }}</button>
      </div>
      <button v-else class="dialog-return" @click="finish(dialogCloseValue('return'))">返回现场</button>
      <p class="dialog-footnote">随时关闭，当前进度会保留。</p>
    </section>
  </div>
</template>

<style scoped>
.dialog-shade { position: absolute; inset: 0; display: flex; align-items: flex-end; justify-content: center; padding: clamp(10px, 2.5vw, 28px); background: linear-gradient(transparent 20%, #102e2c55); pointer-events: auto; }
.lesson-dialog { position: relative; width: min(760px, 100%); max-height: 88%; overflow: auto; padding: 25px 28px 18px; border: 3px solid #184c3b; border-radius: 20px; background: #fffaf0; color: #1a3a31; box-shadow: 0 12px 0 #10342844, 0 20px 50px #061e2b55; font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif; outline: none; }
.dialog-speaker { margin: 34px 48px 12px 0; font-size: 17px; font-weight: 800; color: #22694d; }
h2 { margin: 0 40px 12px 0; font-size: 22px; }
.dialog-text { margin: 0; white-space: pre-line; font-size: clamp(16px, 1.65vw, 20px); line-height: 1.65; }
.dialog-hint { margin: 14px 0 0; padding: 10px 14px; border-left: 4px solid #c5a048; background: #f4ebd4; font-size: 15px; line-height: 1.5; }
button { font: inherit; cursor: pointer; touch-action: manipulation; }
.dialog-close { position: absolute; top: 10px; right: 12px; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; background: #e8eedf; color: #183c30; font-size: 31px; line-height: 1; }
.dialog-program{margin-top:12px;padding:12px 14px;border:1px solid #a9b7a4;border-radius:10px;background:#eef2e8;font-size:16px;line-height:1.5;}
.dialog-program p{margin:6px 0;}
.dialog-program div{display:flex;flex-wrap:wrap;gap:8px 24px;}
.dialog-choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(230px, 100%), 1fr)); gap: 10px; margin-top: 19px; }
.dialog-choices button, .dialog-return { padding: 12px 16px; min-height: 48px; border: 2px solid #73957a; border-radius: 11px; background: #fffef8; color: #163e31; text-align: left; line-height: 1.4; font-size: 16px; font-weight: 650; }
.dialog-choices button:hover, .dialog-return:hover { background: #e6eddb; }
button:focus-visible { outline: 3px solid #1175bb; outline-offset: 3px; }
.dialog-return { margin-top: 18px; }
.dialog-footnote { margin: 12px 0 0; color: #627468; font-size: 12px; }
@media (max-width: 600px) { .lesson-dialog { padding: 18px 17px 12px; border-radius: 15px; } .dialog-choices { grid-template-columns: 1fr; gap: 7px; margin-top: 12px; } .dialog-choices button { padding: 9px 12px; min-height: 44px; font-size: 15px; } .dialog-speaker { margin-bottom: 7px; } }
.dialog-tool { position: absolute; right: 64px; top: 12px; min-height: 40px; border: 2px solid #73957a; border-radius: 10px; padding: 6px 10px; background: #fffef8; color: #163e31; font-size: 14px; }
.dialog-tool:disabled { opacity: .55; }
.dialog-tool-answer { position: relative; padding: 12px 46px 12px 14px; margin-top: 12px; border: 2px solid #ba8b28; border-radius: 12px; background: #fff3cf; line-height: 1.6; }
.dialog-tool-answer p { margin: 6px 0 0; }
.dialog-tool-answer button { position: absolute; top: 6px; right: 8px; width: 32px; height: 32px; border: 0; border-radius: 50%; background: #f2dfab; color: #163e31; font-size: 24px; }
.dialog-undo { position: absolute; right: 260px; top: 12px; min-height: 40px; border: 2px solid #73957a; border-radius: 10px; padding: 6px 10px; background: #fffef8; color: #163e31; font-size: 14px; }
.dialog-undo:disabled { opacity: .55; }
@media (max-width: 440px) { .dialog-undo { right: auto; left: 16px; top: 58px; } .dialog-speaker { margin-top: 82px; } }
.dialog-tools{position:sticky;top:-25px;z-index:10;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin:-10px -5px 8px;padding:8px 0;background:#fffaf0;}
.dialog-tools button,.dialog-tools .dialog-undo,.dialog-tools .dialog-tool,.dialog-tools .dialog-close{position:static;min-height:40px;padding:6px 10px;border:2px solid #73957a;border-radius:10px;background:#fffef8;color:#163e31;font-size:14px;}
.dialog-tools .dialog-close{width:40px;font-size:25px;padding:0;}
.dialog-speaker{margin:8px 0 12px;}
.dialog-choices .answer-demo{outline:4px solid #ba8b28;outline-offset:3px;background:#fff3cf;}
.clue-focus{outline:3px solid #1175bb;outline-offset:3px;}
</style>
