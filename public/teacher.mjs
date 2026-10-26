import './adventure-rules.js';
import { attemptPercent, formatAnswer } from './teacher-format.mjs';
import { pointsLabel, scoreboard } from './scoreboard.mjs';

const adventure = window.AdventureRules;
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const IDS = ['sale', 'repair', 'cross', 'minimum'];
const TITLES = { sale: '温室风机调试', repair: '温室控制器返修', cross: '路口导行屏调试', minimum: '储能柜配电' };
const BRIEF = { sale: '温室风机', repair: '控制器返修', cross: '路口导行', minimum: '储能配电' };
const SHORT = { sale: 'S1', repair: 'S2', cross: 'S3', minimum: '选做' };
const reasonLabels = { boundary: '比较两侧与恰好边界', swap: '条件改向后出口也对应调整', symbol: '只改判断方向', one: '只执行条件选中的一条路径', compare: '比较两个数并选择较小数' };

let data = null;        // 当前班级接口数据（测试可直接注入）
let expanded = '';      // 展开证据的学生 id

const state = {
  classId: '501',
  solutions: null,
  built: false,
  classes: [],
  classesAt: 0,
  filters: {
    search: '', entered: 'all', passed: 'all', quiz: 'all', base: 'all', sync: 'all',
    pointsMin: '', pointsMax: '',
    sale: 'all', repair: 'all', cross: 'all', minimum: 'all',
  },
  sort: { key: 'name', dir: 1 },
};

/* ---------- 小工具 ---------- */
const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

function bar(label, n, total, kind = '') {
  const width = total ? Math.min(100, (n / total) * 100) : 0;
  return `<div class="bar-row"><span>${esc(label)}</span><div class="bar-track" role="img" aria-label="${esc(label)}：${n}/${total}"><div class="bar-fill ${kind}" style="width:${width}%"></div></div><b>${n}<small>/${total}</small></b></div>`;
}

function donut(value, total, label) {
  const r = 26, c = 2 * Math.PI * r, ratio = total ? Math.min(1, value / total) : 0;
  return `<div class="donut" role="img" aria-label="${esc(label)}：${value}/${total}">
    <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
      <circle cx="32" cy="32" r="${r}" fill="none" stroke="#e3ebf2" stroke-width="9"/>
      <circle cx="32" cy="32" r="${r}" fill="none" stroke="#147d78" stroke-width="9" stroke-linecap="round"
              stroke-dasharray="${(c * ratio).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 32 32)"/>
      <text x="32" y="37" text-anchor="middle" font-size="15" font-weight="700" fill="#183c30">${pct(value, total)}%</text>
    </svg><span>${esc(label)}</span></div>`;
}

function stationCells(student) {
  const levels = student.state.levels || {};
  return `<div class="station-dots">${IDS.map(id => {
    const level = levels[id] || {};
    const cls = level.valid ? 'valid' : level.completed ? 'done' : '';
    return `<i class="${cls}" title="${esc(TITLES[id])}：${level.valid ? '当前已验证' : level.completed ? '曾完成待重验' : '未完成'}">${esc(SHORT[id])}</i>`;
  }).join('')}</div>`;
}

