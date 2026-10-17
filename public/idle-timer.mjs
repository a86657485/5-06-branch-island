/** 停顿加强：地图步骤 20 秒，思考面板 40 秒，最多两次。暂停期间不累计。 */

export function createIdleTimer({ stepMs = 20000, thinkMs = 40000, now = () => Date.now(), onStrength = () => {} } = {}) {
  let stepKey = '';
  let thinking = false;
  let paused = false;
  let accumulated = 0;
  let last = now();
  let strength = 0;
  let reported = 0;

  function threshold() { return thinking ? thinkMs : stepMs; }

  function tick() {
    const time = now();
    const delta = Math.max(0, time - last);
    last = time;
    if (paused || !stepKey) return strength;
    accumulated += delta;
    const limit = threshold();
    let next = 0;
    if (accumulated >= limit * 2) next = 2;
    else if (accumulated >= limit) next = 1;
    if (next > strength) {
      strength = next;
      if (strength > reported) {
        reported = strength;
        onStrength({ strength, stepKey, idleMs: accumulated, thinking });
      }
    }
    return strength;
  }

  return {
    tick,
    strength: () => strength,
    configure({ key, thinking: isThinking, paused: isPaused }) {
      if (key !== stepKey) {
        stepKey = key || '';
        accumulated = 0;
        strength = 0;
        reported = 0;
        last = now();
      }
      thinking = !!isThinking;
      if (isPaused !== undefined) paused = !!isPaused;
    },
    setPaused(value) { paused = !!value; if (!paused) last = now(); },
    reset() { accumulated = 0; strength = 0; reported = 0; last = now(); },
    snapshot() { return { stepKey, thinking, paused, accumulated, strength }; }
  };
}
