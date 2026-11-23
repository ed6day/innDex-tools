@echo off
rem Adds STS2 Helper shortcuts to the Desktop and Start menu.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-shortcut.ps1"
