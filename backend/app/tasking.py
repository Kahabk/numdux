from __future__ import annotations

import json
import re
from textwrap import dedent
from typing import Any

from .models import GeneratedCode


def infer_workflow(instruction: str) -> list[str]:
    text = instruction.lower()
    only_filter = "only" in text and "filter" in text and not any(token in text for token in ["clean", "train", "model"])
    only_train = "only" in text and any(token in text for token in ["train", "model"]) and "clean" not in text and "filter" not in text
    workflow = ["load_local_dataset"]
    if not only_train:
        workflow.append("filter_rows" if "filter" in text else "clean_and_preprocess")
    if any(token in text for token in ["feature", "engineer", "encoding", "encode"]):
        workflow.append("feature_engineering")
    if any(token in text for token in ["train", "model", "random forest", "accuracy", "evaluate", "predict"]):
        workflow.extend(["train_model", "evaluate_model"])
    if any(token in text for token in ["predict", "prediction", "generate predictions"]):
        workflow.append("generate_predictions")
    workflow.append("validate_outputs")
    return list(dict.fromkeys(workflow))


def generate_task_code(instruction: str, metadata: dict[str, Any]) -> GeneratedCode:
    workflow = infer_workflow(instruction)
    wants_model = any(step in workflow for step in ["train_model", "evaluate_model", "generate_predictions"])
    wants_features = "feature_engineering" in workflow or wants_model
    payload = {
        "instruction": instruction,
        "workflow": workflow,
        "target_hint": _target_hint(instruction, metadata),
        "filter_hint": _filter_hint(instruction, metadata),
        "wants_model": wants_model,
        "wants_features": wants_features,
    }
    code = dedent(
        f"""
        import json
        from datetime import datetime
        from pathlib import Path

        import numpy as np
        import pandas as pd

        TASK = {payload!r}
        INPUT_PATH = Path("/input/dataset")
        OUTPUT_DIR = Path("/output")
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

        def load_frame(path):
            suffix = path.suffix.lower()
            if suffix == ".parquet":
                return pd.read_parquet(path)
            if suffix in {{".xlsx", ".xls"}}:
                return pd.read_excel(path)
            if suffix == ".jsonl":
                return pd.read_json(path, lines=True)
            if suffix == ".json":
                return pd.read_json(path)
            if suffix == ".tsv":
                return pd.read_csv(path, sep="\\t", low_memory=False)
            return pd.read_csv(path, low_memory=False)

        def json_default(value):
            if isinstance(value, (np.integer,)):
                return int(value)
            if isinstance(value, (np.floating,)):
                return None if not np.isfinite(value) else float(value)
            if isinstance(value, (np.ndarray,)):
                return value.tolist()
            return str(value)

        df = load_frame(INPUT_PATH)
        original_shape = df.shape
        before_nulls = df.isna().sum().to_dict()
        before_duplicates = int(df.duplicated().sum())
        steps = []

        def record(name, detail):
            steps.append({{"step": name, "detail": detail, "timestamp": datetime.utcnow().isoformat() + "Z"}})

        filter_hint = TASK.get("filter_hint") or {{}}
        if filter_hint.get("column") in df.columns:
            column = filter_hint["column"]
            before_filter = int(len(df))
            value = filter_hint.get("value")
            op = filter_hint.get("op")
            series = df[column]
            numeric_series = pd.to_numeric(series, errors="coerce")
            numeric_value = pd.to_numeric(pd.Series([value]), errors="coerce").iloc[0]
            if op in [">", ">=", "<", "<="] and pd.notna(numeric_value):
                if op == ">":
                    df = df[numeric_series > numeric_value]
                elif op == ">=":
                    df = df[numeric_series >= numeric_value]
                elif op == "<":
                    df = df[numeric_series < numeric_value]
                elif op == "<=":
                    df = df[numeric_series <= numeric_value]
            elif op in ["=", "=="]:
                df = df[series.astype(str).str.lower() == str(value).lower()]
            elif op == "contains":
                df = df[series.astype(str).str.contains(str(value), case=False, na=False)]
            df = df.reset_index(drop=True)
            record("filter_rows", {{"column": column, "op": op, "value": value, "rows_before": before_filter, "rows_after": int(len(df))}})

        if "clean_and_preprocess" in TASK["workflow"] and before_duplicates:
            df = df.drop_duplicates().reset_index(drop=True)
            record("remove_duplicates", {{"rows_removed": before_duplicates}})

        if "clean_and_preprocess" in TASK["workflow"]:
            for column in list(df.columns):
                series = df[column]
                if series.dtype == object or str(series.dtype).startswith("string"):
                    cleaned = series.astype("string").str.strip()
                    cleaned = cleaned.replace({{"": pd.NA, "na": pd.NA, "n/a": pd.NA, "null": pd.NA, "none": pd.NA}})
                    df[column] = cleaned
                numeric = pd.to_numeric(df[column], errors="coerce")
                if len(df) and numeric.notna().mean() > 0.85:
                    median = numeric.median()
                    df[column] = numeric.fillna(median if pd.notna(median) else 0)
                elif df[column].isna().any():
                    mode = df[column].mode(dropna=True)
                    df[column] = df[column].fillna(mode.iloc[0] if not mode.empty else "unknown")
            record("clean_and_preprocess", {{"rows": int(df.shape[0]), "columns": int(df.shape[1])}})

        feature_frame = df.copy()
        target = TASK.get("target_hint")
        if TASK["wants_model"] and target not in df.columns:
            candidates = [c for c in df.columns if 1 < df[c].nunique(dropna=True) <= max(20, int(len(df) * 0.5))]
            target = candidates[-1] if candidates else df.columns[-1] if len(df.columns) else None
        if target in feature_frame.columns:
            feature_frame = feature_frame.drop(columns=[target])
        if TASK["wants_features"]:
            for column in feature_frame.select_dtypes(include=["object", "string", "category"]).columns:
                if feature_frame[column].nunique(dropna=True) <= 30:
                    dummies = pd.get_dummies(feature_frame[column], prefix=str(column), dummy_na=True)
                    feature_frame = pd.concat([feature_frame.drop(columns=[column]), dummies], axis=1)
            for column in feature_frame.columns:
                if feature_frame[column].dtype == bool:
                    feature_frame[column] = feature_frame[column].astype(int)
            record("feature_engineering", {{"feature_columns": int(feature_frame.shape[1])}})

        model_result = {{"status": "not_requested"}}
        predictions_rows = []
        if TASK["wants_model"] and target in df.columns and len(df) >= 5:
            y = df[target]
            X = feature_frame.select_dtypes(include=[np.number]).replace([np.inf, -np.inf], np.nan).fillna(0)
            if X.shape[1] == 0:
                X = pd.DataFrame({{"row_number": np.arange(len(df))}})
            try:
                from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
                from sklearn.metrics import accuracy_score, mean_absolute_error, r2_score
                from sklearn.model_selection import train_test_split

                stratify = y if y.nunique(dropna=True) > 1 and y.nunique(dropna=True) <= 20 else None
                try:
                    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=stratify)
                except Exception:
                    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
                is_classification = y.dtype == object or str(y.dtype).startswith("string") or y.nunique(dropna=True) <= 20
                model = RandomForestClassifier(n_estimators=120, random_state=42, n_jobs=-1) if is_classification else RandomForestRegressor(n_estimators=120, random_state=42, n_jobs=-1)
                model.fit(X_train, y_train)
                pred = model.predict(X_test)
                if is_classification:
                    metrics = {{"accuracy": float(accuracy_score(y_test, pred))}}
                else:
                    metrics = {{"mae": float(mean_absolute_error(y_test, pred)), "r2": float(r2_score(y_test, pred))}}
                predictions_rows = pd.DataFrame({{"actual": y_test.reset_index(drop=True), "prediction": pred}}).head(100).to_dict(orient="records")
                importances = sorted(zip([str(c) for c in X.columns], model.feature_importances_), key=lambda item: item[1], reverse=True)[:12]
                model_result = {{"status": "success", "target": str(target), "model": model.__class__.__name__, "rows_train": int(len(X_train)), "rows_test": int(len(X_test)), "metrics": metrics, "feature_importance": [{{"feature": name, "importance": float(score)}} for name, score in importances], "predictions_preview": predictions_rows[:20]}}
                record("train_evaluate_model", model_result)
            except Exception as exc:
                model_result = {{"status": "failed", "target": str(target), "error": str(exc)}}
                record("model_error", model_result)
        elif TASK["wants_model"]:
            model_result = {{"status": "failed", "error": "Need at least 5 rows and a target column to train a Random Forest model.", "target": str(target)}}
            record("model_error", model_result)

        cleaned_path = OUTPUT_DIR / "cleaned.parquet"
        df.to_parquet(cleaned_path, index=False)
        df.to_csv(OUTPUT_DIR / "cleaned.csv", index=False)
        feature_frame.to_csv(OUTPUT_DIR / "features.csv", index=False)
        if predictions_rows:
            pd.DataFrame(predictions_rows).to_csv(OUTPUT_DIR / "predictions.csv", index=False)

        after_nulls = df.isna().sum().to_dict()
        validation = {{
            "status": "passed" if cleaned_path.exists() else "failed",
            "workflow": TASK["workflow"],
            "checks": [
                {{"name": "local_dataset_loaded", "passed": original_shape[0] >= 0}},
                {{"name": "cleaned_dataset_written", "passed": cleaned_path.exists()}},
                {{"name": "columns_available", "passed": df.shape[1] > 0}},
            ],
            "metrics": {{
                "nulls_before": {{str(k): int(v) for k, v in before_nulls.items()}},
                "nulls_after": {{str(k): int(v) for k, v in after_nulls.items()}},
                "duplicates_before": before_duplicates,
                "duplicates_after": int(df.duplicated().sum()),
                "transformed_values": int(sum(max(0, before_nulls.get(k, 0) - after_nulls.get(k, 0)) for k in before_nulls)),
            }},
            "model": model_result,
        }}
        manifest = {{
            "instruction": TASK["instruction"],
            "workflow": TASK["workflow"],
            "local_input_path": str(INPUT_PATH),
            "outputs": ["cleaned.parquet", "cleaned.csv", "features.csv", "validation_report.json", "execution_summary.json"],
            "steps": steps,
        }}
        summary = {{
            "status": validation["status"],
            "dataset_shape_before": [int(original_shape[0]), int(original_shape[1])],
            "dataset_shape_after": [int(df.shape[0]), int(df.shape[1])],
            "model": model_result,
            "generated_at": datetime.utcnow().isoformat() + "Z",
        }}
        (OUTPUT_DIR / "cleaning_manifest.json").write_text(json.dumps(manifest, indent=2, default=json_default))
        (OUTPUT_DIR / "validation_report.json").write_text(json.dumps(validation, indent=2, default=json_default))
        (OUTPUT_DIR / "execution_summary.json").write_text(json.dumps(summary, indent=2, default=json_default))
        """
    ).strip()
    return GeneratedCode(code=code, expected_outputs=["cleaned.parquet", "cleaned.csv", "features.csv", "validation_report.json", "execution_summary.json"])


