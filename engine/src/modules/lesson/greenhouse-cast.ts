/** 温室一张图上的巡检角色。S1 与 S2 共用坐标，外观按当前站决定。 */

export const GREENHOUSE_ACTORS = [
  { id: 'guide', x: 460, y: 445, graphic: 'gardener', label: '园艺员阿绿' },
  { id: 'sensor', x: 375, y: 425, graphic: 'sensor', label: '温度探头' },
  { id: 'control', x: 330, y: 490, graphic: 'control', label: '规则控制柜' },
  { id: 'fan', x: 270, y: 470, graphic: 'fan-off', label: '通风风机' },
  { id: 'verify', x: 465, y: 500, graphic: 'monitor', label: '现场核验仪' },
  { id: 'portal', x: 605, y: 535, graphic: 'portal', label: '下一站' }
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
