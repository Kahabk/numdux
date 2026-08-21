from __future__ import annotations

import os
from pathlib import Path


PACKAGE_DIR = Path(__file__).resolve().parent
PACKAGE_ROOT = PACKAGE_DIR.parents[1]
FRONTEND_DIR = PACKAGE_DIR / "dist"


def _looks_like_source_checkout(path: Path) -> bool:
    return (path / "pyproject.toml").exists() and (path / "backend" / "app").exists()


def app_root() -> Path:
    configured = os.getenv("NUMDUX_HOME") or os.getenv("NUMDUX_ROOT")
    if configured:
        return Path(configured).expanduser().resolve()
    if _looks_like_source_checkout(PACKAGE_ROOT):
        return PACKAGE_ROOT
    return Path.cwd().resolve()


APP_ROOT = app_root()
STORAGE_DIR = APP_ROOT / ".numdux_data"
ENV_FILE = APP_ROOT / ".env"
