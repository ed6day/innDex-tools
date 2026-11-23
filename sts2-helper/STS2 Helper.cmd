@echo off
rem Double-click to start STS2 Helper and open the dashboard (see launcher\launch.ps1).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\launch.ps1" %*
