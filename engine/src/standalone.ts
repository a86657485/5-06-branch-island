// Pixi's CSP adapter replaces generated Function code with ordinary closures.
import 'pixi.js/unsafe-eval';
import { mergeConfig } from "@signe/di";
import { inject, provideRpg, RpgClientEngine, startGame } from "@rpgjs/client";
import { Direction } from '@rpgjs/common';
import startServer from "./server";
import configClient from "./config/config.client";
import { createApp } from 'vue';
import { dispose, getContext, ready, request, subscribeContext, setArtifactBarrier } from './classroom-bridge';
import FlowPanel from './gui/FlowPanel.vue';
import { createIdleTimer } from '../../public/idle-timer.mjs';
import { currentFocus, gotoTitle } from '../../public/focus.mjs';
import { emptyFlow, repairPreset } from './gui/flow-model';
import { toPlain } from './gui/plain';
import { focusFootprint } from './focus-marker';

let engine: RpgClientEngine | undefined;
let heldDirection: Direction | undefined;
let movementFrame = 0;
let dialogOpen = false;
let auxiliaryBusy = false;
let autoWalking = false;
let processPanelOpen = false;
let studioOpen = false;
const controls = document.getElementById('engine-controls');
const status = document.getElementById('engine-status');
const statusText = document.getElementById('engine-status-text');
const reloadButton = document.getElementById('engine-reload') as HTMLButtonElement | null;
const feedbackLine=document.getElementById('engine-feedback');
const assistanceCard=document.getElementById('engine-assistance');
let activeWorldHelp: {stepKey:string,target?:{focusKey?:string},origin?:string,level?:number}|null=null;
const dismissButton = document.getElementById('engine-dismiss') as HTMLButtonElement | null;

function stopMovement() {
  heldDirection = undefined;
  cancelAnimationFrame(movementFrame);
  movementFrame = 0;
  controls?.querySelectorAll('[aria-pressed="true"]').forEach(button => button.setAttribute('aria-pressed', 'false'));
  engine?.interruptCurrentPlayerMovement();
}

function canControl() {
  return !!engine && !dialogOpen && !studioOpen && !hostOverlay && !auxiliaryBusy && !autoWalking && status?.hidden !== false && !engine.stopProcessingInput;
}

function moveWhileHeld() {
  if (!heldDirection || !canControl()) { stopMovement(); return; }
  // This is RPGJS's movement channel: its physics, collisions and events run normally.
  void engine!.processInput({ input: heldDirection });
  if (Date.now() - lastMoveReset > 400) { noteActivity(); lastMoveReset = Date.now(); }
  movementFrame = requestAnimationFrame(moveWhileHeld);
}

function showStatus(message: string, startup = false) {
  stopMovement();
  if (statusText) statusText.textContent = message;
  if (reloadButton) reloadButton.hidden = !startup;
  if (dismissButton) dismissButton.hidden = startup;
  if (status) status.hidden = false;
  paintControlState();
}

document.getElementById('engine-action')?.addEventListener('click', () => {
  if (!canControl() || !interactionTarget.inRange) return;
  stopMovement();
  noteActivity();
  engine!.processAction('lesson:interact');
});

for (const method of ['help', 'flow', 'learn'] as const) {
  document.getElementById(`engine-${method}`)?.addEventListener('click', async () => {
    if (!canControl()) return;
    stopMovement();
    auxiliaryBusy = true;
    paintControlState();
    const previousBlock = engine!.stopProcessingInput;
    engine!.stopProcessingInput = true;
    try { if(method==='learn')await request('learn');else await request(method, { levelId: getContext()?.levelId }); }
    catch (error) { showStatus(error instanceof Error ? error.message : '暂未打开，请重试。'); }
    finally { engine!.stopProcessingInput = previousBlock; auxiliaryBusy = false; paintControlState(); }
  });
}

