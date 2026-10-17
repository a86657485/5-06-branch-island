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

const OPENING = {
  gate: '走到运维主管面前，按 E 交谈。',
  sale: '先听园艺员说任务。',
  repair: '听维修员说控制器的问题。',
  cross: '听巡检员说导行屏的任务。',
  minimum: '听能源工程师说配电规则。'
};

export function routeDots(mapId, output = 'bridge') {
  const east = mapId === 'crossing-east';
  const bridge = output !== 'crossing';
  const places = east ? PLACES['crossing-east'] : PLACES.crossing;
  const target = bridge ? (east ? places.bridgeEast : places.bridgeWest) : (east ? places.crossingEast : places.crossingWest);
  const y = bridge ? 336 : 680;
  const endX = target[0] - 32;
  const points = [];
  for (let x = endX - 32 * 4; x <= endX; x += 32) points.push({ x, y });
  return points;
}

function opening(levelId) {
  return OPENING[levelId] || OPENING.sale;
}

function stationFocus(levelId, scene, level, draft, panelOpen) {
  const mapId = mapFor(levelId, scene);
  const flow = draft?.flow || {};
  const sentence = draft?.sentence || {};
  const predictions = draft?.predictionsLocked || {};
  const panel = panelOpen === false ? '' : (draft?.panel || scene?.panel || '');
  // 上一次核验会留下 visited，不能当成这一趟已经走过。
  const walked = (scene.actions || []).includes('route');
  const crossingWalk = levelId === 'cross' && scene.ticket && !walked && !level?.valid;
  if (crossingWalk) {
    const useCrossing = scene.ticket.output === 'crossing' || scene.deviceOutput === 'crossing';
    const place = mapId === 'crossing-east'
      ? (useCrossing ? 'crossingEast' : 'bridgeEast')
      : (useCrossing ? 'crossingWest' : 'bridgeWest');
    const focus = pack({
      id: place, step: '10', kind: 'map', thinking: false, goto: false,
      gotoReason: '这段要你亲自走过去',
      hint: '沿导行屏指的路，亲自走过去。',
      strong: '看方向标记，这段要亲自走。',
      pause: scene.signal === 'red',
      target: at(mapId, place)
    });
    focus.dots = routeDots(mapId, useCrossing ? 'crossing' : 'bridge');
    return focus;
  }
  if (level?.valid) {
    return pack({ id: 'guide', step: 'done', kind: 'map', thinking: false, goto: true, hint: '本站已验收，去找负责人汇报。', strong: '走到发光标记，按 E 继续。', target: at(mapId, 'guide') });
  }
  if (panel === 'flow' && (!flow.diamond || !flow.yes || !flow.no)) {
    return pack({ id: 'slot-next', step: '4', kind: 'panel', thinking: true, goto: false, hint: '点亮着的空格，再点一张卡片。', strong: '先点卡片区，再点空格。', target: {} });
  }
  if (panel === 'flow' && !flow.locked) {
    return pack({ id: 'flow-lock', step: '5', kind: 'panel', thinking: false, goto: false, hint: '放好了，点锁定流程图。', strong: '点锁定流程图。', target: {} });
  }
  if (panel === 'sentence' && !sentence.locked) {
    return pack({ id: 'sentence-slot-next', step: '6', kind: 'panel', thinking: true, goto: false, hint: '点空格，再点一个词块。', strong: '先点词块区，再点空格。', target: {} });
  }
  if (panel === 'predict' && !predictions.locked) {
    return pack({ id: 'predict-row-next', step: '7', kind: 'panel', thinking: true, goto: false, hint: '每个温度选：启动还是关闭？', strong: '点这一行的启动或关闭。', target: {} });
  }
  if (!scene.phase || scene.phase === 'start') {
    return pack({ id: 'guide', step: '1', kind: 'map', thinking: false, goto: true, hint: opening(levelId), strong: '走到发光的圆圈上按 E。', target: at(mapId, 'guide') });
  }
  if (!scene.measured) {
    const place = levelId === 'cross' ? 'observe' : levelId === 'minimum' ? 'batteryA' : 'sensor';
    const hint = levelId === 'repair' ? '选 30℃，先运行原程序看看。' : levelId === 'cross' ? '到观察点看看路口附近。' : levelId === 'minimum' ? '去读两组电池的电量。' : '到温度探头，选一个温度。';
    return pack({ id: place, step: '2', kind: 'map', thinking: false, goto: true, hint, strong: '走到发光的圆圈上按 E。', target: at(mapId, place) });
  }
  if (!flow.locked) {
    const drawHint = levelId === 'repair' ? '先运行原程序，看 30℃。' : levelId === 'cross' ? '到导行屏，按 E 打开画图。' : '到规则控制柜，按 E 打开。';
    return pack({ id: 'control', step: '3', kind: 'map', thinking: false, goto: true, hint: drawHint, strong: '走到发光的圆圈上按 E。', target: at(mapId, 'control') });
  }
  if (!sentence.locked && !(levelId === 'cross' && scene.ticket)) {
    return pack({ id: 'control', step: '6', kind: 'map', thinking: false, goto: true, hint: '回控制柜，用词块拼一句。', strong: '按 E 打开拼句。', target: at(mapId, 'control') });
  }
  if ((levelId === 'sale' || levelId === 'repair') && !predictions.locked) {
    return pack({ id: 'control', step: '7', kind: 'map', thinking: false, goto: true, hint: '回控制柜，锁定三个温度的预测。', strong: '按 E 打开预测表。', target: at(mapId, 'control') });
  }
  if (!scene.ticket) {
    return pack({ id: 'control', step: '8', kind: 'map', thinking: false, goto: true, hint: '点执行本次温度。', strong: '在控制柜里点执行。', target: at(mapId, 'control') });
  }
  const place = levelId === 'minimum' ? 'monitor' : 'verify';
  return pack({ id: place, step: '9', kind: 'map', thinking: false, goto: true, hint: '到核验处保存这次结果。', strong: '走到发光的圆圈上按 E。', target: at(mapId, place) });
}

