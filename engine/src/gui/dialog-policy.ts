/** 关闭对话只结束这一次询问，不写完成或证据。换图、Esc、返回现场都一样。 */

export const DIALOG_DISMISS_EVENTS = ['lesson-map-changed', 'lesson-level-changed'] as const;

export function dialogCloseValue(_signal: 'escape' | 'return' | 'map' | 'level' | 'choice-missing' = 'return') {
  return null;
}

export function dialogCloseWritesEvidence() {
  return false;
}

/** 预测选项沿用当前程序的提示；领取任务等对话使用现场引导。 */
export function dialogTaskStep(ids: string[], temperature?: number, speaker?: string) {
  if (speaker === '验收负责人') return { phase: 'reason' };
  if (speaker === '人行信号灯') return { phase: 'world', key: 'signal' };
  const outputs = [['on', 'off'], ['bridge', 'crossing'], ['a', 'b']];
  if (ids.length === 2 && outputs.some(pair => pair.every(id => ids.includes(id)))) {
    return { phase: 'predict', ...([29, 30, 31].includes(temperature || 0) ? { temperature } : {}) };
  }
  return { phase: 'world', key: 'guide' };
}
