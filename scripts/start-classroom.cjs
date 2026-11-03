'use strict';
/**
 * 课堂服务启动器（Windows 用）：已启动则直接打开浏览器，否则后台拉起 server.cjs。
 * 用法：node scripts/start-classroom.cjs [端口]
 */
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const PORT = Number(process.argv[2] || process.env.PORT || 8766);
const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');
const LOG = path.join(LOG_DIR, 'server.log');

function probe() {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/config', timeout: 1200 }, res => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function openBrowser(url) {
  try {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch (e) {
    console.log('请手动在浏览器打开：' + url);
  }
}

(async () => {
  const already = await probe();
  if (already) {
    console.log(`课堂服务已在运行： http://localhost:${PORT}/`);
    openBrowser(`http://localhost:${PORT}/`);
    return;
  }
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const out = fs.openSync(LOG, 'a');
  const child = spawn(process.execPath, ['server.cjs'], {
    cwd: ROOT,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, PORT: String(PORT), HOST: process.env.HOST || '0.0.0.0' }
  });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 250));
    if (await probe()) {
      console.log(`课堂服务已启动： http://localhost:${PORT}/  进程号 ${child.pid}`);
      console.log(`日志： ${LOG}`);
      openBrowser(`http://localhost:${PORT}/`);
      return;
    }
  }
  console.log('启动超时，请查看日志：' + LOG);
  process.exitCode = 1;
})();
