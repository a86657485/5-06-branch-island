import test from 'node:test';
import assert from 'node:assert/strict';
import { currentFocus } from '../public/focus.mjs';

/** 每个交互点对应的说法：描述里必须点到它，否则光圈和文字就是两回事。
 *  过街的四个入口例外——设计上不提前说出走天桥还是斑马线，只说“沿选中的路线”。 */
const KEYWORDS = {
  guide: /负责人|园艺员|维修员|安全员|工程师|主管|汇报/,
  sensor: /探头|温度/,
  control: /控制柜|导行屏|分配台/,
  fan: /风机/,
  verify: /核验/,
  monitor: /核验|充电口|监测/,
  observe: /观察/,
  signal: /信号灯|红灯|绿灯/,
  batteryA: /电池A|两组电池|电量/,
  batteryB: /电池B|两组电池|电量/,
  portal: /通道|下一站|温室/,
};
const WALKING = new Set(['bridgeWest', 'bridgeEast', 'crossingWest', 'crossingEast']);

const scene = (over = {}) => ({ phase: 'assigned', measured: false, visited: [], actions: [], collected: [], ...over });
const draft = (over = {}) => ({
  config: { operator: '>=', yes: 'on', no: 'off' },
  flow: { diamond: 'ge30', yes: 'on', no: 'off', locked: false },
  sentence: { locked: false },
  predictionsLocked: { locked: false },
  ...over,
});
const LOCKED = draft({
  flow: { diamond: 'ge30', yes: 'on', no: 'off', locked: true },
  sentence: { locked: true },
  predictionsLocked: { locked: true },
});

function matrix() {
  const out = [];
  for (const station of ['sale', 'repair', 'cross', 'minimum']) {
    const drafts = [
      {},
      draft(),
      LOCKED,
      draft({ diagnoseAnswer: 'swap', flow: { preset: false, diamond: 'ge30', yes: 'on', no: 'off', locked: true } }),
    ];
    const scenes = [
      scene(),
      scene({ measured: true }),
      scene({ measured: true, ticket: { output: 'on', branch: 'yes' } }),
      scene({ measured: true, ticket: { output: 'crossing', branch: 'no' }, signal: 'red' }),
      scene({ measured: true, ticket: { output: 'crossing', branch: 'no' }, signal: 'green' }),
      scene({ measured: true, visited: ['verified'], facility: false }),
      scene({ measured: true, collected: ['a'] }),
      scene({ phase: 'reading' }),
      scene({ measured: true, actions: ['observe', 'predict'] }),
    ];
    for (const s of scenes) {
      for (const d of drafts) {
        for (const levelValid of [false, true]) {
          for (const panelOpen of [undefined, true]) {
            out.push([station, s, d, levelValid, panelOpen]);
          }
        }
      }
    }
  }
  return out;
}

test('每一个光圈都说得出自己在哪：文案必须点到那个交互点', () => {
  const problems = [];
  let checked = 0;
  for (const [station, s, d, levelValid, panelOpen] of matrix()) {
    const focus = currentFocus({ levelId: station, scene: s, level: { valid: levelValid }, draft: d, runs: [], panelOpen });
    if (!focus) continue;
    checked += 1;
    const place = focus.target?.place;
    const text = `${focus.hint} ${focus.strong || ''}`;
    if (focus.kind === 'map') {
      if (!place) {
        problems.push(`${station}/${focus.id}：说自己在地图上，却没有目标点`);
        continue;
      }
      const re = KEYWORDS[place];
      if (re && !WALKING.has(place) && !re.test(text)) {
        problems.push(`${station}/${place}：文案没提到这个地点 → 「${focus.hint}」`);
      }
    } else if (place) {
      problems.push(`${station}/${focus.id}：面板步骤不该带地图目标(${place})`);
    }
    if (!focus.hint) problems.push(`${station}/${focus.id}：没有提示文案`);
  }
  assert.ok(checked > 150, `只检查到 ${checked} 个状态，矩阵没跑起来`);
  assert.deepEqual(problems, [], `发现 ${problems.length} 处描述与焦点不一致`);
});

test('面板类焦点不指向地图，地图类焦点给得出坐标', () => {
  for (const [station, s, d, levelValid, panelOpen] of matrix()) {
    const focus = currentFocus({ levelId: station, scene: s, level: { valid: levelValid }, draft: d, runs: [], panelOpen });
    if (!focus) continue;
    if (focus.kind === 'panel') {
      assert.equal(focus.goto, false, `${station}/${focus.id}：面板步骤不该有“自动前往”`);
      assert.equal(focus.target?.place, undefined, `${station}/${focus.id}：面板步骤不该指向地图`);
    }
    if (focus.kind === 'map' && focus.goto) {
      assert.ok(Number.isFinite(focus.target?.x) && Number.isFinite(focus.target?.y), `${station}/${focus.id}：可前往的焦点要有坐标`);
    }
  }
});