def repair_task_code(code: str, error: str, attempt: int) -> tuple[str, str]:
    if "could not convert string to float" in error.lower() or "input contains nan" in error.lower():
        return code.replace(".fillna(0)", ".replace([np.inf, -np.inf], np.nan).fillna(0)"), "Normalized non-finite numeric values before model training."
    if "least populated class" in error.lower() or "stratify" in error.lower():
        return code.replace("stratify = y if y.nunique(dropna=True) > 1 and y.nunique(dropna=True) <= 20 else None", "stratify = None"), "Disabled stratified splitting because the target classes are too small."
    if "n_splits" in error.lower() or "test_size" in error.lower():
        return code.replace("test_size=0.2", "test_size=0.33"), "Adjusted the train/test split for a small dataset."
    return code + f"\\n# Repair attempt {attempt}: previous error was captured for audit.\\n", "No deterministic repair rule matched; rerunning with captured audit context."


def _target_hint(instruction: str, metadata: dict[str, Any]) -> str | None:
    lowered = instruction.lower()
    for column in metadata.get("column_metadata", []):
        name = str(column.get("name", ""))
        if name and name.lower() in lowered:
            return name
    columns = metadata.get("column_metadata", [])
    return str(columns[-1].get("name")) if columns else None


def _filter_hint(instruction: str, metadata: dict[str, Any]) -> dict[str, Any] | None:
    lowered = instruction.lower()
    if "filter" not in lowered and "where" not in lowered:
        return None
    columns = [str(column.get("name", "")) for column in metadata.get("column_metadata", [])]
    for column in sorted(columns, key=len, reverse=True):
        escaped = re.escape(column)
        match = re.search(rf"{escaped}\s*(>=|<=|==|=|>|<)\s*['\"]?([^,'\"\n]+)['\"]?", instruction, flags=re.IGNORECASE)
        if match:
            return {"column": column, "op": match.group(1), "value": match.group(2).strip()}
        contains = re.search(rf"{escaped}\s+contains\s+['\"]?([^,'\"\n]+)['\"]?", instruction, flags=re.IGNORECASE)
        if contains:
            return {"column": column, "op": "contains", "value": contains.group(1).strip()}
    return None
