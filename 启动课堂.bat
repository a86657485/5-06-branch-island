@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js，请先安装 Node.js 22.13 或更新版本。
  pause
  exit /b 1
)
node scripts\start-classroom.cjs 8766
timeout /t 3 >nul
exit
