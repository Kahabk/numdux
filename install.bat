@echo off
setlocal EnableExtensions
echo ===================================================
echo       Numdux Notebook Installer for Windows
echo ===================================================
echo.

cd /d "%~dp0"

set PYTHON_CMD=
where py >nul 2>nul
if %errorlevel% equ 0 (
    py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
    if %errorlevel% equ 0 set PYTHON_CMD=py -3
)

if "%PYTHON_CMD%"=="" (
    where python >nul 2>nul
    if %errorlevel% equ 0 (
        python -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
        if %errorlevel% equ 0 set PYTHON_CMD=python
    )
)

if "%PYTHON_CMD%"=="" (
    where python3 >nul 2>nul
    if %errorlevel% equ 0 (
        python3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
        if %errorlevel% equ 0 set PYTHON_CMD=python3
    )
)

if "%PYTHON_CMD%"=="" (
    echo [ERROR] Python 3.10 or newer was not found in your PATH.
    echo Please install Python 3.10+ and check "Add Python to PATH" during installation.
    echo Get Python at: https://www.python.org/downloads/
    goto error
)

echo [INFO] Using Python:
%PYTHON_CMD% -V

if not exist ".venv" (
    echo [INFO] Creating Python virtual environment in .venv...
    %PYTHON_CMD% -m venv .venv
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to create Python virtual environment.
        goto error
    )
)

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Virtual environment Python was not found at .venv\Scripts\python.exe.
    goto error
)

set VENV_PYTHON=.venv\Scripts\python.exe

echo [INFO] Upgrading pip...
"%VENV_PYTHON%" -m pip install --upgrade pip
if %errorlevel% neq 0 (
    echo [ERROR] Failed to upgrade pip.
    goto error
)
set FRONTEND_BUILT=0
if exist "backend\app\dist\index.html" (
    set FRONTEND_BUILT=1
)

where npm >nul 2>nul
if %errorlevel% neq 0 (
    if %FRONTEND_BUILT% equ 1 (
        echo [INFO] npm not found, but pre-built frontend assets were detected. Skipping frontend build.
    ) else (
        echo [ERROR] npm was not found and no pre-built frontend assets exist.
        echo Please install Node.js/npm, then re-run this installer.
        goto error
    )
    goto skip_frontend
)

echo [INFO] npm found. Installing frontend dependencies...
call npm install
if %errorlevel% neq 0 (
    echo [WARNING] npm install failed. Running without rebuilding frontend.
    goto skip_frontend
)

echo [INFO] Building frontend assets...
call npm run build
if %errorlevel% neq 0 (
    echo [WARNING] npm run build failed. Running without rebuilding frontend.
) else (
    set FRONTEND_BUILT=1
)

:skip_frontend

echo [INFO] Installing Python dependencies...
"%VENV_PYTHON%" -m pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo [ERROR] Python dependency installation failed.
    echo If the error mentions compiling numpy, pandas, scipy, scikit-learn, or pyarrow, upgrade Python/pip or install Python 3.11/3.12 and re-run this installer.
    goto error
)

echo [INFO] Registering optional editable package entry point...
"%VENV_PYTHON%" -m pip install --no-build-isolation -e .
if %errorlevel% neq 0 (
    echo [WARNING] Editable package registration failed. The local .\numdux wrapper will still work.
)

echo [INFO] Registering 'numdux' command globally in your User PATH...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$dir = [System.IO.Path]::GetFullPath('.'); $userPath = [Environment]::GetEnvironmentVariable('Path', 'User'); $parts = @(); if (-not [string]::IsNullOrWhiteSpace($userPath)) { $parts = $userPath -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } }; if ($parts -notcontains $dir) { $newPath = (($parts + $dir) -join ';'); [Environment]::SetEnvironmentVariable('Path', $newPath, 'User') }" >nul 2>nul
if %errorlevel% neq 0 (
    echo [WARNING] Could not automatically add Numdux to PATH. You can run it using '.\numdux' from the root folder.
) else (
    echo [INFO] Registered successfully! You can run 'numdux' from any new terminal window.
)

echo.
echo ===================================================
echo     Numdux Notebook Installation Successful!
echo ===================================================
echo.
echo You can now start the application from ANY folder by opening
echo a NEW command prompt/PowerShell window and running:
echo     numdux
echo.
echo To run in development mode (with hot-reloading Vite server):
echo     numdux --dev
echo.
echo (If you are in the project folder, you can also run '.\numdux')
echo.
pause
exit /b 0

:error
echo.
echo [ERROR] Installation failed. Please check the logs above.
pause
exit /b 1
