/** 按需查阅的巡检手册；教材局部图配方法，不写本站完整方案。 */
const file = '第6课 判断选择用分支.pdf';
const images = {
 branch: { src: '/assets/textbook/branch-choice.png', alt: '教材按身高选择票价的判断与是、否两条路径', page: '教材第37页', source: { file, splitPage: 3, printedPage: 37, crop: [122,199,355,420], description: '学生区购票流程图局部；不含右侧教参栏。' } },
 road: { src: '/assets/textbook/road-condition.png', alt: '教材过街图菱形内的判断语句局部', page: '教材第38页', source: { file, splitPage: 4, printedPage: 38, crop: [207,328,292,361], description: '学生区菱形判断语句局部；不含完整出口动作，不含右侧教参栏。' } },
 compare: { src: '/assets/textbook/compare-two-inputs.png', alt: '教材两个不同自然数的输入与待补全分支图', page: '教材第39页', source: { file, splitPage: 5, printedPage: 39, crop: [119,190,337,424], description: '学生区留空的两数比较图；不含右侧教参答案。' } }
};
const cards = {
 sale: { title: '巡检手册·判断和路径', purpose: '需要时，查判断怎样连接行动。', image: images.branch, lines: ['先说清现场规则，再画流程图。','菱形里写能回答是或否的判断。','成立走“是”，不成立走“否”。','用不同输入，检查两路的动作。'] },
 repair: { title: '巡检手册·查错与重验', purpose: '需要时，查怎样用记录定位问题。', image: images.branch, lines: ['先跑旧程序，留下不符的记录。','判断与两个出口的动作要配合。','改完再测，旧记录不能替新程序作证。','用两侧与相等的输入检查修改。'] },
 cross: { title: '巡检手册·观察与选择', purpose: '需要时，查现场信息怎样进入判断。', image: images.road, lines: ['先观察现场，再说清判断条件。','成立和不成立，都要连到行动。','一次判断，只走选中的一路。','现场变了，要重新观察再检验。'] },
 minimum: { title: '巡检手册·比较两个数', purpose: '需要时，查两个输入怎样比较。', image: images.compare, lines: ['输入两个不同的数，先比较再选择。','“是”和“否”连到各自的动作。','换一组大小关系，也要再试一试。','输出哪一个，要看本次任务约定。'] }
};
export function learnCard(levelId) {
 if (!Object.hasOwn(cards,levelId)) throw new Error('找不到这个探究站点');
 return structuredClone({...cards[levelId],duration:'约30—45秒'});
}
