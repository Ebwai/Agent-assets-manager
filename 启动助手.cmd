@echo off
cd /d "%~dp0"
if not exist "node_modules\yaml\package.json" (
  call npm install
  if errorlevel 1 pause & exit /b 1
)
if not defined PORT set "PORT=8073"
start "" "http://127.0.0.1:%PORT%"
npm start
