@echo off
set "ROOT=%~dp0.."
if not exist "%ROOT%\runtime-logs" mkdir "%ROOT%\runtime-logs"
schtasks /Delete /TN PalantirBackend /F >nul 2>nul
schtasks /Delete /TN PalantirFrontend /F >nul 2>nul
schtasks /Create /TN PalantirBackend /SC ONCE /ST 23:59 /TR "%ROOT%\scripts\run-backend-local.cmd" /F
schtasks /Create /TN PalantirFrontend /SC ONCE /ST 23:59 /TR "%ROOT%\scripts\run-frontend-local.cmd" /F
schtasks /Run /TN PalantirBackend
schtasks /Run /TN PalantirFrontend
