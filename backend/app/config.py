from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping


ROOT = Path(__file__).resolve().parents[2]


def load_env_file(path: Path = ROOT / ".env") -> None:
    if not path.exists():
        return
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def update_env_file(updates: Mapping[str, str], path: Path = ROOT / ".env") -> None:
    existing_lines = path.read_text().splitlines() if path.exists() else []
    remaining = {key: str(value) for key, value in updates.items()}
    next_lines: list[str] = []

    for raw_line in existing_lines:
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#") or "=" not in raw_line:
            next_lines.append(raw_line)
            continue
        key, _value = raw_line.split("=", 1)
        normalized_key = key.strip()
        if normalized_key in remaining:
            value = remaining.pop(normalized_key)
            next_lines.append(f'{normalized_key}="{value}"')
            os.environ[normalized_key] = value
        else:
            next_lines.append(raw_line)

    for key, value in remaining.items():
        next_lines.append(f'{key}="{value}"')
        os.environ[key] = value

    path.write_text("\n".join(next_lines).rstrip() + "\n")


@dataclass(frozen=True)
class Settings:
    ai_provider: str
    gemini_api_key: str
    gemini_model: str


def get_settings() -> Settings:
    load_env_file()
    return Settings(
        ai_provider=os.getenv("AI_PROVIDER", "rule").strip().lower(),
        gemini_api_key=os.getenv("GEMINI_API_KEY", "").strip(),
        gemini_model=os.getenv("GEMINI_MODEL", "gemini-3.5-flash").strip(),
    )
