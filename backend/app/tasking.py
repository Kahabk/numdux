from __future__ import annotations

import json
import re
from textwrap import dedent
from typing import Any

from .models import GeneratedCode


AUTO_STAGE_WORKFLOWS: dict[str, list[str]] = {
    "load_data": ["load_local_dataset", "inspect_data", "validate_outputs"],
    "explore_data": ["load_local_dataset", "explore_data", "validate_outputs"],
    "visualize_data": ["load_local_dataset", "visualize_data", "validate_outputs"],
    "clean_data": ["load_local_dataset", "clean_and_preprocess", "validate_outputs"],
    "feature_engineering": ["load_local_dataset", "feature_engineering", "validate_outputs"],
    "prepare_data": ["load_local_dataset", "feature_engineering", "prepare_data", "pca_variance", "validate_outputs"],
    "split_data": ["load_local_dataset", "feature_engineering", "prepare_data", "split_data", "validate_outputs"],
    "train_model": ["load_local_dataset", "feature_engineering", "prepare_data", "split_data", "train_model", "evaluate_model", "validate_outputs"],
    "tune_evaluate": ["load_local_dataset", "feature_engineering", "prepare_data", "split_data", "train_model", "evaluate_model", "validate_outputs"],
    "save_predict": ["load_local_dataset", "feature_engineering", "prepare_data", "split_data", "train_model", "evaluate_model", "generate_predictions", "validate_outputs"],
}


def _stage_id(instruction: str) -> str | None:
    match = re.search(r"AUTO_AGENT_STAGE_ID:\s*([a-z_]+)", instruction, flags=re.IGNORECASE)
    return match.group(1).lower() if match else None


def infer_workflow(instruction: str) -> list[str]:
    stage_id = _stage_id(instruction)
    if stage_id in AUTO_STAGE_WORKFLOWS:
        return AUTO_STAGE_WORKFLOWS[stage_id]
    text = instruction.lower()
    only_filter = "only" in text and "filter" in text and not any(token in text for token in ["clean", "train", "model"])
    model_tokens = ["train", "model", "random forest", "accuracy", "acuracy", "evaluate", "test", "score", "predict", "overfit", "hyperparameter", "best model"]
    only_train = "only" in text and any(token in text for token in model_tokens) and "clean" not in text and "filter" not in text
    workflow = ["load_local_dataset"]
    if not only_train:
        workflow.append("filter_rows" if "filter" in text else "clean_and_preprocess")
    if any(token in text for token in ["feature", "engineer", "encoding", "encode"]):
        workflow.append("feature_engineering")
    if any(token in text for token in model_tokens):
        workflow.extend(["train_model", "evaluate_model"])
    if any(token in text for token in ["predict", "prediction", "generate predictions"]):
        workflow.append("generate_predictions")
    workflow.append("validate_outputs")
    return list(dict.fromkeys(workflow))


