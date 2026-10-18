import layout from '../../tiled/layout.json';
import { EventMode, type EventDefinition, type RpgPlayer } from '@rpgjs/server';
import { advanceRoute, bothRoadsVerified, closedBridgeSelected, routeMark } from './route-progress.mjs';
import {
  apply, clearPending, configure, ctx, event, input, patchScene, predict,
  record, review, rpc, say, scene
} from './runtime';

const routeProgress = new WeakMap<RpgPlayer, ReturnType<typeof advanceRoute>>();
const movingSave = new WeakSet<RpgPlayer>();

function routeKey() {
  return JSON.stringify([ctx().draft.config, input(), ctx().draft.prediction, scene().ticket]);
}

/** Called from the engine's movement hook; map coordinates are physical evidence. */
export async function checkRoute(player: RpgPlayer) {
  if (ctx().levelId !== 'cross' || movingSave.has(player)) return;
  const current = scene();
  if (!current.ticket || current.actions.includes('route')) {
    routeProgress.delete(player);
    return;
  }
  const selected = current.ticket.output;
  if (!['bridge', 'crossing'].includes(selected)) return;
  if ((selected === 'bridge' && !current.facility) || (selected === 'crossing' && current.signal !== 'green')) {
    routeProgress.delete(player);
    return;
  }
  const progress = advanceRoute(routeProgress.get(player), { x: player.x(), y: player.y() }, selected, routeKey());
  routeProgress.set(player, progress);
  const mark = routeMark(progress.stage);
  if (!mark) return;
  movingSave.add(player);
  try {
    await patchScene(player, { actions: [...current.actions, mark], phase: 'arrived' });
  } catch (error) {
    await say(player, '通行记录员', error instanceof Error ? error.message : '通行记录未同步，请重新尝试。');
  } finally {
    movingSave.delete(player);
  }
}

async function roadGuide(player: RpgPlayer, east = false) {
  const choice = await say(player, '交通设施巡检员',
    '请调试这块指路牌：附近有天桥就引导走天桥，否则到斑马线等待绿灯。观察现场、写出两个出口、先预测，再亲自沿选中路线通行。两种现场都要试。', [
      { id: 'accept', label: '领取巡检任务' },
      { id: 'bridge', label: '巡检有天桥的东区路口' },
      { id: 'crossing', label: '巡检没有天桥的西区路口' },
      ...(east ? [{ id: 'return', label: '沿安全路线徒步返回西岸复验' }] : []),
      { id: 'review', label: '向巡检员说明我的发现' }
    ]);
  if (choice === 'review') return review(player);
  if (choice === 'return') {
    if (scene().ticket) return say(player, '交通设施巡检员', '请先去旁边的核验台保存这次实际结果，再返回修订。');
    player.setVariable('returnToWest', true);
    await patchScene(player, { ...(scene().facility ? {} : { signal: 'green' }) });
    return say(player, '交通设施巡检员', scene().facility
      ? '回程天桥已开放，请沿上方天桥徒步返回西岸，再到观察点重新读数。'
      : '已等待回程绿灯。请沿下方斑马线徒步返回西岸，再到观察点重新读数。');
  }
  if (choice === 'accept') {
    if(scene().phase === 'start') await patchScene(player, { phase: 'assigned' });
    return say(player, '交通设施巡检员', '先走到“设施观察点”看清这个路口，再操作旁边的指路牌。按方向键或 WASD 行走，面向物体按 E 交流。');
  }
  if (choice === 'bridge' || choice === 'crossing') {
    const facility = choice === 'bridge';
    routeProgress.delete(player);
    player.setVariable('returnToWest', false);
    await clearPending(player, {
      facility, actorId: facility ? 'cross-open' : 'cross-closed', signal: 'red', phase: 'assigned'
    });
    return say(player, '交通设施巡检员', facility
      ? '已来到东区：这里有一座可通行的天桥。请重新观察现场、预测并测试当前指路程序。'
      : '已来到西区：这里没有天桥。请重新观察现场、预测并测试当前指路程序。');
  }
}

async function observeRoad(player: RpgPlayer) {
  const facility = scene().facility === true;
  routeProgress.delete(player);
  player.setVariable('returnToWest', false);
  await clearPending(player, {
    facility, actorId: facility ? 'cross-open' : 'cross-closed', measured: true,
    phase: 'observed', actions: ['observe']
  });
  return say(player, '现场观察仪', facility
    ? '观察记录：附近有天桥，判断条件“附近有天桥或地下通道”成立。下方也能看见斑马线。请让程序只选一个出口。'
    : '观察记录：附近没有天桥或地下通道，这个条件不成立。下方有带信号灯的人行横道。请让程序只选一个出口。');
}

