/** 把面板数据收成可 postMessage 的普通对象。Vue 代理过不了结构化克隆。 */

export function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
