#!/usr/bin/env bash
set -u

echo "==================================================="
echo "       Numdux Notebook Installer for Linux/macOS"
echo "==================================================="
echo

cd "$(dirname "$0")"

PYTHON_CMD=""
for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >/dev/null 2>&1; then
        PYTHON_CMD="$candidate"
        break
    fi
done

if [ -z "$PYTHON_CMD" ]; then
    echo "[ERROR] Python 3.10 or newer was not found in your PATH."
    echo "Install Python 3.10+ and re-run this installer."
    exit 1
fi

echo "[INFO] Using $($PYTHON_CMD -V)"

if [ ! -d ".venv" ]; then
    echo "[INFO] Creating Python virtual environment in .venv..."
    "$PYTHON_CMD" -m venv .venv
    if [ $? -ne 0 ]; then
        echo "[ERROR] Failed to create Python virtual environment."
        echo "On Debian/Ubuntu, install the venv package, for example: sudo apt install python3-venv"
        exit 1
    fi
fi

VENV_PYTHON=".venv/bin/python"
if [ ! -x "$VENV_PYTHON" ]; then
    echo "[ERROR] Virtual environment Python was not found at $VENV_PYTHON."
    exit 1
fi

echo "[INFO] Upgrading pip..."
"$VENV_PYTHON" -m pip install --upgrade pip
if [ $? -ne 0 ]; then
    echo "[ERROR] Failed to upgrade pip."
    exit 1
fi
FRONTEND_BUILT=0
if [ -f "backend/app/dist/index.html" ]; then
    FRONTEND_BUILT=1
fi

if command -v npm >/dev/null 2>&1; then
    echo "[INFO] npm found. Installing frontend dependencies and building assets..."
    if npm install; then
        if npm run build; then
            FRONTEND_BUILT=1
        else
            echo "[WARNING] npm run build failed. Running with existing built files."
        fi
    else
        echo "[WARNING] npm install failed. Running with existing built files."
    fi
else
    if [ $FRONTEND_BUILT -eq 1 ]; then
        echo "[INFO] npm not found, but pre-built frontend assets were detected. Skipping frontend build."
    else
        echo "[ERROR] npm was not found and no pre-built frontend assets exist."
        echo "Install Node.js/npm, then re-run this installer."
        exit 1
    fi
fi

echo "[INFO] Installing Python dependencies..."
if ! "$VENV_PYTHON" -m pip install -r requirements.txt; then
    echo "[ERROR] Python dependency installation failed."
    echo "If the error mentions compiling numpy, pandas, scipy, scikit-learn, or pyarrow, upgrade Python/pip or install Python 3.11/3.12 and re-run this installer."
    exit 1
fi

echo "[INFO] Registering optional editable package entry point..."
if ! "$VENV_PYTHON" -m pip install --no-build-isolation -e .; then
    echo "[WARNING] Editable package registration failed. The local ./numdux wrapper will still work."
fi

chmod +x ./numdux >/dev/null 2>&1 || true
echo
echo "==================================================="
echo "     Numdux Notebook Installation Successful!"
echo "==================================================="
echo
echo "Start Numdux directly with:"
echo "    ./numdux"
echo
echo "Or activate the environment first:"
echo "    source .venv/bin/activate"
echo "    python -m backend.app.cli"
echo
echo "To run in development mode (with hot-reloading Vite server):"
echo "    ./numdux --dev"
echo
