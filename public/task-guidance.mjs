/** 各站短委托与确定性法宝内容；仅返回文字，不改答案或学习状态。 */
const BRIEFS = {
  sale: {
    problem: '新风机还没设自动开关，阿绿没法守着。',
    purpose: '本次约定达到30℃就开风机，请教会控制柜做决定。',
    success: '我的程序能按告示开关风机，29、30、31℃都测对。'
  },
  repair: {
    problem: '老修换上备用控制板后，到了30℃风机却停了。',
    purpose: '先保留原程序看故障，再查条件和两边动作是否配合。',
    success: '我能说清改了哪里，并用修改后的程序重新测过。'
  },
  cross: {
    problem: '导行屏指错了路，大家停在路边不知道怎么走。',
    purpose: '帮导行屏看清有无可用设施，再选一条合适的路。',
    success: '有设施和没有设施时，程序都能选出合适的一条路。'
  },
  minimum: {
    problem: '两块电池等着充电，现在只有一个优先充电口。',
    purpose: '本次约定谁剩余电量少就先充谁，请让控制柜先比较。',
    success: 'A少或B少时，程序都能选中较低电量的电池。'
  }
};
const SYMBOLS = { '<': '＜', '>': '＞', '<=': '≤', '>=': '≥' };
const OPERATORS = { ge30: '>=', lt30: '<', gt30: '>', le30: '<=', lt: '<', gt: '>' };
const PHASES = ['flow', 'predict', 'diagnose', 'sentence', 'world', 'reason', 'confirm', 'confirm-predictions', 'run'];
const WORLD_FOCI = ['guide', 'sensor', 'control', 'fan', 'verify', 'portal', 'monitor', 'batteryA', 'batteryB', 'observe', 'signal', 'bridgeWest', 'bridgeEast', 'crossingWest', 'crossingEast'];

export function stationBrief(levelId) {
  if (!Object.hasOwn(BRIEFS, levelId)) throw new Error('找不到这个探究站点');
  return { ...BRIEFS[levelId] };
}

function currentInput(levelId, draft, step) {
  const input = draft.input || {}, scene = draft.scene || {};
  if (levelId === 'cross') return { facility: input.facility ?? scene.facility ?? true };
  if (levelId === 'minimum') return { a: input.a ?? (scene.pair === 'pair-b' ? 9 : 3), b: input.b ?? (scene.pair === 'pair-b' ? 2 : 8) };
  return { temperature: step.temperature ?? input.temperature ?? scene.temperatureCase ?? 30 };
}

function program(draft) {
  const config = draft.config || {}, flow = draft.flow || {};
  return { operator: config.operator || OPERATORS[flow.diamond] || '>=', yes: config.yes || flow.yes || '', no: config.no || flow.no || '' };
}

function outputLabel(levelId, output) {
  if (levelId === 'cross') return output === 'bridge' ? '走天桥或地下通道' : '到有信号灯的人行横道';
  if (levelId === 'minimum') return output === 'a' ? '电池A优先充电' : '电池B优先充电';
  return output === 'on' ? '启动风机' : '关闭风机';
}

function conditionLabel(levelId, operator) {
  if (levelId === 'cross') return '附近有可用的天桥或地下通道';
  if (levelId === 'minimum') return `电量a${SYMBOLS[operator] || operator}b`;
  return `温度${SYMBOLS[operator] || operator}30℃`;
}

