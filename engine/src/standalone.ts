// Pixi's CSP adapter replaces generated Function code with ordinary closures.
import 'pixi.js/unsafe-eval';
import { mergeConfig } from "@signe/di";
import { inject, provideRpg, RpgClientEngine, startGame } from "@rpgjs/client";
import { Direction } from '@rpgjs/common';
import startServer from "./server";
import configClient from "./config/config.client";
import { dispose, getContext, ready, request, subscribeContext } from './classroom-bridge';
import { createIdleTimer } from '../../public/idle-timer.mjs';

let engine: RpgClientEngine | undefined;
let heldDirection: Direction | undefined;
let movementFrame = 0;
let dialogOpen = false;
let auxiliaryBusy = false;
const controls = document.getElementById('engine-controls');
const status = document.getElementById('engine-status');
const statusText = document.getElementById('engine-status-text');
const reloadButton = document.getElementById('engine-reload') as HTMLButtonElement | null;
const dismissButton = document.getElementById('engine-dismiss') as HTMLButtonElement | null;

function stopMovement() {
  heldDirection = undefined;
  cancelAnimationFrame(movementFrame);
  movementFrame = 0;
  controls?.querySelectorAll('[aria-pressed="true"]').forEach(button => button.setAttribute('aria-pressed', 'false'));
  engine?.interruptCurrentPlayerMovement();
}

function canControl() {
  return !!engine && !dialogOpen && !auxiliaryBusy && status?.hidden !== false && !engine.stopProcessingInput;
}

function moveWhileHeld() {
  if (!heldDirection || !canControl()) { stopMovement(); return; }
  // This is RPGJS's movement channel: its physics, collisions and events run normally.
  void engine!.processInput({ input: heldDirection });
  movementFrame = requestAnimationFrame(moveWhileHeld);
}

function showStatus(message: string, startup = false) {
  stopMovement();
  if (statusText) statusText.textContent = message;
  if (reloadButton) reloadButton.hidden = !startup;
  if (dismissButton) dismissButton.hidden = startup;
  if (status) status.hidden = false;
}

for (const button of controls?.querySelectorAll<HTMLButtonElement>('[data-direction]') ?? []) {
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    if (!canControl()) return;
    stopMovement();
    button.setPointerCapture(event.pointerId);
    button.setAttribute('aria-pressed', 'true');
    heldDirection = button.dataset.direction as Direction;
    moveWhileHeld();
  });
  button.addEventListener('pointerup', stopMovement);
  button.addEventListener('pointercancel', stopMovement);
  button.addEventListener('lostpointercapture', stopMovement);
  button.addEventListener('keydown', event => {
    if (![' ', 'Enter'].includes(event.key) || event.repeat || !canControl()) return;
    event.preventDefault();
    event.stopPropagation();
    stopMovement();
    heldDirection = button.dataset.direction as Direction;
    button.setAttribute('aria-pressed', 'true');
    moveWhileHeld();
  });
  button.addEventListener('keyup', event => {
    if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); stopMovement(); }
  });
}

document.getElementById('engine-action')?.addEventListener('click', () => {
  if (!canControl()) return;
  stopMovement();
  const direction = engine!.getCurrentPlayer()?.direction?.();
  engine!.processAction('action', { direction });
});

for (const method of ['help', 'flow'] as const) {
  document.getElementById(`engine-${method}`)?.addEventListener('click', async () => {
    if (!canControl()) return;
    stopMovement();
    auxiliaryBusy = true;
    const previousBlock = engine!.stopProcessingInput;
    engine!.stopProcessingInput = true;
    try { await request(method, { levelId: getContext()?.levelId }); }
    catch (error) { showStatus(error instanceof Error ? error.message : '暂未打开，请重试。'); }
    finally { engine!.stopProcessingInput = previousBlock; auxiliaryBusy = false; }
  });
}

