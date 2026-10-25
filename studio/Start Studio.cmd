@echo off
cd /d "%~dp0"
if not exist "node_modules\@ffmpeg-installer\ffmpeg\index.js" call npm.cmd install --no-audit --no-fund
if errorlevel 1 goto done
node --env-file-if-exists=.env server.mjs
:done
pause
