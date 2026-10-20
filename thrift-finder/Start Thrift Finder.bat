@echo off
rem Double-click me to start Thrift Finder.
cd /d "%~dp0"

where node >/dev/null 2>nul
if errorlevel 1 (
  echo Thrift Finder needs Node.js ^(free^).
  echo Install the LTS version from https://nodejs.org, then double-click this file again.
  start "" https://nodejs.org/en/download
  pause
  exit /b 1
)

if not exist "node_modules\.thrift-finder-ready" (
  echo First run: setting things up ^(a few minutes, only once^)...
  call npm install --no-audit --no-fund || goto failed
  node setup.js || goto failed
  type nul > "node_modules\.thrift-finder-ready"
)

node server.js %*
pause
exit /b 0

:failed
echo Setup failed ^(see above^).
pause
exit /b 1
