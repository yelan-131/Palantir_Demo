@echo off
pushd "%~dp0..\backend"
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 >> "%~dp0..\runtime-logs\backend.log" 2>> "%~dp0..\runtime-logs\backend.err.log"