/* ---------- 数据 ---------- */
async function get(path) {
  const response = await fetch(path, { signal: AbortSignal.timeout(8000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || body.message || '读取未完成');
  return body;
}

function pointsOf(student) {
  const { main, bonus } = scoreboard(student.state);
  return main + bonus;
}

function examText(student) {
  const st = student.state;
  if (!student.entered) return '尚未进入';
  const opened = !!(st.quizOpenedAt || st.exam?.openedAt);
  if (!opened) return '未完成三站、未开考';
  if (data.examClosedAt) return '考核已关闭';
  const base = st.quiz?.base;
  if (!base?.first) return '考核已开放';
  return base.passed ? '基础层达标' : `基础层未达标 ${base.firstScore}/${base.first.total}`;
}

function passedThree(student) {
  const levels = student.state.levels || {};
  return ['sale', 'repair', 'cross'].every(id => levels[id]?.valid);
}

function hasAttempts(student) {
  return (student.state.attempts || []).length > 0;
}

function stationMatch(student, id, mode) {
  if (mode === 'all') return true;
  const level = (student.state.levels || {})[id] || {};
  if (mode === 'done') return !!level.completed;
  if (mode === 'valid') return !!level.valid;
  if (mode === 'todo') return !level.completed;
  return true;
}

function syncMatch(student, mode) {
  if (mode === 'all') return true;
  if (!student.lastSync) return mode === 'never';
  const at = new Date(student.lastSync).getTime();
  if (mode === 'hour') return Date.now() - at < 3600 * 1000;
  if (mode === 'today') return new Date(student.lastSync).toDateString() === new Date().toDateString();
  return true;
}

function matches(student) {
  const f = state.filters;
  if (f.search && !student.name.includes(f.search) && !student.id.includes(f.search)) return false;
  if (f.entered === 'yes' && !student.entered) return false;
  if (f.entered === 'no' && student.entered) return false;
  if (f.passed === 'yes' && !passedThree(student)) return false;
  if (f.passed === 'no' && passedThree(student)) return false;
  const attempts = hasAttempts(student);
  if (f.quiz === 'some' && !attempts) return false;
  if (f.quiz === 'none' && attempts) return false;
  const base = student.state.quiz?.base;
  if (f.base === 'pass' && !base?.passed) return false;
  if (f.base === 'fail' && (!attempts || base?.passed)) return false;
  if (!syncMatch(student, f.sync)) return false;
  const points = pointsOf(student);
  if (f.pointsMin !== '' && points < Number(f.pointsMin)) return false;
  if (f.pointsMax !== '' && points > Number(f.pointsMax)) return false;
  return IDS.every(id => stationMatch(student, id, f[id]));
}

const SORTERS = {
  name: student => student.name,
  status: student => examText(student),
  stations: student => IDS.filter(id => student.state.levels?.[id]?.completed).length,
  points: student => pointsOf(student),
  base: student => attemptPercent(student.state.quiz?.base?.first) ?? -1,
  challenge: student => attemptPercent(student.state.quiz?.challenge?.first) ?? -1,
  sync: student => (student.lastSync ? new Date(student.lastSync).getTime() : 0),
};

function visibleStudents() {
  const students = (data?.students || []).filter(matches);
  const sorter = SORTERS[state.sort.key] || SORTERS.name;
  return students.sort((a, b) => {
    const x = sorter(a), y = sorter(b);
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * state.sort.dir;
    return String(x).localeCompare(String(y), 'zh-Hans-CN') * state.sort.dir;
  });
}

/* ---------- 筛选栏 ---------- */
function chips() {
  const f = state.filters;
  const list = [];
  if (f.search) list.push(['姓名', f.search]);
  if (f.entered !== 'all') list.push(['进入', f.entered === 'yes' ? '已进入' : '未进入']);
  if (f.passed !== 'all') list.push(['三站', f.passed === 'yes' ? '已通过' : '未通过']);
  if (f.quiz !== 'all') list.push(['检测', f.quiz === 'some' ? '已提交' : '未提交']);
  if (f.base !== 'all') list.push(['基础层', f.base === 'pass' ? '达标' : '未达标']);
  if (f.sync !== 'all') list.push(['同步', { hour: '最近1小时', today: '今天', never: '从未' }[f.sync]]);
  if (f.pointsMin !== '' || f.pointsMax !== '') list.push(['积分', `${f.pointsMin || 0}–${f.pointsMax || '不限'}`]);
  IDS.forEach(id => {
    if (f[id] !== 'all') list.push([TITLES[id], { done: '已完成', valid: '当前有效', todo: '未完成' }[f[id]]]);
  });
  return list.map(([key, value]) => `<span class="chip">${esc(key)}：${esc(value)}</span>`).join('');
}

function filterBar() {
  const select = (id, label, options) => `<label>${esc(label)}<select id="f-${id}">${options.map(([value, text]) => `<option value="${value}" ${state.filters[id] === value ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
  return `<div class="filter-head"><h2>筛选（全部字段）</h2><span id="filter-count" class="muted"></span></div>
  <div class="filter-grid">
    <label>姓名或学号<input id="f-search" type="search" value="${esc(state.filters.search)}" placeholder="输入姓名或 501-001"></label>
    ${select('entered', '进入状态', [['all', '全部'], ['yes', '已进入'], ['no', '未进入']])}
    ${select('passed', '三站当前通过', [['all', '全部'], ['yes', '已通过'], ['no', '未通过']])}
    ${select('quiz', '检测提交', [['all', '全部'], ['some', '已提交'], ['none', '未提交']])}
    ${select('base', '基础层结果', [['all', '全部'], ['pass', '达标'], ['fail', '未达标']])}
    ${select('sync', '最近同步', [['all', '全部'], ['hour', '最近1小时'], ['today', '今天'], ['never', '从未']])}
    <label>积分下限<input id="f-points-min" type="number" min="0" step="5" value="${esc(state.filters.pointsMin)}" placeholder="不限"></label>
    <label>积分上限<input id="f-points-max" type="number" min="0" step="5" value="${esc(state.filters.pointsMax)}" placeholder="不限"></label>
    ${select('sale', 'S1 温室风机', [['all', '全部'], ['done', '已完成'], ['valid', '当前有效'], ['todo', '未完成']])}
    ${select('repair', 'S2 控制器返修', [['all', '全部'], ['done', '已完成'], ['valid', '当前有效'], ['todo', '未完成']])}
    ${select('cross', 'S3 路口导行', [['all', '全部'], ['done', '已完成'], ['valid', '当前有效'], ['todo', '未完成']])}
    ${select('minimum', '选做 储能配电', [['all', '全部'], ['done', '已完成'], ['valid', '当前有效'], ['todo', '未完成']])}
  </div>
  <div class="filter-actions"><button id="f-clear" class="quiet" type="button">清除筛选</button><div class="chips" id="f-chips">${chips()}</div></div>`;
}

function bindFilters() {
  const on = (id, key) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { state.filters[key] = el.value; refresh(); });
  };
  on('f-search', 'search');
  ['entered', 'passed', 'quiz', 'base', 'sync', 'sale', 'repair', 'cross', 'minimum'].forEach(key => on('f-' + key, key));
  on('f-points-min', 'pointsMin');
  on('f-points-max', 'pointsMax');
  $('#f-clear').onclick = () => {
    Object.assign(state.filters, { search: '', entered: 'all', passed: 'all', quiz: 'all', base: 'all', sync: 'all', pointsMin: '', pointsMax: '', sale: 'all', repair: 'all', cross: 'all', minimum: 'all' });
    $('#filter-bar').innerHTML = filterBar();
    bindFilters();
    refresh();
  };
}

/* ---------- 渲染 ---------- */
function shell() {
  $('#teacher').innerHTML = `<header class="topbar"><span class="brand">分支冒险岛<span>班级学习大屏</span></span>
      <div class="topbar-actions"><span id="sync-pill" class="sync-pill">读取中…</span><a href="/?demo=1" class="quiet">进入独立教师测试 →</a></div></header>
    <main class="teacher-main">
      <div class="teacher-toolbar"><h1>看见每一次判断</h1>
        <label>当前班级<select id="class"></select></label>
        <button id="refresh" class="primary">立即刷新</button>
        <button id="close-exam" class="quiet">按班关闭考核</button>
        <button id="new-lesson" class="quiet">开始新课次</button>
      </div>
      <p class="teacher-updated" id="updated"></p>
      <div id="teacher-error" role="status"></div>
      <details class="prior-sessions" id="prior"></details>
      <section class="stats" id="stats"></section>
      <section class="filter-bar" id="filter-bar"></section>
      <section class="teacher-grid" id="charts"></section>
      <section class="teacher-table">
        <div class="teacher-toolbar"><div><h2>学生明细与学习证据</h2><p class="chart-sub">筛选只影响下方明细与图表，班级总人数保持不变。点表头可排序。</p></div><span id="result-count" class="muted"></span></div>
        <div class="table-wrap"><table><thead><tr>
          <th data-sort="name" class="sortable">姓名</th>
          <th data-sort="status" class="sortable">考核状态</th>
          <th data-sort="stations" class="sortable">站点进度</th>
          <th data-sort="points" class="sortable">积分</th>
          <th data-sort="base" class="sortable">基础层</th>
          <th data-sort="challenge" class="sortable">挑战层</th>
          <th data-sort="sync" class="sortable">最近同步</th>
          <th>证据</th>
        </tr></thead><tbody id="rows"></tbody></table></div>
      </section>
      <details class="teacher-answers"><summary>查看教师参考操作与题目答案</summary><div id="solutions">点击展开后加载参考材料。</div></details>
    </main>`;
  state.built = true;
  $('#refresh').onclick = () => load();
  $('#class').onchange = event => { state.classId = event.target.value; expanded = ''; state.classesAt = 0; load(); };
  $('#close-exam').onclick = async () => {
    if (data.examClosedAt) return;
    if (!confirm(`关闭${state.classId}班考核后，这一班不能再交卷。`)) return;
    await fetch('/api/teacher/exam-close', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classId: state.classId }) });
    await load();
  };
  $('#new-lesson').onclick = async () => {
    if (!confirm(`开始${state.classId}班新课次后，学生重新登录会从零开始。上一课次的积分和作答留在历史里。`)) return;
    await fetch('/api/teacher/lesson-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classId: state.classId }) });
    await load();
  };
  $$('th[data-sort]').forEach(th => {
    th.onclick = () => {
      const key = th.dataset.sort;
      state.sort = state.sort.key === key ? { key, dir: -state.sort.dir } : { key, dir: key === 'name' ? 1 : -1 };
      refresh();
    };
  });
  $('.teacher-answers').ontoggle = async event => {
    if (!event.target.open) return;
    try {
      state.solutions ||= await get('/api/teacher/solutions');
      const s = state.solutions;
      $('#solutions').innerHTML = `<article><h2>四站参考操作</h2>
        <p>温室：本任务试运行规则“≥30°C”是启动/否关闭；或“＜30°C”是关闭/否启动。</p>
        <p>维修：先用30°C体验“≥30，是关闭/否启动”的错误设备，再交换出口，或把条件改回＜30且出口不变，重测29、30、31°C。</p>
        <p>安全通行：有设施→走设施；没有→到有信号灯人行横道按信号通行。</p>
        <p>配电：给定低电量优先规则，a＜b是a否b；a＞b是b否a。分别用3/8与9/2两组测试，并实际到充电口验证。</p>
        <p>每站还需对应的理由证据。开放解释应由教师结合实验进一步核对。</p></article>` +
        s.questions.map((q, i) => `<article><b>${i + 1}. ${esc(q.prompt)}</b><p>答案 ${esc(formatAnswer(q))}</p><p>${esc(q.explanation)}</p></article>`).join('');
    } catch (error) {
      $('#solutions').textContent = error.message;
    }
  };
  $('#filter-bar').innerHTML = filterBar();
  bindFilters();
}

