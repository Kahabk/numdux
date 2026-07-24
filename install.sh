#!/usr/bin/env bash

echo "==================================================="
echo "       Numdux Notebook Installer for Linux"
echo "==================================================="
echo

# 1. Check Python3
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] python3 was not found in your PATH."
    echo "Please install Python 3.11+ using your package manager."
    exit 1
fi

# Check Python version (>= 3.11)
if ! python3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" &> /dev/null; then
    echo "[WARNING] Numdux is optimized for Python 3.11+. Your Python version is $(python3 -V | cut -d' ' -f2), which is older."
fi

# 2. Create virtual environment if it doesn't exist
if [ ! -d ".venv" ]; then
    echo "[INFO] Creating Python virtual environment in .venv..."
    python3 -m venv .venv
    if [ $? -ne 0 ]; then
        echo "[ERROR] Failed to create Python virtual environment. Install python3-venv if needed."
        exit 1
    fi
fi

echo "[INFO] Activating virtual environment..."
source .venv/bin/activate
if [ $? -ne 0 ]; then
    echo "[ERROR] Failed to activate virtual environment."
    exit 1
fi

echo "[INFO] Upgrading pip..."
python3 -m pip install --upgrade pip

# 3. Check and build frontend if needed
FRONTEND_BUILT=0
if [ -f "backend/app/dist/index.html" ]; then
    FRONTEND_BUILT=1
fi

if command -v npm &> /dev/null; then
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
        echo "[WARNING] npm was not found and no pre-built frontend assets exist."
        echo "Please install Node.js/npm to build the frontend, then re-run this installer."
    fi
fi

# 4. Install backend dependencies and register the numdux CLI package
echo "[INFO] Installing Python dependencies and registering 'numdux' CLI..."
if pip install -e .; then
    echo
    echo "==================================================="
    echo "     Numdux Notebook Installation Successful!"
    echo "==================================================="
    echo
    echo "To start Numdux, activate your environment and run:"
    echo "    source .venv/bin/activate"
    echo "    numdux"
    echo
    echo "Or run directly using the wrapper:"
    echo "    ./numdux"
    echo
    echo "To run in development mode (with hot-reloading Vite server):"
    echo "    ./numdux --dev"
    echo
else
    echo "[ERROR] Python package installation failed."
    exit 1
fi