const taskHint = document.getElementById('engine-task-hint');
const focusMarker = document.getElementById('focus-marker');
const focusLabel = document.getElementById('focus-label');
const focusArrow = focusMarker?.querySelector('.focus-arrow');
const pathDots = document.getElementById('path-dots');
const hintButton = document.getElementById('engine-hint') as HTMLButtonElement | null;
const undo = document.getElementById('engine-undo') as HTMLButtonElement | null;
const goto = document.getElementById('engine-goto') as HTMLButtonElement | null;
const actionButton = document.getElementById('engine-action') as HTMLButtonElement | null;
const actionLabel = document.getElementById('engine-action-label');
const actionHelp = document.getElementById('engine-action-help');
let interactionTarget = { label: '交谈 / 操作', inRange: false };
let lastControlsBlocked: boolean | undefined;
function setText(node: Element | null | undefined, value: string) { if (node && node.textContent !== value) node.textContent = value; }
function setClass(node: Element, name: string, value: boolean) { if (node.classList.contains(name) !== value) node.classList.toggle(name, value); }
function setStyle(node: HTMLElement, name: string, value: string) { if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value); }
function setHidden(node: HTMLElement, value: boolean) { if (node.hidden !== value) node.hidden = value; }
function setDisabled(node: HTMLButtonElement, value: boolean) { if (node.disabled !== value) node.disabled = value; }
function setData(node: HTMLElement, name: string, value: string) { if (node.dataset[name] !== value) node.dataset[name] = value; }
function paintControlState() {
  const blocked = !canControl();
  if (actionButton) setDisabled(actionButton, blocked || !interactionTarget.inRange);
  setText(actionLabel, interactionTarget.label);
  setText(actionHelp, interactionTarget.inRange ? '点此交互' : '请先靠近目标');
  if (lastControlsBlocked === blocked) return;
  lastControlsBlocked = blocked;
  if (controls) controls.dataset.blocked = String(blocked);
  if (blocked) stopMovement();
  window.dispatchEvent(new CustomEvent('lesson-controls-state', { detail: { blocked } }));
}
window.addEventListener('lesson-interaction-target', event => {
  interactionTarget = (event as CustomEvent<typeof interactionTarget>).detail;
  paintControlState();
});
let panelFocusDirty = true;
let highlightedPanel: Element | null = null;
let highlightedId = '';
new MutationObserver(() => {
  panelFocusDirty = true;
  studioOpen = !!document.querySelector('.studio');
  syncIdle();
}).observe(document.getElementById('vue-gui-overlay') || document.body, { childList: true, subtree: true });
let lastMoveReset = 0;
const idle = createIdleTimer({
  onStrength(detail) {
    const context = getContext();
    const focus = lessonFocus(context);
    paintFocus(focus);
    void request('navHelp', { levelId: context?.levelId, mapId: focus.target.mapId || context?.draft?.rpg?.mapId || '', step: focus.step, focusId: focus.id, trigger: 'idle', strength: detail.strength, idleMs: detail.idleMs }).catch(() => undefined);
  }
});
let hostOverlay = '';
function lessonFocus(context = getContext()) {
  return currentFocus({ levelId: context?.levelId, scene: context?.draft?.scene, level: context?.level, draft: context?.draft, panelOpen: studioOpen, runs: context?.runs, evidenceStart: context?.evidenceStart, overlay: hostOverlay || undefined });
}
function noteActivity() {
  idle.reset();
}
let viewportCache: any;
function findViewport(node: any): any {
  if (!node) return undefined;
  if (typeof node.toGlobal === 'function' && typeof node.toWorld === 'function') return node;
  for (const child of node.children ?? []) {
    const found = findViewport(child);
    if (found) return found;
  }
  return undefined;
}
function mapViewport() {
  if (viewportCache && viewportCache.destroyed !== true && viewportCache.parent) return viewportCache;
  viewportCache = findViewport((engine as any)?.canvasApp?.stage);
  return viewportCache;
}
let canvasCache: HTMLCanvasElement | null = null;
function projectionFrame() {
  if (!canvasCache || !canvasCache.isConnected) canvasCache = document.querySelector('#rpg canvas');
  return canvasCache ? { rect: canvasCache.getBoundingClientRect(), viewport: mapViewport() } : null;
}
type Projection = ReturnType<typeof projectionFrame>;
function projectTarget(target: { x?: number, y?: number, mapId?: string, place?: string }, projection: Projection) {
  const footprint = focusFootprint(target);
  if (!projection || !footprint) return null;
  const { rect, viewport } = projection;
  let sx = rect.left + rect.width / 2;
  let sy = rect.top + rect.height / 2;
  let scaleX = 1;
  let scaleY = 1;
  if (viewport) {
    const global = viewport.toGlobal({ x: footprint.x, y: footprint.y });
    if (Number.isFinite(global?.x) && Number.isFinite(global?.y)) {
      sx = rect.left + Number(global.x);
      sy = rect.top + Number(global.y);
      const unit = viewport.toGlobal({ x: footprint.x + 1, y: footprint.y + 1 });
      scaleX = Math.abs(unit.x - global.x);
      scaleY = Math.abs(unit.y - global.y);
    }
  }
  const margin = 48;
  const minX = rect.left + margin;
  const maxX = rect.right - margin;
  const minY = rect.top + margin;
  const maxY = rect.bottom - margin;
  const offscreen = sx < minX || sx > maxX || sy < minY || sy > maxY;
  const arrow = Math.abs(sx - (minX + maxX) / 2) > Math.abs(sy - (minY + maxY) / 2)
    ? (sx > (minX + maxX) / 2 ? '→' : '←')
    : (sy > (minY + maxY) / 2 ? '↓' : '↑');
  return {
    x: Math.min(maxX, Math.max(minX, sx)),
    y: Math.min(maxY, Math.max(minY, sy)),
    offscreen,
    arrow: offscreen ? arrow : '→',
    ringWidth: footprint.radiusX * 2 * scaleX,
    ringHeight: footprint.radiusY * 2 * scaleY,
    halfWidth: footprint.halfWidth * scaleX
  };
}
function projectWorld(target: { x?: number, y?: number }, projection: Projection) {
  const x = Number(target?.x);
  const y = Number(target?.y);
  if (!projection || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const { rect, viewport } = projection;
  if (!viewport) return null;
  const global = viewport.toGlobal({ x, y });
  if (!Number.isFinite(global?.x) || !Number.isFinite(global?.y)) return null;
  const sx = rect.left + Number(global.x);
  const sy = rect.top + Number(global.y);
  return { x: sx, y: sy, offscreen: sx < rect.left || sx > rect.right || sy < rect.top || sy > rect.bottom };
}
function paintPanelFocus(focus: { kind?: string, id?: string }) {
  const id = focus.kind === 'panel' ? (focus.id === 'sentence-slot-next' ? 'sentence-lock' : focus.id || '') : '';
  if (!panelFocusDirty && id === highlightedId && (!highlightedPanel || highlightedPanel.isConnected)) return;
  const next = id ? document.querySelector(`[data-focus="${id}"]`) : null;
  if (next !== highlightedPanel) {
    if (highlightedPanel) setClass(highlightedPanel, 'focus-target', false);
    if (next) setClass(next, 'focus-target', true);
    highlightedPanel = next;
  }
  highlightedId = id;
  panelFocusDirty = false;
}
function worldStep(){const focus=lessonFocus();return JSON.stringify([getContext()?.levelId,focus.id,focus.step]);}
function clearAssistance(){activeWorldHelp=null;if(assistanceCard)assistanceCard.hidden=true;focusMarker?.classList.remove('assisted-marker');}
function showAssistance(detail:any){
 if(!assistanceCard)return;
 activeWorldHelp={stepKey:worldStep(),target:detail.target,origin:detail.origin,level:detail.level};
 const title=assistanceCard.querySelector('strong'),text=assistanceCard.querySelector('p');
 if(title)title.textContent=detail.origin==='tool'?'法宝示范':'探究帮助';
 if(text)text.textContent=[detail.action,detail.why || detail.text].filter(Boolean).join('\n');
 assistanceCard.hidden=false;
}
window.addEventListener('lesson-feedback',event=>{
 const detail=(event as CustomEvent).detail || {};
 if(feedbackLine){feedbackLine.textContent=detail.text || '';feedbackLine.hidden=!detail.text;}
 if(detail.level>0)showAssistance({...detail,origin:'scaffold'});
});
document.getElementById('engine-assistance-close')?.addEventListener('click',clearAssistance);

const dotPool: HTMLElement[] = [];
function paintDots(dots: Array<{ x: number, y: number }> = [], projection: Projection) {
  if (!pathDots) return;
  let used = 0;
  for (const dot of dots) {
    const point = projectWorld(dot, projection);
    if (!point || point.offscreen) continue;
    let mark = dotPool[used];
    if (!mark) {
      mark = document.createElement('span');
      mark.className = 'path-dot';
      dotPool.push(mark);
      pathDots.appendChild(mark);
    }
    setHidden(mark, false);
    setStyle(mark, 'left', `${point.x}px`);
    setStyle(mark, 'top', `${point.y}px`);
    used++;
  }
  for (let index = used; index < dotPool.length; index++) setHidden(dotPool[index], true);
  setHidden(pathDots, used === 0);
}
function paintFocus(focus = lessonFocus()) {
  if (new URLSearchParams(location.search).has('preview')) return;
  if (hostOverlay && focusMarker) setHidden(focusMarker, true);
  const focusStrength = idle.strength();
  const projection = projectionFrame();
  paintControlState();
  if(activeWorldHelp && activeWorldHelp.stepKey!==worldStep())clearAssistance();
  if (taskHint) {
    setText(taskHint, focusStrength ? focus.strong : focus.hint);
    setHidden(taskHint, false);
    setData(taskHint, 'strength', focus.kind==='panel'?'0':String(focusStrength));
    setClass(taskHint, 'focus-target', true);
    setClass(taskHint, 'tap-hand', focusStrength >= 2 && focus.goto);
  }
  if (focusMarker && focusLabel) {
    const point = projectTarget(focus.target || {}, projection);
    setHidden(focusMarker, !!hostOverlay || !point);
    setData(focusMarker, 'strength', String(focusStrength));
    setClass(focusMarker, 'edge', !!point?.offscreen);
    setClass(focusMarker, 'tap-hand', focusStrength >= 2 && focus.kind === 'map' && !point?.offscreen);
    if (point) {
      setStyle(focusMarker, 'left', `${point.x}px`);
      setStyle(focusMarker, 'top', `${point.y}px`);
      setStyle(focusMarker, '--ring-width', `${point.ringWidth}px`);
      setStyle(focusMarker, '--ring-height', `${point.ringHeight}px`);
      setStyle(focusMarker, '--target-half-width', `${point.halfWidth}px`);
      setText(focusArrow, point.arrow);
    }
    const showingTarget=!!activeWorldHelp && activeWorldHelp.target?.focusKey===focus.target?.place;
    setClass(focusMarker, 'assisted-marker',showingTarget);
    setText(focusLabel, showingTarget?'法宝位置':point?.offscreen ? (focus.goto ? '下一目标' : '看方向') : '');
  }
  paintDots(hostOverlay ? [] : (focus.dots || []), projection);
  paintPanelFocus(focus);
  const hints=getContext()?.support?.hints||[];
  if(hintButton){setText(hintButton, `通关法宝 ${Math.max(0,5-hints.length)}/5`);setDisabled(hintButton, hints.length>=5||auxiliaryBusy);}
  if(undo)setDisabled(undo, !getContext()?.undoAvailable||autoWalking);
  if (goto) {
    setDisabled(goto, !focus.goto || !canControl());
    setText(goto, autoWalking?'自动行走中…':'自动前往任务点');
    const title = gotoTitle(focus, processPanelOpen);
    if (goto.title !== title) goto.title = title;
    setClass(goto, 'focus-target', focusStrength >= 2 && focus.goto);
  }
}
function syncIdle(paused = dialogOpen || auxiliaryBusy || document.hidden) {
  const focus = lessonFocus();
  const mapKey = focus.target?.mapId ? `${focus.target.mapId}:${focus.id}:${focus.step}` : '';
  idle.configure({ key: mapKey || (focus.id ? `${focus.id}:${focus.step}` : ''), thinking: focus.thinking });
  idle.setPaused(paused || focus.pause);
  paintFocus(focus);
}
window.addEventListener('lesson-walking',event=>{autoWalking=!!(event as CustomEvent).detail?.moving;if(autoWalking)stopMovement();paintFocus();});
window.addEventListener('lesson-process-panel', event => {
  processPanelOpen = !!(event as CustomEvent<{ open: boolean }>).detail?.open;
  paintFocus();
});
window.addEventListener('message', event => {
  const message = event.data;
  if (!message || message.type !== 'rpgjs-overlay') return;
  hostOverlay = message.open ? (message.kind || 'overlay') : '';
  if (hostOverlay) stopMovement();
  if (controls) controls.inert = !!hostOverlay || dialogOpen;
  if (focusMarker && hostOverlay) focusMarker.hidden = true;
  syncIdle(dialogOpen || auxiliaryBusy || document.hidden || !!hostOverlay);
});
window.addEventListener('lesson-dialog-state', event => {
  dialogOpen = !!(event as CustomEvent<{ open: boolean }>).detail.open;
  if (dialogOpen) stopMovement();
  if (controls) controls.inert = dialogOpen || !!hostOverlay;
  syncIdle();
});
window.addEventListener('lesson-map-changed', () => { interactionTarget = { label: '交谈 / 操作', inRange: false }; clearAssistance();if(feedbackLine)feedbackLine.hidden=true;stopMovement(); syncIdle(true); window.setTimeout(() => syncIdle(), 800); });
window.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || window.parent === window) return;
  window.parent.postMessage({ type: 'rpgjs-overlay-close' }, window.location.origin);
});
function focusFrame() {
  idle.tick();
  paintFocus();
  requestAnimationFrame(focusFrame);
}
requestAnimationFrame(focusFrame);
document.getElementById('engine-goto')?.addEventListener('click', () => {
  const context = getContext();
  const focus = lessonFocus(context);
  if (!canControl() || !focus.goto) return;
  noteActivity();clearAssistance();if(feedbackLine)feedbackLine.hidden=true;
  window.dispatchEvent(new CustomEvent('lesson-goto', { detail: { ...focus.target, goto: true } }));
  void request('navHelp', { levelId: context?.levelId, mapId: focus.target.mapId || '', step: focus.step, focusId: focus.id, trigger: 'goto', strength: 0, idleMs: 0 }).catch(() => undefined);
});
document.getElementById('engine-hint')?.addEventListener('click', async () => {
  if(!canControl() || auxiliaryBusy)return;
  stopMovement();noteActivity();auxiliaryBusy=true;paintFocus();
  try{
    const focus=lessonFocus(),requestedStep=worldStep();
    const value=await request<any>('toolHint',{step:{phase:'world',key:focus.id}});
    if(requestedStep===worldStep())showAssistance({...value.hint,origin:'tool'});
  }catch(error){showStatus(error instanceof Error?error.message:'法宝暂未确认，次数没有扣。');}
  finally{auxiliaryBusy=false;paintFocus();}
});
document.getElementById('engine-undo')?.addEventListener('click',async()=>{
 if(!canControl())return;
 stopMovement();
 try{await request('undo');syncIdle();}catch(error){showStatus(error instanceof Error?error.message:'请再点一次撤回。');}
});
document.getElementById('engine-help')?.addEventListener('click', () => {
  const focus = lessonFocus();
  noteActivity();
  void request('navHelp', { levelId: getContext()?.levelId, mapId: focus.target.mapId || '', step: focus.step, focusId: focus.id, trigger: 'button', strength: 0, idleMs: 0 }).catch(() => undefined);
});
window.addEventListener('lesson-level-changed',()=>{clearAssistance();if(feedbackLine)feedbackLine.hidden=true;});
window.addEventListener('lesson-bridge-error', event => showStatus((event as CustomEvent<string>).detail));
window.addEventListener('blur', stopMovement);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopMovement(); syncIdle(); });
reloadButton?.addEventListener('click', () => window.location.reload());
dismissButton?.addEventListener('click', () => { if (status) status.hidden = true; paintFocus(); });

