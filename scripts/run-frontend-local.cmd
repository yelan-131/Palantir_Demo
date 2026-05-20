@echo off
pushd "%~dp0..\frontend"
node_modules\.bin\vite.cmd --host 127.0.0.1 >> "%~dp0..\runtime-logs\frontend.log" 2>> "%~dp0..\runtime-logs\frontend.err.log"
