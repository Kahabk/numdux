from __future__ import annotations

import json
import urllib.error
import urllib.request
from textwrap import dedent
from typing import Any

from .models import CleaningOperation, CleaningPlan, GeneratedCode


SYSTEM_PROMPT = """You are an expert data engineer, data quality analyst, statistician, and Python developer operating inside a restricted data-processing environment.

Your role is to analyze dataset metadata, identify data-quality problems, generate safe cleaning plans, write executable data-cleaning code, inspect sandbox execution results, and repair failed code.

You do not directly modify datasets.

You generate code that is executed by a separate isolated sandbox.

Rules:
1. Never assume a transformation succeeded before receiving sandbox results.
2. Never overwrite the original dataset.
3. Always write cleaned data to the provided output path.
4. Never access the internet.
5. Never install packages.
6. Never execute shell commands.
7. Never access system secrets or environment variables.
8. Never access files outside the approved input and output directories.
9. Never invent columns, statistics, or dataset values.
10. Prefer deterministic and minimally destructive transformations.
11. Explain all destructive transformations.
12. Preserve the semantic meaning of the dataset.
13. Produce a transformation manifest.
14. Produce validation checks.
15. Return structured JSON when requested.
16. Use Pandas or Polars based on dataset size and operation type.
17. Do not remove outliers unless there is sufficient evidence that they are invalid.
18. Do not use correlation as evidence of causation.
19. Warn about data leakage, sensitive information, class imbalance, invalid identifiers, and time-series ordering.
20. When execution errors are returned, repair the code without changing unrelated working logic."""


class AIProvider:
    def create_plan(self, instruction: str, metadata: dict) -> CleaningPlan:
        raise NotImplementedError

    def generate_code(self, plan: CleaningPlan, metadata: dict) -> GeneratedCode:
        raise NotImplementedError


def extract_json_object(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
        elif cleaned.startswith("python"):
            cleaned = cleaned[6:]
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("AI response did not contain a JSON object.")
    return json.loads(cleaned[start : end + 1])


def compact_metadata(metadata: dict) -> dict:
    columns = metadata.get("column_metadata", [])
    return {
        "file_name": metadata.get("file_name"),
        "rows": metadata.get("rows"),
        "columns": metadata.get("columns"),
        "duplicate_rows": metadata.get("duplicate_rows"),
        "empty_rows": metadata.get("empty_rows"),
        "data_quality_score": metadata.get("data_quality_score"),
        "detected_problems": metadata.get("detected_problems", [])[:20],
        "sample_rows": metadata.get("sample_rows", [])[:8],
        "column_metadata": [
            {
                "name": col.get("name"),
                "original_type": col.get("original_type"),
                "inferred_type": col.get("inferred_type"),
                "null_count": col.get("null_count"),
                "null_percentage": col.get("null_percentage"),
                "unique_count": col.get("unique_count"),
                "minimum": col.get("minimum"),
                "maximum": col.get("maximum"),
                "mean": col.get("mean"),
                "median": col.get("median"),
                "outlier_count": col.get("outlier_count"),
                "invalid_values": col.get("invalid_values", [])[:8],
                "top_values": col.get("top_values", [])[:5],
                "sensitive_data_probability": col.get("sensitive_data_probability"),
            }
            for col in columns[:80]
        ],
    }


class GeminiAIProvider(AIProvider):
    def __init__(self, api_key: str, model: str) -> None:
        self.api_key = api_key
        self.model = model

    def create_plan(self, instruction: str, metadata: dict) -> CleaningPlan:
        payload = {
            "instruction": instruction,
            "metadata": compact_metadata(metadata),
            "required_schema": {
                "summary": "string",
                "detected_issues": ["string"],
                "operations": [
                    {
                        "id": "operation_001",
                        "title": "string",
                        "reason": "string",
                        "columns": ["string"],
                        "operation_type": "string",
                        "parameters": {},
                        "destructive": False,
                        "reversible": True,
                        "confidence": 0.0,
                    }
                ],
                "risk_level": "low|medium|high",
                "requires_approval": True,
            },
        }
        text = self._generate(
            "Return only valid JSON for a safe dataset-cleaning plan. Do not wrap it in markdown.",
            payload,
        )
        return CleaningPlan.model_validate(extract_json_object(text))

    def generate_code(self, plan: CleaningPlan, metadata: dict) -> GeneratedCode:
        payload = {
            "plan": plan.model_dump(),
            "metadata": compact_metadata(metadata),
            "approved_paths": {
                "input_path": "/input/dataset",
                "output_dir": "/output",
                "required_files": [
                    "cleaned.parquet",
                    "cleaning_manifest.json",
                    "validation_report.json",
                    "execution_summary.json",
                ],
            },
            "code_rules": [
                "Return JSON only with language, engine, code, expected_outputs.",
                "The code must read only /input/dataset.",
                "The code must write only inside /output.",
                "Never use os, subprocess, socket, requests, urllib, eval, exec, compile, pickle, dynamic imports, shell commands, package installation, or external paths.",
                "Produce cleaned.parquet, cleaning_manifest.json, validation_report.json, and execution_summary.json.",
            ],
        }
        text = self._generate(
            "Return only valid JSON for executable safe Python cleaning code. Put code in the code field as a string.",
            payload,
        )
        return GeneratedCode.model_validate(extract_json_object(text))

    def _generate(self, task: str, payload: dict) -> str:
        prompt = f"{task}\n\n{json.dumps(payload, default=str)}"
        body = json.dumps(
            {
                "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json"},
            }
        ).encode("utf-8")
        request = urllib.request.Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent",
            data=body,
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": self.api_key,
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=12) as response:
                data = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Gemini request failed: {exc.code} {details}") from exc
        return self._extract_generate_content_text(data)

    @staticmethod
    def _extract_generate_content_text(data: dict) -> str:
        parts: list[str] = []
        for candidate in data.get("candidates", []):
            for part in candidate.get("content", {}).get("parts", []):
                if isinstance(part, dict) and part.get("text"):
                    parts.append(str(part["text"]))
        if parts:
            return "\n".join(parts)
        raise ValueError("Gemini response did not include generated text.")

    def verify_connection(self) -> tuple[bool, str | None]:
        request = urllib.request.Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}",
            headers={"x-goog-api-key": self.api_key},
            method="GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=8):
                return True, None
        except urllib.error.HTTPError as exc:
            return False, f"Gemini rejected the key or model ({exc.code})."
        except Exception:
            return False, "Gemini could not be reached from the backend."


