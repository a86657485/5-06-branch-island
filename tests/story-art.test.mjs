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

const captions = {
  'ill-brief.svg': ['今日巡检', 'S1 温室', 'S2 返修', 'S3 路口', '阿派'],
  'ill-cool.svg': ['凉下来了'],
  'ill-cross-ok.svg': ['安全过街'],
  'ill-energy.svg': ['A 较高', 'B 较低', '电量低的先充'],
  'ill-fault.svg': ['30℃不开', '条件与出口', '控制器故障'],
  'ill-queue.svg': ['导行屏', '游客排队'],
  'ill-wilt.svg': ['菜苗蔫了']
};

test('剧情 SVG 都是合法 UTF-8，并能解析成 SVG', () => {
  const files = readdirSync(dir).filter(name => name.endsWith('.svg')).sort();
  assert.deepEqual(files, Object.keys(captions));
  for (const name of files) {
    const bytes = readFileSync(path.join(dir, name));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const root = parseXml(text);
    assert.equal(root?.name, 'svg', name);
    assert.equal(text.includes('\uFFFD'), false, name);
    assert.equal(text.includes('?'), false, name);
    for (const caption of captions[name]) assert.equal(text.includes(caption), true, `${name} 缺少 ${caption}`);
    if (name === 'ill-energy.svg') {
      const bar = (x) => {
        const found = text.match(new RegExp(`<rect x="${x}" y="\\d+" width="88" height="(\\d+)"`));
        assert.ok(found, name);
        return Number(found[1]);
      };
      assert.equal(bar(166) > bar(386), true);
    }
  }
});
