from __future__ import annotations

from datetime import datetime
import json
import shutil
from pathlib import Path
from textwrap import dedent
from typing import Any
import uuid

from .models import ExecutionResult, ModelRunRecord, ModelTrainingRequest
from .safety import validate_python_code
from .sandbox import SandboxManager


class ModelRunStore:
    def __init__(self, root: Path) -> None:
        self.root = root / "models"
        self.root.mkdir(parents=True, exist_ok=True)

    def list(self, dataset_id: str) -> list[ModelRunRecord]:
        dataset_dir = self.root / dataset_id
        if not dataset_dir.exists():
            return []
        records = [ModelRunRecord.model_validate(json.loads(path.read_text())) for path in dataset_dir.glob("*.json")]
        return sorted(records, key=lambda item: item.created_at, reverse=True)

    def get(self, dataset_id: str, run_id: str) -> ModelRunRecord | None:
        path = self.root / dataset_id / f"{run_id}.json"
        if not path.exists():
            return None
        return ModelRunRecord.model_validate(json.loads(path.read_text()))

    def save(self, record: ModelRunRecord, run_dir: Path) -> ModelRunRecord:
        dataset_dir = self.root / record.dataset_id
        dataset_dir.mkdir(parents=True, exist_ok=True)
        source_model = run_dir / "output" / "model.joblib"
        model_path = dataset_dir / f"{record.id}.joblib"
        if source_model.exists():
            shutil.copy2(source_model, model_path)
            record.model_path = str(model_path)
        (dataset_dir / f"{record.id}.json").write_text(json.dumps(record.model_dump(), indent=2, default=str))
        return record

    def delete_dataset(self, dataset_id: str) -> None:
        dataset_dir = self.root / dataset_id
        if dataset_dir.exists():
            shutil.rmtree(dataset_dir)

    def clear_all(self) -> None:
        if self.root.exists():
            shutil.rmtree(self.root)
        self.root.mkdir(parents=True, exist_ok=True)


def train_model_in_sandbox(storage_root: Path, dataset_path: Path, dataset_id: str, version_id: str, request: ModelTrainingRequest, columns: list[str]) -> tuple[ModelRunRecord, Path | None]:
    if request.target not in columns:
        raise ValueError(f"Target column '{request.target}' does not exist.")
    features = [column for column in columns if column != request.target] if request.features == "auto" else request.features
    missing = [column for column in features if column not in columns]
    if missing:
        raise ValueError(f"Feature column(s) do not exist: {', '.join(missing)}")
    if request.target in features:
        raise ValueError("Target column cannot also be a feature.")
    if not features:
        raise ValueError("At least one feature column is required.")

    run_id = f"model_{uuid.uuid4().hex[:10]}"
    code = generate_training_code(run_id, dataset_id, version_id, request, features)
    errors = validate_python_code(code)
    if errors:
        execution = ExecutionResult(status="blocked", stderr="\n".join(errors), safety_errors=errors, validation_report={"status": "blocked"})
        return ModelRunRecord(
            id=run_id,
            dataset_id=dataset_id,
            version_id=version_id,
            target=request.target,
            features=features,
            task_type="classification",
            model_type=request.model_type,
            hyperparameters=request.hyperparameters,
            created_at=datetime.utcnow().isoformat() + "Z",
            execution=execution.model_dump(),
        ), None

    execution, run_dir = SandboxManager(storage_root).run(dataset_path, code, timeout_seconds=180)
    output = run_dir / "output" / "model_run.json"
    payload: dict[str, Any] = {}
    if output.exists():
        payload = json.loads(output.read_text())
    task_type = payload.get("task_type") if payload.get("task_type") in {"classification", "regression"} else "classification"
    return ModelRunRecord(
        id=run_id,
        dataset_id=dataset_id,
        version_id=version_id,
        target=request.target,
        features=features,
        task_type=task_type,
        model_type=payload.get("model_type", request.model_type),
        hyperparameters=request.hyperparameters,
        metrics=payload.get("metrics", {}),
        feature_importances=payload.get("feature_importances", []),
        training_time_seconds=float(payload.get("training_time_seconds", execution.duration_ms / 1000)),
        created_at=payload.get("created_at", datetime.utcnow().isoformat() + "Z"),
        execution=execution.model_dump(),
    ), run_dir


