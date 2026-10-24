import layout from '../../tiled/layout.json';
import { Direction } from '@rpgjs/common';
import { EventMode, type EventDefinition, type RpgPlayer } from '@rpgjs/server';
import { advanceRoute, bothRoadsVerified, closedBridgeSelected, routeMark } from './route-progress.mjs';
import {
  apply, clearPending, configure, ctx, event, input, patchScene, predict,
  record, review, say, scene, currentRuns, canReview
} from './runtime';
import { stationBrief } from '../../../../public/task-guidance.mjs';

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
  if(canReview())return review(player);
  const first=!scene().phase||scene().phase==='start',brief=stationBrief('cross');
  const verified=currentRuns().filter(run=>run.correct&&run.scene?.outcome==='arrived');
  const nextFacility=verified.length?([true,false].find(value=>!verified.some(run=>run.input?.facility===value))??scene().facility):scene().facility!==false;
  const change=!first&&nextFacility!==scene().facility;
  const returning=!first&&!change&&east&&!scene().ticket;
  const choice=await say(player,'巡检员小巡',`${brief.problem}\n${brief.purpose}\n${first?'先观察这里的设施，再让导行屏判断。':change?'这一种现场已经测对，接着检查另一种现场。':returning?'这次还要复验，先沿安全路线回到西岸。':'先观察现场，在导行屏设置规则、预测并运行，再沿选中的路线去核验。'}`,[{id:first?'accept':change?'next-case':returning?'return':'continue',label:first?'领取巡检任务':change?(nextFacility?'检查有可用设施的路口':'检查没有可用设施的路口'):returning?'沿安全路线回西岸':'继续本次巡检'}]);
  if (choice === 'return') {
    player.setVariable('returnToWest', true);
    await patchScene(player, { ...(scene().facility ? {} : { signal: 'green' }) });
    return;
  }
  if (choice === 'accept') {
    await patchScene(player, { phase: 'assigned' });return;
  }
  if (choice === 'next-case') {
    routeProgress.delete(player);
    player.setVariable('returnToWest', false);
    await clearPending(player, {
      facility:nextFacility, actorId: nextFacility ? 'cross-open' : 'cross-closed', signal: 'red', phase: 'assigned'
    });
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
  if(!ctx().draft.flow?.locked||(!scene().ticket&&currentRuns().some(run=>!run.correct)))return configure(player);
  if(scene().actions?.[1]!=='predict')return predict(player);
  return apply(player);
}

async function bridgeEntrance(player: RpgPlayer) {
  const current = scene();
  if (!current.ticket) return say(player, '天桥入口', '请先观察现场，在指路牌上作出预测并执行程序。');
  if (current.ticket.output !== 'bridge') return say(player, '天桥入口', '本次程序选中了人行横道。只能沿当前选中的一个出口验证。');
  if (closedBridgeSelected(current.ticket.output, current.facility)) {
    await patchScene(player, { actions: [...current.actions, 'route'], phase: 'blocked' });
    return record(player, 'blocked', 'blocked');
  }
  return say(player, '天桥入口', '天桥通道已开放。沿桥走过道路，到东侧核验台确认本次通行。');
}

async function signalLamp(player: RpgPlayer) {
  if(scene().signal==='green')return say(player,'人行信号灯','绿灯已经亮起。如果导行屏选中了人行横道，点这条路线的入口，沿斑马线到对岸核验。');
  const choice = await say(player, '人行信号灯', scene().signal === 'green'
    ? '现在是绿灯。程序选中人行横道时才可进入这一条验证路线。'
    : '现在是红灯，请在安全侧等待。教学仿真中，可以等待本轮绿灯出现。', [
      { id: 'green', label: '等待绿灯，准备通行' }
    ]);
  if (choice !== 'green') return;
  await patchScene(player, { signal: 'green' });
}

let visitorShape: {
  teleport?: (position: { x: number; y: number }) => Promise<unknown>;
  x?: { set?: (value: number) => void };
  y?: { set?: (value: number) => void };
  stopMoveTo?: () => void;
  changeDirection?: (direction: Direction) => void;
  setGraphicAnimation?: (name: string) => void;
  animationFixed: boolean;
} | undefined;

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
  const startX = 420;
  const endX = 1040;
  const shape = visitorShape;
  if (!shape) return;
  const teleportTo = async (x: number) => {
    if (typeof shape.teleport === 'function') await shape.teleport({ x, y });
    else { shape.x?.set?.(x); shape.y?.set?.(y); }
  };
  shape.stopMoveTo?.();
  shape.changeDirection?.(Direction.Right);
  shape.setGraphicAnimation?.('walk');
  shape.animationFixed = true;
  try {
    const steps = 20;
    for (let step = 0; step <= steps; step += 1) {
      if (stopped()) return;
      try { await teleportTo(startX + (endX - startX) * step / steps); }
      catch { /* 关掉演出后不再追位置 */ }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  } finally {
    shape.animationFixed = false;
    shape.setGraphicAnimation?.('stand');
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
  return record(player, 'verify', 'arrived');
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
  if(canReview())return review(player);
  const first=!scene().phase||scene().phase==='start',brief=stationBrief('minimum');
  const verified=currentRuns().filter(run=>run.correct);
  const pair=verified.length?(verified.some(run=>run.input?.a<run.input?.b)?'pair-b':'pair-a'):(scene().pair||'pair-a');
  const change=!first&&pair!==(scene().pair||'pair-a');
  const choice=await say(player,'园区能源工程师',`${brief.problem}\n${brief.purpose}\n${change?'这一组已经测对，换另一组电量看看。':'先分别点A、B读取电量，再让控制台作比较。两组都要验证。这是选做委托。'}`,[{id:first?'accept':change?'next-case':'continue',label:first?'领取节能配电任务':change?(pair==='pair-b'?'换一组：A 9%，B 2%':'换一组：A 3%，B 8%'):'继续调试配电程序'}]);
  if (choice === 'accept') {
    await patchScene(player, { phase: 'assigned' });return;
  }
  if (choice === 'next-case') {
    await clearPending(player, { pair, actorId: pair, collected: [], phase: 'assigned' });
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
  if(!ctx().draft.flow?.locked||(!scene().ticket&&currentRuns().some(run=>!run.correct)))return configure(player);
  if(scene().actions?.[1]!=='predict')return predict(player);
  return apply(player);
}

async function verifyEnergy(player: RpgPlayer) {
  if (!scene().ticket || !scene().actions.includes('route')) {
    return say(player, '充电核验台', '请先读取两组电量、作出预测并执行程序，然后实际走近程序选中的那组电池接入。');
  }
  return record(player, 'verify');
}

export const energyEvents = [
  placed('energy','guide','energy-guide',event('园区能源工程师','mechanic',energyGuide)),
  placed('energy','batteryA','battery-a',event('A 电池支路','battery-a',player=>battery(player,'a'))),
  placed('energy','batteryB','battery-b',event('B 电池支路','battery-b',player=>battery(player,'b'))),
  placed('energy','control','energy-console',event('配电控制台','control',energyConsole)),
  placed('energy','monitor','energy-verify',event('充电核验台','monitor',verifyEnergy))
];
