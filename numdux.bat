@echo off
set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"

if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" -m backend.app.cli %*
) else (
    python -m backend.app.cli %*
)
