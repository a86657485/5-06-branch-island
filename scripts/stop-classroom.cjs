'use strict';
/**
 * 课堂服务停止器（Windows 用）：结束监听指定端口的 node 进程，不删除名单与学习记录。
 * 用法：node scripts/stop-classroom.cjs [端口]
 */
const { execFileSync } = require('node:child_process');

const PORT = String(process.argv[2] || process.env.PORT || 8766);

function pids() {
  let text = '';
  try {
    text = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
  } catch (e) {
    console.log('无法读取端口占用：' + e.message);
    return [];
  }
  const found = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!/LISTENING/i.test(line)) continue;
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5) continue;
    if (cols[1] === `0.0.0.0:${PORT}` || cols[1] === `127.0.0.1:${PORT}` || cols[1].endsWith(`:${PORT}`)) found.add(cols[cols.length - 1]);
  }
  return [...found];
}

const list = pids();
if (!list.length) {
  console.log(`端口 ${PORT} 上没有运行中的课堂服务。`);
  process.exit(0);
}
for (const pid of list) {
  try {
    execFileSync('taskkill', ['/PID', pid, '/F'], { stdio: 'ignore' });
    console.log(`已停止进程 ${pid}（端口 ${PORT}）。名单与学习记录已保留。`);
  } catch (e) {
    console.log(`停止进程 ${pid} 失败：${e.message}`);
  }
}
