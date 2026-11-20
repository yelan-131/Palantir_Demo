@echo off
setlocal
set "ROOT=%~dp0.."
if not exist "%ROOT%\runtime-logs" mkdir "%ROOT%\runtime-logs"
pushd "%ROOT%\backend" || exit /b 1
"%ROOT%\.venv\Scripts\python.exe" app\core\error_catalog.py --check-python-source app >> "%ROOT%\runtime-logs\backend.log" 2>> "%ROOT%\runtime-logs\backend.err.log"
if errorlevel 1 (
    popd
    exit /b 1
)
"%ROOT%\.venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 >> "%ROOT%\runtime-logs\backend.log" 2>> "%ROOT%\runtime-logs\backend.err.log"
set "BACKEND_EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %BACKEND_EXIT_CODE%
