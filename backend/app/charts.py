from __future__ import annotations

from datetime import datetime
import json
from pathlib import Path
from typing import Any
import uuid

import pandas as pd

from .models import ChartConfig, ChartConfigCreate, ChartFilter, DatasetQueryResponse


AGGREGATIONS = {"count", "sum", "mean", "min", "max"}


class ChartConfigStore:
    def __init__(self, root: Path) -> None:
        self.root = root / "charts"
        self.root.mkdir(parents=True, exist_ok=True)

    def list(self, dataset_id: str) -> list[ChartConfig]:
        return [ChartConfig.model_validate(item) for item in self._read(dataset_id)]

    def get(self, dataset_id: str, chart_id: str) -> ChartConfig | None:
        return next((chart for chart in self.list(dataset_id) if chart.id == chart_id), None)

    def create(self, dataset_id: str, payload: ChartConfigCreate) -> ChartConfig:
        charts = self._read(dataset_id)
        chart = ChartConfig(
            id=f"chart_{uuid.uuid4().hex[:10]}",
            dataset_id=dataset_id,
            created_at=datetime.utcnow().isoformat() + "Z",
            **payload.model_dump(),
        )
        charts.append(chart.model_dump())
        self._write(dataset_id, charts)
        return chart

    def delete(self, dataset_id: str, chart_id: str) -> bool:
        charts = self._read(dataset_id)
        next_charts = [chart for chart in charts if chart.get("id") != chart_id]
        if len(next_charts) == len(charts):
            return False
        self._write(dataset_id, next_charts)
        return True

    def delete_dataset(self, dataset_id: str) -> None:
        path = self._path(dataset_id)
        if path.exists():
            path.unlink()

    def clear_all(self) -> None:
        for path in self.root.glob("*.json"):
            path.unlink()

    def _path(self, dataset_id: str) -> Path:
        safe = "".join(char for char in dataset_id if char.isalnum() or char in {"_", "-"})
        return self.root / f"{safe}.json"

    def _read(self, dataset_id: str) -> list[dict[str, Any]]:
        path = self._path(dataset_id)
        if not path.exists():
            return []
        return json.loads(path.read_text())

    def _write(self, dataset_id: str, data: list[dict[str, Any]]) -> None:
        self._path(dataset_id).write_text(json.dumps(data, indent=2))


def query_dataframe(
    dataframe: pd.DataFrame,
    dataset_id: str,
    version_id: str,
    groupby: list[str],
    aggregation: str,
    value_field: str | None,
    filters: list[ChartFilter],
    limit: int,
) -> DatasetQueryResponse:
    validate_columns(dataframe, groupby)
    if value_field:
        validate_columns(dataframe, [value_field])
    if aggregation not in AGGREGATIONS:
        raise ValueError(f"Unsupported aggregation '{aggregation}'.")

    frame = apply_filters(dataframe, filters)
    capped_limit = min(max(int(limit), 1), 2_000)
    group_fields = [column for column in groupby if column]

    if group_fields:
        grouped = frame.groupby(group_fields, dropna=False)
        if aggregation == "count":
            result = grouped.size().reset_index(name="value")
        else:
            if not value_field:
                raise ValueError("value_field is required for sum, mean, min, and max aggregations.")
            numeric = frame.copy()
            numeric[value_field] = pd.to_numeric(numeric[value_field], errors="coerce")
            result = getattr(numeric.groupby(group_fields, dropna=False)[value_field], aggregation)().reset_index(name="value")
        result = result.sort_values("value", ascending=False, kind="stable").head(capped_limit)
    else:
        if aggregation == "count":
            result = pd.DataFrame([{"metric": "count", "value": int(len(frame))}])
        elif value_field:
            numeric = pd.to_numeric(frame[value_field], errors="coerce")
            value = getattr(numeric, aggregation)()
            result = pd.DataFrame([{"metric": f"{aggregation}_{value_field}", "value": value}])
        else:
            result = frame.head(capped_limit)

    result = result.where(pd.notna(result), None)
    data = result.to_dict(orient="records")
    return DatasetQueryResponse(
        dataset_id=dataset_id,
        version_id=version_id,
        rows=len(data),
        columns=[str(column) for column in result.columns],
        data=data,
    )


def apply_filters(dataframe: pd.DataFrame, filters: list[ChartFilter]) -> pd.DataFrame:
    frame = dataframe
    for item in filters:
        validate_columns(frame, [item.column])
        series = frame[item.column]
        op = item.operator
        value = item.value
        if op == "is_null":
            mask = series.isna()
        elif op == "not_null":
            mask = series.notna()
        elif op in {"contains", "not_contains"}:
            mask = series.astype(str).str.contains(str(value or ""), case=False, na=False)
            if op == "not_contains":
                mask = ~mask
        else:
            left = pd.to_numeric(series, errors="coerce")
            right = pd.to_numeric(pd.Series([value]), errors="coerce").iloc[0]
            if pd.isna(right):
                left = series.astype(str)
                right = str(value)
            if op == "=":
                mask = left == right
            elif op == "!=":
                mask = left != right
            elif op == ">":
                mask = left > right
            elif op == ">=":
                mask = left >= right
            elif op == "<":
                mask = left < right
            elif op == "<=":
                mask = left <= right
            else:
                raise ValueError(f"Unsupported filter operator '{op}'.")
        frame = frame[mask]
    return frame


def validate_columns(dataframe: pd.DataFrame, columns: list[str]) -> None:
    missing = [column for column in columns if column and column not in dataframe.columns]
    if missing:
        raise ValueError(f"Unknown column(s): {', '.join(missing)}")
