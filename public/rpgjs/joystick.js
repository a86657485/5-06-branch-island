/**
 * 触屏摇杆（2026-10-26）
 *
 * 引擎的行走入口是 engine.processInput，但它在打包产物里不外露；键盘事件是同一通道，
 * 因此这里改为派发 ArrowUp/Down/Left/Right 的 keydown / keyup，与真实键盘完全同路径。
 * 只在触摸设备显示（见 index.html 的 @media (pointer: coarse) 与 html.lesson-touch）。
 */
(function () {
  var base = document.getElementById('lesson-joystick');
  var knob = document.getElementById('lesson-joystick-knob');
  if (!base || !knob) return;

  var MAX = 42;   // 摇杆最大位移（像素）
  var DEAD = 12;  // 中央死区，避免误触抖动
  var KEYS = {
    up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
    down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
    left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
    right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 }
  };

  var active = null;
  var pointerId = null;

  // 桌面 Chrome 也会挂着 ontouchstart，这里以指针类型为准，避免台式机误显示摇杆
  var mq = window.matchMedia ? window.matchMedia.bind(window) : null;
  var coarse = mq ? mq('(pointer: coarse)').matches : false;
  var fine = mq ? mq('(pointer: fine)').matches : true;
  var hasTouch = (navigator.maxTouchPoints || 0) > 0;
  if (coarse || (hasTouch && !fine)) {
    document.documentElement.classList.add('lesson-touch');
  }

  function blocked() {
    // 对话、规则面板、错误状态打开时不给行走，避免绕过引擎的 canControl 判断
    if (document.querySelector('.dialog-shade, .studio-shade')) return true;
    var controls = document.getElementById('engine-controls');
    if (controls && controls.inert) return true;
    var status = document.getElementById('engine-status');
    if (status && !status.hidden) return true;
    return false;
  }

  function dispatch(type, direction) {
    var k = KEYS[direction];
    if (!k) return;
    var event = new KeyboardEvent(type, {
      key: k.key,
      code: k.code,
      keyCode: k.keyCode,
      which: k.keyCode,
      bubbles: true,
      cancelable: true
    });
    window.dispatchEvent(event);
    document.dispatchEvent(event);
  }

  function resetKnob() {
    knob.style.transform = 'translate(0,0)';
  }

  function release() {
    if (active) dispatch('keyup', active);
    active = null;
    resetKnob();
  }

  function setDirection(direction) {
    if (direction === active) return;
    if (active) dispatch('keyup', active);
    active = direction;
    if (direction) dispatch('keydown', direction);
  }

  function update(clientX, clientY) {
    var rect = base.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var dx = clientX - cx;
    var dy = clientY - cy;
    var length = Math.sqrt(dx * dx + dy * dy) || 1;
    if (length > MAX) {
      dx = (dx / length) * MAX;
      dy = (dy / length) * MAX;
    }
    knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';

    if (blocked()) {
      if (active) release();
      return;
    }
    if (length < DEAD) {
      setDirection(null);
      return;
    }
    if (Math.abs(dx) >= Math.abs(dy)) setDirection(dx > 0 ? 'right' : 'left');
    else setDirection(dy > 0 ? 'down' : 'up');
  }

  base.addEventListener('pointerdown', function (event) {
    if (event.pointerType === 'mouse') return;  // 桌面用键盘，摇杆只在触屏生效
    event.preventDefault();
    event.stopPropagation();
    pointerId = event.pointerId;
    try { base.setPointerCapture(pointerId); } catch (error) { /* 老内核忽略 */ }
    base.classList.add('is-active');
    update(event.clientX, event.clientY);
  });

  base.addEventListener('pointermove', function (event) {
    if (pointerId === null || event.pointerId !== pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    update(event.clientX, event.clientY);
  });

  function end(event) {
    if (pointerId === null || (event && event.pointerId !== pointerId)) return;
    pointerId = null;
    base.classList.remove('is-active');
    release();
  }

  base.addEventListener('pointerup', end);
  base.addEventListener('pointercancel', end);
  base.addEventListener('lostpointercapture', end);
  window.addEventListener('blur', end);

  // 面板弹出或被遮挡时兜底松开，避免角色一直朝一个方向走
  window.setInterval(function () {
    if (active && blocked()) release();
  }, 250);
})();
