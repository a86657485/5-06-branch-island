/** 温室一张图上的巡检角色。S1 与 S2 共用坐标，外观按当前站决定。 */

export const GREENHOUSE_ACTORS = [
  { id: 'guide', x: 575, y: 395, graphic: 'gardener', label: '园艺员阿绿' },
  { id: 'sensor', x: 358, y: 398, graphic: 'sensor', label: '温度探头' },
  { id: 'control', x: 185, y: 515, graphic: 'control', label: '规则控制柜' },
  { id: 'fan', x: 415, y: 585, graphic: 'fan-off', label: '通风风机' },
  { id: 'verify', x: 715, y: 565, graphic: 'monitor', label: '现场核验仪' },
  { id: 'portal', x: 925, y: 520, graphic: 'portal', label: '下一站' }
] as const;

export function actorIdOf(eventId: string) {
  return String(eventId || '').split('::')[0];
}

export function planGreenhouseSync(existing: Array<{ id?: string, x?: number, y?: number }>, levelId: string, deviceOn = false) {
  const repair = levelId === 'repair';
  return GREENHOUSE_ACTORS.map(actor => {
    const found = existing.find(event => actorIdOf(event.id || '') === actor.id);
    const graphic = actor.id === 'guide' ? (repair ? 'mechanic' : 'gardener') : actor.id === 'fan' ? (deviceOn ? 'fan-on' : 'fan-off') : actor.graphic;
    const label = actor.id === 'guide' ? (repair ? '维修员老修' : '园艺员阿绿') : actor.label;
    const dx = (found?.x ?? actor.x) - actor.x;
    const dy = (found?.y ?? actor.y) - actor.y;
    return { id: actor.id, x: actor.x, y: actor.y, graphic, label, create: !found, move: !!found && Math.hypot(dx, dy) > 4 };
  });
}
