#!/bin/bash
set -e
LABEL=cn.jun.branch-island-5-06
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  if ! launchctl bootout "gui/$(id -u)/$LABEL"; then
    echo '停止未完成。请保留数据，暂时不要备份正在运行的数据库。'
    exit 1
  fi
fi
for i in 1 2 3 4 5; do
  if ! launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then break; fi
  sleep 1
done
if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  echo '后台服务仍在运行。请检查后重试，暂时不要备份。'
  exit 1
fi
APP_CONFIG="$(curl --noproxy '*' -fsS http://127.0.0.1:8766/api/config 2>/dev/null || true)"
if [[ "$APP_CONFIG" == *'"appId":"branch-island-5-06"'* ]]; then
  echo '后台作业已停，但仍有本课程序在8766运行。请先关闭临时运行的窗口，再备份。'
  exit 1
fi
if [ -f "$PLIST" ]; then mv "$PLIST" "$PLIST.disabled"; fi
echo '已确认停止分支冒险岛，名单与学习记录全部保留。再次双击启动课堂即可恢复。'
