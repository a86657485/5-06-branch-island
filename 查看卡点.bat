@echo off
chcp 936 >nul
cd /d "%~dp0"
"C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe" scripts\卡点自检.py
echo.
pause
