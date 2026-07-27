@echo off
echo ===================================================
echo       Numdux Notebook Installer for Windows
echo ===================================================
echo.

REM 1. Check Python (try python, python3, py)
set PYTHON_CMD=
where python >nul 2>nul
if %errorlevel% equ 0 (
    set PYTHON_CMD=python
    goto python_found
)

where python3 >nul 2>nul
if %errorlevel% equ 0 (
    set PYTHON_CMD=python3
    goto python_found
)

where py >nul 2>nul
if %errorlevel% equ 0 (
    set PYTHON_CMD=py
    goto python_found
)

:python_found
if "%PYTHON_CMD%"=="" (
    echo [ERROR] Python was not found in your PATH.
    echo Please install Python 3.11+ and check "Add Python to PATH" during installation.
    echo Get Python at: https://www.python.org/downloads/
    goto error
)

REM Check Python version (>= 3.11)
%PYTHON_CMD% -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>nul
if %errorlevel% neq 0 (
    echo [WARNING] Numdux is optimized for Python 3.11+. Your Python version might be older.
)

REM 2. Create virtual environment if it doesn't exist
if not exist ".venv" (
    echo [INFO] Creating Python virtual environment in .venv...
    %PYTHON_CMD% -m venv .venv
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to create Python virtual environment.
        goto error
    )
)

echo [INFO] Activating virtual environment...
call .venv\Scripts\activate.bat
if %errorlevel% neq 0 (
    echo [ERROR] Failed to activate virtual environment.
    goto error
)

echo [INFO] Upgrading pip...
python -m pip install --upgrade pip

REM 3. Check and build frontend if needed
set FRONTEND_BUILT=0
if exist "backend\app\dist\index.html" (
    set FRONTEND_BUILT=1
)

where npm >nul 2>nul
if %errorlevel% neq 0 (
    if %FRONTEND_BUILT% equ 1 (
        echo [INFO] npm not found, but pre-built frontend assets were detected. Skipping frontend build.
    ) else (
        echo [WARNING] npm was not found and no pre-built frontend assets exist.
        echo Please install Node.js/npm to build the frontend, then re-run this installer.
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

REM 4. Install backend dependencies and register the numdux CLI package
echo [INFO] Installing Python dependencies and registering 'numdux' CLI...
pip install -e .
if %errorlevel% neq 0 (
    echo [ERROR] Python package installation failed.
    goto error
)

REM 5. Register numdux globally in User PATH
echo [INFO] Registering 'numdux' command globally in your User PATH...
powershell -NoProfile -Command "$dir = [System.IO.Path]::GetFullPath('.'); $userPath = [Environment]::GetEnvironmentVariable('Path', 'User'); if ([string]::IsNullOrEmpty($userPath)) { [Environment]::SetEnvironmentVariable('Path', $dir, 'User'); Write-Host 'Successfully added Numdux directory to your User PATH.' } elseif ($userPath -split ';' -notcontains $dir) { [Environment]::SetEnvironmentVariable('Path', $userPath + ';' + $dir, 'User'); Write-Host 'Successfully added Numdux directory to your User PATH.' } else { Write-Host 'Numdux directory is already in your User PATH.' }" >nul 2>nul
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
