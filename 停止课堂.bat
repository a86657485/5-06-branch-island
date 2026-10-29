@echo off
chcp 65001 >nul
cd /d "%~dp0"
node scripts\stop-classroom.cjs 8766
timeout /t 3 >nul
exit