function flowHint(levelId, draft, slot) {
  const flow = draft.flow || {}, config = program(draft);
  const chosen = OPERATORS[flow.diamond] || config.operator;
  const thermal = levelId === 'sale' || levelId === 'repair';
  const compatible = thermal ? ['<', '>='].includes(chosen) : ['<', '>'].includes(chosen);
  const operator = levelId === 'minimum' ? (compatible ? chosen : '<') : thermal ? (compatible ? chosen : '>=') : '';
  if (slot === 'diamond') return {
    action: `选“${conditionLabel(levelId, operator)}吗”。`,
    why: levelId === 'cross' ? '先问设施能不能用，才能决定路线。' : levelId === 'minimum' ? '先比较两块电池，才能知道谁电量少。' : '温度是决定风机动作的输入。达到30℃也要算进去。'
  };
  const yes = levelId === 'cross' ? 'bridge' : levelId === 'minimum' ? (operator === '<' ? 'a' : 'b') : operator === '<' ? 'off' : 'on';
  const no = levelId === 'cross' ? 'crossing' : levelId === 'minimum' ? (operator === '<' ? 'b' : 'a') : operator === '<' ? 'on' : 'off';
  const output = slot === 'no' ? no : yes;
  const branch = slot === 'no' ? '否' : '是';
  const correction = thermal && !compatible ? '先把判断改为“温度≥30℃吗”，再' : '';
  const why = levelId === 'cross'
    ? slot === 'no' ? '没有可用设施，也要有安全的另一条路。' : '条件成立说明有可用设施，走这一条。'
    : levelId === 'minimum'
      ? `按“${conditionLabel(levelId, operator)}”的${branch}出口，选电量较低的一块。`
      : operator === '<'
        ? slot === 'no' ? '不低于30℃就是达到30℃，应该启动。' : '低于30℃时，按告示应该关闭。'
        : slot === 'no' ? '没有达到30℃时，按告示应该关闭。' : '达到30℃时，按告示应该启动。';
  return { action: `${correction}把“${branch}”出口设为“${outputLabel(levelId, output)}”。`, why };
}

function predictionHint(levelId, draft, input) {
  const config = program(draft);
  if (!config.yes || !config.no) return { action: '先在控制柜设好判断条件和两个出口。', why: '程序还没完整，暂时不能确定会做什么。' };
  const left = levelId === 'minimum' ? input.a : input.temperature;
  const right = levelId === 'minimum' ? input.b : 30;
  const holds = levelId === 'cross' ? input.facility : config.operator === '<' ? left < right : config.operator === '>' ? left > right : config.operator === '<=' ? left <= right : left >= right;
  const output = holds ? config.yes : config.no;
  const expected = levelId === 'cross' ? (input.facility ? 'bridge' : 'crossing') : levelId === 'minimum' ? (input.a < input.b ? 'a' : 'b') : input.temperature >= 30 ? 'on' : 'off';
  const comparison = levelId === 'cross' ? (input.facility ? '有可用设施，条件成立' : '没有可用设施，条件不成立') : `${left}${SYMBOLS[config.operator] || config.operator}${right}${holds ? '成立' : '不成立'}`;
  return {
    action: `预测选“${outputLabel(levelId, output)}”。`,
    why: `${comparison}，沿“${holds ? '是' : '否'}”出口。${output !== expected ? '这是当前程序的结果，与任务约定不符。' : '这与本次任务约定一致。'}`
  };
}

function worldHint(levelId, draft, focus) {
  const scene = draft.scene || {}, actions = scene.actions || [];
  if (levelId === 'cross' && focus === 'signal') return { action: '点“等待绿灯，准备通行”，绿灯亮后再过街。', why: '红灯不通行。程序选中人行横道后，还要等绿灯。' };
  if (scene.ticket) {
    if (levelId === 'minimum' && !actions.includes('route')) return { action: `点电池${(program(draft)[scene.ticket.branch] || scene.ticket.output) === 'a' ? 'A' : 'B'}的接入口，接入选中电池。`, why: '先执行程序选中的支路，再核验结果。' };
    if (levelId === 'cross' && !actions.includes('route')) return { action: scene.ticket.output === 'bridge' ? '点天桥入口，沿程序选中的路线检查。' : '点信号灯等绿灯，再沿人行横道检查。', why: '一次判断只检查选中的这一条路线。' };
    return { action: '点现场核验仪，比较这次结果。', why: '程序已运行，要检查实际结果是否合约定。' };
  }
  const faultObserved = (scene.visited || []).includes('verified') || !!draft.diagnoseAnswer || draft.flow?.preset === false;
  if (levelId === 'repair' && !faultObserved) return { action: '先读取30℃，运行原程序，再去核验仪。', why: '先留下故障现场，才能比较修改前后。' };
  if (focus === 'guide' || focus === 'portal') return scene.phase === 'start' || !scene.phase
    ? { action: '点负责人，领取本站任务。', why: '先知道现场的问题，再确定设备该做什么。' }
    : { action: '点负责人，用运行记录说明你的发现。', why: '要把判断条件、选择的路径和结果说清楚。' };
  if (levelId === 'minimum' && (focus === 'batteryA' || focus === 'batteryB' || !scene.measured)) {
    const collected = scene.collected || [];
    const b = focus === 'batteryB' || collected.includes('a');
    return { action: `点电池${b ? 'B' : 'A'}，读取它的剩余电量。`, why: '要知道两块的电量，才能比较谁更少。' };
  }
  if (focus === 'sensor') return { action: '点温度探头，读取下一种测试温度。', why: '不同温度能检查两条路径和相等的边界。' };
  if (focus === 'observe') return { action: '点设施观察点，看这里有没有可用设施。', why: '程序需要先知道现场条件，再决定走法。' };
  if (focus === 'verify' || focus === 'monitor') return { action: '点核验仪，检查本次实际结果。', why: '核验记录能帮助比较预测和实际。' };
  if (!draft.flow?.locked) return { action: '点控制柜，依次选判断和两个出口。', why: '设备要先有完整规则，才能按条件执行。' };
  if (!draft.prediction && actions[1] !== 'predict') return { action: '在控制柜先预测本次会做什么。', why: '先留下自己的判断，再用运行结果比较。' };
  return { action: '点“运行”，让设备执行当前程序。', why: '用现场结果检验刚才的判断。' };
}

