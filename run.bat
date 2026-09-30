@echo off
setlocal
cd /d "%~dp0"
title RIVET RIOT: Operation Saltbone

rem ---------------------------------------------------------------
rem  RIVET RIOT launcher (Windows)
rem    run.bat          build once (if needed) and play in the browser
rem    run.bat build    force a fresh production build, then play
rem    run.bat dev      start the dev server (hot reload) instead
rem ---------------------------------------------------------------

where node >nul 2>nul
if errorlevel 1 goto :nonode

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)||(a===20&&b>=19)?0:1)"
if errorlevel 1 goto :oldnode

if not exist "node_modules\" (
  echo [1/3] Installing dependencies...
  call npm install
  if errorlevel 1 goto :fail
)

if /i "%~1"=="dev" goto :dev
if /i "%~1"=="build" goto :build
if not exist "dist\index.html" goto :build
goto :play

:build
echo [2/3] Building the game...
call npm run build
if errorlevel 1 goto :fail

:play
echo [3/3] Starting RIVET RIOT. Your browser will open automatically.
echo       Close this window or press Ctrl+C to quit.
call npx vite preview --port 4173 --open
goto :eof

:dev
echo Starting the dev server. Your browser will open automatically.
call npx vite --port 5173 --open
goto :eof

:nonode
echo [!] Node.js was not found. Install Node.js 22 LTS from https://nodejs.org/ and run this file again.
pause
exit /b 1

:oldnode
echo [!] Node.js 20.19+ or 22.12+ is required. Current version:
node --version
pause
exit /b 1

:fail
echo [!] Something went wrong. See the messages above.
pause
exit /b 1
