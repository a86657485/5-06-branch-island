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
    image: '/assets/story/ill-brief.svg',
    lines: ['今天你是园区巡检员。', '路线：温室→返修→路口。', '打开巡检单，从第一站开始！']
  },
  sale: {
    opening: {
      npc: '园艺员阿绿',
      image: '/assets/story/ill-wilt.svg',
      lines: ['温室好热！菜苗都蔫了！', '风机不会自己判断，得靠你。', '告示写着：≥30℃就开风机。', '请补流程图，再测 29/30/31。', '设备怎样‘看情况’决定这一次做哪件事？']
    },
    result_ok: {
      npc: '园艺员阿绿',
      image: '/assets/story/ill-cool.svg',
      lines: ['凉下来了！苗抬起头啦！', '分支就是看条件，只走一条。']
    },
    result_fail: {
      npc: '园艺员阿绿',
      image: '/assets/story/ill-wilt.svg',
      lines: ['还是好热……再检查出口吧。']
    }
  },
  repair: {
    opening: {
      npc: '维修员老修',
      image: '/assets/story/ill-fault.svg',
      lines: ['有人改过控制器，风机又乱了。', '我不能告诉你错在哪。', '先跑 30℃，亲眼看故障。', '找出条件与出口是否配合。']
    },
    result_ok: {
      npc: '维修员老修',
      image: '/assets/story/ill-cool.svg',
      lines: ['修好了！条件改了出口要跟着。', '下一站：路口导行屏。']
    },
    result_fail: {
      npc: '维修员老修',
      image: '/assets/story/ill-fault.svg',
      lines: ['30℃还是不开……再改改。']
    }
  },
  cross: {
    opening: {
      npc: '巡检员小巡',
      image: '/assets/story/ill-queue.svg',
      lines: ['导行屏坏了，游客在排队！', '有没有天桥，走法不一样。', '这回图要你自己画。', '补全分支，两种状态都要走通。']
    },
    result_ok: {
      npc: '巡检员小巡',
      image: '/assets/story/ill-cross-ok.svg',
      lines: ['游客安全过街了，辛苦啦！', '三站巡检完成，可以开考了。']
    },
    result_fail: {
      npc: '巡检员小巡',
      image: '/assets/story/ill-queue.svg',
      lines: ['这条路走不通，回头改图吧。']
    }
  },
  minimum: {
    opening: {
      npc: '储能柜小电',
      image: '/assets/story/ill-energy.svg',
      lines: ['两块电池，谁电量低充谁？', '选做哦，做完随时可走。']
    },
    result_ok: {
      npc: '储能柜小电',
      image: '/assets/story/ill-energy.svg',
      lines: ['充对了！加分记上啦。']
    },
    result_fail: {
      npc: '储能柜小电',
      image: '/assets/story/ill-energy.svg',
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