export function toolHint(levelId, draft = {}, step = {}) {
  stationBrief(levelId);
  const phase = step.phase || 'world';
  if (!PHASES.includes(phase)) throw new Error('找不到这个任务步骤');
  step = {
    phase,
    ...(phase === 'flow' ? { slot: step.slot } : {}),
    ...(phase === 'predict' && [29, 30, 31].includes(step.temperature) ? { temperature: step.temperature } : {}),
    ...(phase === 'world' ? { key: WORLD_FOCI.includes(step.key) ? step.key : '' } : {})
  };
  const flow = draft.flow || {}, scene = draft.scene || {}, config = program(draft);
  const input = currentInput(levelId, draft, step);
  const slot = phase === 'flow' ? (step.slot || ['diamond', 'yes', 'no'].find(name => !flow[name]) || 'diamond') : '';
  if (phase === 'flow' && !['diamond', 'yes', 'no'].includes(slot)) throw new Error('找不到这个任务步骤');
  const snapshot = {
    input,
    config,
    flow: { diamond: flow.diamond || '', yes: flow.yes || '', no: flow.no || '', locked: !!flow.locked, preset: !!flow.preset },
    ...(phase === 'sentence' ? { sentence: draft.sentence?.slots || [] } : {}),
    ...(phase === 'run' ? { measured: !!scene.measured } : {}),
    ...(phase === 'world' ? { world: { phase: scene.phase || '', measured: !!scene.measured, actions: scene.actions || [], output: scene.ticket?.output || '', visited: scene.visited || [], collected: scene.collected || [], signal: scene.signal || '', prediction: draft.prediction || '', diagnosed: draft.diagnoseAnswer || '' } } : {})
  };
  const key = `${levelId}|${phase}|${slot}|${phase === 'predict' ? input.temperature ?? '' : step.key || ''}|${JSON.stringify(snapshot)}`;
  let content;
  if (phase === 'confirm') content = {action:'点“确认这份程序”。',why:'先确认判断和两边动作，再去检验。'};
  else if (phase === 'confirm-predictions') content = {action:'点“记下预测，下一步”。',why:'先留下你的判断，再看实际结果。'};
  else if (phase === 'run') content = !scene.measured
    ? {action:`点“保存修改，去读取${['sale','repair'].includes(levelId)?'温度':'现场数据'}”。`,why:'先取得这次输入，才能检验程序。'}
    : ['sale','repair'].includes(levelId)
      ? {action:'点“执行本次温度，去现场看结果”。',why:'用已读取的温度，检验刚才的预测。'}
      : {action:'点“保存程序，回现场先预测”。',why:'先预测这一组，再运行并核验。'};
  else if (phase === 'flow') content = flowHint(levelId, draft, slot);
  else if (phase === 'predict') content = predictionHint(levelId, draft, input);
  else if (phase === 'diagnose') content = { action: '选“错在出口”：把两个动作与判断条件配合起来。', why: '30℃时条件成立，却走到了关闭风机的出口。' };
  else if (phase === 'sentence') content = { action: `读出：如果${conditionLabel(levelId, config.operator)}，就${outputLabel(levelId, config.yes)}，否则${outputLabel(levelId, config.no)}。`, why: '句子和图说同一个规则。否则对应条件不成立的那一条。' };
  else if (phase === 'reason') {
    const reverted = config.operator === '<' && config.yes === 'off' && config.no === 'on';
    content = levelId === 'sale'
      ? { action: '选“达到30℃就开，低于才关”。', why: '30与30相等，也属于达到30℃。' }
      : levelId === 'repair'
        ? reverted
          ? { action: '选“改回低于30℃，出口动作保留”。', why: '这次改回低于30℃，原动作又配合了。并不是任意改条件都能保留原出口。' }
          : { action: '选“保留达到30℃，对调开关出口”。', why: '同一个温度的判断变了，动作也要跟着配合。' }
        : levelId === 'cross'
          ? { action: '选“先看设施，再走选中的一路”。', why: '一次判断得到一个结果，只走对应的一路。' }
          : { action: '选“先比电量，剩得少的先充”。', why: '谁电量低会变化，要先比较才能决定。' };
  }
  else content = worldHint(levelId, draft, step.key || '');
  return { key, ...content, conceptual: !['confirm','confirm-predictions','run'].includes(phase), target: assistedTarget(levelId, draft, step) };
}

