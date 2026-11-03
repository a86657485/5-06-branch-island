import test from 'node:test';
import assert from 'node:assert/strict';
import { nextStep, VALID_GOALS } from '../public/guidance.mjs';

/** 各站交互点的真实标签（与 scene.mjs 的 buildEntries 对齐）。 */
const LABELS = {
  sale: { guide: '园区养护员', sensor: '温度探头', control: '通风控制柜', fan: '执行风机', verify: '监测屏核验' },
  repair: { guide: '维修员阿诚', sensor: '温度探头', control: '故障控制柜', fan: '执行风机', verify: '监测屏核验' },
  cross: { guide: '安全员', observe: '观察现场', control: '设置指引牌', bridge: '天桥入口', zebra: '斑马线入口', signal: '信号控制箱', verify: '对岸核验' },
  minimum: { guide: '能源工程师', a: '电池A采集台', b: '电池B采集台', control: '电量分配台', verify: '充电口核验' },
};

const scene = (over = {}) => ({ phase: 'assigned', measured: false, visited: [], collected: [], temperatureCase: 30, ...over });
const step = (station, s, extra = {}) => nextStep({ station, scene: s, prediction: '', input: {}, ...extra });

test('任务条目标必须是该站真实存在的交互点', () => {
  const fixtures = [];
  for (const station of ['sale', 'repair']) {
    for (const measured of [false, true]) {
      for (const prediction of ['', 'on']) {
        for (const diagnosed of [false, true]) {
          for (const ticket of [null, { output: 'on' }]) {
            fixtures.push([station, scene({ measured, ticket, visited: diagnosed ? ['diagnosed'] : [] }), { prediction }]);
          }
        }
      }
    }
  }
  for (const measured of [false, true]) {
    for (const output of ['bridge', 'crossing']) {
      for (const signal of ['red', 'green']) {
        for (const phase of ['route', 'arrived']) {
          fixtures.push(['cross', scene({ measured, phase, signal, ticket: { output } }), {}]);
        }
      }
    }
  }
  for (const collected of [[], ['a'], ['a', 'b']]) {
    for (const phase of ['pickup', 'charging']) {
      for (const output of ['3', '8']) {
        fixtures.push(['minimum', scene({ measured: collected.length === 2, phase, collected, ticket: { output } }), { input: { a: 3, b: 8 } }]);
      }
    }
  }
  for (const [station, s, extra] of fixtures) {
    const { goal, text } = step(station, s, extra);
    assert.ok(VALID_GOALS[station].includes(goal), `${station} 指向了不存在的目标点：${goal}`);
    assert.ok(text && !/undefined|NaN/.test(text), `${station} 文案异常：${text}`);
    const tokens = [...text.matchAll(/【([^】]+)】/g)].map(m => m[1]);
    for (const token of tokens) {
      assert.ok(
        LABELS[station][goal].includes(token),
        `${station}：文案让去【${token}】，箭头却指向「${LABELS[station][goal]}」`,
      );
    }
  }
});

test('第一站：读数据 → 设规则并预测 → 执行 → 核验，四步不跳', () => {
  assert.deepEqual(step('sale', scene({ phase: 'start' })), { goal: 'guide', text: '先走近现场NPC，领取调试委托。' });
  assert.equal(step('sale', scene(), {}).goal, 'sensor');
  assert.equal(step('sale', scene({ measured: true })).goal, 'control');
  assert.equal(step('sale', scene({ measured: true }), { prediction: 'on' }).goal, 'fan');
  assert.equal(step('sale', scene({ measured: true, ticket: { output: 'on' } }), { prediction: 'on' }).goal, 'verify');
});

test('第二站：故障没确认前，不能叫学生去改规则', () => {
  const before = step('repair', scene({ measured: true }), {});
  assert.equal(before.goal, 'control');
  assert.match(before.text, /猜/);
  assert.ok(!/改/.test(before.text), '规则还锁着就叫学生改，会让他反复点柜子');

  assert.equal(step('repair', scene({ measured: true }), { prediction: 'on' }).goal, 'fan');
  assert.match(step('repair', scene({ measured: true }), { prediction: 'on' }).text, /重现|错在哪/);

  const after = step('repair', scene({ measured: true, visited: ['diagnosed'] }), {});
  assert.equal(after.goal, 'control');
  assert.match(after.text, /改/);
  assert.equal(step('repair', scene({ measured: true, visited: ['diagnosed'] }), { prediction: 'off' }).goal, 'fan');
});

test('第三站：红灯时不能把学生指向斑马线', () => {
  const red = step('cross', scene({ measured: true, ticket: { output: 'crossing' }, signal: 'red', phase: 'route' }));
  assert.equal(red.goal, 'signal');
  assert.match(red.text, /红灯/);

  const green = step('cross', scene({ measured: true, ticket: { output: 'crossing' }, signal: 'green', phase: 'route' }));
  assert.equal(green.goal, 'zebra');

  const bridge = step('cross', scene({ measured: true, ticket: { output: 'bridge' }, signal: 'red', phase: 'route' }));
  assert.equal(bridge.goal, 'bridge', '有天桥时红绿灯不影响');
});

test('第三站：走完一轮先回安全员换现场，再重新观察', () => {
  assert.equal(step('cross', scene({ measured: true })).goal, 'control');
  assert.equal(step('cross', scene({ measured: true, visited: ['verified'] })).goal, 'guide');
  assert.equal(step('cross', scene({ measured: true, ticket: { output: 'bridge' }, phase: 'arrived' })).goal, 'verify');
});

test('第四站：先采两组，再比较，再按出口取样', () => {
  assert.equal(step('minimum', scene(), { input: { a: 3, b: 8 } }).goal, 'a');
  assert.equal(step('minimum', scene({ collected: ['a'] }), { input: { a: 3, b: 8 } }).goal, 'b');
  assert.equal(step('minimum', scene({ collected: ['a', 'b'], measured: true }), { input: { a: 3, b: 8 } }).goal, 'control');
  assert.equal(step('minimum', scene({ collected: ['a', 'b'], measured: true, visited: ['verified'] }), {}).goal, 'guide');
  assert.equal(step('minimum', scene({ collected: ['a', 'b'], measured: true, ticket: { output: '3' }, phase: 'pickup' }), { input: { a: 3, b: 8 } }).goal, 'a');
  assert.equal(step('minimum', scene({ collected: ['a', 'b'], measured: true, ticket: { output: '8' }, phase: 'pickup' }), { input: { a: 3, b: 8 } }).goal, 'b');
  assert.equal(step('minimum', scene({ collected: ['a', 'b'], measured: true, ticket: { output: '3' }, phase: 'charging' }), { input: { a: 3, b: 8 } }).goal, 'verify');
});

test('验收通过后统一指向 NPC，不再催学生做实验', () => {
  for (const station of ['sale', 'repair', 'cross', 'minimum']) {
    assert.equal(step(station, scene({ measured: true }), { levelValid: true }).goal, 'guide');
  }
});

test('第二站：执行完就该去核验，不能因为还没诊断就再叫去风机', () => {
  const executed = step('repair', scene({ measured: true, ticket: { output: 'off' } }), { prediction: 'on' });
  assert.equal(executed.goal, 'verify');
  assert.match(executed.text, /核验/);
  // 诊断完成、改好规则、又执行了一次：同样直接去核验
  const again = step('repair', scene({ measured: true, ticket: { output: 'on' }, visited: ['diagnosed'] }), { prediction: 'on' });
  assert.equal(again.goal, 'verify');
});
