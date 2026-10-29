import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { focusFootprint } from '../engine/src/focus-marker.ts';

test('地图标记落在精灵脚底，导航目标和脸部不被挪动', () => {
  const target = { x: 460, y: 445, place: 'guide' };
  const footprint = focusFootprint(target);
  assert.deepEqual(target, { x: 460, y: 445, place: 'guide' });
  // Frame anchor (24, 80), visible feet row 98; head occupies rows 5–34.
  assert.equal(footprint.x, target.x - 24 + 36);
  assert.equal(footprint.y, target.y - 80 + 98);
  assert.ok(footprint.y - footprint.radiusY * 1.12 > target.y - 80 + 34);
  assert.ok(footprint.radiusX / 44 >= 0.9 && footprint.radiusX / 44 <= 1.1);
  assert.ok(footprint.radiusY / footprint.radiusX >= 0.28 && footprint.radiusY / footprint.radiusX <= 0.35);
});

test('设备标记落在可见底边，无世界坐标的面板不出现地图标记', () => {
  const footprint = focusFootprint({ x: 330, y: 490, place: 'control' });
  assert.equal(footprint.y, 490 - 80 + 101);
  assert.equal(focusFootprint({}), null);
  assert.equal(focusFootprint({ x: NaN, y: 490 }), null);
});

test('焦点保留透明中心、侧箭头、静态降级和画外方向', () => {
  const html = fs.readFileSync(new URL('../engine/index.html', import.meta.url), 'utf8');
  const source = fs.readFileSync(new URL('../engine/src/standalone.ts', import.meta.url), 'utf8');
  assert.match(html, /\.focus-ring[^}]*background:\s*transparent/);
  assert.match(html, /prefers-reduced-motion:\s*reduce/);
  assert.match(html, /\.focus-arrow[^}]*pointer-events:\s*none/);
  assert.match(source, /offscreen \? arrow : '→'/);
  assert.match(source, /setHidden\(focusMarker, !!hostOverlay \|\| !point\)/);
  assert.match(source, /setDisabled\(goto, !focus\.goto/);
});
