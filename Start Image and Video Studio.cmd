@echo off
setlocal
cd /d "%~dp0"

where node.exe >nul 2>nul
if errorlevel 1 goto missing_node

if exist "node_modules\tsx\dist\cli.mjs" goto start

echo Installing project dependencies...
where npm.cmd >nul 2>nul
if errorlevel 1 goto try_pnpm
call npm.cmd install
if errorlevel 1 goto failed
goto start

:try_pnpm
where pnpm.cmd >nul 2>nul
if errorlevel 1 goto missing_npm
call pnpm.cmd install --frozen-lockfile
if errorlevel 1 goto failed

:start
echo Opening the integrated Entertainify app at http://127.0.0.1:3000
node.exe --env-file-if-exists=.env --import tsx src/server.ts --dev
if errorlevel 1 goto failed
exit /b 0

:missing_node
echo Node.js is not available in this terminal. Install Node.js 24 from https://nodejs.org/en/download and reopen this launcher.
goto failed

:missing_npm
echo Project dependencies are missing, and npm was not found. Repair or reinstall Node.js 24 with npm included, then reopen this launcher.

:failed
pause
exit /b 1