def generate_training_code(run_id: str, dataset_id: str, version_id: str, request: ModelTrainingRequest, features: list[str]) -> str:
    payload = {
        "run_id": run_id,
        "dataset_id": dataset_id,
        "version_id": version_id,
        "target": request.target,
        "features": features,
        "task_type": request.task_type,
        "model_type": request.model_type,
        "hyperparameters": request.hyperparameters,
    }
    return dedent(
        f"""
        import json
        from datetime import datetime
        from pathlib import Path
        import time

        import joblib
        import numpy as np
        import pandas as pd
        from sklearn.compose import ColumnTransformer
        from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor, RandomForestClassifier, RandomForestRegressor
        from sklearn.impute import SimpleImputer
        from sklearn.linear_model import LinearRegression, LogisticRegression
        from sklearn.metrics import accuracy_score, f1_score, mean_absolute_error, mean_squared_error, r2_score, roc_auc_score
        from sklearn.model_selection import train_test_split
        from sklearn.pipeline import Pipeline
        from sklearn.preprocessing import OneHotEncoder, StandardScaler

        CONFIG = {payload!r}
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

        def clean_params(params, allowed):
            return {{key: value for key, value in params.items() if key in allowed}}

        start = time.perf_counter()
        df = load_frame(INPUT_PATH)
        target = CONFIG["target"]
        features = CONFIG["features"]
        data = df[features + [target]].dropna(subset=[target]).copy()
        y = data[target]
        X = data[features]
        unique = y.nunique(dropna=True)
        task_type = CONFIG["task_type"]
        if task_type == "auto":
            task_type = "classification" if y.dtype == object or str(y.dtype).startswith("string") or unique <= min(20, max(2, int(len(y) * 0.2))) else "regression"

        numeric_features = [column for column in X.columns if pd.api.types.is_numeric_dtype(X[column])]
        categorical_features = [column for column in X.columns if column not in numeric_features]
        numeric_pipeline = Pipeline([("imputer", SimpleImputer(strategy="median")), ("scaler", StandardScaler())])
        categorical_pipeline = Pipeline([("imputer", SimpleImputer(strategy="most_frequent")), ("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=False))])
        preprocessor = ColumnTransformer([("num", numeric_pipeline, numeric_features), ("cat", categorical_pipeline, categorical_features)])
        params = CONFIG["hyperparameters"]
        model_type = CONFIG["model_type"]
        if task_type == "classification":
            if model_type == "logistic_regression":
                model = LogisticRegression(max_iter=int(params.get("max_iter", 300)), **clean_params(params, {{"C", "class_weight"}}))
            elif model_type == "gradient_boosting":
                model = GradientBoostingClassifier(random_state=42, **clean_params(params, {{"n_estimators", "learning_rate", "max_depth"}}))
            else:
                model_type = "random_forest"
                model = RandomForestClassifier(random_state=42, n_jobs=-1, **clean_params(params, {{"n_estimators", "max_depth", "min_samples_leaf", "class_weight"}}))
        else:
            if model_type == "linear_regression":
                model = LinearRegression(**clean_params(params, {{"fit_intercept"}}))
            elif model_type == "gradient_boosting":
                model = GradientBoostingRegressor(random_state=42, **clean_params(params, {{"n_estimators", "learning_rate", "max_depth"}}))
            else:
                model_type = "random_forest"
                model = RandomForestRegressor(random_state=42, n_jobs=-1, **clean_params(params, {{"n_estimators", "max_depth", "min_samples_leaf"}}))

        pipeline = Pipeline([("preprocess", preprocessor), ("model", model)])
        stratify = y if task_type == "classification" and unique > 1 and unique <= 20 else None
        try:
            X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=stratify)
        except Exception:
            X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
        pipeline.fit(X_train, y_train)
        pred = pipeline.predict(X_test)
        metrics = {{}}
        if task_type == "classification":
            metrics["accuracy"] = float(accuracy_score(y_test, pred))
            metrics["f1"] = float(f1_score(y_test, pred, average="weighted", zero_division=0))
            try:
                proba = pipeline.predict_proba(X_test)
                if proba.shape[1] == 2:
                    metrics["auc"] = float(roc_auc_score(y_test, proba[:, 1]))
            except Exception:
                metrics["auc"] = None
        else:
            metrics["rmse"] = float(mean_squared_error(y_test, pred, squared=False))
            metrics["mae"] = float(mean_absolute_error(y_test, pred))
            metrics["r2"] = float(r2_score(y_test, pred))

        names = pipeline.named_steps["preprocess"].get_feature_names_out()
        fitted_model = pipeline.named_steps["model"]
        if hasattr(fitted_model, "feature_importances_"):
            raw_importance = fitted_model.feature_importances_
        elif hasattr(fitted_model, "coef_"):
            raw_importance = np.abs(np.ravel(fitted_model.coef_))
        else:
            raw_importance = np.zeros(len(names))
        feature_importances = sorted(
            [{{"feature": str(name), "importance": float(score)}} for name, score in zip(names, raw_importance)],
            key=lambda item: item["importance"],
            reverse=True,
        )[:30]
        elapsed = time.perf_counter() - start
        result = {{
            "id": CONFIG["run_id"],
            "dataset_id": CONFIG["dataset_id"],
            "version_id": CONFIG["version_id"],
            "target": target,
            "features": features,
            "task_type": task_type,
            "model_type": model_type,
            "hyperparameters": params,
            "metrics": metrics,
            "feature_importances": feature_importances,
            "training_time_seconds": round(float(elapsed), 4),
            "created_at": datetime.utcnow().isoformat() + "Z",
        }}
        joblib.dump(pipeline, OUTPUT_DIR / "model.joblib")
        df.to_parquet(OUTPUT_DIR / "cleaned.parquet", index=False)
        (OUTPUT_DIR / "model_run.json").write_text(json.dumps(result, indent=2, default=json_default))
        (OUTPUT_DIR / "validation_report.json").write_text(json.dumps({{"status": "passed", "model": result, "checks": [{{"name": "model_trained", "passed": True}}]}}, indent=2, default=json_default))
        (OUTPUT_DIR / "cleaning_manifest.json").write_text(json.dumps({{"operation": "model_training", "model_run": CONFIG["run_id"]}}, indent=2))
        (OUTPUT_DIR / "execution_summary.json").write_text(json.dumps(result, indent=2, default=json_default))
        """
    ).strip()