function renderStats(visible) {
  const total = visible.length;
  const entered = visible.filter(v => v.entered).length;
  const passed = visible.filter(passedThree).length;
  const quiz = visible.filter(hasAttempts).length;
  const points = visible.reduce((sum, v) => sum + pointsOf(v), 0);
  const scope = total !== data.students.length ? `（全班 ${data.students.length} 人）` : '（全班）';
  $('#stats').innerHTML = `
    <div><strong>${total}</strong><span>当前筛选命中${scope}</span></div>
    <div class="stat-with-ring">${donut(entered, total, '进入率')}<div><strong>${entered}</strong><span>已进入</span></div></div>
    <div><strong>${passed}</strong><span>三站当前通过</span></div>
    <div><strong>${quiz}</strong><span>有检测证据</span></div>
    <div><strong>${points}</strong><span>累计积分</span></div>`;
}

function histogram(visible) {
  const buckets = [[0, 0, '0'], [1, 20, '1–20'], [21, 50, '21–50'], [51, 80, '51–80'], [81, 100, '81–100'], [101, Infinity, '100+']];
  const counts = buckets.map(([from, to]) => visible.filter(v => { const p = pointsOf(v); return p >= from && p <= to; }).length);
  const max = Math.max(1, ...counts);
  return `<section class="chart-card"><h2>积分分布</h2><p class="chart-sub">按当前筛选的 ${visible.length} 人统计；积分为主线加选做。</p>
    <div class="histogram">${buckets.map(([, , label], i) => `<div class="col"><b>${counts[i]}</b><div class="bar" style="height:${Math.round((counts[i] / max) * 118)}px"></div><span>${label}</span></div>`).join('')}</div></section>`;
}

