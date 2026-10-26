import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../engine/public/joystick.js', import.meta.url), 'utf8');

function joystick() {
  class Hub {
    listeners = new Map();
    addEventListener(type, listener) {
      this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
    }
    dispatchEvent(event) {
      for (const listener of this.listeners.get(event.type) || []) listener(event);
      if (event.bubbles && !event.stopped) this.parent?.dispatchEvent(event);
    }
  }
  class Event {
    constructor(type, options = {}) { this.type = type; Object.assign(this, options); }
    preventDefault() {}
    stopPropagation() { this.stopped = true; }
  }
  const window = new Hub();
  const document = new Hub();
  document.parent = window;
  const classes = new Set();
  const base = Object.assign(new Hub(), {
    classList: { add: value => classes.add(value), remove: value => classes.delete(value) },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 132, height: 132 }),
    setPointerCapture() {}, releasePointerCapture() {}
  });
  const knob = { style: {} };
  const controls = { inert: false, dataset: { blocked: 'false' } };
  const status = { hidden: true };
  const nodes = { 'lesson-joystick': base, 'lesson-joystick-knob': knob, 'engine-controls': controls, 'engine-status': status };
  document.documentElement = { classList: { add() {} } };
  document.getElementById = id => nodes[id];
  let shade = false;
  document.querySelector = () => shade ? {} : null;
  const intervals = [];
  window.setInterval = callback => intervals.push(callback);
  window.matchMedia = query => ({ matches: query === '(pointer: coarse)' });
  const keys = [];
  window.addEventListener('keydown', event => keys.push(`${event.type}:${event.key}`));
  window.addEventListener('keyup', event => keys.push(`${event.type}:${event.key}`));
  runInNewContext(source, { window, document, navigator: { maxTouchPoints: 1 }, KeyboardEvent: Event });
  const pointer = (type = 'pointerdown', options = {}) => base.dispatchEvent(new Event(type, {
    pointerId: 4, pointerType: 'touch', clientX: 115, clientY: 66, ...options
  }));
  const signal = (type, detail) => window.dispatchEvent(new Event(type, { detail }));
  return { window, document, keys, pointer, signal, knob, controls, status, classes, interval: () => intervals.forEach(callback => callback()), shade: value => { shade = value; } };
}

test('摇杆每次按下和松开只向键盘通道发送一次事件', () => {
  const h = joystick();
  h.pointer();
  h.pointer('pointerup');
  assert.deepEqual(h.keys, ['keydown:ArrowRight', 'keyup:ArrowRight']);
  h.pointer('pointerdown', { pointerType: 'mouse' });
  assert.equal(h.keys.length, 2);
});

test('自动前往开始时立即松开，阻止手势续走，结束后可重新按住', () => {
  const h = joystick();
  h.pointer();
  h.signal('lesson-walking', { moving: true });
  assert.equal(h.keys.at(-1), 'keyup:ArrowRight');
  assert.equal(h.knob.style.transform, 'translate(0,0)');
  assert.equal(h.classes.has('is-active'), false);
  const released = h.keys.length;
  h.pointer('pointermove', { clientX: 10 });
  h.pointer();
  assert.equal(h.keys.length, released);
  h.signal('lesson-walking', { moving: false });
  h.pointer();
  assert.equal(h.keys.at(-1), 'keydown:ArrowRight');
});

for (const reason of ['status', 'auxiliary', 'hostOverlay']) {
  test(`${reason} 的统一阻塞信号立即松开并允许恢复`, () => {
    const h = joystick();
    h.pointer();
    h.signal('lesson-controls-state', { blocked: true, reason });
    assert.equal(h.keys.at(-1), 'keyup:ArrowRight');
    const released = h.keys.length;
    h.pointer();
    assert.equal(h.keys.length, released);
    h.signal('lesson-controls-state', { blocked: false });
    h.pointer();
    assert.equal(h.keys.at(-1), 'keydown:ArrowRight');
  });
}

test('对话和规则面板各自关闭后才恢复摇杆', () => {
  const h = joystick();
  h.pointer();
  h.signal('lesson-dialog-state', { open: true });
  assert.equal(h.keys.at(-1), 'keyup:ArrowRight');
  h.signal('lesson-process-panel', { open: true });
  h.signal('lesson-dialog-state', { open: false });
  const released = h.keys.length;
  h.pointer();
  assert.equal(h.keys.length, released);
  h.signal('lesson-process-panel', { open: false });
  h.pointer();
  assert.equal(h.keys.at(-1), 'keydown:ArrowRight');
});

test('父页面遮挡现场时立即松开摇杆', () => {
  const h = joystick();
  h.pointer();
  h.window.dispatchEvent({ type: 'message', data: { type: 'rpgjs-overlay', open: true } });
  assert.equal(h.keys.at(-1), 'keyup:ArrowRight');
  const released = h.keys.length;
  h.pointer();
  assert.equal(h.keys.length, released);
  h.window.dispatchEvent({ type: 'message', data: { type: 'rpgjs-overlay', open: false } });
  h.pointer();
  assert.equal(h.keys.at(-1), 'keydown:ArrowRight');
});

test('失焦没有 pointerId 也会立即松开，并清理旧手势', () => {
  const h = joystick();
  h.pointer();
  h.window.dispatchEvent({ type: 'blur' });
  assert.equal(h.keys.at(-1), 'keyup:ArrowRight');
  assert.equal(h.knob.style.transform, 'translate(0,0)');
  const released = h.keys.length;
  h.pointer('pointermove');
  assert.equal(h.keys.length, released);
});

test('DOM阻塞状态仍能拦截新按下并兜底松开现有按键', () => {
  const h = joystick();
  h.controls.dataset.blocked = 'true';
  h.pointer();
  assert.deepEqual(h.keys, []);
  h.controls.dataset.blocked = 'false';
  h.pointer();
  h.status.hidden = false;
  h.interval();
  assert.equal(h.keys.at(-1), 'keyup:ArrowRight');
  assert.equal(h.knob.style.transform, 'translate(0,0)');
  assert.equal(h.classes.has('is-active'), false);
  h.status.hidden = true;
  h.shade(true);
  const released = h.keys.length;
  h.pointer();
  assert.equal(h.keys.length, released);
});
