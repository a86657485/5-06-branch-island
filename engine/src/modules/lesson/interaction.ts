/** Only events in this room and visible to this player can receive a manual action. */
export function nearestInteraction(player: any, map = player.getCurrentMap?.(), range = 48) {
  if (!map?.getEvents) return undefined;
  let nearest: any;
  let distance = range;
  for (const event of map.getEvents()) {
    if (typeof event.execMethod !== 'function' || map.isEventVisibleForPlayer?.(event, player) === false) continue;
    const d = Math.hypot(event.x() - player.x(), event.y() - player.y());
    if (d <= distance) { nearest = event; distance = d; }
  }
  return nearest ? { event: nearest, distance } : undefined;
}

export function interactionLabel(event: any, levelId: string) {
  const id = String(event.id || '').split('::')[0];
  const people: Record<string, string> = { guide: levelId === 'repair' ? '老修' : '阿绿', 'road-guide': '小巡', 'road-guide-east': '小巡', 'energy-guide': '小电', 'road-visitor': '游客' };
  if (people[id]) return `交谈·${people[id]}`;
  const devices: Record<string, string> = { sensor: '探头', control: '控制柜', fan: '风机', verify: '核验仪', portal: '下一站' };
  const name = typeof event.name === 'function' ? event.name() : event.name;
  return `操作·${devices[id] || name || '现场设备'}`;
}
