/** 站在目标旁一格，面向目标，并躲开旁边的其他事件。 */

export type ApproachPoint = { x: number; y: number };
export type Approach = ApproachPoint & { direction: 'up' | 'down' | 'left' | 'right' };

export function standBeside(target: ApproachPoint, from: ApproachPoint, others: ApproachPoint[] = [], tile = 32, clearance = 40): Approach {
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
