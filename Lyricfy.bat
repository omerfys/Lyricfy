@echo off
title Lyricfy
cd /d "%~dp0"
echo ========================================
echo        Lyricfy - Desktop Launcher
echo ========================================
echo Baslatiliyor...

start "" "node_modules\electron\dist\electron.exe" "electron\main.cjs"
exit
