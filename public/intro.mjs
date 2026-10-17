/** I0 闸机故障单。测试者固定站在立柱旁，不跟随。 */

export const TESTERS = [
  { id: 't116', name: '测试者 116', height: 116, x: 168, y: 210 },
  { id: 't138', name: '测试者 138', height: 138, x: 248, y: 210 }
];

export function createIntro() {
  return { accepted: false, heightCase: null, judged: null, ticket: null, idea: null, sawSign: false, done: false, skipped: false, review: false, blocked: null };
}

export function introAct(state, action, extra) {
  const current = state || createIntro();
  if (action === 'review') return { ...current, review: true, blocked: null };
  if (current.done || current.skipped) return current;
  if (action === 'lead') return { ...current, accepted: true, blocked: null };
  if (action === 'skip') return { ...current, skipped: true, done: true, blocked: null };
  if (action === 'measure') {
    if (!TESTERS.some(tester => tester.height === extra)) return { ...current, blocked: '请在立柱旁量已经站好的测试者。' };
    return { ...current, heightCase: extra, blocked: null };
  }
  if (action === 'judge') {
    if (!current.heightCase) return { ...current, blocked: '先到量高立柱读身高。' };
    if (extra !== 'half' && extra !== 'full') return current;
    return { ...current, judged: extra, blocked: null };
  }
  if (action === 'ticket') {
    if (!current.judged) return { ...current, blocked: '先判一判：这位该买哪种票？' };
    return { ...current, ticket: '10', blocked: null };
  }
  if (action === 'sign') return { ...current, sawSign: true, blocked: null };
  if (action === 'idea') return { ...current, idea: extra || '看情况收费', blocked: null };
  if (action === 'leave') {
    if (!current.ticket) return { ...current, blocked: '还没出票，不能去温室。先让闸机出一张票。' };
    return { ...current, done: true, blocked: null };
  }
  return current;
}
