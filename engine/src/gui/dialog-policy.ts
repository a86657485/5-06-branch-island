/** 关闭对话只结束这一次询问，不写完成或证据。换图、Esc、返回现场都一样。 */

export const DIALOG_DISMISS_EVENTS = ['lesson-map-changed', 'lesson-level-changed'] as const;

export function dialogCloseValue(_signal: 'escape' | 'return' | 'map' | 'level' | 'choice-missing' = 'return') {
  return null;
}

export function dialogCloseWritesEvidence() {
  return false;
}
