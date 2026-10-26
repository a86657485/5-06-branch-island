import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import layout from '../engine/src/tiled/layout.json' with { type: 'json' };
import { GREENHOUSE_ACTORS } from '../engine/src/modules/lesson/greenhouse-cast.ts';
import { clickWaypoints } from '../engine/src/modules/lesson/click-path.ts';
import { standBeside } from '../engine/src/modules/lesson/approach.ts';
import { currentFocus, gotoTitle } from '../public/focus.mjs';

const ids = ['guide', 'sensor', 'control', 'fan', 'verify', 'portal'];
const approved = { start: [780, 620], guide: [520, 430], sensor: [360, 430], control: [260, 500], fan: [420, 520], verify: [600, 500], portal: [700, 530] };
const tmx = readFileSync(new URL('../engine/src/tiled/greenhouse.tmx', import.meta.url), 'utf8');
const cells = tmx.match(/<layer[^>]*name="Solid scenery"[\s\S]*?<data[^>]*>([\s\S]*?)<\/data>/)[1].trim().split(/[,\s]+/).map(Number);
const point = ([x, y]) => ({ x, y });
const positionsIn = text => Object.fromEntries([...text.matchAll(/(start|guide|sensor|control|fan|verify|portal):\s*\[(\d+),\s*(\d+)\]/g)].map(([, id, x, y]) => [id, [Number(x), Number(y)]]));

function collision({ x, y }) {
  for (let row = Math.floor(y / 32); row <= Math.floor((y + 23.999) / 32); row += 1) {
    for (let column = Math.floor(x / 32); column <= Math.floor((x + 23.999) / 32); column += 1) {
      if (column < 0 || column >= 48 || row < 0 || row >= 32 || cells[row * 48 + column]) return true;
    }
  }
  return false;
}

function assertWalkable(from, to, label) {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 2));
  for (let step = 0; step <= steps; step += 1) {
    const at = { x: from.x + (to.x - from.x) * step / steps, y: from.y + (to.y - from.y) * step / steps };
    assert.equal(collision(at), false, `${label}: 24×24 碰撞框在 ${at.x.toFixed(1)},${at.y.toFixed(1)} 受阻`);
  }
}

test('温室六处对象分散并与起点留出一个身位，所有位置来源同步', () => {
  const positions = layout.greenhouse.positions;
  assert.deepEqual(positions, approved);
  const entries = Object.entries(positions);
  for (let index = 0; index < entries.length; index += 1) {
    for (const [otherId, other] of entries.slice(index + 1)) {
      const [id, current] = entries[index];
      assert.equal(Math.hypot(current[0] - other[0], current[1] - other[1]) >= 104, true, `${id} 与 ${otherId} 不得拥挤`);
    }
  }
  const generator = readFileSync(new URL('../scripts/build-rpg-assets.cjs', import.meta.url), 'utf8').match(/greenhouse:\s*\{([^}]+)\}/)[1];
  const focus = readFileSync(new URL('../public/focus.mjs', import.meta.url), 'utf8').match(/greenhouse:\s*\{([^}]+)\}/)[1];
  assert.deepEqual(positionsIn(generator), positions, '资产生成器保持同一布局');
  assert.deepEqual(positionsIn(focus), Object.fromEntries(ids.map(id => [id, positions[id]])), '地图焦点落在实际对象上');
  assert.deepEqual(Object.fromEntries(GREENHOUSE_ACTORS.map(actor => [actor.id, [actor.x, actor.y]])), Object.fromEntries(ids.map(id => [id, positions[id]])), '动态角色重建后位置一致');
  const objects = Object.fromEntries([...tmx.matchAll(/<object[^>]+name="([^"]+)"[^>]+x="(\d+)" y="(\d+)"/g)].map(([, id, x, y]) => [id, [Number(x), Number(y)]]));
  assert.deepEqual(objects, positions, 'TMX 初始对象保持同一布局');
});

test('温室起点、对象和四侧互动站位容纳 24×24 碰撞框', () => {
  for (const [id, coordinates] of Object.entries(approved)) {
    const target = point(coordinates);
    for (const [dx, dy] of [[0, 0], [16, 0], [-16, 0], [0, 16], [0, -16]]) {
      assert.equal(collision({ x: target.x + dx, y: target.y + dy }), false, `${id} ${dx},${dy}`);
    }
  }
});

test('温室自动行走从起点及任一设备抵达其它互动站位时绕过花坛', () => {
  const targets = ids.map(id => ({ id, ...point(approved[id]) }));
  const starts = Object.entries(approved).flatMap(([id, [x, y]]) => (id === 'start' ? [[0, 0]] : [[0, 0], [16, 0], [-16, 0], [0, 16], [0, -16]]).map(([dx, dy]) => ({ id, x: x + dx, y: y + dy })));
  starts.push({ id: 'sensor-north', x: 358, y: 402 });
  for (const levelId of ['sale', 'repair']) {
    for (const from of starts) {
      for (const target of targets) {
        if (from.id === target.id) continue;
        const others = targets.filter(other => other.id !== target.id);
        const stand = standBeside(target, from, others);
        const waypoints = clickWaypoints(from, { ...stand, place: target.id }, { levelId });
        let previous = from;
        for (const waypoint of waypoints) {
          assertWalkable(previous, waypoint, `${levelId} ${from.id}→${target.id}`);
          previous = waypoint;
        }
        assert.deepEqual({ x: previous.x, y: previous.y }, { x: stand.x, y: stand.y });
      }
    }
  }
});

test('地图导航提示使用实际的自动前往按钮名', () => {
  for (const levelId of ['sale', 'repair', 'cross', 'minimum']) {
    const focus = currentFocus({ levelId, scene: { phase: 'start' } });
    assert.equal(gotoTitle(focus), '自动前往');
    assert.match(focus.strong, /自动前往/);
    assert.equal(focus.strong.includes('下一步'), false);
    assert.equal([...focus.strong].length <= 25, true);
  }
  assert.equal(currentFocus({ levelId: 'repair', scene: { phase: 'start' } }).hint, '点自动前往，听维修员说问题。');
});