function stationChart(visible) {
  const total = visible.length || 1;
  return `<section class="chart-card"><h2>各站完成与当前验证</h2>
    <p class="chart-sub">分母为当前筛选的 ${visible.length} 人；修改规则后当前验证可能失效，历史积分保留。</p>
    ${IDS.map(id => `${bar(BRIEF[id] + ' 完成', visible.filter(v => v.state.levels?.[id]?.completed).length, total)}${bar('　当前有效', visible.filter(v => v.state.levels?.[id]?.valid).length, total, 'first')}`).join('')}</section>`;
}

function quizChart(visible, data) {
  const withQuiz = visible.filter(hasAttempts);
  const avg = key => {
    const values = withQuiz.map(v => attemptPercent(key === 'first' ? (v.state.quiz?.base?.first || v.state.attempts[0]) : (v.state.quiz?.base?.latest || v.state.attempts.at(-1)))).filter(n => n != null);
    return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
  };
  const first = avg('first'), latest = avg('latest');
  const top = (data.summary.misconceptions || []).filter(v => v.incorrect > 0).sort((a, b) => b.incorrect - a.incorrect).slice(0, 3);
  return `<section class="chart-card"><h2>检测：首次与最近</h2>
    <p class="chart-sub">只对已提交检测的 ${withQuiz.length} 人计算，未答与未提交不记作 0 分。</p>
    ${first == null ? '<p class="muted">尚无检测证据</p>' : `${bar('首次平均正确率', first, 100, 'first')}${bar('最近平均正确率', latest ?? 0, 100)}`}
    <h2 style="margin-top:26px">需要当堂核对的卡点</h2>
    <ul class="misconceptions">${top.map(v => `<li>${esc(v.prompt)}：已交卷中答错 ${v.incorrect} 份</li>`).join('') || '<li>尚无错题汇总</li>'}</ul></section>`;
}