/** 仅在学生主动取得帮助之后，用于定位建议；本函数不操作页面或填写答案。 */
export function assistedTarget(levelId, draft = {}, step = {}) {
 stationBrief(levelId);
 const phase=step.phase||'world',config=program(draft),flow=draft.flow||{},scene=draft.scene||{};
 if(phase==='confirm')return {focusKey:'flow-lock'};
 if(phase==='confirm-predictions')return {focusKey:'predict-lock'};
 if(phase==='run')return {focusKey:'run-next'};
 if(phase==='flow'){
  const chosen=OPERATORS[flow.diamond]||config.operator;
  const operator=levelId==='minimum'?(['<','>'].includes(chosen)?chosen:'<'):['<','>='].includes(chosen)?chosen:'>=';
  const slot=step.slot||['diamond','yes','no'].find(name=>!flow[name])||'diamond';
  if(slot==='diamond')return {cardId:levelId==='cross'?'bridge-q':levelId==='minimum'?(operator==='>'?'gt':'lt'):operator==='<'?'lt30':'ge30'};
  const yes=levelId==='cross'?'bridge':levelId==='minimum'?(operator==='<'?'a':'b'):operator==='<'?'off':'on';
  const no=levelId==='cross'?'crossing':levelId==='minimum'?(operator==='<'?'b':'a'):operator==='<'?'on':'off';
  return {cardId:slot==='no'?no:yes};
 }
 if(phase==='predict'){
  if(!config.yes||!config.no)return {focusKey:'control'};
  const input=currentInput(levelId,draft,step),left=levelId==='minimum'?input.a:input.temperature,right=levelId==='minimum'?input.b:30;
  const holds=levelId==='cross'?input.facility:config.operator==='<'?left<right:config.operator==='>'?left>right:config.operator==='<='?left<=right:left>=right;
  return {choiceId:holds?config.yes:config.no};
 }
 if(phase==='reason')return {choiceId:levelId==='sale'?'boundary':levelId==='cross'?'one':levelId==='minimum'?'compare':config.operator==='<'&&config.yes==='off'&&config.no==='on'?'symbol':'swap'};
 if(phase==='diagnose')return {choiceId:'exit'};
 if(phase==='sentence')return {focusKey:'sentence-confirm'};
 if(scene.ticket&&levelId==='minimum'&&!(scene.actions||[]).includes('route'))return {focusKey:(config[scene.ticket.branch]||scene.ticket.output)==='b'?'batteryB':'batteryA'};
 return {focusKey:WORLD_FOCI.includes(step.key)?step.key:'control'};
}
