import { Components } from '@rpgjs/server';
import layout from '../../tiled/layout.json';
import { event,ctx,scene,input,patchScene,clearPending,say,configure,review,record,portal } from './runtime';

const positions = layout.greenhouse.positions;
const place = (id: string, station: any) => ({ id, x: positions[id][0], y: positions[id][1], event: station });
const repairing = () => ctx().levelId === 'repair';

function guideLabel(repair: boolean) {
  return repair ? '维修员老修' : '园艺员阿绿';
}

const guide = {
  ...event('园艺员阿绿', 'gardener', async player => {
    const repair = repairing();
    const choice = await say(player, guideLabel(repair), repair
      ? '有人改过控制器，风机又乱了。我不能告诉你错在哪。先跑 30℃，亲眼看故障。找出条件与出口是否配合。请先用30°C看到故障，再修复并复验29、30、31°C。'
      : '温室好热！菜苗都蔫了！风机不会自己判断，得靠你。告示写着达到30°C就开风机。请补流程图，再测29、30、31°C。设备怎样‘看情况’决定这一次做哪件事？',
      [{ id: 'accept', label: '开始本站任务' }, { id: 'review', label: '根据运行记录汇报验收' }]);
    if (choice === 'accept' && scene().phase === 'start') await patchScene(player, { phase: 'assigned' });
    if (choice === 'review') await review(player);
  }),
  onChanges(player: any) {
    const repair = player.getVariable('lessonLevel') === 'repair';
    this.setGraphic(repair ? 'mechanic' : 'gardener');
    this.setComponentsTop(Components.text(guideLabel(repair), { fill: '#163e31', fontSize: 15 }));
  }
};

/** 温室一张图同时承接风机调试和控制器返修。返修不再换到车间，也不传送。 */
export const greenhouseEvents = [
  place('guide', guide),
  place('sensor', event('温度探头', 'sensor', async player => {
    if (scene().phase === 'start') { await say(player, '温度探头', '先与管理员交谈，了解设备任务。'); return; }
    const choice = await say(player, '温度探头', `当前试验温度${input().temperature}°C。选择一个采样情境。温度数据为教学仿真。`, [29, 30, 31].map(t => ({ id: String(t), label: `采样 ${t}°C` })));
    if (!choice) return;
    const t = Number(choice);
    const repair = repairing();
    await clearPending(player, { temperatureCase: t, actorId: `sensor${t}` });
    await patchScene(player, { phase: 'measured', measured: true, actions: [repair ? 'inspect' : 'measure'] });
    await say(player, '读数已采集', `探头读数：${t}°C。请走到控制柜，判断条件是否成立。`);
  })),
  place('control', event('规则控制柜', 'control', configure)),
  place('fan', { ...event('通风风机', 'fan-off', async player => { await say(player, '通风风机', `风机目前${scene().deviceOutput === 'on' ? '正在转动' : '处于关闭状态'}。请在控制柜运行程序，再到核验仪观察本次结果。`); }), onChanges(player: any) { this.setGraphic(player.getVariable('deviceOutput') === 'on' ? 'fan-on' : 'fan-off'); } }),
  place('verify', event('现场核验仪', 'monitor', async player => { await record(player, 'gate'); })),
  place('portal', portal())
];

/** 车间图不再注册。文件留着，避免旧引用缺符号。 */
export const workshopEvents: any[] = [];