function classChart() {
  const list = state.classes;
  if (!list.length) return '';
  return `<section class="chart-card"><h2>各班对比</h2><p class="chart-sub">全部班级的进入与三站通过情况，每 60 秒刷新一次。</p>
    ${list.map(c => `<div class="class-row"><span class="class-name">${esc(c.id)}班</span>
      <div class="class-bars">
        <div class="class-bar" title="已进入 ${c.entered}/${c.total}"><i style="width:${pct(c.entered, c.total)}%"></i><em>进入 ${c.entered}</em></div>
        <div class="class-bar pass" title="三站通过 ${c.passed}/${c.total}"><i style="width:${pct(c.passed, c.total)}%"></i><em>通过 ${c.passed}</em></div>
      </div><b>${c.total}人</b></div>`).join('')}</section>`;
}

function renderCharts(visible) {
  $('#charts').innerHTML = stationChart(visible) + histogram(visible) + quizChart(visible, data) + classChart();
}

function rows(visible) {
  return visible.map(student => {
    const st = student.state;
    const first = st.quiz?.base?.first || (st.attempts || []).find(a => a.tier === 'base') || (st.attempts || [])[0];
    const challenge = st.quiz?.challenge;
    const open = expanded === student.id;
    return `<tr class="${open ? 'row-open' : ''}">
      <td><b>${esc(student.name)}</b><small class="row-id">${esc(student.id)}</small></td>
      <td>${esc(examText(student))}</td>
      <td>${stationCells(student)}</td>
      <td>${esc(pointsLabel(st))}</td>
      <td>${first ? `${first.score}/${first.total || ''}${st.quiz?.base?.passed ? ' 达标' : ' 未达标'}` : '尚无证据'}</td>
      <td>${challenge?.first ? `${challenge.first.score}/${challenge.first.total}` : (challenge?.closed ? '未作答' : '未提交')}</td>
      <td>${student.lastSync ? esc(new Date(student.lastSync).toLocaleTimeString('zh-CN')) : '—'}</td>
      <td><button data-student="${esc(student.id)}">${open ? '收起' : '展开'}</button></td>
    </tr>${open ? `<tr class="evidence-row"><td colspan="8">${evidence(student)}</td></tr>` : ''}`;
  }).join('') || '<tr><td colspan="8"><div class="empty-state">没有符合当前筛选的学生，试试清除部分条件。</div></td></tr>';
}