def generate_task_code(instruction: str, metadata: dict[str, Any]) -> GeneratedCode:
    stage_id = _stage_id(instruction)
    workflow = infer_workflow(instruction)
    text = instruction.lower()
    staged_model = stage_id in {"train_model", "tune_evaluate", "save_predict"}
    staged_features = stage_id in {"feature_engineering", "prepare_data", "split_data", "train_model", "tune_evaluate", "save_predict"}
    staged_pca = stage_id in {"prepare_data", "train_model", "tune_evaluate", "save_predict"}
    staged_plots = stage_id in {"visualize_data", "tune_evaluate", "save_predict"}
    wants_model = staged_model or (stage_id is None and any(step in workflow for step in ["train_model", "evaluate_model", "generate_predictions"]))
    wants_features = staged_features or "feature_engineering" in workflow or wants_model
    wants_pca = staged_pca or (stage_id is None and any(token in text for token in ["pca", "variance", "dimensional", "dimension"]))
    wants_plots = staged_plots or (stage_id is None and any(token in text for token in ["plot", "chart", "visual", "review", "histogram", "confusion matrix"]))
    wants_auto_ml = stage_id in {"train_model", "tune_evaluate", "save_predict"} or (wants_model and stage_id is None and any(token in text for token in ["multiple", "best", "overfit", "hyperparameter", "optimization", "classify", "classification", "ensemble"]))
    wants_outliers = stage_id == "clean_data" or (stage_id is None and any(token in text for token in ["outlier", "outline", "extreme"]))
    wants_inspection = stage_id in {"load_data", "explore_data", "visualize_data"} or (stage_id is None and any(token in text for token in ["load", "explore", "inspect", "summary", "profile", "visualize", "histogram"]))
    wants_split = stage_id == "split_data" or wants_model
    required_plot_files = [
        "histograms.png",
        "pie_chart.png",
        "scatter_plot.png",
        "box_plot.png",
        "correlation_heatmap.png",
        "pair_plot.png",
        "missingness.png",
    ] if stage_id == "visualize_data" else []
    payload = {
        "stage_id": stage_id,
        "instruction": instruction,
        "workflow": workflow,
        "target_hint": _target_hint(instruction, metadata),
        "filter_hint": _filter_hint(instruction, metadata),
        "wants_model": wants_model,
        "wants_features": wants_features,
        "wants_pca": wants_pca,
        "wants_plots": wants_plots or wants_model,
        "wants_auto_ml": wants_auto_ml,
        "wants_outliers": wants_outliers,
        "wants_inspection": wants_inspection or wants_model or wants_features,
        "wants_split": wants_split,
        "required_plot_files": required_plot_files,
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

        numeric_source = df.select_dtypes(include=[np.number])
        categorical_source = df.select_dtypes(include=["object", "string", "category"])
        outlier_summary = {{}}
        for column in numeric_source.columns:
            series = pd.to_numeric(df[column], errors="coerce")
            q1 = series.quantile(0.25)
            q3 = series.quantile(0.75)
            iqr = q3 - q1
            if pd.notna(iqr) and iqr > 0:
                lower = q1 - 1.5 * iqr
                upper = q3 + 1.5 * iqr
                outlier_summary[str(column)] = int(((series < lower) | (series > upper)).sum())
        profile_summary = {{
            "rows": int(df.shape[0]),
            "columns": int(df.shape[1]),
            "column_names": [str(column) for column in df.columns],
            "numeric_columns": [str(column) for column in numeric_source.columns],
            "categorical_columns": [str(column) for column in categorical_source.columns],
            "missing_values": {{str(k): int(v) for k, v in before_nulls.items()}},
            "duplicate_rows": before_duplicates,
            "outliers_iqr": outlier_summary,
            "target_hint": TASK.get("target_hint"),
        }}
        (OUTPUT_DIR / "data_profile_summary.json").write_text(json.dumps(profile_summary, indent=2, default=json_default))
        record("load_explore_data", profile_summary)

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
            if TASK.get("wants_outliers"):
                for column in df.select_dtypes(include=[np.number]).columns:
                    series = pd.to_numeric(df[column], errors="coerce")
                    q1 = series.quantile(0.25)
                    q3 = series.quantile(0.75)
                    iqr = q3 - q1
                    if pd.notna(iqr) and iqr > 0:
                        lower = q1 - 1.5 * iqr
                        upper = q3 + 1.5 * iqr
                        affected = int(((series < lower) | (series > upper)).sum())
                        if affected:
                            df[column] = series.clip(lower, upper)
                            record("cap_outliers", {{"column": str(column), "rows_capped": affected, "lower": float(lower), "upper": float(upper)}})
            record("clean_and_preprocess", {{"rows": int(df.shape[0]), "columns": int(df.shape[1])}})

        feature_frame = df.copy()
        target = TASK.get("target_hint")
        if (TASK["wants_model"] or TASK.get("wants_split")) and target not in df.columns:
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

        pca_result = {{"status": "not_requested"}}
        numeric_features = feature_frame.select_dtypes(include=[np.number]).replace([np.inf, -np.inf], np.nan).fillna(0)
        prepared_features = numeric_features.copy()
        if TASK["wants_features"] and prepared_features.shape[1] > 0:
            try:
                from sklearn.preprocessing import StandardScaler
                scaled_values = StandardScaler().fit_transform(prepared_features)
                prepared_features = pd.DataFrame(scaled_values, columns=[str(column) for column in prepared_features.columns])
                record("prepare_data_encoding_scaling", {{"prepared_columns": int(prepared_features.shape[1]), "scaled_numeric": True}})
            except Exception as exc:
                record("prepare_data_error", {{"error": str(exc)}})
        if TASK.get("wants_pca") and numeric_features.shape[1] >= 2 and len(numeric_features) >= 3:
            try:
                from sklearn.decomposition import PCA
                from sklearn.preprocessing import StandardScaler

                scaled = StandardScaler().fit_transform(numeric_features)
                max_components = max(1, min(numeric_features.shape[1], len(numeric_features) - 1))
                pca = PCA(n_components=max_components, random_state=42)
                components = pca.fit_transform(scaled)
                cumulative = np.cumsum(pca.explained_variance_ratio_)
                kept_components = int(np.searchsorted(cumulative, 0.9) + 1)
                kept_components = max(1, min(kept_components, max_components))
                pca_frame = pd.DataFrame(components[:, :kept_components], columns=[f"pca_{{index + 1}}" for index in range(kept_components)])
                pca_frame.to_csv(OUTPUT_DIR / "pca_features.csv", index=False)
                pca_result = {{
                    "status": "success",
                    "input_features": int(numeric_features.shape[1]),
                    "kept_components": kept_components,
                    "explained_variance_ratio": [float(value) for value in pca.explained_variance_ratio_[:kept_components]],
                    "cumulative_variance": float(cumulative[kept_components - 1]),
                }}
                (OUTPUT_DIR / "pca_variance.json").write_text(json.dumps(pca_result, indent=2, default=json_default))
                record("pca_variance", pca_result)
            except Exception as exc:
                pca_result = {{"status": "failed", "error": str(exc)}}
                record("pca_error", pca_result)

        if TASK.get("wants_split") and not TASK["wants_model"] and target in df.columns and len(df) >= 5:
            try:
                from sklearn.model_selection import train_test_split
                X_split = prepared_features.copy()
                if X_split.shape[1] == 0:
                    X_split = pd.DataFrame({{"row_number": np.arange(len(df))}})
                y_split = df[target]
                is_classification_split = y_split.dtype == object or str(y_split.dtype).startswith("string") or y_split.nunique(dropna=True) <= 20
                stratify_split = y_split if is_classification_split and y_split.nunique(dropna=True) > 1 and y_split.nunique(dropna=True) <= 20 else None
                try:
                    X_train_preview, X_test_preview, y_train_preview, y_test_preview = train_test_split(X_split, y_split, test_size=0.2, random_state=42, stratify=stratify_split)
                except Exception:
                    X_train_preview, X_test_preview, y_train_preview, y_test_preview = train_test_split(X_split, y_split, test_size=0.2, random_state=42)
                split_summary = {{
                    "target": str(target),
                    "task_type": "classification" if is_classification_split else "regression",
                    "rows_total": int(len(X_split)),
                    "rows_train": int(len(X_train_preview)),
                    "rows_test": int(len(X_test_preview)),
                    "feature_count": int(X_split.shape[1]),
                    "stratified": bool(stratify_split is not None),
                }}
                (OUTPUT_DIR / "split_summary.json").write_text(json.dumps(split_summary, indent=2, default=json_default))
                record("split_data", split_summary)
            except Exception as exc:
                record("split_data_error", {{"error": str(exc)}})

        model_result = {{"status": "not_requested"}}
        predictions_rows = []
        if TASK["wants_model"] and target in df.columns and len(df) >= 5:
            y = df[target]
            X = prepared_features.copy()
            if X.shape[1] == 0:
                X = pd.DataFrame({{"row_number": np.arange(len(df))}})
            try:
                from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor, RandomForestClassifier, RandomForestRegressor
                from sklearn.linear_model import LinearRegression, LogisticRegression
                from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, mean_absolute_error, r2_score
                from sklearn.model_selection import GridSearchCV, train_test_split

                stratify = y if y.nunique(dropna=True) > 1 and y.nunique(dropna=True) <= 20 else None
                try:
                    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=stratify)
                except Exception:
                    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
                is_classification = y.dtype == object or str(y.dtype).startswith("string") or y.nunique(dropna=True) <= 20
                split_summary = {{
                    "target": str(target),
                    "task_type": "classification" if is_classification else "regression",
                    "rows_total": int(len(X)),
                    "rows_train": int(len(X_train)),
                    "rows_test": int(len(X_test)),
                    "feature_count": int(X.shape[1]),
                    "stratified": bool(stratify is not None),
                }}
                (OUTPUT_DIR / "split_summary.json").write_text(json.dumps(split_summary, indent=2, default=json_default))
                record("split_data", split_summary)
                if is_classification:
                    candidates = [
                        ("logistic_regression", LogisticRegression(max_iter=500)),
                        ("random_forest", RandomForestClassifier(n_estimators=120, random_state=42, n_jobs=-1)),
                        ("gradient_boosting", GradientBoostingClassifier(random_state=42)),
                    ]
                    grids = {{
                        "random_forest": {{"n_estimators": [80, 140], "max_depth": [None, 6, 12], "min_samples_leaf": [1, 3]}},
                        "gradient_boosting": {{"n_estimators": [80, 140], "learning_rate": [0.05, 0.1], "max_depth": [2, 3]}},
                        "logistic_regression": {{"C": [0.3, 1.0, 3.0]}},
                    }}
                else:
                    candidates = [
                        ("linear_regression", LinearRegression()),
                        ("random_forest", RandomForestRegressor(n_estimators=120, random_state=42, n_jobs=-1)),
                        ("gradient_boosting", GradientBoostingRegressor(random_state=42)),
                    ]
                    grids = {{
                        "random_forest": {{"n_estimators": [80, 140], "max_depth": [None, 6, 12], "min_samples_leaf": [1, 3]}},
                        "gradient_boosting": {{"n_estimators": [80, 140], "learning_rate": [0.05, 0.1], "max_depth": [2, 3]}},
                    }}

                comparisons = []
                best = None
                for name, base_model in candidates:
                    estimator = base_model
                    best_params = {{}}
                    if TASK.get("wants_auto_ml") and name in grids and len(X_train) >= 8:
                        cv_splits = min(3, len(X_train))
                        if is_classification:
                            class_counts = pd.Series(y_train).value_counts()
                            if len(class_counts):
                                cv_splits = min(cv_splits, int(class_counts.min()))
                        if cv_splits >= 2:
                            scoring = "accuracy" if is_classification else "r2"
                            search = GridSearchCV(base_model, grids[name], cv=cv_splits, scoring=scoring, n_jobs=-1)
                            search.fit(X_train, y_train)
                            estimator = search.best_estimator_
                            best_params = search.best_params_
                    estimator.fit(X_train, y_train)
                    train_pred = estimator.predict(X_train)
                    test_pred = estimator.predict(X_test)
                    if is_classification:
                        train_score = float(accuracy_score(y_train, train_pred))
                        test_score = float(accuracy_score(y_test, test_pred))
                        metrics = {{"accuracy": test_score, "f1": float(f1_score(y_test, test_pred, average="weighted", zero_division=0))}}
                    else:
                        train_score = float(r2_score(y_train, train_pred))
                        test_score = float(r2_score(y_test, test_pred))
                        metrics = {{"r2": test_score, "mae": float(mean_absolute_error(y_test, test_pred))}}
                    overfit_gap = float(train_score - test_score)
                    penalized_score = test_score - max(0.0, overfit_gap - 0.12)
                    comparison = {{
                        "name": name,
                        "train_score": train_score,
                        "test_score": test_score,
                        "overfit_gap": overfit_gap,
                        "penalized_score": penalized_score,
                        "metrics": metrics,
                        "best_params": best_params,
                    }}
                    comparisons.append(comparison)
                    if best is None or comparison["penalized_score"] > best["comparison"]["penalized_score"]:
                        best = {{"name": name, "model": estimator, "comparison": comparison, "pred": test_pred}}

                if best is None:
                    raise ValueError("No model candidates could be trained.")
                model = best["model"]
                pred = best["pred"]
                metrics = best["comparison"]["metrics"]
                predictions_rows = pd.DataFrame({{"actual": y_test.reset_index(drop=True), "prediction": pred}}).head(100).to_dict(orient="records")
                confusion_payload = {{"status": "not_classification"}}
                if is_classification:
                    labels = sorted(pd.Series(y_test).dropna().astype(str).unique().tolist())
                    matrix = confusion_matrix(pd.Series(y_test).astype(str), pd.Series(pred).astype(str), labels=labels)
                    confusion_df = pd.DataFrame(matrix, index=[f"actual_{{label}}" for label in labels], columns=[f"pred_{{label}}" for label in labels])
                    confusion_df.to_csv(OUTPUT_DIR / "confusion_matrix.csv")
                    confusion_payload = {{"status": "success", "labels": labels, "matrix": matrix.tolist()}}
                    (OUTPUT_DIR / "confusion_matrix.json").write_text(json.dumps(confusion_payload, indent=2, default=json_default))
                if hasattr(model, "feature_importances_"):
                    raw_importances = model.feature_importances_
                elif hasattr(model, "coef_"):
                    raw_importances = np.abs(np.ravel(model.coef_))
                else:
                    raw_importances = np.zeros(X.shape[1])
                importances = sorted(zip([str(c) for c in X.columns], raw_importances), key=lambda item: item[1], reverse=True)[:12]
                try:
                    import joblib
                    joblib.dump(model, OUTPUT_DIR / "best_model.joblib")
                except Exception as exc:
                    record("model_save_error", {{"error": str(exc)}})
                model_result = {{
                    "status": "success",
                    "target": str(target),
                    "task_type": "classification" if is_classification else "regression",
                    "model": best["name"],
                    "rows_train": int(len(X_train)),
                    "rows_test": int(len(X_test)),
                    "metrics": metrics,
                    "overfit_gap": best["comparison"]["overfit_gap"],
                    "model_comparison": comparisons,
                    "confusion_matrix": confusion_payload,
                    "feature_importance": [{{"feature": name, "importance": float(score)}} for name, score in importances],
                    "predictions_preview": predictions_rows[:20],
                    "pca": pca_result,
                }}
                (OUTPUT_DIR / "model_comparison.json").write_text(json.dumps(comparisons, indent=2, default=json_default))
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
        prepared_features.to_csv(OUTPUT_DIR / "prepared_features.csv", index=False)
        if predictions_rows:
            pd.DataFrame(predictions_rows).to_csv(OUTPUT_DIR / "predictions.csv", index=False)
        plot_files = []
        plot_errors = []
        if TASK.get("wants_plots"):
            try:
                import matplotlib
                matplotlib.use("Agg")
                import matplotlib.pyplot as plt
                try:
                    import seaborn as sns
                    sns.set_theme(style="whitegrid")
                except Exception:
                    sns = None

                numeric_plot_columns = list(df.select_dtypes(include=[np.number]).columns[:8])
                if numeric_plot_columns:
                    axes = df[numeric_plot_columns].hist(figsize=(10, 7), bins=24, color="#6c8cff")
                    for axis in np.ravel(axes):
                        axis.tick_params(labelsize=7)
                    plt.suptitle("Numeric histograms")
                    plt.tight_layout()
                    plt.savefig(OUTPUT_DIR / "histograms.png", dpi=150)
                    plt.close()
                    plot_files.append("histograms.png")
                categorical_plot_columns = list(df.select_dtypes(include=["object", "string", "category"]).columns)
                low_cardinality_columns = [
                    column for column in df.columns
                    if 1 < df[column].nunique(dropna=True) <= 12
                ]
                pie_column = categorical_plot_columns[0] if categorical_plot_columns else (low_cardinality_columns[-1] if low_cardinality_columns else None)
                if pie_column is not None:
                    counts = df[pie_column].astype(str).value_counts().head(8)
                    pie_title = f"Category share: {{pie_column}}"
                elif numeric_plot_columns:
                    pie_column = numeric_plot_columns[0]
                    binned = pd.qcut(pd.to_numeric(df[pie_column], errors="coerce"), q=4, duplicates="drop")
                    counts = binned.astype(str).value_counts().head(8)
                    pie_title = f"Quartile share: {{pie_column}}"
                else:
                    counts = pd.Series(dtype=int)
                    pie_title = "Category share"
                if len(counts) > 1:
                    plt.figure(figsize=(6, 6))
                    plt.pie(counts.values, labels=counts.index.astype(str), autopct="%1.1f%%", startangle=90)
                    plt.title(pie_title)
                    plt.tight_layout()
                    plt.savefig(OUTPUT_DIR / "pie_chart.png", dpi=150)
                    plt.close()
                    plot_files.append("pie_chart.png")
                if len(numeric_plot_columns) >= 2:
                    x_column, y_column = numeric_plot_columns[0], numeric_plot_columns[1]
                    plt.figure(figsize=(7, 5))
                    if sns is not None:
                        sns.scatterplot(data=df, x=x_column, y=y_column, hue=categorical_plot_columns[0] if categorical_plot_columns else None, s=34)
                    else:
                        plt.scatter(df[x_column], df[y_column], s=24, alpha=0.75, color="#6c8cff")
                    plt.title(f"Scatter: {{x_column}} vs {{y_column}}")
                    plt.tight_layout()
                    plt.savefig(OUTPUT_DIR / "scatter_plot.png", dpi=150)
                    plt.close()
                    plot_files.append("scatter_plot.png")
                    plt.figure(figsize=(9, 5))
                    if sns is not None:
                        melted = df[numeric_plot_columns[:6]].melt(var_name="feature", value_name="value")
                        sns.boxplot(data=melted, x="feature", y="value")
                        plt.xticks(rotation=35, ha="right")
                    else:
                        plt.boxplot([pd.to_numeric(df[column], errors="coerce").dropna() for column in numeric_plot_columns[:6]], labels=numeric_plot_columns[:6])
                        plt.xticks(rotation=35, ha="right")
                    plt.title("Numeric box plots")
                    plt.tight_layout()
                    plt.savefig(OUTPUT_DIR / "box_plot.png", dpi=150)
                    plt.close()
                    plot_files.append("box_plot.png")
                if len(numeric_plot_columns) >= 2:
                    corr = df[numeric_plot_columns].corr(numeric_only=True)
                    plt.figure(figsize=(8, 6))
                    if sns is not None:
                        sns.heatmap(corr, annot=True, fmt=".2f", cmap="coolwarm", center=0)
                    else:
                        plt.imshow(corr, cmap="coolwarm", vmin=-1, vmax=1)
                        plt.colorbar()
                        plt.xticks(range(len(corr.columns)), corr.columns, rotation=45, ha="right")
                        plt.yticks(range(len(corr.index)), corr.index)
                    plt.title("Correlation heatmap")
                    plt.tight_layout()
                    plt.savefig(OUTPUT_DIR / "correlation_heatmap.png", dpi=150)
                    plt.close()
                    plot_files.append("correlation_heatmap.png")
                if len(numeric_plot_columns) >= 2:
                    sample_df = df[numeric_plot_columns[:5]].sample(min(len(df), 300), random_state=42) if len(df) > 300 else df[numeric_plot_columns[:5]]
                    if sns is not None:
                        pair_grid = sns.pairplot(sample_df)
                        pair_grid.fig.suptitle("Pair plot", y=1.02)
                        pair_grid.savefig(OUTPUT_DIR / "pair_plot.png", dpi=150)
                        plt.close(pair_grid.fig)
                    else:
                        from pandas.plotting import scatter_matrix
                        axes = scatter_matrix(sample_df, figsize=(9, 9), diagonal="hist", color="#6c8cff", alpha=0.7)
                        for axis in np.ravel(axes):
                            axis.tick_params(labelsize=6)
                        plt.suptitle("Pair plot")
                        plt.tight_layout()
                        plt.savefig(OUTPUT_DIR / "pair_plot.png", dpi=150)
                        plt.close()
                    plot_files.append("pair_plot.png")
                missing_counts = pd.Series(before_nulls).sort_values(ascending=False)
                plt.figure(figsize=(8, 4))
                missing_counts.head(30).plot(kind="bar", color="#d4a35f")
                plt.ylabel("missing cells")
                plt.title("Missingness before cleaning")
                plt.xticks(rotation=45, ha="right")
                plt.tight_layout()
                plt.savefig(OUTPUT_DIR / "missingness.png", dpi=150)
                plt.close()
                plot_files.append("missingness.png")

                if model_result.get("status") == "success" and model_result.get("model_comparison"):
                    comparison_df = pd.DataFrame(model_result["model_comparison"])
                    plt.figure(figsize=(7, 4))
                    plt.bar(comparison_df["name"], comparison_df["test_score"], color="#6c8cff")
                    plt.ylabel("test score")
                    plt.title("Model comparison")
                    plt.xticks(rotation=20, ha="right")
                    plt.tight_layout()
                    plt.savefig(OUTPUT_DIR / "model_comparison.png", dpi=150)
                    plt.close()
                    plot_files.append("model_comparison.png")
                if model_result.get("status") == "success" and model_result.get("feature_importance"):
                    importance_df = pd.DataFrame(model_result["feature_importance"]).head(12)
                    plt.figure(figsize=(7, 4))
                    plt.barh(importance_df["feature"][::-1], importance_df["importance"][::-1], color="#6faf83")
                    plt.title("Feature importance")
                    plt.tight_layout()
                    plt.savefig(OUTPUT_DIR / "feature_importance.png", dpi=150)
                    plt.close()
                    plot_files.append("feature_importance.png")
                confusion_payload = model_result.get("confusion_matrix", {{}})
                if confusion_payload.get("status") == "success":
                    matrix = np.array(confusion_payload.get("matrix", []))
                    labels = confusion_payload.get("labels", [])
                    plt.figure(figsize=(6, 5))
                    if sns is not None:
                        sns.heatmap(matrix, annot=True, fmt="d", cmap="Blues", xticklabels=labels, yticklabels=labels)
                    else:
                        plt.imshow(matrix, cmap="Blues")
                        for row in range(matrix.shape[0]):
                            for col in range(matrix.shape[1]):
                                plt.text(col, row, str(int(matrix[row, col])), ha="center", va="center")
                        plt.xticks(range(len(labels)), labels, rotation=45, ha="right")
                        plt.yticks(range(len(labels)), labels)
                    plt.xlabel("Predicted")
                    plt.ylabel("Actual")
                    plt.title("Confusion matrix")
                    plt.tight_layout()
                    plt.savefig(OUTPUT_DIR / "confusion_matrix.png", dpi=150)
                    plt.close()
                    plot_files.append("confusion_matrix.png")
                if pca_result.get("status") == "success":
                    plt.figure(figsize=(7, 4))
                    values = pca_result.get("explained_variance_ratio", [])
                    plt.plot(range(1, len(values) + 1), np.cumsum(values), marker="o", color="#d4a35f")
                    plt.ylim(0, 1.05)
                    plt.xlabel("components")
                    plt.ylabel("cumulative explained variance")
                    plt.title("PCA variance review")
                    plt.tight_layout()
                    plt.savefig(OUTPUT_DIR / "pca_variance.png", dpi=150)
                    plt.close()
                    plot_files.append("pca_variance.png")
                if predictions_rows:
                    preview_df = pd.DataFrame(predictions_rows).head(40)
                    plt.figure(figsize=(7, 4))
                    plt.plot(preview_df.index, preview_df["actual"].astype(str), label="actual", marker="o", linewidth=1)
                    plt.plot(preview_df.index, preview_df["prediction"].astype(str), label="prediction", marker="x", linewidth=1)
                    plt.legend()
                    plt.title("Prediction review")
                    plt.tight_layout()
                    plt.savefig(OUTPUT_DIR / "prediction_review.png", dpi=150)
                    plt.close()
                    plot_files.append("prediction_review.png")
            except Exception as exc:
                plot_errors.append(str(exc))
                record("plot_error", {{"error": str(exc)}})
        required_plot_files = TASK.get("required_plot_files", [])
        missing_required_plots = [file for file in required_plot_files if not (OUTPUT_DIR / file).exists()]
        if missing_required_plots:
            record("required_plot_error", {{"missing_files": missing_required_plots, "plot_errors": plot_errors}})
        if TASK["wants_model"]:
            accuracy_report = {{
                "status": model_result.get("status"),
                "target": model_result.get("target"),
                "model": model_result.get("model"),
                "rows_train": model_result.get("rows_train"),
                "rows_test": model_result.get("rows_test"),
                "metrics": model_result.get("metrics", {{}}),
                "overfit_gap": model_result.get("overfit_gap"),
                "model_comparison": model_result.get("model_comparison", []),
                "confusion_matrix": model_result.get("confusion_matrix", {{}}),
                "pca": pca_result,
                "plots": plot_files,
                "message": "Classification accuracy is reported when the target is categorical. Regression tasks report r2 and mae.",
            }}
            (OUTPUT_DIR / "model_accuracy_report.json").write_text(json.dumps(accuracy_report, indent=2, default=json_default))

        after_nulls = df.isna().sum().to_dict()
        validation = {{
            "status": "passed" if cleaned_path.exists() and not missing_required_plots else "failed",
            "workflow": TASK["workflow"],
            "checks": [
                {{"name": "local_dataset_loaded", "passed": original_shape[0] >= 0}},
                {{"name": "cleaned_dataset_written", "passed": cleaned_path.exists()}},
                {{"name": "columns_available", "passed": df.shape[1] > 0}},
                {{"name": "required_plots_written", "passed": not missing_required_plots, "missing_files": missing_required_plots}},
            ],
            "metrics": {{
                "nulls_before": {{str(k): int(v) for k, v in before_nulls.items()}},
                "nulls_after": {{str(k): int(v) for k, v in after_nulls.items()}},
                "duplicates_before": before_duplicates,
                "duplicates_after": int(df.duplicated().sum()),
                "transformed_values": int(sum(max(0, before_nulls.get(k, 0) - after_nulls.get(k, 0)) for k in before_nulls)),
            }},
            "model": model_result,
            "pca": pca_result,
            "plots": plot_files,
            "plot_errors": plot_errors,
            "missing_required_plots": missing_required_plots,
        }}
        manifest = {{
            "instruction": TASK["instruction"],
            "workflow": TASK["workflow"],
            "local_input_path": str(INPUT_PATH),
            "outputs": ["cleaned.parquet", "cleaned.csv", "features.csv", "prepared_features.csv", "data_profile_summary.json", "validation_report.json", "execution_summary.json"] + (["split_summary.json"] if TASK["wants_model"] else []) + (["pca_features.csv", "pca_variance.json"] if pca_result.get("status") == "success" else []) + (["model_accuracy_report.json", "model_comparison.json", "best_model.joblib"] if TASK["wants_model"] else []) + (["confusion_matrix.csv", "confusion_matrix.json"] if model_result.get("confusion_matrix", {{}}).get("status") == "success" else []) + plot_files,
            "steps": steps,
        }}
        summary = {{
            "status": validation["status"],
            "dataset_shape_before": [int(original_shape[0]), int(original_shape[1])],
            "dataset_shape_after": [int(df.shape[0]), int(df.shape[1])],
            "model": model_result,
            "pca": pca_result,
            "plots": plot_files,
            "generated_at": datetime.utcnow().isoformat() + "Z",
        }}
        (OUTPUT_DIR / "cleaning_manifest.json").write_text(json.dumps(manifest, indent=2, default=json_default))
        (OUTPUT_DIR / "validation_report.json").write_text(json.dumps(validation, indent=2, default=json_default))
        (OUTPUT_DIR / "execution_summary.json").write_text(json.dumps(summary, indent=2, default=json_default))
        """
    ).strip()
    return GeneratedCode(code=code, expected_outputs=["cleaned.parquet", "cleaned.csv", "features.csv", "prepared_features.csv", "data_profile_summary.json", "validation_report.json", "execution_summary.json", "model_accuracy_report.json", "predictions.csv"])


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
