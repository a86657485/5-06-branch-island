/** 成绩按这一层的实际题数换算，不把每题固定成 5 分。 */

export function attemptPercent(attempt) {
  if (!attempt || !Number.isFinite(attempt.score)) return null;
  const total = Number.isInteger(attempt.total) && attempt.total > 0 ? attempt.total : (Array.isArray(attempt.details) ? attempt.details.length : 0);
  if (!total) return null;
  return Math.round(attempt.score / total * 100);
}

export function formatAnswer(question) {
  const answer = question?.answer;
  const options = Array.isArray(question?.options) ? question.options : [];
  if (Number.isInteger(answer)) {
    const letter = 'ABCD'[answer] || String(answer + 1);
    return `${letter}：${options[answer] ?? ''}`;
  }
  if (Array.isArray(answer)) return answer.map(index => options[index] ?? String(index)).join(' → ');
  if (answer && typeof answer === 'object') {
    return Object.entries(answer).map(([slot, index]) => `${slot}＝${typeof index === 'number' ? (options[index] ?? index) : index}`).join('；');
  }
  return '见题目说明';
}
