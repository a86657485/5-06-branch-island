import test from 'node:test';
import assert from 'node:assert/strict';
import { TESTERS, createIntro, introAct } from '../public/intro.mjs';

test('闸机按主管、量高、判断、出票、告示、回答、通道往下走', () => {
  let intro = createIntro();
  assert.equal(intro.accepted, false);
  intro = introAct(intro, 'lead');
  assert.equal(intro.accepted, true);
  intro = introAct(intro, 'measure', 116);
  intro = introAct(intro, 'judge', 'half');
  intro = introAct(intro, 'ticket');
  const reviewed = introAct(intro, 'review');
  assert.equal(reviewed.review, true);
  assert.equal(reviewed.ticket, '10');
  assert.equal(reviewed.heightCase, 116);
  assert.equal(reviewed.judged, 'half');
  intro = introAct(intro, 'sign');
  assert.equal(intro.sawSign, true);
  intro = introAct(intro, 'idea', '看情况收费');
  assert.equal(intro.idea, '看情况收费');
  intro = introAct(intro, 'leave');
  assert.equal(intro.done, true);
});

test('闸机测试者不动，没票不能离开，出票和跳过都能进温室', () => {
  const before = TESTERS.map(tester => ({ ...tester }));
  let intro = introAct(createIntro(), 'measure', 116);
  assert.equal(intro.heightCase, 116);
  intro = introAct(intro, 'leave');
  assert.equal(intro.done, false);
  assert.match(intro.blocked, /还没出票/);
  intro = introAct(intro, 'judge', 'half');
  intro = introAct(intro, 'ticket');
  assert.equal(intro.ticket, '10');
  const reviewed = introAct(intro, 'review');
  assert.equal(reviewed.ticket, '10');
  assert.equal(reviewed.review, true);
  intro = introAct(intro, 'leave');
  assert.equal(intro.done, true);
  const skipped = introAct(createIntro(), 'skip');
  assert.equal(skipped.done, true);
  assert.equal(skipped.skipped, true);
  assert.deepEqual(TESTERS, before);
});