function renderRows(visible) {
  $('#rows').innerHTML = rows(visible);
  $$('[data-student]').forEach(button => {
    button.onclick = () => {
      expanded = expanded === button.dataset.student ? '' : button.dataset.student;
      refresh();
    };
  });
}

function scaffoldEvidence(st, id) {
  const scaffolds = (st.support?.scaffolds || []).filter(item => item.levelId === id && [1, 2, 3].includes(item.level));
  const highest = scaffolds.reduce((max, item) => Math.max(max, item.level), 0);
  return `<p class="muted">免费递进帮助：${scaffolds.length}次；最高级别：${highest ? `第${highest}级` : '尚无'}</p>${scaffolds.length ? `<details><summary>本站免费递进帮助 ${scaffolds.length} 次</summary>${scaffolds.map(item => `<article><p><b>第${item.level}级 · ${item.level === 1 ? '观察提醒' : '概念帮助'}</b></p>${(item.lines || []).map(line => `<p>${esc(line)}</p>`).join('')}<p class="muted">${item.at ? esc(new Date(item.at).toLocaleString('zh-CN')) : ''}</p></article>`).join('')}</details>` : ''}`;
}

function evidence(student) {
  const st = student.state;
  return `<div class="student-evidence">
    <p><b>通关法宝：本课已用 ${(st.support?.hints || []).length}/5 次</b>。各站共用；提示记录保留，撤回操作不会退回次数。</p>
    <p class="muted">免费递进帮助另行记录，不占全课5次法宝。第1级为观察提醒，第2、3级为概念帮助。</p>
    ${IDS.map(id => {
      const runs = st.runs?.[id] || [], level = st.levels?.[id], prediction = st.predictions?.[id]?.[0];
      const hints = (st.support?.hints || []).filter(hint => hint.levelId === id);
      return `<p><b>${TITLES[id]}</b> · ${runs.length}次运行 · ${runs.filter(r => !r.correct).length}次需修订 · ${level?.valid ? '当前已验证' : level?.completed ? '曾完成，当前待重验' : '尚未完成'}</p>
        <p class="muted">首次预测：${prediction ? esc(predictionLabel(prediction.value ?? prediction.payload?.value)) : '尚无证据'}；修改理由：${esc(reasonLabels[level?.reason] || '尚无证据')}；思路帮助：${esc(st.drafts?.[id]?.hint || 0)}级${level?.attemptKind === 'hinted' ? '；本次在提示下完成' : ''}</p>
        ${scaffoldEvidence(st, id)}
        ${hints.length ? `<details><summary>本站法宝提示 ${hints.length} 次</summary>${hints.map(hint => `<article><p><b>${esc(hint.action)}</b></p><p>为什么：${esc(hint.why)}</p><p class="muted">${hint.at ? esc(new Date(hint.at).toLocaleString('zh-CN')) : ''}</p></article>`).join('')}</details>` : ''}
        ${runs.length ? `<details><summary>看${TITLES[id]}的实际方案与运行</summary>${runs.map(r => `<article><p><b>${esc(adventure.evidenceSummary(id, r))}</b></p><p>输入 ${esc(JSON.stringify(r.input))}；规则 ${esc(JSON.stringify(r.config))}；走${r.branch === 'yes' ? '是' : '否'}；输出 ${esc(r.output)}；${r.correct ? '符合目标' : '需修订'}；${r.at ? esc(new Date(r.at).toLocaleString('zh-CN')) : ''}</p></article>`).join('')}</details>` : ''}`;
    }).join('')}
    <p>检测次数：${(st.attempts || []).length}。场景摘要由页面完成关键交互时记录；它与规则模型核对，不是服务端逐步验证人物行走。请结合课堂观察、口头解释与首次预测核对，句块理由或通关不能单独证明理解。</p>
  </div>`;
}