async function routeConsole(player: RpgPlayer) {
  const choice = await say(player, '智能指路牌', '要调试这次通行的哪一步？先读取现场，预测会走哪里，再让当前程序作出选择。', [
    { id: 'configure', label: '配置条件成立、不成立时的出口' },
    { id: 'predict', label: '先预测这次会选哪条路线' },
    { id: 'apply', label: '执行当前指路程序' },
    { id: 'flow', label: '查看我的分支流程图' }
  ]);
  if (choice === 'configure') return configure(player);
  if (choice === 'predict') return predict(player);
  if (choice === 'flow') return rpc('flow', {});
  if (choice === 'apply') {
    await apply(player);
    const ticket = scene().ticket;
    if (!ticket) return;
    return say(player, '智能指路牌', ticket.output === 'bridge'
      ? '程序只点亮了“天桥”出口。请走到上方天桥入口，再沿天桥走到对岸核验台。若现场没有桥，入口会受阻。'
      : '程序只点亮了“人行横道”出口。请走到下方信号灯旁等待绿灯，再沿斑马线走到对岸核验台。');
  }
}

async function bridgeEntrance(player: RpgPlayer) {
  const current = scene();
  if (!current.ticket) return say(player, '天桥入口', '请先观察现场，在指路牌上作出预测并执行程序。');
  if (current.ticket.output !== 'bridge') return say(player, '天桥入口', '本次程序选中了人行横道。只能沿当前选中的一个出口验证。');
  if (closedBridgeSelected(current.ticket.output, current.facility)) {
    await patchScene(player, { actions: [...current.actions, 'route'], phase: 'blocked' });
    await record(player, 'blocked', 'blocked');
    return say(player, '天桥入口', '这里没有天桥，通道受阻，角色留在安全侧。这说明程序的出口与现场条件不相符。请回指路牌修订后重新观察、预测、验证。');
  }
  return say(player, '天桥入口', '天桥通道已开放。沿桥走过道路，到东侧核验台确认本次通行。');
}

async function signalLamp(player: RpgPlayer) {
  const choice = await say(player, '人行信号灯', scene().signal === 'green'
    ? '现在是绿灯。程序选中人行横道时才可进入这一条验证路线。'
    : '现在是红灯，请在安全侧等待。教学仿真中，可以等待本轮绿灯出现。', [
      { id: 'green', label: '等待本轮绿灯' },
      { id: 'red', label: '观察下一轮红灯：停止通行' }
    ]);
  if (choice !== 'green' && choice !== 'red') return;
  await patchScene(player, { signal: choice });
  return say(player, '人行信号灯', choice === 'green'
    ? '绿灯已亮。若指路牌选中人行横道，请沿下方斑马线连续走到对岸。'
    : '红灯已亮，入口关闭。请在安全侧等待。');
}

let visitorShape: { teleport?: (position: { x: number; y: number }) => Promise<unknown>; x?: { set: (value: number) => void }; y?: { set: (value: number) => void } } | undefined;

function visitorSkipped(player: RpgPlayer) {
  if (player.getVariable('skipVisitor')) return true;
  try { return localStorage.getItem('branch-island-skip-visitor') === '1'; } catch { return false; }
}

function setVisitorSkipped(player: RpgPlayer, skipped: boolean) {
  player.setVariable('skipVisitor', skipped);
  try {
    if (skipped) localStorage.setItem('branch-island-skip-visitor', '1');
    else localStorage.removeItem('branch-island-skip-visitor');
  } catch { /* 本机偏好写不了时，仍记住这一次角色变量 */ }
}

