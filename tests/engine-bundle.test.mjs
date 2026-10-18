import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

test('改了 public/focus.mjs 却没重新打包时，测试会失败', () => {
  const source = readFileSync(new URL('../public/focus.mjs', import.meta.url));
  const hash = createHash('sha256').update(source).digest('hex');
  const stamp = readFileSync(new URL('../public/rpgjs/focus-source.txt', import.meta.url), 'utf8').trim();
  assert.equal(stamp, `public/focus.mjs ${hash}`, 'public/focus.mjs 已变，先运行 npm run build:engine');
  const html = readFileSync(new URL('../public/rpgjs/index.html', import.meta.url), 'utf8');
  const bundleName = html.match(/\/rpgjs\/assets\/(index-[A-Za-z0-9_-]+\.js)/)?.[1];
  assert.ok(bundleName, '园区页面没有指向打包后的脚本');
  const bundle = readFileSync(new URL(`../public/rpgjs/assets/${bundleName}`, import.meta.url), 'utf8');
  assert.equal(bundle.includes('点亮着的空格，再点一张卡片。'), false);
  assert.equal(bundle.includes('把卡片拖进亮着的空格，或先点卡片再点空格。'), true);
});