async function start() {
  await ready();
  const context = await startGame(mergeConfig(configClient, { providers: [provideRpg(startServer)] }));
  engine = inject(RpgClientEngine, context);
  if (controls) controls.hidden = false;
  paintFocus();
}

const previewing = new URLSearchParams(location.search).has('preview');
if (!previewing) start().catch(error => {
  console.error('RPGJS could not start', error);
  showStatus(error instanceof Error ? error.message : '园区暂未加载成功。已保存的学习记录会保留。', true);
});

window.addEventListener('pagehide', () => { stopMovement(); dispose(); }, { once: true });

let artifactQueue = Promise.resolve();
setArtifactBarrier(()=>artifactQueue);
window.addEventListener('lesson-artifact', event => {
  if (window.parent === window) return;
  let patch: Record<string, unknown>;
  try { patch = toPlain((event as CustomEvent<Record<string, unknown>>).detail || {}); }
  catch (error) {
    console.warn('流程图没有保存', error);
    showStatus('刚才的选择没有保存，请再点一次卡片。');
    return;
  }
  const context = getContext();
  if (context?.draft) {
    for (const key of ['flow', 'sentence', 'predictionsLocked', 'diagnoseAnswer', 'panel', 'config']) {
      if (key in patch) context.draft[key] = patch[key];
    }
  }
  syncIdle();
  artifactQueue = artifactQueue.catch(() => undefined).then(async () => {
    try { await request('change', { patch }); }
    catch (error) { showStatus(error instanceof Error ? error.message : '流程图没有保存，请重试。'); }
  });
});
subscribeContext(() => { syncIdle(); });

