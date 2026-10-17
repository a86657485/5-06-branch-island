(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AdventureRules = api;
}(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const ACTORS = {
    visitor119: { label: '本人角色119厘米体验', input: {height:119} },
    visitor120: { label: '本人角色120厘米体验', input: {height:120} },
    visitor121: { label: '本人角色121厘米体验', input: {height:121} },
    sensor29: { label: '29°C温度探头', input: {temperature:29} },
    sensor30: { label: '30°C温度探头', input: {temperature:30} },
    sensor31: { label: '31°C温度探头', input: {temperature:31} },
    'cross-open': { label: '有设施路口', input: {facility:true} },
    'cross-closed': { label: '无设施路口', input: {facility:false} },
    'pair-a': { label: '电池组A（a=3%，b=8%）', input: {a:3,b:8} },
    'pair-b': { label: '电池组B（a=9%，b=2%）', input: {a:9,b:2} }
  };
  const steps = { sale:['measure','predict','ticket','gate'], repair:['inspect','predict','ticket','gate'], cross:['observe','predict','route','verify'], minimum:['collect','predict','route','verify'] };
  const actionLabels = { measure:'测量',inspect:'检查错误机器',predict:'预测',ticket:'出票',gate:'验闸',observe:'观察设施',route:'走选中路线',verify:'到达验证',blocked:'通道受阻，留在安全侧',collect:'领取双数' };
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const shortText = (value,max) => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f]/.test(value);
  const choices = (id,ventilation) => ventilation ? ['on','off'] : id === 'cross' ? ['bridge','crossing'] : id === 'minimum' ? ['a','b'] : ['5','10'];
  const check = (condition,message) => { if (!condition) throw new Error(message); };
  function validateEvidence(id,evidence,input,evaluated) {
    check(object(evidence) && evidence.version === 1 && evidence.station === id && Object.hasOwn(steps,id),'场景摘要的版本或任务不正确');
    const actor = Object.hasOwn(ACTORS,evidence.actorId) ? ACTORS[evidence.actorId] : null;
    const ventilation = ['sale','repair'].includes(id) && Object.hasOwn(input || {},'temperature');
    const keys = ventilation ? ['temperature'] : id === 'cross' ? ['facility'] : id === 'minimum' ? ['a','b'] : ['height'];
    check(actor && object(input) && keys.every(key => Object.hasOwn(actor.input,key) && input[key] === actor.input[key]),'场景角色与现场输入不一致，请重新完成当前体验');
    if ('outcome' in evidence) check(id === 'cross' && ['blocked','arrived'].includes(evidence.outcome),'场景通行结果不正确');
    const blocked = id === 'cross' && evidence.outcome === 'blocked';
    if (blocked) check(input.facility === false && evaluated.output === 'bridge' && evaluated.correct === false,'场景受阻结果与现场设施或指引不一致');
    const expectedSteps = blocked ? ['observe','predict','route','blocked'] : steps[id];
    check(Array.isArray(evidence.actions) && evidence.actions.length === expectedSteps.length && expectedSteps.every((step,index) => evidence.actions[index] === step),'场景步骤不完整或顺序不一致，请完成当前体验');
    check(typeof evidence.destination === 'string' && evidence.destination === evaluated.output,'场景输出与规则实际结果不一致，请重新验证');
    if (['sale','repair'].includes(id)) check(choices(id,ventilation).includes(evaluated.output),'场景输出与当前任务模型不一致');
    check(choices(id,ventilation).includes(evidence.prediction),'场景预测请选择本任务的输出');
    return {version:1,station:id,actorId:evidence.actorId,actions:[...evidence.actions],destination:evidence.destination,prediction:evidence.prediction,...('outcome' in evidence ? {outcome:evidence.outcome} : {})};
  }
  function validateSceneDraft(scene) {
    check(object(scene) && scene.version === 1,'场景草稿版本不正确');
    check(Number.isFinite(scene.x) && scene.x >= 0 && scene.x <= 1200 && Number.isFinite(scene.y) && scene.y >= 0 && scene.y <= 800,'场景坐标超出地图范围');
    check(['down','up','left','right'].includes(scene.facing),'场景角色方向不正确');
    check(scene.actorId === undefined || scene.actorId === null || scene.actorId === '' || Object.hasOwn(ACTORS,scene.actorId),'场景角色不正确');
    check(shortText(scene.phase,40) && typeof scene.measured === 'boolean','场景阶段摘要不正确');
    for (const [field,max] of [['actions',8],['visited',20]]) check(Array.isArray(scene[field]) && scene[field].length <= max && scene[field].every(value => shortText(value,40)),'场景动作摘要过长或格式不正确');
    const clean = {version:1,x:scene.x,y:scene.y,facing:scene.facing,phase:scene.phase,measured:scene.measured,actions:[...scene.actions],visited:[...scene.visited]};
    if (scene.actorId !== undefined) clean.actorId = scene.actorId;
    if ('ticket' in scene) {
      const ticket = scene.ticket;
      check(object(ticket) && shortText(ticket.output,40) && shortText(ticket.expected,40) && typeof ticket.condition === 'boolean' && typeof ticket.correct === 'boolean' && ['yes','no'].includes(ticket.branch),'场景票据缓存格式不正确');
      clean.ticket = {output:ticket.output,condition:ticket.condition,branch:ticket.branch,correct:ticket.correct,expected:ticket.expected};
    }
    if ('facility' in scene) { check(typeof scene.facility === 'boolean','场景设施状态不正确'); clean.facility = scene.facility; }
    if ('pair' in scene) { check(['pair-a','pair-b'].includes(scene.pair),'场景能量组不正确'); clean.pair = scene.pair; }
    if ('collected' in scene) { check(Array.isArray(scene.collected) && scene.collected.length <= 2 && scene.collected.every(value => ['a','b'].includes(value)) && new Set(scene.collected).size === scene.collected.length,'场景能量包记录不正确'); clean.collected = [...scene.collected]; }
    if ('signal' in scene) { check(['red','green'].includes(scene.signal),'场景信号状态不正确'); clean.signal = scene.signal; }
    if ('deviceOutput' in scene) { check(['on','off'].includes(scene.deviceOutput),'设备执行状态不正确'); clean.deviceOutput=scene.deviceOutput; }
    if ('temperatureCase' in scene) { check([29,30,31].includes(scene.temperatureCase),'场景温度体验不正确'); clean.temperatureCase = scene.temperatureCase; }
    if ('lastFeedback' in scene) { check(typeof scene.lastFeedback === 'string' && scene.lastFeedback.length <= 500 && !/[\u0000-\u0009\u000b-\u001f]/.test(scene.lastFeedback),'场景反馈摘要过长或格式不正确'); clean.lastFeedback = scene.lastFeedback; }
    return clean;
  }
  function validateRpgDraft(rpg,id) {
    check(object(rpg) && rpg.version === 1 && rpg.engine === 'rpgjs','场景引擎版本不正确');
    check(['greenhouse','workshop','crossing','crossing-east','energy'].includes(rpg.mapId),'场景地图不正确');
    const maps={sale:['greenhouse'],repair:['workshop'],cross:['crossing','crossing-east'],minimum:['energy']};
    if(id) check(maps[id]?.includes(rpg.mapId),'当前位置与任务地图不一致');
    check(object(rpg.position) && Number.isFinite(rpg.position.x) && rpg.position.x >= 0 && rpg.position.x <= 1600 && Number.isFinite(rpg.position.y) && rpg.position.y >= 0 && rpg.position.y <= 1100,'场景坐标超出地图范围');
    check(['up','down','left','right'].includes(rpg.direction),'场景角色方向不正确');
    return {version:1,engine:'rpgjs',mapId:rpg.mapId,position:{x:rpg.position.x,y:rpg.position.y},direction:rpg.direction};
  }
  function evidenceSummary(id,run) {
    const scene = run.scene;
    if (!scene) return '规则实验（旧版）';
    const actor = Object.hasOwn(ACTORS,scene.actorId) ? ACTORS[scene.actorId] : null;
    const ventilation = run.config?.model === 'ventilation';
    const predictionOutput = id === 'minimum' ? String(run.input?.[scene.prediction]) : scene.prediction;
    const outputLabel = value => ventilation ? value === 'on' ? '启动' : '关闭' : id === 'cross' ? value === 'bridge' ? '设施路线' : '人行横道' : id === 'minimum' ? `${value}%` : `${value}元`;
    const predictionLabel = id === 'minimum' ? `${scene.prediction}（${predictionOutput}）` : outputLabel(predictionOutput);
    const labels = ventilation ? {measure:'读取温度',inspect:'检查设备',gate:id === 'repair' ? '现场复验' : '现场核验',ticket:`执行风机${outputLabel(run.output)}`} : id === 'minimum' ? {collect:'读取两组电量',route:`去${run.branch === 'yes' ? run.config?.yes : run.config?.no}充电口（${outputLabel(run.output)}）`,verify:'核验低电量优先'} : {};
    const actions = scene.actions.map(action => action === 'predict' ? `预测${predictionLabel}` : labels[action] || (action === 'ticket' ? `出票${outputLabel(run.output)}` : action === 'route' ? `走向${outputLabel(run.output)}` : actionLabels[action] || action)).join('→');
    return `${actor?.label || '场景体验'}：${actions}；实际条件${run.condition ? '成立' : '不成立'}；先预测与实际输出${predictionOutput === run.output ? '相符' : '不相符'}。`;
  }
  return { ACTORS, validateEvidence, validateSceneDraft, validateRpgDraft, actionLabels, evidenceSummary };
}));
