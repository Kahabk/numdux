from __future__ import annotations

import hashlib
import io
import math
import re
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .models import ColumnProfile, DatasetProfile


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_RE = re.compile(r"^\+?[\d\s().-]{7,}$")


def load_dataset(content: bytes, filename: str) -> pd.DataFrame:
    suffix = Path(filename).suffix.lower()
    buffer = io.BytesIO(content)
    if suffix in {".xlsx", ".xls"}:
        return pd.read_excel(buffer)
    if suffix == ".parquet":
        return pd.read_parquet(buffer)
    if suffix in {".json", ".jsonl"}:
        return pd.read_json(buffer, lines=suffix == ".jsonl")
    sep = "\t" if suffix == ".tsv" else ","
    return pd.read_csv(buffer, sep=sep, low_memory=False)


def dataframe_fingerprint(df: pd.DataFrame) -> str:
    hashed = pd.util.hash_pandas_object(df, index=True).values
    return hashlib.sha256(hashed.tobytes()).hexdigest()


def safe_json(value: Any) -> Any:
    if pd.isna(value):
        return None
    if hasattr(value, "item"):
        return value.item()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def infer_type(series: pd.Series) -> str:
    if pd.api.types.is_numeric_dtype(series):
        return "numeric"
    if pd.api.types.is_datetime64_any_dtype(series):
        return "datetime"
    non_null = series.dropna().astype(str).head(200)
    if not non_null.empty:
        parsed = pd.to_datetime(non_null, errors="coerce", format="mixed")
        if parsed.notna().mean() > 0.8:
            return "datetime"
        email_rate = non_null.map(lambda v: bool(EMAIL_RE.match(v.strip()))).mean()
        if email_rate > 0.6:
            return "email"
    if series.nunique(dropna=True) <= max(20, len(series) * 0.05):
        return "categorical"
    return "string"


def column_profile(name: str, series: pd.Series) -> ColumnProfile:
    is_bool = pd.api.types.is_bool_dtype(series)
    numeric = pd.to_numeric(series, errors="coerce") if not pd.api.types.is_numeric_dtype(series) else series
    is_numeric = not is_bool and pd.api.types.is_numeric_dtype(numeric) and numeric.notna().sum() > 0
    top = series.dropna().astype(str).value_counts().head(8)
    rare = series.dropna().astype(str).value_counts()
    quantiles: dict[str, Any] = {}
    outliers = 0
    if is_numeric:
        q = numeric.quantile([0.25, 0.5, 0.75])
        quantiles = {str(k): safe_json(v) for k, v in q.items()}
        iqr = q.loc[0.75] - q.loc[0.25]
        if pd.notna(iqr) and iqr > 0:
            outliers = int(((numeric < q.loc[0.25] - 1.5 * iqr) | (numeric > q.loc[0.75] + 1.5 * iqr)).sum())

    values = series.dropna().astype(str).head(200)
    invalids: list[Any] = []
    inferred = infer_type(series)
    if inferred == "email":
        invalids = values[~values.map(lambda v: bool(EMAIL_RE.match(v.strip())))].head(10).tolist()

    sensitive_score = 0.0
    lower_name = name.lower()
    if any(token in lower_name for token in ["email", "phone", "ssn", "passport", "address"]):
        sensitive_score = 0.7
    if inferred == "email":
        sensitive_score = max(sensitive_score, 0.85)

    return ColumnProfile(
        name=name,
        original_type=str(series.dtype),
        inferred_type=inferred,
        null_count=int(series.isna().sum()),
        null_percentage=round(float(series.isna().mean() * 100), 2),
        unique_count=int(series.nunique(dropna=True)),
        minimum=safe_json(numeric.min()) if is_numeric else safe_json(series.dropna().min()) if series.dropna().size else None,
        maximum=safe_json(numeric.max()) if is_numeric else safe_json(series.dropna().max()) if series.dropna().size else None,
        mean=round(float(numeric.mean()), 4) if is_numeric else None,
        median=round(float(numeric.median()), 4) if is_numeric else None,
        mode=safe_json(series.mode(dropna=True).iloc[0]) if not series.mode(dropna=True).empty else None,
        std=round(float(numeric.std()), 4) if is_numeric and pd.notna(numeric.std()) else None,
        variance=round(float(numeric.var()), 4) if is_numeric and pd.notna(numeric.var()) else None,
        quantiles=quantiles,
        skewness=round(float(numeric.skew()), 4) if is_numeric and pd.notna(numeric.skew()) else None,
        kurtosis=round(float(numeric.kurtosis()), 4) if is_numeric and pd.notna(numeric.kurtosis()) else None,
        outlier_count=outliers,
        top_values=[{"value": k, "count": int(v)} for k, v in top.items()],
        rare_values=rare[rare == 1].head(8).index.tolist(),
        invalid_values=invalids,
        string_patterns=[],
        date_patterns=[],
        category_cardinality=int(series.nunique(dropna=True)) if inferred == "categorical" else None,
        sensitive_data_probability=sensitive_score,
    )


