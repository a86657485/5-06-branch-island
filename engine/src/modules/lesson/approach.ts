/** 站到目标身上一点，面向目标。16 像素比身位窄，互动框才碰得到 24 像素的人或设备。 */

export type ApproachPoint = { x: number; y: number };
export type Approach = ApproachPoint & { direction: 'up' | 'down' | 'left' | 'right' };

export function standBeside(target: ApproachPoint, from: ApproachPoint, others: ApproachPoint[] = [], tile = 16, clearance = 40): Approach {
  const sides: Approach[] = [
    { x: target.x + tile, y: target.y, direction: 'left' },
    { x: target.x - tile, y: target.y, direction: 'right' },
    { x: target.x, y: target.y - tile, direction: 'down' },
    { x: target.x, y: target.y + tile, direction: 'up' }
  ];
  const clear = sides.filter(side => others.every(other => Math.hypot(side.x - other.x, side.y - other.y) >= clearance));
  const pool = clear.length ? clear : sides;
  return pool.slice().sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))[0];
}
