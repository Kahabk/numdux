@echo off
set SCRIPT_DIR=%~dp0
setlocal
set PYTHONPATH=%SCRIPT_DIR%;%PYTHONPATH%

if exist "%SCRIPT_DIR%.venv\Scripts\python.exe" (
    "%SCRIPT_DIR%.venv\Scripts\python.exe" -m backend.app.cli %*
) else (
    python -m backend.app.cli %*
)
endlocal