class RuleBasedAIProvider(AIProvider):
    """Deterministic local provider used until a real LLM adapter is configured."""

    def create_plan(self, instruction: str, metadata: dict) -> CleaningPlan:
        operations: list[CleaningOperation] = []
        issues = list(metadata.get("detected_problems", []))
        if metadata.get("duplicate_rows", 0):
            operations.append(CleaningOperation(
                id="operation_001",
                title="Remove exact duplicate rows",
                reason="Exact duplicates reduce dataset quality and can bias downstream analysis.",
                columns=[],
                operation_type="remove_duplicates",
                destructive=True,
                reversible=True,
                confidence=0.92,
            ))
        op_index = len(operations) + 1
        for col in metadata.get("column_metadata", []):
            name = col["name"]
            inferred = col.get("inferred_type")
            if inferred in {"string", "categorical", "email"}:
                operations.append(CleaningOperation(
                    id=f"operation_{op_index:03d}",
                    title=f"Normalize text in {name}",
                    reason="Whitespace and inconsistent blank markers are common import defects.",
                    columns=[name],
                    operation_type="trim_normalize_text",
                    parameters={"empty_markers": ["", "na", "n/a", "null", "none"]},
                    confidence=0.84,
                ))
                op_index += 1
            if col.get("null_count", 0) and inferred == "numeric":
                operations.append(CleaningOperation(
                    id=f"operation_{op_index:03d}",
                    title=f"Fill missing numeric values in {name}",
                    reason="Median imputation is deterministic and robust to outliers.",
                    columns=[name],
                    operation_type="fill_missing_median",
                    parameters={"strategy": "median"},
                    confidence=0.78,
                ))
                op_index += 1
            if inferred == "datetime":
                operations.append(CleaningOperation(
                    id=f"operation_{op_index:03d}",
                    title=f"Parse dates in {name}",
                    reason="Standard date parsing creates a consistent ISO-like representation.",
                    columns=[name],
                    operation_type="parse_dates",
                    confidence=0.76,
                ))
                op_index += 1
            if inferred == "email":
                operations.append(CleaningOperation(
                    id=f"operation_{op_index:03d}",
                    title=f"Flag invalid emails in {name}",
                    reason="Invalid emails should be made explicit without silently deleting rows.",
                    columns=[name],
                    operation_type="validate_email",
                    parameters={"flag_column": f"{name}_is_valid"},
                    confidence=0.86,
                ))
                op_index += 1

        if not operations:
            operations.append(CleaningOperation(
                id="operation_001",
                title="Create audited clean copy",
                reason="No severe issues were detected; produce a validated immutable output.",
                columns=[],
                operation_type="copy_with_manifest",
                confidence=0.7,
            ))
        risk = "medium" if any(op.destructive for op in operations) else "low"
        return CleaningPlan(
            summary=f"Plan for request: {instruction}",
            detected_issues=issues[:12],
            operations=operations[:16],
            risk_level=risk,
            requires_approval=True,
        )

    def generate_code(self, plan: CleaningPlan, metadata: dict) -> GeneratedCode:
        code = dedent(
            """
            import json
            import re
            from datetime import datetime
            from pathlib import Path

            import numpy as np
            import pandas as pd

            INPUT_PATH = Path("/input/dataset")
            OUTPUT_DIR = Path("/output")
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

            if INPUT_PATH.suffix == ".parquet":
                df = pd.read_parquet(INPUT_PATH)
            elif INPUT_PATH.suffix in {".xlsx", ".xls"}:
                df = pd.read_excel(INPUT_PATH)
            elif INPUT_PATH.suffix in {".json", ".jsonl"}:
                df = pd.read_json(INPUT_PATH, lines=INPUT_PATH.suffix == ".jsonl")
            else:
                df = pd.read_csv(INPUT_PATH, low_memory=False)

            rows_before, columns_before = df.shape
            before_nulls = df.isna().sum().to_dict()
            before_duplicates = int(df.duplicated().sum())
            operations = []

            def record(operation, columns, affected_rows=0, parameters=None):
                operations.append({
                    "id": f"op_{len(operations) + 1:03d}",
                    "operation": operation,
                    "columns": columns,
                    "affected_rows": int(affected_rows),
                    "parameters": parameters or {},
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                })

            duplicate_mask = df.duplicated()
            if duplicate_mask.any():
                affected = int(duplicate_mask.sum())
                df = df.drop_duplicates().reset_index(drop=True)
                record("remove_duplicate_rows", [], affected)

            email_pattern = re.compile(r"^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")

            for column in df.columns:
                series = df[column]
                if series.dtype == object or str(series.dtype).startswith("string"):
                    before = series.copy()
                    cleaned = series.astype("string").str.strip()
                    cleaned = cleaned.replace({"": pd.NA, "na": pd.NA, "n/a": pd.NA, "null": pd.NA, "none": pd.NA})
                    changed = int((before.astype("string").fillna("<NA>") != cleaned.fillna("<NA>")).sum())
                    df[column] = cleaned
                    if changed:
                        record("trim_and_normalize_empty_text", [column], changed)

                    if "email" in column.lower():
                        flag = f"{column}_is_valid"
                        df[flag] = df[column].fillna("").map(lambda value: bool(email_pattern.match(str(value))))
                        record("flag_invalid_email", [column, flag], int((~df[flag]).sum()), {"flag_column": flag})

                numeric = pd.to_numeric(df[column], errors="coerce")
                numeric_ratio = float(numeric.notna().mean()) if len(df) else 0.0
                if numeric_ratio > 0.85 and numeric.isna().any():
                    missing_before = int(numeric.isna().sum())
                    median = numeric.median()
                    if pd.notna(median):
                        df[column] = numeric.fillna(median)
                        record("fill_missing_numeric_median", [column], missing_before, {"median": float(median)})

                if any(token in column.lower() for token in ["date", "time", "created", "updated"]):
                    parsed = pd.to_datetime(df[column], errors="coerce", utc=False)
                    if parsed.notna().mean() > 0.5:
                        changed = int(parsed.notna().sum())
                        df[column] = parsed.dt.strftime("%Y-%m-%d")
                        record("standardize_date_format", [column], changed, {"format": "%Y-%m-%d"})

            rows_after, columns_after = df.shape
            after_nulls = df.isna().sum().to_dict()
            after_duplicates = int(df.duplicated().sum())

            cleaned_path = OUTPUT_DIR / "cleaned.parquet"
            df.to_parquet(cleaned_path, index=False)
            df.to_csv(OUTPUT_DIR / "cleaned.csv", index=False)

            manifest = {
                "input_fingerprint": "",
                "output_fingerprint": "",
                "operations": operations,
                "rows_before": int(rows_before),
                "rows_after": int(rows_after),
                "columns_before": int(columns_before),
                "columns_after": int(columns_after),
            }
            validation = {
                "status": "passed",
                "checks": [
                    {"name": "dataset_exists", "passed": cleaned_path.exists()},
                    {"name": "row_count_reasonable", "passed": rows_after >= max(1, int(rows_before * 0.5)) if rows_before else True},
                    {"name": "columns_preserved", "passed": columns_after >= columns_before},
                    {"name": "duplicates_not_increased", "passed": after_duplicates <= before_duplicates},
                ],
                "metrics": {
                    "nulls_before": {str(k): int(v) for k, v in before_nulls.items()},
                    "nulls_after": {str(k): int(v) for k, v in after_nulls.items()},
                    "duplicates_before": before_duplicates,
                    "duplicates_after": after_duplicates,
                    "transformed_values": int(sum(op["affected_rows"] for op in operations)),
                },
            }
            if not all(check["passed"] for check in validation["checks"]):
                validation["status"] = "warning"

            summary = {
                "runtime_engine": "pandas",
                "generated_files": ["cleaned.parquet", "cleaned.csv", "cleaning_manifest.json", "validation_report.json", "execution_summary.json"],
            }

            (OUTPUT_DIR / "cleaning_manifest.json").write_text(json.dumps(manifest, indent=2))
            (OUTPUT_DIR / "validation_report.json").write_text(json.dumps(validation, indent=2))
            (OUTPUT_DIR / "execution_summary.json").write_text(json.dumps(summary, indent=2))
            """
        ).strip()
        return GeneratedCode(code=code)
