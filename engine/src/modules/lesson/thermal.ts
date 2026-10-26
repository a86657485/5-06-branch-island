import { Components, EventMode } from '@rpgjs/server';
import layout from '../../tiled/layout.json';
import { event,ctx,scene,input,patchScene,clearPending,say,configure,review,record,portal,currentRuns,canReview,feedback } from './runtime';
import { actorIdOf, planGreenhouseSync } from './greenhouse-cast';
import { faultSeen } from '../../gui/flow-model';

const positions = layout.greenhouse.positions;
const place = (id: string, station: any) => ({ id, x: positions[id][0], y: positions[id][1], event: station });
const repairing = () => ctx().levelId === 'repair';

function guideLabel(repair: boolean) {
  return repair ? '维修员老修' : '园艺员阿绿';
}

const labelPlace: Record<string, { marginBottom: number, marginLeft: number, width: number }> = {
  guide: { marginBottom: 8, marginLeft: 0, width: 88 },
  sensor: { marginBottom: 8, marginLeft: 0, width: 80 },
  fan: { marginBottom: 8, marginLeft: 0, width: 80 },
  control: { marginBottom: 8, marginLeft: 0, width: 96 },
  verify: { marginBottom: 4, marginLeft: 0, width: 96 },
  portal: { marginBottom: 8, marginLeft: 0, width: 64 }
};

function paintLabel(target: any, label: string, graphic: string) {
  target.name = label;
  target.setGraphic?.(graphic);
  if (actorIdOf(target.id) === 'verify') {
    target.setComponentsTop?.([]);
    target.setComponentsBottom?.(Components.text(label, { fill: '#ffffff', stroke: '#0b241d', fontSize: 18, opacity: 0 }), { width: 128, height: 24, marginLeft: 0, marginBottom: 36 });
    return;
  }
  const place = labelPlace[actorIdOf(target.id)] || { marginBottom: 8, marginLeft: 0, width: 80 };
  target.setComponentsTop?.(Components.text(label, { fill: '#ffffff', stroke: '#0b241d', fontSize: 18, opacity: 0 }), place);
}

const guide = {
  ...event('园艺员阿绿', 'gardener', async player => {
    const repair = repairing();
    if(canReview())return review(player);
    const first=!scene().phase||scene().phase==='start';
    const next=repair?(!faultSeen(ctx().runs)?'先读30℃，猜猜旧程序会做什么。运行后，到核验仪看故障。':'故障已留下，先改条件和两边动作。再测29、30、31℃。'):'先去探头读温度。29、30、31℃都要检验。';
    const choice=await say(player,guideLabel(repair),first?(repair?'备用板到了30℃却停机。先别修改，读30℃后照旧程序运行。':'我没法一直守着新风机。请先读温度，再替它配好自动规则。'):next, [{id:first?'accept':'continue',label:first?'领取这项委托':'继续现场调试'}]);
    if(choice==='accept')await patchScene(player,{phase:'assigned'});
  }),
  onChanges(player: any) {
    const repair = player.getVariable('lessonLevel') === 'repair';
    paintLabel(this, guideLabel(repair), repair ? 'mechanic' : 'gardener');
  }
};

/** 温室一张图同时承接风机调试和控制器返修。返修不再换到车间，也不传送。 */
export const greenhouseEvents = [
  place('guide', guide),
  place('sensor', event('温度探头', 'sensor', async player => {
    if (scene().phase === 'start') { await say(player, '温度探头', '先与管理员交谈，了解设备任务。'); return; }
    if(scene().ticket){await say(player,'温度探头','风机已经运行。先去核验仪，再采下个温度。');return;}
    const original=repairing()&&!faultSeen(ctx().runs),temperatures=original?[30]:[29,30,31];
    const recommended=original?30:([29,30,31].find(t=>!currentRuns().some(run=>run.input?.temperature===t&&run.correct))||29);
    const choice = await say(player, '温度探头', original?'先采样30℃，保留旧程序。运行后，看看风机为什么没转。':`试读${recommended}℃，看看会走哪条路。这里用的是模拟温度。`, temperatures.map(t => ({ id: String(t), label: `采样 ${t}℃${t===recommended?'（建议）':''}` })));
    if (!choice) return;
    const t = Number(choice);
    const repair = repairing();
    await clearPending(player, { temperatureCase: t, actorId: `sensor${t}` });
    await patchScene(player, { phase: 'measured', measured: true, actions: [repair ? 'inspect' : 'measure'] });
    feedback(`读到${t}℃。下一步去控制柜。`);
  })),
  place('control', event('规则控制柜', 'control', configure)),
  place('fan', { ...event('通风风机', 'fan-off', async player => { await say(player, '通风风机', `风机${scene().deviceOutput === 'on' ? '正在转动' : '处于关闭状态'}。运行后，去核验仪比较。`); }), onChanges(player: any) { this.setGraphic(player.getVariable('deviceOutput') === 'on' ? 'fan-on' : 'fan-off'); } }),
  place('verify', event('现场核验仪', 'monitor', async player => { await record(player, 'gate'); })),
  place('portal', portal())
];

const clientFlush = new WeakMap<object, string>();

/** 登录、刷新、切站都把温室角色摆全，并按当前站换外观。 */
export async function ensureGreenhouseActors(map: any, player: any, levelId: string) {
  if (!map || map.id !== 'greenhouse' || !player) return;
  const visible = (map.getEvents?.() || []).filter((item: any) => map.isEventVisibleForPlayer?.(item, player) !== false);
  const placed = new Map(greenhouseEvents.map(item => [item.id, item]));
  const plan = planGreenhouseSync(visible.map((item: any) => ({
    id: item.id,
    x: typeof item.x === 'function' ? item.x() : item.x,
    y: typeof item.y === 'function' ? item.y() : item.y
  })), levelId, player.getVariable?.('deviceOutput') === 'on');
  for (const actor of plan) {
    let target = visible.find((item: any) => actorIdOf(item.id) === actor.id);
    if (!target && actor.create && map.createDynamicEvent) {
      const source = placed.get(actor.id);
      try {
        await map.createDynamicEvent(
          { id: actor.id, x: actor.x, y: actor.y, event: source?.event },
          { mode: EventMode.Scenario, scenarioOwnerId: player.id }
        );
      } catch (error) {
        console.warn('温室角色没有摆上', actor.id, error);
      }
      target = (map.getEvents?.() || []).find((item: any) => actorIdOf(item.id) === actor.id && map.isEventVisibleForPlayer?.(item, player) !== false);
    }
    if (!target) continue;
    if (actor.move && target.teleport) await target.teleport({ x: actor.x, y: actor.y });
    paintLabel(target, actor.label, actor.graphic);
  }
  // 角色进客户端靠 player.syncChanges()。进图时地图流先于场景角色发出，区块中心不变时不会再推事件，
  // through 的角色也不在第一次空间查询里。公开接口没有“补发当前视野事件”，所以同一位玩家在这张图上
  // 只用 teleport 挪 1 像素再回到原位，让这一次位置同步把角色快照带出去。
  const flushKey = `${player.id || ''}:${map.id}`;
  if (clientFlush.get(player) !== flushKey && typeof player.teleport === 'function' && typeof player.x === 'function') {
    clientFlush.set(player, flushKey);
    const x = player.x();
    const y = player.y();
    await player.teleport({ x: x + 1, y });
    await player.teleport({ x, y });
  }
  player.syncChanges?.();
}

/** 车间图不再注册。文件留着，避免旧引用缺符号。 */
export const workshopEvents: any[] = [];