function gateFocus(intro) {
  const blank = intro || {};
  if (!blank.accepted && !blank.heightCase && !blank.skipped) return pack({ id: 'gate-lead', step: '1', kind: 'map', thinking: false, goto: false, hint: opening('gate'), strong: '走到发光标记，按 E 交谈。', target: { place: 'gate-lead' } });
  if (!blank.heightCase) return pack({ id: 'gate-ruler', step: '2', kind: 'map', thinking: false, goto: false, hint: '到量高立柱按 E，量一位测试者。', strong: '点立柱旁的测试者。', target: { place: 'gate-ruler' } });
  if (!blank.judged) return pack({ id: 'i0-judge', step: '3', kind: 'panel', thinking: true, goto: false, hint: '先判一判：这位该买哪种票？', strong: '点半价或全价这一整块。', target: {} });
  if (!blank.ticket) return pack({ id: 'gate-turnstile', step: '4', kind: 'map', thinking: false, goto: false, hint: '到闸机按 E，让它出票。', strong: '点闸机出票。', target: { place: 'gate-turnstile' } });
  if (!blank.sawSign) return pack({ id: 'gate-sign', step: '5', kind: 'map', thinking: false, goto: false, hint: '看告示，和闸机出的票比一比。', strong: '点告示，对照闸机的票。', target: { place: 'gate-sign' } });
  if (!blank.idea) return pack({ id: 'gate-lead', step: '6', kind: 'map', thinking: false, goto: false, hint: '回运维主管处，回答一个问题。', strong: '点一个你的想法。', target: { place: 'gate-lead' } });
  if (!blank.done) return pack({ id: 'gate-portal', step: '7', kind: 'map', thinking: false, goto: false, hint: '从北边园区通道去温室。', strong: '点通道进入温室。', target: { place: 'gate-portal' } });
  return pack({ id: 'guide', step: '1', kind: 'map', thinking: false, goto: true, hint: opening('sale'), strong: '走到发光的圆圈上按 E。', target: {} });
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

export function currentFocus({ levelId = 'sale', scene = null, level = null, draft = null, exam = null, intro = null, panelOpen = undefined } = {}) {
  if (levelId === 'gate' || intro) return gateFocus(intro || {});
  if (levelId === 'quiz' || exam) return examFocus(exam || {});
  return stationFocus(levelId, scene || {}, level || {}, draft || {}, panelOpen);
}
