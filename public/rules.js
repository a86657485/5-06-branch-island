(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BranchRules = api;
}(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const levels = [
    { id: 'sale', title: '温室风机调试', points: 25, required: true },
    { id: 'repair', title: '温室控制器返修', points: 25, required: true },
    { id: 'cross', title: '路口导行屏调试', points: 25, required: true },
    { id: 'minimum', title: '储能柜配电', points: 25, required: false }
  ];
  const solutions = {
    sale: { config: { model:'ventilation', operator: '>=', yes: 'on', no: 'off' }, reason: 'boundary', tests: [{temperature:29},{temperature:30},{temperature:31}], explanation: '本任务试运行设定：温度≥30°C启动风机，否则关闭。使用＜30°C判断时，两个出口对应交换。' },
    repair: { config: { model:'ventilation', operator: '>=', yes: 'on', no: 'off' }, reason: 'swap', tests: [{temperature:29},{temperature:30},{temperature:31}], explanation: '条件由＜30改成≥30后，成立分支应启动，不成立分支应关闭。先用30°C观察旧出口错误，再修订并复验。' },
    cross: { config: { yes: 'bridge', no: 'crossing' }, reason: 'one', tests: [{facility:true},{facility:false}], explanation: '有天桥或地下通道就走天桥或地下通道；否则到有信号灯的人行横道按信号通行。一次判断只执行选中的一个分支。' },
    minimum: { config: { operator: '<', yes: 'a', no: 'b' }, reason: 'compare', tests: [{a:3,b:8},{a:9,b:2}], explanation: '本任务按电量较低优先充电。比较两组不同自然数，输出较小电量对应的电池；a较小和b较小都应测试。' }
  };
  function normalizeConfig(id, config, partial = false) {
    if (!levels.some(level => level.id === id)) throw new Error('找不到这个任务');
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('请选择判断条件与两个分支');
    const ventilation = config.model === 'ventilation';
    if (config.model !== undefined && (!ventilation || !['sale','repair'].includes(id))) throw new Error('请检查当前任务模型');
    let choices;
    if (ventilation) choices = ['on','off'];
    else if (id === 'cross') choices = ['bridge', 'crossing'];
    else if (id === 'minimum') choices = ['a', 'b'];
    else choices = ['5', '10'];
    const allowed = value => choices.includes(value) || (partial && (value === '' || value === undefined));
    if (!allowed(config.yes) || !allowed(config.no)) throw new Error('请检查两个分支的选择');
    if (id === 'cross') return { yes: config.yes ?? '', no: config.no ?? '' };
    const operators = id === 'minimum' ? ['<', '>'] : id === 'repair' ? ['<', '>='] : ['<', '>=', '>', '<='];
    if (!operators.includes(config.operator) && !(partial && (config.operator === '' || config.operator === undefined))) throw new Error('请检查判断条件');
    return { ...(ventilation ? {model:'ventilation'} : {}), operator: config.operator ?? '', yes: config.yes ?? '', no: config.no ?? '' };
  }
  function configKey(id, config) { return JSON.stringify(normalizeConfig(id, config)); }
  function evaluate(id, config, input) {
    config = normalizeConfig(id, config);
    if (!input || typeof input !== 'object') throw new Error('请先设置实验输入');
    let condition, output, expected, conditionText, inputText;
    const symbol = { '<': '＜', '>': '＞', '<=': '≤', '>=': '≥' };
    const compare = (operator, left, right) => operator === '<' ? left < right : operator === '>' ? left > right : operator === '<=' ? left <= right : left >= right;
    if (config.model === 'ventilation') {
      if (!Number.isInteger(input.temperature)) throw new Error('温度请输入整数摄氏度');
      condition = compare(config.operator, input.temperature, 30);
      expected = input.temperature >= 30 ? 'on' : 'off';
      inputText = `读取温度 ${input.temperature}°C`;
      conditionText = `${input.temperature} ${symbol[config.operator] || config.operator} 30`;
    } else if (id === 'sale' || id === 'repair') {
      if (!Number.isInteger(input.height) || input.height < 0 || input.height > 250) throw new Error('身高请输入0到250之间的整数厘米');
      condition = compare(config.operator, input.height, 120);
      expected = input.height < 120 ? '5' : '10';
      inputText = `输入身高 ${input.height} 厘米`;
      conditionText = `${input.height} ${symbol[config.operator] || config.operator} 120`;
    } else if (id === 'cross') {
      if (typeof input.facility !== 'boolean') throw new Error('请明确选择附近是否有天桥或地下通道');
      condition = input.facility; expected = input.facility ? 'bridge' : 'crossing';
      inputText = input.facility ? '附近有天桥或地下通道' : '附近没有天桥或地下通道';
      conditionText = '附近有天桥或地下通道';
    } else {
      if (![input.a,input.b].every(n => Number.isInteger(n) && n >= 0 && n <= 999) || input.a === input.b) throw new Error('请输入0到999之间的两个不同自然数');
      condition = config.operator === '<' ? input.a < input.b : input.a > input.b;
      expected = String(Math.min(input.a,input.b));
      inputText = `输入 a=${input.a}，b=${input.b}`;
      conditionText = `${input.a} ${config.operator} ${input.b}`;
    }
    const branch = condition ? 'yes' : 'no';
    const selected = config[branch];
    output = id === 'minimum' ? String(input[selected]) : selected;
    const label = value => config.model === 'ventilation' ? value === 'on' ? '启动风机' : '关闭风机' : id === 'cross' ? value === 'bridge' ? '走天桥或地下通道' : '到有信号灯的人行横道按信号通行' : id === 'minimum' ? `输出 ${value}` : `收 ${value} 元`;
    return { condition, conditionText, branch, output, expected, correct: output === expected, trace: [inputText, `判断“${conditionText}”：${condition ? '成立' : '不成立'}`, `只执行${condition ? '成立' : '不成立'}分支：${label(output)}`] };
  }
  function validateComplete(id, config, runs, reason, evidenceStart = 0) {
    const key = configKey(id, config);
    const history = Array.isArray(runs) ? runs : [];
    let start = Math.max(0,evidenceStart);
    const ventilation = config.model === 'ventilation';
    if (id === 'repair') {
      const diagnosed = history.findIndex(run => run.config?.model === config.model && (ventilation ? run.input?.temperature === 30 && run.config?.yes === 'off' && run.config?.no === 'on' : run.input?.height === 120 && run.config?.yes === '5' && run.config?.no === '10') && run.config?.operator === '>=' && !evaluate(id,run.config,run.input).correct);
      if (diagnosed < 0) return { passed: false, feedback: ventilation ? '先检查设备原程序（条件≥30，成立关机、不成立启动），用30°C观察错误，再修订复验。' : '先运行维修舱的原程序（条件≥120，成立收5元，不成立收10元），用120厘米观察错误，再修订复验。' };
      start = Math.max(start,diagnosed + 1);
    }
    const current = history.slice(start).filter(run => {
      try { return configKey(id,run.config) === key; } catch { return false; }
    });
    if (!current.length) return { passed: false, feedback: '先运行当前方案，观察它实际选择了哪条分支。' };
    if (current.some(run => !evaluate(id,config,run.input).correct)) return { passed: false, feedback: '当前方案还有测试结果与任务目标不符。请检查判断条件和两个分支，修改后重新测试。' };
    if (id === 'sale' || id === 'repair') {
      const missing = (ventilation ? [29,30,31] : [119,120,121]).filter(value => !current.some(run => run.input[ventilation ? 'temperature' : 'height'] === value));
      if (missing.length) return { passed: false, feedback: ventilation ? `当前方案还需要测试 ${missing.join('、')}°C，特别留意30°C属于哪条分支。` : `当前方案还需要测试 ${missing.join('、')} 厘米，特别留意120厘米属于哪条分支。` };
    } else if (id === 'cross') {
      if (![true,false].every(facility => current.some(run => run.input.facility === facility))) return { passed: false, feedback: '请分别测试“有设施”和“没有设施”，确认两条分支都能正确执行。' };
    } else if (![true,false].every(smaller => current.some(run => (run.input.a < run.input.b) === smaller))) return { passed: false, feedback: '请分别测试a较小和b较小，不能只验证同一条分支。' };
    if (reason !== solutions[id].reason) return { passed: false, feedback: '实验已完成。请再选择能解释判断条件和执行分支关系的理由。' };
    return { passed: true, feedback: '当前方案通过了所需测试，理由也符合本关目标。' };
  }
  return { levels, evaluate, validateComplete, solutions, normalizeConfig, configKey };
}));
