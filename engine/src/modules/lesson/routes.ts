import layout from '../../tiled/layout.json';
import { Direction } from '@rpgjs/common';
import { EventMode, type EventDefinition, type RpgPlayer } from '@rpgjs/server';
import { advanceRoute, bothRoadsVerified, closedBridgeSelected, routeMark } from './route-progress.mjs';
import {
  apply, clearPending, configure, ctx, event, input, patchScene, predict,
  record, review, say, scene, currentRuns, canReview, feedback
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
  if(canReview())return review(player);
  const first=!scene().phase||scene().phase==='start';
  const verified=currentRuns().filter(run=>run.correct&&run.scene?.outcome==='arrived');
  const nextFacility=verified.length?([true,false].find(value=>!verified.some(run=>run.input?.facility===value))??scene().facility):scene().facility!==false;
  const change=!first&&nextFacility!==scene().facility;
  const returning=!first&&!change&&east&&!scene().ticket;
  const choice=await say(player,'巡检员小巡',first?'准备好了，就先观察路口设施。':change?'这里已经测对。再检查另一种现场。':returning?'还要再验一次。先沿安全路线回到西岸。':'先观察，再到导行屏作预测。运行后，沿选中的路去核验。',[{id:first?'accept':change?'next-case':returning?'return':'continue',label:first?'领取巡检任务':change?(nextFacility?'检查有可用设施的路口':'检查没有可用设施的路口'):returning?'沿安全路线回西岸':'继续本次巡检'}]);
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
    ? '附近有可用天桥。去导行屏判断这次怎么走。'
    : '附近没有天桥或地下通道。看看导行屏的另一条安排。');
}

async function routeConsole(player: RpgPlayer) {
  if(!ctx().draft.flow?.locked||(!scene().ticket&&currentRuns().some(run=>!run.correct)))return configure(player);
  if(scene().actions?.[1]!=='predict')return predict(player);
  return apply(player);
}

async function bridgeEntrance(player: RpgPlayer) {
  const current = scene();
  if (!current.ticket) return say(player, '天桥入口', '先观察现场，再去导行屏。预测后才能运行程序。');
  if (current.ticket.output !== 'bridge') return say(player, '天桥入口', '这次选中了人行横道。请沿程序选中的一路检验。');
  if (closedBridgeSelected(current.ticket.output, current.facility)) {
    await patchScene(player, { actions: [...current.actions, 'route'], phase: 'blocked' });
    return record(player, 'blocked', 'blocked');
  }
  return say(player, '天桥入口', '天桥通道已开放。沿桥到对岸，再去核验台。');
}

async function signalLamp(player: RpgPlayer) {
  if(scene().signal==='green')return say(player,'人行信号灯','绿灯亮了。沿选中的人行横道到对岸核验。');
  const choice = await say(player, '人行信号灯', scene().signal === 'green'
    ? '绿灯亮了。沿选中的人行横道到对岸核验。'
    : '红灯时，先在安全侧停住。点下面的按钮，等绿灯亮起。', [
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
    return say(player, '过街游客', '两种现场都测对，我再按导行屏走。');
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
    return say(player, '通行核验台', '还没有完整通行记录。请从入口走完程序选中的一路。');
  }
  return record(player, 'verify', 'arrived');
}

function gate(route: 'bridge' | 'crossing'): EventDefinition {
  const base = event(route === 'bridge' ? '天桥安全门' : '斑马线安全门', 'portal', async player => {
    await say(player, '安全门', route === 'bridge'
      ? '有可用天桥，程序也选中它，入口才开。'
      : '程序选中人行横道后，还要等绿灯。');
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
  const first=!scene().phase||scene().phase==='start';
  const verified=currentRuns().filter(run=>run.correct);
  const pair=verified.length?(verified.some(run=>run.input?.a<run.input?.b)?'pair-b':'pair-a'):(scene().pair||'pair-a');
  const change=!first&&pair!==(scene().pair||'pair-a');
  const choice=await say(player,'园区能源工程师',first?'先分别点A、B，读取两块电量。':change?'这一组已经测对。换另一组电量再试。':'先读两块电量，再让控制台比较。两组都要检验。',[{id:first?'accept':change?'next-case':'continue',label:first?'领取节能配电任务':change?(pair==='pair-b'?'换一组：A 9%，B 2%':'换一组：A 3%，B 8%'):'继续调试配电程序'}]);
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
    if (key !== selected) return say(player, `电池 ${key.toUpperCase()}`, `本次程序没选这块电池。去${String(selected).toUpperCase()}支路看实际选择。`);
    if (!current.actions.includes('route')) {
      await patchScene(player, { actions: [...current.actions, 'route'], phase: 'connected' });
    }
    return feedback(`已接入${key.toUpperCase()}电池，剩余${values[key]}%。下一步去核验台。`);
  }
  const previous = current.measured || ctx().draft.prediction ? [] : (current.collected ?? []);
  const collected = [...new Set([...previous, key])];
  const measured = collected.includes('a') && collected.includes('b');
  await clearPending(player, {
    pair: current.pair ?? 'pair-a', actorId: current.pair ?? 'pair-a', collected, measured,
    actions: measured ? ['collect'] : [], phase: measured ? 'collected' : 'reading'
  });
  return feedback(`读到${key.toUpperCase()}电量${values[key]}%。${measured ? '两块都读完了，去控制台比较。' : '再读另一块电池。'}`);
}

async function energyConsole(player: RpgPlayer) {
  if(!ctx().draft.flow?.locked||(!scene().ticket&&currentRuns().some(run=>!run.correct)))return configure(player);
  if(scene().actions?.[1]!=='predict')return predict(player);
  return apply(player);
}

async function verifyEnergy(player: RpgPlayer) {
  if (!scene().ticket || !scene().actions.includes('route')) {
    return say(player, '充电核验台', '先读电量、预测并运行。接入选中的电池，再来核验。');
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
