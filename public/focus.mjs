/** 任何时刻只返回一个焦点。提示只说去哪里、怎么点，不说选哪一张。 */

const PLACES = {
  greenhouse: { guide: [460, 445], sensor: [375, 425], control: [330, 490], fan: [270, 470], verify: [465, 500], portal: [605, 535] },
  workshop: { guide: [1035, 245], sensor: [970, 225], control: [1120, 225], fan: [1245, 225], verify: [1180, 235], portal: [955, 330] },
  energy: { guide: [540, 270], batteryA: [300, 155], batteryB: [440, 180], control: [365, 190], monitor: [435, 245], portal: [610, 300] },
  crossing: { guide: [350, 600], observe: [430, 515], control: [410, 595], bridgeWest: [470, 326], bridgeEast: [1080, 326], crossingWest: [470, 681], crossingEast: [1080, 681], verify: [1135, 535], portal: [1190, 590] },
  'crossing-east': { guide: [350, 600], observe: [430, 515], control: [410, 595], bridgeWest: [470, 326], bridgeEast: [1080, 326], crossingWest: [470, 681], crossingEast: [1080, 681], verify: [1135, 535], portal: [1190, 590] }
};

export function mapFor(levelId, scene) {
  if (levelId === 'repair') return 'workshop';
  if (levelId === 'minimum') return 'energy';
  if (levelId === 'cross') return scene?.facility === false ? 'crossing' : 'crossing-east';
  return 'greenhouse';
}

function clip(text) {
  const chars = [...String(text || '')];
  return chars.length <= 30 ? chars.join('') : chars.slice(0, 30).join('');
}

function at(mapId, place) {
  const point = PLACES[mapId]?.[place] || [0, 0];
  return { mapId, place, x: point[0], y: point[1] };
}

function pack(focus) {
  return {
    id: focus.id,
    step: focus.step,
    kind: focus.kind,
    thinking: !!focus.thinking,
    goto: !!focus.goto,
    gotoReason: focus.goto ? '' : (focus.gotoReason || ''),
    hint: clip(focus.hint),
    strong: clip(focus.strong),
    pause: !!focus.pause,
    target: focus.target || {}
  };
}

function stationFocus(levelId, scene, level) {
  const mapId = mapFor(levelId, scene);
  const walked = (scene.actions || []).includes('route') || (scene.visited || []).includes('verified');
  const crossingWalk = levelId === 'cross' && scene.ticket && !walked && !level?.valid;
  if (crossingWalk) {
    const useCrossing = scene.ticket.output === 'crossing' || scene.deviceOutput === 'crossing';
    const place = mapId === 'crossing-east'
      ? (useCrossing ? 'crossingEast' : 'bridgeEast')
      : (useCrossing ? 'crossingWest' : 'bridgeWest');
    return pack({
      id: place, step: '10', kind: 'map', thinking: false, goto: false,
      gotoReason: '这段要你亲自走过去',
      hint: '沿导行屏指的路，亲自走过去。',
      strong: '看方向标记，这段要亲自走。',
      pause: scene.signal === 'red',
      target: at(mapId, place)
    });
  }
  if (level?.valid) {
    return pack({ id: 'guide', step: 'done', kind: 'map', thinking: false, goto: true, hint: '本站已验收，去找负责人汇报。', strong: '走到发光标记，按 E 继续。', target: at(mapId, 'guide') });
  }
  if (!scene.phase || scene.phase === 'start') {
    return pack({ id: 'guide', step: '1', kind: 'map', thinking: false, goto: true, hint: '先听现场负责人说任务。', strong: '走到发光的圆圈上按 E。', target: at(mapId, 'guide') });
  }
  if (!scene.measured) {
    const place = levelId === 'cross' ? 'observe' : levelId === 'minimum' ? 'batteryA' : 'sensor';
    const hint = levelId === 'cross' ? '到观察点看看路口附近。' : levelId === 'minimum' ? '去读两组电池的电量。' : '到探头，选一个读数。';
    return pack({ id: place, step: '2', kind: 'map', thinking: false, goto: true, hint, strong: '走到发光的圆圈上按 E。', target: at(mapId, place) });
  }
  if (!scene.ticket) {
    return pack({ id: 'control', step: '3', kind: 'panel', thinking: true, goto: true, hint: '到控制台设置规则，先预测再执行。', strong: '点控制区域，不标出某一张卡。', target: at(mapId, 'control') });
  }
  const place = levelId === 'minimum' ? 'monitor' : 'verify';
  return pack({ id: place, step: '9', kind: 'map', thinking: false, goto: true, hint: '到核验处保存这次结果。', strong: '走到发光的圆圈上按 E。', target: at(mapId, place) });
}

function examFocus(exam) {
  if (!exam.open) {
    const missing = exam.missing?.[0];
    return pack({
      id: 'exam-missing', step: '0', kind: 'exam', thinking: false, goto: true,
      hint: missing ? `还差：${missing.title}。` : '先完成三站再来考核。',
      strong: '点回到该站，自己走进去。',
      target: { stationId: missing?.id || '' }
    });
  }
  if (exam.tier === 'challenge' && exam.challengeSubmitted) {
    return pack({ id: 'quiz-result', step: '5', kind: 'exam', thinking: false, goto: false, hint: '看看自己的结果。', strong: '这里只回看结果。', target: {} });
  }
  if (exam.tier !== 'challenge' && exam.baseSubmitted && exam.challengeUnlocked && exam.showResult) {
    return pack({ id: 'quiz-challenge-entry', step: '3', kind: 'exam', thinking: false, goto: false, hint: '挑战层已解锁，可以加做。', strong: '点挑战层，或留在基础层。', target: {} });
  }
  if (exam.allFilled && !(exam.tier === 'challenge' ? exam.challengeSubmitted : exam.baseSubmitted)) {
    const id = exam.tier === 'challenge' ? 'quiz-submit-challenge' : 'quiz-submit-base';
    return pack({ id, step: '2', kind: 'exam', thinking: false, goto: false, hint: '都答完了，点提交这一层。', strong: '点提交按钮。', target: {} });
  }
  return pack({
    id: 'quiz-card-current', step: '1', kind: 'exam', thinking: true, goto: false,
    hint: '读题作答。整道题一起看，不标选项。',
    strong: '先点卡片区，再点空格。',
    target: {}
  });
}

export function currentFocus({ levelId = 'sale', scene = null, level = null, exam = null } = {}) {
  if (levelId === 'quiz' || exam) return examFocus(exam || {});
  return stationFocus(levelId, scene || {}, level || {});
}
