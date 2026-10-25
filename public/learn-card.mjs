/** 教材局部图配先学短讲；学习导航不写答案、积分或通关。 */
const file = '第6课 判断选择用分支.pdf';
const images = {
 branch: { src: '/assets/textbook/branch-choice.png', alt: '教材按身高选择票价的判断与是、否两条路径', page: '教材第37页', source: { file, splitPage: 3, printedPage: 37, crop: [122,199,355,420], description: '学生区购票流程图局部；不含右侧教参栏。' } },
 road: { src: '/assets/textbook/road-condition.png', alt: '教材过街图菱形内的判断语句局部', page: '教材第38页', source: { file, splitPage: 4, printedPage: 38, crop: [207,328,292,361], description: '学生区菱形判断语句局部；不含完整出口动作，不含右侧教参栏。' } },
 compare: { src: '/assets/textbook/compare-two-inputs.png', alt: '教材两个不同自然数的输入与待补全分支图', page: '教材第39页', source: { file, splitPage: 5, printedPage: 39, crop: [119,190,337,424], description: '学生区留空的两数比较图；不含右侧教参答案。' } }
};
const cards = {
 sale: { title: '先看懂判断，再帮小苗', purpose: '帮阿绿，让风机学会看温度。', image: images.branch, lines: ['教材按身高选票价，这里改用温度。','菱形里是一句能回答是或否的判断。','成立走“是”，不成立走“否”。','一次只做一路，最后再汇合。'] },
 repair: { title: '先看故障，再动手修', purpose: '帮老修找到不符的地方。', image: images.branch, lines: ['先跑旧程序，找到不符的那次。','判断为真叫成立，为假叫不成立。','换了判断，要检查两边动作是否配合。','改完再测，旧记录不能替新程序作证。'] },
 cross: { title: '看清现场，再选一路', purpose: '帮小巡把导行屏调正确。', image: images.road, lines: ['先观察现场，再让程序判断。','成立和不成立，都要有行动。','一次只选一路，不能两路都做。','现场变了，要重新观察再检验。'] },
 minimum: { title: '先比较，再选电池', purpose: '帮小电比较两块电池的电量。', image: images.compare, lines: ['输入两个不同的数，先比较再选择。','“是”和“否”连到各自的动作。','换一组大小关系，也要再试一试。','充电怎样安排，要看本次任务约定。'] }
};
export function learnCard(levelId) {
 if (!Object.hasOwn(cards,levelId)) throw new Error('找不到这个探究站点');
 return structuredClone({...cards[levelId],duration:'约30—45秒'});
}
