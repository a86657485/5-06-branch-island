/**
 * 任务引导的唯一来源。
 *
 * 之前「顶部任务条」和「角色走向哪个点」是两套独立的 if 链，改一处忘一处，
 * 就会出现「任务条叫你去设规则，可柜子是锁的」「箭头指向斑马线，可那是红灯」
 * 这类让学生原地打转的引导。现在文案和目的一起算，只在 tests/guidance.test.mjs
 * 里维护一份状态表。
 *
 * 纯函数：入参是站点、场景快照、当前输入，不碰 DOM。
 */

/** 每个站点实际存在的交互点，nextStep 只能指向这些 kind，否则场景会退化成第一个点。 */
export const VALID_GOALS = {
  sale: ['guide', 'sensor', 'control', 'fan', 'verify'],
  repair: ['guide', 'sensor', 'control', 'fan', 'verify'],
  cross: ['guide', 'observe', 'control', 'bridge', 'zebra', 'signal', 'verify'],
  minimum: ['guide', 'a', 'b', 'control', 'verify'],
};

export function nextStep({ station, scene, prediction = '', input = {}, levelValid = false } = {}) {
  const s = scene || {};
  const visited = s.visited || [];

  if (levelValid) return { goal: 'guide', text: '本轮验收通过，找NPC前往下一处任务。' };
  if (s.phase === 'start') return { goal: 'guide', text: '先走近现场NPC，领取调试委托。' };
  if (!station || !VALID_GOALS[station]) throw new Error(`未知站点：${station}`);

  if (station === 'cross') {
    if (!s.measured) return { goal: 'observe', text: '到【观察现场】确认这一处有没有可用的天桥。' };
    if (!s.ticket) {
      return visited.includes('verified')
        ? { goal: 'guide', text: '回安全员处切换另一种现场条件，再观察与核验。' }
        : { goal: 'control', text: '走近【设置指引牌】，为「是」和「否」各选一条路，并作出预测。' };
    }
    if (s.phase === 'arrived') return { goal: 'verify', text: '已到对岸，点【对岸核验】检查本次指引。' };
    if (s.ticket.output === 'bridge') return { goal: 'bridge', text: '指引让你走天桥：点【天桥入口】走过去。' };
    if (s.signal !== 'green') return { goal: 'signal', text: '指引让你走斑马线，但现在是红灯：先点【信号控制箱】切绿灯。' };
    return { goal: 'zebra', text: '指引让你走斑马线：点【斑马线入口】走过去。' };
  }

  if (station === 'minimum') {
    const got = s.collected || [];
    if (got.length < 2) {
      return {
        goal: got.includes('a') ? 'b' : 'a',
        text: got.length ? '再去另一处采集台，把两组电量都读下来。' : '分别到电池A、电池B采集台，读取两组电量。',
      };
    }
    if (!s.ticket) {
      return visited.includes('verified')
        ? { goal: 'guide', text: '回能源工程师处领取另一组样本，检验另一种大小关系。' }
        : { goal: 'control', text: '到【电量分配台】设定判断条件与两个出口，并作出预测。' };
    }
    if (s.phase === 'charging') return { goal: 'verify', text: '把选出的电池带到充电口，核对是不是低电量优先。' };
    const pick = Number(s.ticket.output) === input.a ? 'a' : 'b';
    return { goal: pick, text: `装置选了${pick === 'a' ? '电池A' : '电池B'}，去对应出口取样。` };
  }

  // sale / repair：读数据 → 预测 → 执行 → 核验
  if (!s.measured) return { goal: 'sensor', text: `到【温度探头】读取${s.temperatureCase ?? 30}℃的试运行数据。` };
  /* 2026-11-03：温室测一个温度就够。这次对了就回负责人汇报，不必再跑下一个温度。 */
  if (!s.ticket && s.lastCorrect === true) return { goal: 'guide', text: '这次结果符合约定，回负责人汇报验收。' };
  if (!s.ticket && s.lastCorrect === false) return { goal: 'control', text: '这次结果和约定不符，回【控制柜】改一处再测。' };
  const notDiagnosed = station === 'repair' && !visited.includes('diagnosed');
  if (notDiagnosed) {
    if (s.ticket) return { goal: 'verify', text: '设备已执行，到【监测屏核验】看它错在哪。' };
    if (!prediction) return { goal: 'control', text: '到【故障控制柜】先猜一猜：这台旧设备这次会怎样？' };
    return { goal: 'fan', text: '预测记下了，去【执行风机】用 30℃ 执行一次，看它错在哪。' };
  }
  if (!s.ticket) {
    if (!prediction) {
      return station === 'repair'
        ? { goal: 'control', text: '回【故障控制柜】把接反的出口改对，再作出预测。' }
        : { goal: 'control', text: '在【控制柜】设定判断条件与两个出口，并作出预测。' };
    }
    return { goal: 'fan', text: '规则和预测都设好了，去【执行风机】执行。' };
  }
  return { goal: 'verify', text: '设备已执行，到【监测屏核验】看结果。' };
}
