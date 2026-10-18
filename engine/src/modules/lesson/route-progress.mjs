/** 两种设施都有一次走通且正确的核验。 */
export function bothRoadsVerified(runs, evidenceStart = 0) {
  const windowed = (Array.isArray(runs) ? runs : []).slice(Math.max(0, evidenceStart || 0));
  const passed = facility => windowed.some(run => run?.input?.facility === facility && run.correct === true && (run.scene?.outcome === 'arrived' || run.outcome === 'arrived'));
  return passed(true) && passed(false);
}

/** 封闭现场却选了天桥：入口受阻，并记一次错误。 */
export function closedBridgeSelected(output, facility) {
  return output === 'bridge' && !facility;
}

/** Stage 3 is the walked corridor. checkRoute stores that as the `route` action. */
export function routeMark(stage) {
  return stage === 3 ? 'route' : '';
}

/** Track actual movement through one selected west-to-east road corridor. */
export function advanceRoute(previous, position, route, key) {
  const progress = previous?.key === key && previous.route === route
    ? { ...previous }
    : { key, route, stage: 0 };
  const { x, y } = position;
  if (progress.last && Math.hypot(x - progress.last.x, y - progress.last.y) > 96) progress.stage = 0;
  progress.last = { x, y };
  const inCorridor = route === 'bridge' ? y >= 288 && y <= 392 : y >= 608 && y <= 744;
  if (!inCorridor) {
    progress.stage = 0;
    return progress;
  }
  if (x >= 430 && x <= 580) progress.stage = Math.max(progress.stage, 1);
  if (progress.stage === 1 && x >= 700 && x <= 860) progress.stage = 2;
  if (progress.stage === 2 && x >= 1024 && x <= 1180) progress.stage = 3;
  return progress;
}