def profile_dataset(dataset_id: str, version_id: str, filename: str, content: bytes, df: pd.DataFrame) -> DatasetProfile:
    columns = [column_profile(str(col), df[col]) for col in df.columns]
    duplicate_rows = int(df.duplicated().sum())
    empty_rows = int(df.isna().all(axis=1).sum())
    total_cells = max(int(df.shape[0] * df.shape[1]), 1)
    null_rate = float(df.isna().sum().sum()) / total_cells
    dup_rate = duplicate_rows / max(len(df), 1)
    quality = max(0.0, min(100.0, 100.0 - null_rate * 45 - dup_rate * 35 - empty_rows / max(len(df), 1) * 20))
    numeric_df = df.select_dtypes(include="number")
    detected = []
    if duplicate_rows:
        detected.append(f"{duplicate_rows} duplicate rows")
    if empty_rows:
        detected.append(f"{empty_rows} fully empty rows")
    for col in columns:
        if col.null_count:
            detected.append(f"{col.name} has {col.null_percentage}% nulls")
        if col.invalid_values:
            detected.append(f"{col.name} has invalid {col.inferred_type} values")
        if col.outlier_count:
            detected.append(f"{col.name} has {col.outlier_count} statistical outliers")

    def matrix(method: str) -> dict[str, dict[str, float | None]]:
        if numeric_df.shape[1] < 2:
            return {}
        data = numeric_df.corr(method=method) if method != "cov" else numeric_df.cov()
        return {
            str(i): {str(j): safe_json(round(float(v), 4)) if pd.notna(v) else None for j, v in row.items()}
            for i, row in data.iterrows()
        }

    missingness_chart = [
        {"column": column.name, "nulls": column.null_count, "percent": column.null_percentage}
        for column in sorted(columns, key=lambda item: item.null_percentage, reverse=True)
    ]
    numeric_distributions: list[dict[str, Any]] = []
    for name in numeric_df.columns[:8]:
        values = pd.to_numeric(numeric_df[name], errors="coerce").dropna()
        if values.empty:
            continue
        low, high = float(values.min()), float(values.max())
        if low == high:
            bins = [{"label": str(round(low, 4)), "count": int(len(values))}]
        else:
            counts, edges = np.histogram(values, bins=min(12, max(4, int(math.sqrt(len(values))))))
            bins = [
                {"label": f"{edges[index]:.3g}-{edges[index + 1]:.3g}", "count": int(count)}
                for index, count in enumerate(counts)
            ]
        numeric_distributions.append({"column": str(name), "bins": bins})

    category_distributions: list[dict[str, Any]] = []
    for column in columns:
        if column.inferred_type not in {"categorical", "string", "email"}:
            continue
        values = df[column.name].dropna().astype(str).value_counts().head(8)
        if not values.empty:
            category_distributions.append({
                "column": column.name,
                "values": [{"label": str(label), "count": int(count)} for label, count in values.items()],
            })
        if len(category_distributions) >= 8:
            break

    return DatasetProfile(
        dataset_id=dataset_id,
        version_id=version_id,
        file_name=filename,
        file_format=Path(filename).suffix.lower().lstrip(".") or "csv",
        file_size=len(content),
        encoding="utf-8",
        rows=int(df.shape[0]),
        columns=int(df.shape[1]),
        memory_usage=int(df.memory_usage(deep=True).sum()),
        duplicate_rows=duplicate_rows,
        empty_rows=empty_rows,
        dataset_fingerprint=dataframe_fingerprint(df),
        data_quality_score=round(quality, 1),
        column_metadata=columns,
        pearson_correlation=matrix("pearson"),
        spearman_correlation=matrix("spearman"),
        covariance_matrix=matrix("cov"),
        missingness_chart=missingness_chart,
        numeric_distributions=numeric_distributions,
        category_distributions=category_distributions,
        detected_problems=detected[:30],
        sample_rows=df.head(20).where(pd.notna(df), None).to_dict(orient="records"),
    )
