// Pixi's CSP adapter replaces generated Function code with ordinary closures.
import 'pixi.js/unsafe-eval';
import { mergeConfig } from "@signe/di";
import { inject, provideRpg, RpgClientEngine, startGame } from "@rpgjs/client";
import { Direction } from '@rpgjs/common';
import startServer from "./server";
import configClient from "./config/config.client";
import { createApp } from 'vue';
import { dispose, getContext, ready, request, subscribeContext } from './classroom-bridge';
import FlowPanel from './gui/FlowPanel.vue';
import { createIdleTimer } from '../../public/idle-timer.mjs';
import { currentFocus } from '../../public/focus.mjs';
import { toPlain } from './gui/plain';

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
  if (Date.now() - lastMoveReset > 400) { noteActivity(); lastMoveReset = Date.now(); }
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
    noteActivity();
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
  noteActivity();
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

const taskHint = document.getElementById('engine-task-hint');
const focusMarker = document.getElementById('focus-marker');
const focusLabel = document.getElementById('focus-label');
const focusArrow = focusMarker?.querySelector('.focus-arrow');
const pathDots = document.getElementById('path-dots');
let lastMoveReset = 0;
const idle = createIdleTimer({
  onStrength(detail) {
    const context = getContext();
    const focus = lessonFocus(context);
    paintFocus(focus);
    void request('navHelp', { levelId: context?.levelId, mapId: focus.target.mapId || context?.draft?.rpg?.mapId || '', step: focus.step, focusId: focus.id, trigger: 'idle', strength: detail.strength, idleMs: detail.idleMs }).catch(() => undefined);
  }
});
function lessonFocus(context = getContext()) {
  return currentFocus({ levelId: context?.levelId, scene: context?.draft?.scene, level: context?.level, draft: context?.draft });
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
function projectTarget(target: { x?: number, y?: number, mapId?: string }) {
  const canvas = document.querySelector('#rpg canvas') as HTMLCanvasElement | null;
  const x = Number(target?.x);
  const y = Number(target?.y);
  if (!canvas || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const rect = canvas.getBoundingClientRect();
  const viewport = mapViewport();
  let sx = rect.left + rect.width / 2;
  let sy = rect.top + rect.height / 2;
  if (viewport) {
    const global = viewport.toGlobal({ x, y });
    if (Number.isFinite(global?.x) && Number.isFinite(global?.y)) {
      sx = rect.left + Number(global.x);
      sy = rect.top + Number(global.y);
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
    arrow: offscreen ? arrow : '↓'
  };
}
function projectWorld(target: { x?: number, y?: number }) {
  const canvas = document.querySelector('#rpg canvas') as HTMLCanvasElement | null;
  const x = Number(target?.x);
  const y = Number(target?.y);
  if (!canvas || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const rect = canvas.getBoundingClientRect();
  const viewport = mapViewport();
  if (!viewport) return null;
  const global = viewport.toGlobal({ x, y });
  if (!Number.isFinite(global?.x) || !Number.isFinite(global?.y)) return null;
  const sx = rect.left + Number(global.x);
  const sy = rect.top + Number(global.y);
  return { x: sx, y: sy, offscreen: sx < rect.left || sx > rect.right || sy < rect.top || sy > rect.bottom };
}
function paintPanelFocus(focus: { kind?: string, id?: string }) {
  document.querySelectorAll('.card-tray.focus-target, .flow-slot.focus-target, .studio.focus-target').forEach(node => node.classList.remove('focus-target'));
  if (focus.kind !== 'panel' || !focus.id) return;
  document.querySelector(`[data-focus="${focus.id}"]`)?.classList.add('focus-target');
  if (focus.id === 'slot-next' || focus.id === 'sentence-slot-next') {
    const region = focus.id === 'sentence-slot-next' ? '[data-region="sentence-cards"]' : '[data-region="flow-cards"]';
    document.querySelector(region)?.classList.add('focus-target');
  }
}
function paintDots(dots: Array<{ x: number, y: number }> = []) {
  if (!pathDots) return;
  pathDots.replaceChildren();
  const visible = dots.map(dot => projectWorld(dot)).filter(point => point && !point.offscreen);
  pathDots.hidden = visible.length === 0;
  for (const point of visible) {
    const mark = document.createElement('span');
    mark.className = 'path-dot';
    mark.style.left = `${point!.x}px`;
    mark.style.top = `${point!.y}px`;
    pathDots.appendChild(mark);
  }
}
function paintFocus(focus = lessonFocus()) {
  if (new URLSearchParams(location.search).has('preview')) return;
  const focusStrength = idle.strength();
  if (taskHint) {
    taskHint.textContent = focusStrength ? focus.strong : focus.hint;
    taskHint.hidden = false;
    taskHint.dataset.strength = String(focusStrength);
    taskHint.classList.toggle('focus-target', true);
    taskHint.classList.toggle('tap-hand', focusStrength >= 2 && focus.goto);
  }
  if (focusMarker && focusLabel) {
    const point = projectTarget(focus.target || {});
    focusMarker.hidden = !point;
    focusMarker.dataset.strength = String(focusStrength);
    focusMarker.classList.toggle('edge', !!point?.offscreen);
    focusMarker.classList.toggle('tap-hand', focusStrength >= 2 && focus.kind === 'map' && !point?.offscreen);
    if (point) {
      focusMarker.style.left = `${point.x}px`;
      focusMarker.style.top = `${point.y}px`;
      if (focusArrow) focusArrow.textContent = point.arrow;
    }
    focusLabel.textContent = point?.offscreen ? (focus.goto ? '下一目标' : '看方向') : '';
  }
  paintDots(focus.dots || []);
  paintPanelFocus(focus);
  const goto = document.getElementById('engine-goto') as HTMLButtonElement | null;
  if (goto) {
    goto.disabled = !focus.goto;
    goto.title = focus.goto ? '前往下一目标' : (focus.gotoReason || '这段要你亲自走过去');
    goto.classList.toggle('focus-target', focusStrength >= 2 && focus.goto);
  }
}
function syncIdle(paused = dialogOpen || auxiliaryBusy || document.hidden) {
  const focus = lessonFocus();
  const mapKey = focus.target?.mapId ? `${focus.target.mapId}:${focus.id}:${focus.step}` : '';
  idle.configure({ key: mapKey || (focus.id ? `${focus.id}:${focus.step}` : ''), thinking: focus.thinking });
  idle.setPaused(paused || focus.pause);
  paintFocus(focus);
}
window.addEventListener('lesson-dialog-state', event => {
  dialogOpen = !!(event as CustomEvent<{ open: boolean }>).detail.open;
  if (dialogOpen) stopMovement();
  if (controls) controls.inert = dialogOpen;
  syncIdle();
});
window.addEventListener('lesson-map-changed', () => { stopMovement(); syncIdle(true); window.setTimeout(() => syncIdle(), 800); });
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
  noteActivity();
  window.dispatchEvent(new CustomEvent('lesson-goto', { detail: { ...focus.target, goto: true } }));
  void request('navHelp', { levelId: context?.levelId, mapId: focus.target.mapId || '', step: focus.step, focusId: focus.id, trigger: 'goto', strength: 0, idleMs: 0 }).catch(() => undefined);
});
document.getElementById('engine-help')?.addEventListener('click', () => {
  const focus = lessonFocus();
  noteActivity();
  void request('navHelp', { levelId: getContext()?.levelId, mapId: focus.target.mapId || '', step: focus.step, focusId: focus.id, trigger: 'button', strength: 0, idleMs: 0 }).catch(() => undefined);
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

const previewing = new URLSearchParams(location.search).has('preview');
if (!previewing) start().catch(error => {
  console.error('RPGJS could not start', error);
  showStatus(error instanceof Error ? error.message : '园区暂未加载成功。已保存的学习记录会保留。', true);
});

window.addEventListener('pagehide', () => { stopMovement(); dispose(); }, { once: true });

let artifactQueue = Promise.resolve();
window.addEventListener('lesson-artifact', event => {
  if (window.parent === window) return;
  let patch: Record<string, unknown>;
  try { patch = toPlain((event as CustomEvent<Record<string, unknown>>).detail || {}); }
  catch (error) {
    console.warn('流程图没有保存', error);
    showStatus('流程图没有保存，请再点一次卡片和空格。');
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
    createApp(FlowPanel, {
      mode: 'sale',
      preview,
      diagnosed: true,
      flow: { diamond: 'ge30', yes: 'on', no: 'off', locked: preview !== 'flow' }
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
