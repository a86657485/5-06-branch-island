/** 主线积分和储能柜选做加分分开。旧存档把 25 分并进总分时，显示时拆出来。 */

export function scoreboard(state = {}) {
  const completed = !!state.levels?.minimum?.completed;
  const levelBonus = completed ? (Number(state.levels.minimum.points) || 25) : 0;
  const recorded = state.bonusPoints == null || !Number.isFinite(Number(state.bonusPoints)) ? null : Number(state.bonusPoints);
  const bonus = completed ? (recorded ?? levelBonus) : 0;
  let main = Number(state.points) || 0;
  if (recorded == null && levelBonus && main >= levelBonus) main -= levelBonus;
  return { main, bonus };
}

export function pointsLabel(state) {
  const { main, bonus } = scoreboard(state);
  return bonus ? `${main} 积分 · 选做加分 ${bonus}` : `${main} 积分`;
}
