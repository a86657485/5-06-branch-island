import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('上下文更新不再把加强提示清回 0', () => {
  const source = fs.readFileSync(new URL('../engine/src/standalone.ts', import.meta.url), 'utf8');
  assert.equal(source.includes('focusStrength = 0'), false);
  assert.match(source, /idle\.strength\(\)/);
  assert.match(source, /draft: context\?\.draft/);
  assert.match(source, /lesson-artifact/);
  assert.match(source, /paintDots/);
});