function predictionLabel(value) {
  return ({ on: '启动风机', off: '关闭风机', bridge: '设施路线', crossing: '信号灯人行横道', a: '电池a', b: '电池b', '5': '5元（旧版）', '10': '10元（旧版）' })[value] || value;
}

/* ---------- 刷新 ---------- */
function refresh() {
  if (!data) return;
  const visible = visibleStudents();
  renderStats(visible);
  renderCharts(visible);
  renderRows(visible);
  const total = data.students.length;
  $('#result-count').textContent = `显示 ${visible.length} / ${total} 人`;
  $('#f-chips').innerHTML = chips();
  const hint = $('#filter-count');
  if (hint) hint.textContent = `命中 ${visible.length} 人`;
  $('#updated').textContent = `每5秒自动更新 · 最近成功同步：${new Date(data.updatedAt).toLocaleString('zh-CN')} · 第${data.lessonRound || data.round}课次`;
  $('#close-exam').textContent = data.examClosedAt ? '本班考核已关闭' : '按班关闭考核';
  $('#sync-pill').textContent = `已连接 · ${visible.length} 人命中`;
  const prior = data.priorSessions || [];
  $('#prior').innerHTML = prior.length ? `<summary>以往课次（不计入本课统计）</summary>${prior.map(session => `<p>第${session.round}课次：${session.students.map(s => `${esc(s.name)} ${s.points}分`).join('，') || '无记录'}</p>`).join('')}` : '';
  $('#prior').hidden = !prior.length;
  const select = $('#class');
  if (select.options.length !== data.classes.length || select.value !== state.classId) {
    select.innerHTML = data.classes.map(c => `<option value="${esc(c.id || c)}" ${(c.id || c) === state.classId ? 'selected' : ''}>${esc(c.id || c)}班</option>`).join('');
  }
}

async function loadClasses() {
  if (Date.now() - state.classesAt < 60000 && state.classes.length) return;
  try {
    state.classes = await Promise.all(data.classes.map(async c => {
      const id = c.id || c;
      if (id === state.classId) {
        return { id, total: data.summary.total, entered: data.summary.entered, passed: data.students.filter(passedThree).length };
      }
      const other = await get(`/api/teacher?classId=${encodeURIComponent(id)}`);
      return { id, total: other.summary.total, entered: other.summary.entered, passed: other.students.filter(passedThree).length };
    }));
    state.classesAt = Date.now();
  } catch { /* 对比图失败不影响主看板 */ }
}

let loading = false;
async function load() {
  if (loading) return;
  loading = true;
  try {
    data = await get(`/api/teacher?classId=${encodeURIComponent(state.classId)}`);
    if (!state.built) shell();
    await loadClasses();
    refresh();
    $('#teacher-error').innerHTML = '';
  } catch (error) {
    if (!state.built) {
      $('#teacher').innerHTML = `<main class="loading"><h1>大屏暂未连接</h1><p>${esc(error.message)}</p><a href="/teacher.html">重试</a></main>`;
    } else {
      $('#teacher-error').innerHTML = `<div class="sync-error">同步未完成：${esc(error.message)}。当前显示上次成功数据，可稍后重试。</div>`;
    }
  } finally {
    loading = false;
  }
}

load();setInterval(load,5000);
