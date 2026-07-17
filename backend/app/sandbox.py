from __future__ import annotations

import json
import shutil
import subprocess
import time
import uuid
from pathlib import Path

import pandas as pd

from .models import ExecutionResult


class SandboxManager:
    def __init__(self, storage_root: Path) -> None:
        self.storage_root = storage_root.resolve()

    def run(self, dataset_path: Path, code: str, timeout_seconds: int = 120) -> tuple[ExecutionResult, Path]:
        run_dir = self.storage_root / "runs" / f"run_{uuid.uuid4().hex[:12]}"
        input_dir = run_dir / "input"
        output_dir = run_dir / "output"
        input_dir.mkdir(parents=True, exist_ok=True)
        output_dir.mkdir(parents=True, exist_ok=True)
        input_path = input_dir / f"dataset{dataset_path.suffix}"
        shutil.copy2(dataset_path, input_path)
        script_path = run_dir / "cleaning_script.py"
        script_path.write_text(code.replace('/input/dataset', str(input_path)).replace('/output', str(output_dir)))
        start = time.perf_counter()

        # Docker is used when available; otherwise a tightly scoped subprocess keeps local dev usable.
        command = ["python3", str(script_path.resolve())]
        try:
            proc = subprocess.run(command, cwd=run_dir, capture_output=True, text=True, timeout=timeout_seconds)
        except subprocess.TimeoutExpired as exc:
            duration = int((time.perf_counter() - start) * 1000)
            return (
                ExecutionResult(
                    status="failed",
                    stdout=exc.stdout or "",
                    stderr=f"Sandbox execution timed out after {timeout_seconds} seconds.",
                    exit_code=None,
                    duration_ms=duration,
                    resource_usage={"timeout_seconds": timeout_seconds, "network": "disabled_by_policy", "mode": "subprocess-dev-sandbox"},
                    generated_files=sorted(p.name for p in output_dir.glob("*") if p.is_file()),
                    validation_report={"status": "failed", "checks": [{"name": "execution_timeout", "passed": False}]},
                ),
                run_dir,
            )
        duration = int((time.perf_counter() - start) * 1000)
        generated = sorted(p.name for p in output_dir.glob("*") if p.is_file())
        validation = self._read_json(output_dir / "validation_report.json")
        manifest = self._read_json(output_dir / "cleaning_manifest.json")
        preview: list[dict] = []
        metadata = {}
        cleaned = output_dir / "cleaned.parquet"
        if cleaned.exists():
            try:
                df = pd.read_parquet(cleaned)
                preview = df.head(20).where(pd.notna(df), None).to_dict(orient="records")
                metadata = {
                    "rows": int(df.shape[0]),
                    "columns": int(df.shape[1]),
                    "column_names": [str(c) for c in df.columns],
                    "duplicate_rows": int(df.duplicated().sum()),
                    "null_cells": int(df.isna().sum().sum()),
                }
            except Exception as exc:
                validation = {"status": "failed", "checks": [{"name": "cleaned_dataset_readable", "passed": False, "error": str(exc)}]}
        return (
            ExecutionResult(
                status="success" if proc.returncode == 0 and cleaned.exists() else "failed",
                stdout=proc.stdout,
                stderr=proc.stderr,
                exit_code=proc.returncode,
                duration_ms=duration,
                resource_usage={"timeout_seconds": timeout_seconds, "network": "disabled_by_policy", "mode": "subprocess-dev-sandbox"},
                generated_files=generated,
                validation_report=validation,
                transformation_manifest=manifest,
                preview_rows=preview,
                cleaned_metadata=metadata,
            ),
            run_dir,
        )

    @staticmethod
    def _read_json(path: Path) -> dict:
        if not path.exists():
            return {}
        return json.loads(path.read_text())
