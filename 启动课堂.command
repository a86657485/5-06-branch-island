#!/bin/bash
set -e
cd "$(dirname "$0")"
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ] && [ -x /usr/local/bin/node ]; then NODE_BIN=/usr/local/bin/node; fi
if [ -z "$NODE_BIN" ] && [ -x /opt/homebrew/bin/node ]; then NODE_BIN=/opt/homebrew/bin/node; fi
if [ -z "$NODE_BIN" ]; then
  echo '请先安装 Node.js 22.13 或更新版本，再双击此文件。'
  read -r -p '按回车关闭。' _
  exit 1
fi
if ! "$NODE_BIN" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'; then
  echo '当前 Node.js 版本较低，请更新至22.13或以上。'
  read -r -p '按回车关闭。' _
  exit 1
fi
LABEL=cn.jun.branch-island-5-06
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents" runtime
if lsof -nP -iTCP:8766 -sTCP:LISTEN >/dev/null 2>&1 && ! launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  echo '8766端口正在被其他程序使用。没有停止它，请联系教师检查后再启动。'
  read -r -p '按回车关闭。' _
  exit 1
fi
"$NODE_BIN" - "$PWD" "$NODE_BIN" "$PLIST" <<'JS'
const fs=require('node:fs');
const [base,node,plist]=process.argv.slice(2);
const logDir=require('node:path').join(process.env.HOME,'Library','Logs','branch-island-5-06');
fs.mkdirSync(logDir,{recursive:true});
const esc=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
fs.writeFileSync(plist,`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>cn.jun.branch-island-5-06</string><key>ProgramArguments</key><array><string>${esc(node)}</string><string>${esc(base+'/server.cjs')}</string></array><key>WorkingDirectory</key><string>${esc(base)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>StandardOutPath</key><string>${esc(logDir+'/service.log')}</string><key>StandardErrorPath</key><string>${esc(logDir+'/service-error.log')}</string><key>EnvironmentVariables</key><dict><key>PORT</key><string>8766</string><key>HOST</key><string>0.0.0.0</string></dict></dict></plist>`);
JS
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
for i in 1 2 3 4 5; do
  APP_CONFIG="$(curl --noproxy '*' -fsS http://127.0.0.1:8766/api/config 2>/dev/null || true)"
  if [[ "$APP_CONFIG" == *'"appId":"branch-island-5-06"'* ]]; then
    echo '分支冒险岛已启动。关闭此窗口后课堂服务仍然运行。'
    echo '学生入口：http://localhost:8766/'
    echo '教师大屏：http://localhost:8766/teacher.html'
    if [ "${NO_OPEN:-0}" != 1 ]; then open http://localhost:8766/; fi
    exit 0
  fi
  sleep 1
done
echo '启动未完成。请查看 ~/Library/Logs/branch-island-5-06/service-error.log，并检查Node版本和端口。'
exit 1
