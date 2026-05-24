@echo off
title STS2 Helper

cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found. Install from https://nodejs.org/
    pause
    exit /b 1
)

if not exist node_modules (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 ( echo Install failed. & pause & exit /b 1 )
)

echo.
echo  STS2 Helper starting on http://localhost:3000
echo  Opening dashboard in browser...
echo  Press Ctrl+C to stop.
echo.

start "" "http://localhost:3000"
node server.js
pause