function mountPreview() {
  const preview = new URLSearchParams(location.search).get('preview');
  if (preview === 'flow' || preview === 'sentence' || preview === 'predict') {
    const host = document.createElement('div');
    host.id = 'studio-preview';
    host.style.cssText = 'position:fixed;inset:0;z-index:3000;background:#173b31;';
    document.body.appendChild(host);
    const params = new URLSearchParams(location.search);
    const mode = params.get('mode') === 'repair' ? 'repair' : 'sale';
    const flow = params.has('blank')
      ? (mode === 'repair' ? repairPreset() : emptyFlow())
      : { diamond: 'ge30', yes: 'on', no: 'off', locked: preview !== 'flow' };
    createApp(FlowPanel, {
      mode,
      preview,
      diagnosed: true,
      flow
    }).mount(host);
    return;
  }
  if (preview !== 'dots') return;
  const focus = currentFocus({
    levelId: 'cross',
    scene: { phase: 'executed', measured: true, facility: true, ticket: { output: 'bridge' }, actions: [], signal: 'green' },
    level: { valid: false }
  });
  const host = document.createElement('div');
  host.id = 'dots-preview';
  host.style.cssText = 'position:fixed;inset:0;z-index:3000;background:#3d7a52;';
  const dots = focus.dots || [];
  const xs = dots.map(dot => dot.x);
  const ys = dots.map(dot => dot.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  for (const dot of dots) {
    const mark = document.createElement('span');
    mark.className = 'path-dot';
    mark.style.position = 'absolute';
    mark.style.left = `${12 + ((dot.x - minX) / (maxX - minX || 1)) * 76}%`;
    mark.style.top = `${18 + ((dot.y - minY) / (maxY - minY || 1)) * 68}%`;
    host.appendChild(mark);
  }
  const caption = document.createElement('p');
  caption.textContent = '脚印停在目标前。这段要亲自走过去。';
  caption.style.cssText = 'position:absolute;left:24px;bottom:24px;margin:0;padding:12px 16px;background:#fffaf0;border-radius:12px;color:#173b31;font-weight:700;';
  host.appendChild(caption);
  document.body.appendChild(host);
}
mountPreview();
