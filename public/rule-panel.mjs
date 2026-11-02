/**
 * 规则面板的数据模型。
 *
 * 学生的核心困难：判断卡、两个分支的动作卡、预测卡长得一模一样，
 * 四排按钮里有两排都是「启动风机 / 停止风机」，一填就填错行。
 * 这里把「判断」和「动作」在数据层就分成不同 kind，渲染层再给不同颜色和序号，
 * 同时算出「还差哪几项」，让学生永远看得到下一步缺什么。
 *
 * 纯函数，不碰 DOM，单测见 tests/rule-panel.test.mjs。
 */

const VENT_ACTIONS = [['on', '启动风机'], ['off', '停止风机']];
const CROSS_ACTIONS = [['bridge', '走天桥'], ['crossing', '走斑马线']];
const MIN_ACTIONS = [['a', '送电池A'], ['b', '送电池B']];

const VENT_JUDGE = [['>=', '温度 ≥ 30℃'], ['<', '温度 ＜ 30℃']];
const MIN_JUDGE = [['<', 'A 比 B 少'], ['>', 'A 比 B 多']];

export function actionValues(station) {
  if (station === 'cross') return CROSS_ACTIONS.slice();
  if (station === 'minimum') return MIN_ACTIONS.slice();
  return VENT_ACTIONS.slice();
}

export function judgeValues(station) {
  return station === 'minimum' ? MIN_JUDGE.slice() : VENT_JUDGE.slice();
}

const toCards = pairs => pairs.map(([value, label]) => ({ value, label }));

function labelOf(list, value) {
  const hit = list.find(([v]) => v === value);
  return hit ? hit[1] : '（还没选）';
}

/** 任意取值 → 中文标签，锁定时用来显示设备当前设置。 */
export function valueLabel(station, value) {
  const all = judgeValues(station).concat(actionValues(station));
  const hit = all.find(([v]) => v === value);
  return hit ? hit[1] : '（未设置）';
}

/** 四个区块：① 判断 ② 是 ③ 否 ④ 预测。locked 时判断与两个动作只读。 */
export function panelModel(station, config = {}, ctx = {}) {
  const { locked = false, facility = null } = ctx;
  const actions = toCards(actionValues(station));
  const yesReadOnly = Boolean(locked);
  const noReadOnly = Boolean(locked);

  if (station === 'cross') {
    const hasBridge = facility === true;
    return [
      {
        step: 1, kind: 'judge', field: null, readOnly: true,
        title: '① 现场判断：附近有可用天桥吗？',
        hint: '这一格由现场观察决定，不能手动改。',
        cards: [{ value: hasBridge ? 'yes' : 'no', label: hasBridge ? '附近有天桥' : '附近没有天桥' }],
      },
      {
        step: 2, kind: 'action', field: 'yes', readOnly: yesReadOnly,
        title: '② 条件成立（走【是】分支）→ 走哪边？',
        hint: '', cards: actions,
      },
      {
        step: 3, kind: 'action', field: 'no', readOnly: noReadOnly,
        title: '③ 条件不成立（走【否】分支）→ 走哪边？',
        hint: '', cards: actions,
      },
    ];
  }

  const judge = toCards(judgeValues(station));
  const fixedJudge = station === 'repair';
  return [
    {
      step: 1, kind: 'judge', field: 'operator', readOnly: fixedJudge,
      title: station === 'minimum' ? '① 判断条件：两块电池怎么比？' : '① 判断条件：温度到 30℃ 了吗？',
      hint: fixedJudge
        ? '原设备已经把条件改成「≥ 30℃」，这一步锁住了，只能改两个出口。'
        : station === 'minimum'
          ? '比出哪一块电量更少，把少的那块送去先充。'
          : '30℃ 也算「达到」。',
      cards: judge,
    },
    {
      step: 2, kind: 'action', field: 'yes', readOnly: yesReadOnly,
      title: '② 条件成立（走【是】分支）→ 做什么？',
      hint: '', cards: actions,
    },
    {
      step: 3, kind: 'action', field: 'no', readOnly: noReadOnly,
      title: '③ 条件不成立（走【否】分支）→ 做什么？',
      hint: '', cards: actions,
    },
  ];
}

export function predictBlock(station) {
  return {
    step: 4, kind: 'predict', field: 'prediction', readOnly: false,
    title: '④ 先猜一猜：这次设备会怎样？',
    hint: '',
    cards: toCards(actionValues(station)),
  };
}

/** 还差哪几项没选，用来在面板上直接告诉学生，而不是等他点执行才报错。 */
export function panelStatus(station, config = {}, ctx = {}) {
  const { locked = false } = ctx;
  const missing = [];
  const stationJudge = station === 'cross'
    ? true
    : station === 'repair' || locked
      ? true
      : Boolean(config.operator);
  if (!stationJudge) missing.push('判断条件');
  if (!config.yes) missing.push('是分支动作');
  if (!config.no) missing.push('否分支动作');
  return { ready: missing.length === 0, missing };
}

/** 完整规则的一句话回显，选了哪个就在句子里显示哪个。 */
export function ruleSentence(station, config = {}, ctx = {}) {
  const actions = actionValues(station);
  const yes = labelOf(actions, config.yes);
  const no = labelOf(actions, config.no);
  if (station === 'cross') {
    return `如果 附近有可用天桥 → 是：${yes}；否：${no}`;
  }
  const judge = labelOf(judgeValues(station), config.operator);
  return `如果 ${judge} → 是：${yes}；否：${no}`;
}
