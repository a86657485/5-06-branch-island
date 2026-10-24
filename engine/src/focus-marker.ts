type FocusTarget = { x?: number, y?: number, place?: string };

/** RPGJS places these 72×104 frames at the top-left of a 24×24 foot hitbox.
 * Its frame anchor is (24, 80); the atlas has 5px of clear space below NPC feet.
 * Keep this visual offset out of the task/navigation coordinates.
 */
export function focusFootprint(target: FocusTarget) {
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) return null;
  const person = target.place === 'guide';
  const radiusX = person ? 44 : 36;
  return {
    x: target.x! + 12,
    y: target.y! + (person ? 18 : 21),
    radiusX,
    radiusY: radiusX * 0.32,
    halfWidth: person ? 27 : 35
  };
}
