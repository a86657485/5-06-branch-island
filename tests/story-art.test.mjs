import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import path from 'node:path';

const dir = path.join(import.meta.dirname, '../public/assets/story');
const stems = ['ill-brief', 'ill-cool', 'ill-cross-ok', 'ill-energy', 'ill-fault', 'ill-queue', 'ill-wilt'];
const pngs = stems.map(stem => `${stem}.png`);
const webps = stems.map(stem => `${stem}.webp`);

test('剧情配图七张齐全，PNG 原图与 WebP 派生图并存', () => {
  assert.deepEqual(readdirSync(dir).sort(), [...pngs, ...webps].sort());
});

test('页面引用的是七张 WebP，不再直接加载 PNG', () => {
  const patrol = readFileSync(path.join(import.meta.dirname, '../public/patrol.mjs'), 'utf8');
  const references = [...patrol.matchAll(/\/assets\/story\/([^'"\s]+)/g)].map(match => match[1]);
  assert.deepEqual([...new Set(references)].sort(), [...webps].sort());
});

test('WebP 派生图必须明显小于原 PNG（防止回退成大图拖慢旧电脑）', () => {
  for (const stem of stems) {
    const png = statSync(path.join(dir, `${stem}.png`)).size;
    const webp = statSync(path.join(dir, `${stem}.webp`)).size;
    assert.ok(webp < png * 0.35, `${stem}.webp 只比 PNG 小 ${(100 - (webp / png) * 100).toFixed(0)}%，压缩失效`);
  }
});

test('七张剧情原图均为可解压的 960×540 RGB PNG', () => {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  for (const name of pngs) {
    const bytes = readFileSync(path.join(dir, name));
    assert.ok(bytes.length > 10_000, `${name} 图像数据不完整`);
    assert.deepEqual(bytes.subarray(0, 8), signature, name);
    assert.equal(bytes.readUInt32BE(8), 13, name);
    assert.equal(bytes.toString('ascii', 12, 16), 'IHDR', name);
    assert.equal(bytes.readUInt32BE(16), 960, name);
    assert.equal(bytes.readUInt32BE(20), 540, name);
    assert.equal(bytes[24], 8, `${name} 位深`);
    assert.equal(bytes[25], 2, `${name} RGB 色彩`);
    assert.equal(bytes[28], 0, `${name} 非隔行图像`);
    const compressed = [];
    let offset = 8;
    let ended = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      assert.ok(offset + length + 12 <= bytes.length, `${name} 区块截断`);
      if (type === 'IDAT') compressed.push(bytes.subarray(offset + 8, offset + 8 + length));
      offset += length + 12;
      if (type === 'IEND') { ended = true; break; }
    }
    assert.ok(ended && compressed.length, `${name} 缺少图像或结束区块`);
    assert.equal(offset, bytes.length, `${name} 末尾存在多余内容`);
    const pixels = inflateSync(Buffer.concat(compressed));
    const stride = 960 * 3 + 1;
    assert.equal(pixels.length, stride * 540, `${name} 像素数据长度`);
    for (let y = 0; y < 540; y++) assert.ok(pixels[y * stride] <= 4, `${name} 行过滤器无效`);
  }
});

test('节能配图保留已审图的 A 高绿条、B 低黄条与“电量低的先充”', () => {
  // 固定已目视核对的原图与线上派生图，避免再次替换成电量关系相反的示意图。
  const png = createHash('sha256').update(readFileSync(path.join(dir, 'ill-energy.png'))).digest('hex');
  assert.equal(png, '533b12f1f3b2d2749a33f7729266f77cd0e6943da04364ce04f6f289dba12f04');
  const webp = createHash('sha256').update(readFileSync(path.join(dir, 'ill-energy.webp'))).digest('hex');
  assert.equal(webp, '854e69fa3a5940d9db877cd795d795980635f136f7a3769b28bbd2a9d0644438');
});
