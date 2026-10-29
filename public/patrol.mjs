/** 巡检主线：固定 S1→S2→S3。跳过剧情只记叙事，不写学习达成。 */

export const ROUTE = ['sale', 'repair', 'cross'];

export const STATIONS = [
  { id: 'sale', code: 'S1', title: '温室风机', required: true },
  { id: 'repair', code: 'S2', title: '控制器返修', required: true },
  { id: 'cross', code: 'S3', title: '路口导行屏', required: true },
  { id: 'minimum', code: 'E1', title: '储能柜（选做）', required: false }
];

export const STORIES = {
  brief: {
    npc: '调度员阿派',
    image: '/assets/story/ill-brief.png',
    lines: ['今天园区试运行自动设备。', '阿绿和路口小巡都在等你帮忙。', '你是巡检员，要查清问题再交付。', '先去温室，听听阿绿遇到了什么事。']
  },
  sale: {
    opening: {
      npc: '园艺员阿绿',
      image: '/assets/story/ill-wilt.png',
      lines: ['温室新装了风机，还没设自动开关。', '阿绿要照料小苗，没法一直守着。', '告示说达到30℃就开，低于就关。', '同一台风机，怎样自己选对动作？', '请先读温度，再替风机配好规则。', '试完29、30、31℃，再来报结果。']
    },
    result_ok: {
      npc: '园艺员阿绿',
      image: '/assets/story/ill-cool.png',
      lines: ['29、30、31℃都符合告示。', '老修的备用板还等着你验收。']
    },
    result_fail: {
      npc: '园艺员阿绿',
      image: '/assets/story/ill-wilt.png',
      lines: ['这次风机的动作与告示不符。', '回控制柜改一处，再用现场温度试试。']
    }
  },
  repair: {
    opening: {
      npc: '维修员老修',
      image: '/assets/story/ill-fault.png',
      lines: ['老修刚换上备用控制板。', '温度到了30℃，风机却停了。', '同一告示没变，程序却换过一处。', '要查哪里出了错，先留下现场。', '先别改板，照旧程序运行一次。', '留下故障后再修，三个温度都重测。']
    },
    result_ok: {
      npc: '维修员老修',
      image: '/assets/story/ill-cool.png',
      lines: ['旧故障已留下，修后也都重验通过。', '小巡在路口等你帮忙。']
    },
    result_fail: {
      npc: '维修员老修',
      image: '/assets/story/ill-fault.png',
      lines: ['这次动作还没有全部符合告示。', '看看是哪种温度走错了出口，再修改和重测。']
    }
  },
  cross: {
    opening: {
      npc: '巡检员小巡',
      image: '/assets/story/ill-queue.png',
      lines: ['游客在路口停住，不知该往哪边走。', '小巡请你重新设置导行屏。', '有可用天桥就走桥，没有就去人行横道。', '指路前，屏幕得先知道什么？', '请先观察设施，再替导行屏配规则。', '有桥、没桥都走到对岸，才算验收。']
    },
    result_ok: {
      npc: '巡检员小巡',
      image: '/assets/story/ill-cross-ok.png',
      lines: ['两种现场都走到对岸，验收通过。', '三站完成，可以进入基础检测。']
    },
    result_fail: {
      npc: '巡检员小巡',
      image: '/assets/story/ill-queue.png',
      lines: ['刚才选择的路线还不符合现场约定。', '先看这里有没有可用设施，再修改导行屏。']
    }
  },
  minimum: {
    opening: {
      npc: '储能柜小电',
      image: '/assets/story/ill-energy.png',
      lines: ['两块电池排队，优先充电口只有一个。', '小电担心电量更少的那块等太久。', '这次约定：谁剩得少，就先充谁。', '换一组电池，还能选对吗？', '先读两块电量，再让控制柜作选择。', '换一组也要测，想离开随时可走。']
    },
    result_ok: {
      npc: '储能柜小电',
      image: '/assets/story/ill-energy.png',
      lines: ['两组都选中低电量电池，验收通过。', '选做完成，可以回基础检测。']
    },
    result_fail: {
      npc: '储能柜小电',
      image: '/assets/story/ill-energy.png',
      lines: ['再比一比，谁的电量更低。']
    }
  }
};

export function createPatrol() {
  return { briefSeen: false, seen: {}, skipped: [] };
}

export function storyKey(levelId, beat) {
  return beat === 'brief' || levelId === 'brief' ? 'brief' : `${levelId}:${beat}`;
}

export function markStory(patrol, key, skipped) {
  const current = patrol || createPatrol();
  const skippedList = Array.isArray(current.skipped) ? current.skipped : [];
  return {
    briefSeen: !!current.briefSeen || key === 'brief',
    seen: { ...(current.seen || {}), [key]: true },
    skipped: skipped ? [...new Set([...skippedList, key])] : [...skippedList]
  };
}

/** 跳过或看完剧情都不算完成学习任务。 */
export function storyChangesLearning() {
  return false;
}

export function stationUnlocked(id, levels, demo = false) {
  if (demo || id === 'minimum' || id === 'quiz') return true;
  const index = ROUTE.indexOf(id);
  if (index < 0) return false;
  if (index === 0) return true;
  return !!levels?.[ROUTE[index - 1]]?.completed;
}

export function storyScript(levelId, beat) {
  if (beat === 'brief' || levelId === 'brief') return STORIES.brief;
  return STORIES[levelId]?.[beat] || null;
}
