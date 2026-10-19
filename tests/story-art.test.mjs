import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.join(import.meta.dirname, '../public/assets/story');

function parseXml(source) {
  const tokens = source.match(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/[^>]+>|<[^>]+>/g);
  if (!tokens?.length) throw new Error('没有标签');
  const stack = [];
  let root = null;
  for (const token of tokens) {
    if (token.startsWith('<?') || token.startsWith('<!')) continue;
    if (token.startsWith('</')) {
      const name = token.slice(2, -1).trim().split(/\s/)[0];
      const open = stack.pop();
      if (!open || open.name !== name) throw new Error(`标签不成对：${name}`);
      if (!stack.length) root = open;
      else stack.at(-1).children.push(open);
      continue;
    }
    const self = /\/>$/.test(token);
    const inner = token.slice(1, self ? -2 : -1).trim();
    const name = inner.split(/\s/)[0];
    if (!/^[A-Za-z_][\w:.-]*$/.test(name)) throw new Error(`标签名无效：${name}`);
    const node = { name, children: [] };
    if (self) {
      if (!stack.length) root = node;
      else stack.at(-1).children.push(node);
    } else stack.push(node);
  }
  if (stack.length) throw new Error(`未闭合：${stack.map(item => item.name).join(',')}`);
  return root;
}

test('剧情 SVG 都是合法 UTF-8，并能解析成 SVG', () => {
  const files = readdirSync(dir).filter(name => name.endsWith('.svg')).sort();
  assert.deepEqual(files, [
    'ill-brief.svg', 'ill-cool.svg', 'ill-cross-ok.svg', 'ill-energy.svg',
    'ill-fault.svg', 'ill-queue.svg', 'ill-wilt.svg'
  ]);
  for (const name of files) {
    const bytes = readFileSync(path.join(dir, name));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const root = parseXml(text);
    assert.equal(root?.name, 'svg', name);
    assert.equal(text.includes('\uFFFD'), false, name);
  }
});