const idle = createIdleTimer({
  onStrength(detail) {
    const context = getContext();
    void request('navHelp', { levelId: context?.levelId, mapId: context?.draft?.rpg?.mapId || '', step: detail.stepKey, focusId: detail.stepKey, trigger: 'idle', strength: detail.strength, idleMs: detail.idleMs }).catch(() => undefined);
  }
});
function syncIdle(paused = dialogOpen || auxiliaryBusy || document.hidden) {
  const context = getContext();
  const scene = context?.draft?.scene;
  idle.configure({ key: scene ? `${context?.levelId}:${scene.phase || 'start'}` : '', thinking: false });
  idle.setPaused(paused);
  const goto = document.getElementById('engine-goto') as HTMLButtonElement | null;
  if (goto) goto.disabled = !!(context?.levelId === 'cross' && scene?.actions?.includes('route'));
}
window.addEventListener('lesson-dialog-state', event => {
  dialogOpen = !!(event as CustomEvent<{ open: boolean }>).detail.open;
  if (dialogOpen) stopMovement();
  if (controls) controls.inert = dialogOpen;
  syncIdle();
});
window.addEventListener('lesson-map-changed', () => { stopMovement(); syncIdle(true); window.setTimeout(() => syncIdle(), 800); });
window.setInterval(() => idle.tick(), 1000);
document.getElementById('engine-goto')?.addEventListener('click', () => {
  const context = getContext();
  if (!canControl() || (context?.levelId === 'cross' && context.draft.scene?.actions?.includes('route'))) return;
  idle.reset();
  void request('navHelp', { levelId: context?.levelId, step: context?.draft?.scene?.phase || '', trigger: 'goto', strength: 0, idleMs: 0 }).catch(() => undefined);
});
window.addEventListener('lesson-bridge-error', event => showStatus((event as CustomEvent<string>).detail));
window.addEventListener('blur', stopMovement);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopMovement(); syncIdle(); });
reloadButton?.addEventListener('click', () => window.location.reload());
dismissButton?.addEventListener('click', () => { if (status) status.hidden = true; });

async function start() {
  await ready();
  const context = await startGame(mergeConfig(configClient, { providers: [provideRpg(startServer)] }));
  engine = inject(RpgClientEngine, context);
  if (controls) controls.hidden = false;
}

start().catch(error => {
  console.error('RPGJS could not start', error);
  showStatus(error instanceof Error ? error.message : '园区暂未加载成功。已保存的学习记录会保留。', true);
});

window.addEventListener('pagehide', () => { stopMovement(); dispose(); }, { once: true });

const taskHint=document.getElementById('engine-task-hint');
subscribeContext(context=>{
 if(!taskHint)return;
 const s=context.draft.scene,id=context.levelId;
 if(!s){taskHint.hidden=true;return;}
 const guide=id==='sale'?'温室管理员':id==='repair'?'维修工程师':id==='cross'?'巡检员':'能源工程师';
 let text=s.phase==='start'?`先走近${guide}，按 E 或“交互”领取委托。`:id==='cross'?'走近设施观察点，读取这一处路口的情况。':id==='minimum'?'分别走近 A、B 两块电池，读取这组电量。':'走近温度探头，采集一个试验温度。';
 if(s.measured)text='走近控制台，设置条件和两个分支，先预测再执行。';
 if(s.ticket)text=id==='cross'?(s.actions.includes('route')?'已走过选中路线，去东岸通行核验台比较结果。':'沿程序选中的路线实际通行；走斑马线前须等绿灯。'):id==='minimum'?(s.actions.includes('route')?'已接入选中支路，走近充电核验台比较结果。':'亲自走到程序选中的电池支路接入。'):'本次程序已执行，走近现场核验仪比较结果。';
 if(context.level?.valid)text=`本项委托已验收。找${guide}领取下一站任务。`;
 taskHint.textContent=text;taskHint.hidden=false;syncIdle();
});