async function slideVisitor(route: 'bridge' | 'crossing', stopped: () => boolean) {
  const y = route === 'bridge' ? 336 : 680;
  for (let step = 0; step <= 12; step += 1) {
    if (stopped()) return;
    const x = 420 + (1040 - 420) * step / 12;
    try {
      if (typeof visitorShape?.teleport === 'function') await visitorShape.teleport({ x, y });
      else { visitorShape?.x?.set?.(x); visitorShape?.y?.set?.(y); }
    } catch { /* 关掉演出后不再追位置 */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

async function showVisitor(player: RpgPlayer) {
  if (visitorSkipped(player)) return say(player, '交通设施巡检员', '游客过街演出已关闭。路上的游客可以再打开。');
  const route = scene().facility === false ? 'crossing' : 'bridge';
  let stopped = false;
  const motion = slideVisitor(route, () => stopped);
  const choice = await say(player, '过街游客', route === 'bridge'
    ? '有可用天桥，我走天桥过马路。这段大约三秒，可以关掉。'
    : '天桥现在不可用，我走斑马线过马路。这段大约三秒，可以关掉。', [
    { id: 'skip', label: '关闭动画' }
  ]);
  stopped = true;
  await motion;
  if (choice === 'skip') {
    setVisitorSkipped(player, true);
    return say(player, '过街游客', '动画已关闭。以后仍可以找我重新看。');
  }
  return say(player, '交通设施巡检员', '游客安全过街了，辛苦啦！');
}

async function visitorTalk(player: RpgPlayer) {
  if (!bothRoadsVerified(ctx().runs, ctx().evidenceStart)) {
    return say(player, '过街游客', '两种现场都测对以后，我再按导行屏过马路。');
  }
  if (visitorSkipped(player)) {
    const again = await say(player, '过街游客', '过街动画已关闭。', [
      { id: 'watch', label: '再看一次过街' },
      { id: 'keep', label: '保持关闭' }
    ]);
    if (again !== 'watch') return;
    setVisitorSkipped(player, false);
  }
  return showVisitor(player);
}

async function verifyRoad(player: RpgPlayer) {
  if (!scene().ticket || !scene().actions.includes('route') || scene().phase !== 'arrived') {
    return say(player, '通行核验台', '还没有这次完整通行的记录。请从西侧入口沿程序选中的路线走过道路，不能只从旁边来到核验台。');
  }
  await record(player, 'verify', 'arrived');
  if (bothRoadsVerified(ctx().runs, ctx().evidenceStart)) {
    const match = await say(player, '通行核验台', '开放 → 你走了天桥（如果那一半）｜封闭 → 你走了斑马线（否则那一半）。', [
      { id: 'yes', label: '对得上' },
      { id: 'no', label: '对不上' }
    ]);
    if (match === 'no') return say(player, '通行核验台', '对照两次实际走过的路，再看句子里的如果和否则。');
    if (match !== 'yes') return;
    return showVisitor(player);
  }
  return say(player, '通行核验台', '已保存本次现场、先前预测、实际选中分支与通行结果。请找巡检员说明为什么一次判断只执行一个出口；还需测试另一种设施现场。');
}

function gate(route: 'bridge' | 'crossing'): EventDefinition {
  const base = event(route === 'bridge' ? '天桥安全门' : '斑马线安全门', 'portal', async player => {
    await say(player, '安全门', route === 'bridge'
      ? '天桥存在，并且指路程序选中天桥时，这个入口才开放。'
      : '请先让程序选中人行横道，并在信号灯处等待绿灯。');
  });
  return {
    ...base,
    name: route === 'bridge' ? '天桥安全门' : '斑马线安全门',
    mode: EventMode.Scenario,
    onInit() { this.setHitbox(32, 142); this.through = false; },
    onChanges(player) {
      const current = scene() ?? {};
      const returning = player.getVariable('returnToWest') && route === (current.facility ? 'bridge' : 'crossing');
      this.through = !!returning || current.ticket?.output === route && (route === 'bridge' ? current.facility === true : current.signal === 'green');
    }
  };
}

function placed(map:string, point:string, id:string, definition:EventDefinition){const [x,y]=layout[map].positions[point];return {id,x,y,event:definition};}
export const crossingEvents = [
  placed('crossing','guide','road-guide',event('交通设施巡检员','warden',player=>roadGuide(player))),
  placed('crossing','portal','road-guide-east',event('东岸巡检员','warden',player=>roadGuide(player,true))),
  placed('crossing','observe','road-observe',event('设施观察点','sensor',observeRoad)),
  placed('crossing','control','road-console',event('智能指路牌','control',routeConsole)),
  placed('crossing','bridgeWest','bridge-entrance',event('天桥入口','portal',bridgeEntrance)),
  {id:'road-signal',x:474,y:608,event:event('人行信号灯','monitor',signalLamp)},
  placed('crossing','verify','road-verify',event('通行核验台','monitor',verifyRoad)),
  placed('crossing','visitor','road-visitor',(() => {
    const base = event('过街游客','staff',visitorTalk);
    return { ...base, onInit() { base.onInit?.call(this); visitorShape = this; } };
  })()),
  {id:'bridge-gate',x:590,y:285,event:gate('bridge')},
  {id:'crossing-gate',x:590,y:620,event:gate('crossing')}
];

async function energyGuide(player: RpgPlayer) {
  const choice = await say(player, '园区能源工程师',
    '调试两路充电柜：先给电量较低的一组充电。请分别走近 A、B 读取电量，配置比较条件和两个出口，先预测，再亲自到被选中的支路接入，最后回核验台。两组数据都要验证。', [
      { id: 'accept', label: '领取节能配电任务' },
      { id: 'pair-a', label: '装入第一组：A 3%，B 8%' },
      { id: 'pair-b', label: '装入第二组：A 9%，B 2%' },
      { id: 'review', label: '向工程师说明我的比较方法' }
    ]);
  if (choice === 'review') return review(player);
  if (choice === 'accept') {
    if(scene().phase === 'start') await patchScene(player, { phase: 'assigned' });
    return say(player, '园区能源工程师', '请先走近左、右两组电池，读取 A 和 B 的电量。这些是教学仿真数据。');
  }
  if (choice === 'pair-a' || choice === 'pair-b') {
    await clearPending(player, { pair: choice, actorId: choice, collected: [], phase: 'assigned' });
    return say(player, '园区能源工程师', '电池组已更换。上一组的读取和预测不能代替这一组，请重新读取两个电量。');
  }
}

async function battery(player: RpgPlayer, key: 'a' | 'b') {
  const current = scene();
  const values = input();
  if (current.ticket) {
    const selected = ctx().draft.config[current.ticket.branch];
    if (key !== selected) return say(player, `电池 ${key.toUpperCase()}`, `当前程序没有选中这一支路。请只去 ${String(selected).toUpperCase()} 支路接入，观察程序的实际选择。`);
    if (!current.actions.includes('route')) {
      await patchScene(player, { actions: [...current.actions, 'route'], phase: 'connected' });
    }
    return say(player, `电池 ${key.toUpperCase()}`, `已在现场接入程序选中的 ${key.toUpperCase()} 支路，电量 ${values[key]}%。请走到充电核验台，检查这次是否真的先给较低电量充电。`);
  }
  const previous = current.measured || ctx().draft.prediction ? [] : (current.collected ?? []);
  const collected = [...new Set([...previous, key])];
  const measured = collected.includes('a') && collected.includes('b');
  await clearPending(player, {
    pair: current.pair ?? 'pair-a', actorId: current.pair ?? 'pair-a', collected, measured,
    actions: measured ? ['collect'] : [], phase: measured ? 'collected' : 'reading'
  });
  return say(player, `电池 ${key.toUpperCase()}`, `现场读取：${key.toUpperCase()} 电量 ${values[key]}%。${measured ? '两个电量都已读取，可以到配电控制台比较与预测。' : '还需要走近另一组电池，读取它的电量。'}`);
}

async function energyConsole(player: RpgPlayer) {
  const choice = await say(player, '配电控制台', '选择要调试的步骤。判断成立与不成立，都要写明接入 A 还是 B。', [
    { id: 'configure', label: '配置比较符和两个充电支路' },
    { id: 'predict', label: '先预测本次会接入 A 还是 B' },
    { id: 'apply', label: '执行当前配电程序' },
    { id: 'flow', label: '查看我的分支流程图' }
  ]);
  if (choice === 'configure') return configure(player);
  if (choice === 'predict') return predict(player);
  if (choice === 'flow') return rpc('flow', {});
  if (choice === 'apply') {
    await apply(player);
    const ticket = scene().ticket;
    if (!ticket) return;
    const selected = ctx().draft.config[ticket.branch];
    return say(player, '配电控制台', `程序只点亮 ${String(selected).toUpperCase()} 支路。请实际走近这一组电池接入，再走到充电核验台。`);
  }
}

async function verifyEnergy(player: RpgPlayer) {
  if (!scene().ticket || !scene().actions.includes('route')) {
    return say(player, '充电核验台', '请先读取两组电量、作出预测并执行程序，然后实际走近程序选中的那组电池接入。');
  }
  await record(player, 'verify');
  await patchScene(player, { collected: [] });
  return say(player, '充电核验台', '本次预测、比较真假、实际选中支路和是否低电量优先已保存。请到能源工程师处更换另一组数据，或说明你的比较方法。');
}

export const energyEvents = [
  placed('energy','guide','energy-guide',event('园区能源工程师','mechanic',energyGuide)),
  placed('energy','batteryA','battery-a',event('A 电池支路','battery-a',player=>battery(player,'a'))),
  placed('energy','batteryB','battery-b',event('B 电池支路','battery-b',player=>battery(player,'b'))),
  placed('energy','control','energy-console',event('配电控制台','control',energyConsole)),
  placed('energy','monitor','energy-verify',event('充电核验台','monitor',verifyEnergy))
];
