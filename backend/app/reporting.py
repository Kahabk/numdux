from __future__ import annotations

from collections import Counter
from datetime import datetime
from io import BytesIO
import math
import os
from pathlib import Path
from typing import Any
import warnings

os.environ.setdefault("MPLCONFIGDIR", "/tmp/numdux-matplotlib")
warnings.filterwarnings("ignore", message="Unable to import Axes3D.*")

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages


REPORT_COLORS = {
    "ink": "#172033",
    "muted": "#61708a",
    "accent": "#4e6ed9",
    "success": "#4e8b69",
    "warning": "#b98236",
    "danger": "#b75252",
    "surface": "#f4f6fa",
    "line": "#dbe1eb",
}

REPORT_DARK_COLORS = {
    "ink": "#eef2f8",
    "muted": "#aeb9ca",
    "accent": "#7c97ff",
    "success": "#74b98b",
    "warning": "#d6a45c",
    "danger": "#dc7d7d",
    "surface": "#1b1f27",
    "line": "#343b49",
    "page": "#111318",
}


def build_report(dataset: dict[str, Any], run: dict[str, Any] | None = None, artifact_dir: Path | None = None, theme: str = "light", saved_charts: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    theme = "dark" if theme == "dark" else "light"
    profile = dataset["profile"]
    columns = profile.get("column_metadata", [])
    generated_at = datetime.utcnow().isoformat() + "Z"
    total_cells = max(profile.get("rows", 0) * profile.get("columns", 0), 1)
    null_cells = sum(column.get("null_count", 0) for column in columns)
    invalid_count = sum(len(column.get("invalid_values", [])) for column in columns)
    outlier_count = sum(column.get("outlier_count", 0) for column in columns)
    quality_score = _finite_float(profile.get("data_quality_score"), 0.0)
    findings = _findings(columns, profile.get("duplicate_rows", 0), profile.get("rows", 0))
    metric_items = [
        _metric("Quality score", f"{quality_score:.1f}%", "success" if quality_score >= 85 else "warning", "Composite profile score"),
        _metric("Rows", f"{profile.get('rows', 0):,}", "neutral", "Records in selected version"),
        _metric("Columns", str(profile.get("columns", 0)), "neutral", "Fields profiled"),
        _metric("Missing values", f"{null_cells / total_cells * 100:.1f}%", "warning" if null_cells else "success", f"{null_cells:,} cells"),
        _metric("Duplicate rows", f"{profile.get('duplicate_rows', 0):,}", "warning" if profile.get("duplicate_rows", 0) else "success", "Exact duplicate records"),
        _metric("Invalid values", f"{invalid_count:,}", "warning" if invalid_count else "success", "Detected format violations"),
        _metric("Outliers", f"{outlier_count:,}", "warning" if outlier_count else "success", "IQR-based candidates"),
        _metric("Detected issues", str(len(findings)), "warning" if findings else "success", "Profile findings"),
    ]
    report_columns = [_report_column(column, findings) for column in columns]
    report = {
        "title": f"Data Quality and Validation Report",
        "theme": theme,
        "subtitle": dataset["filename"],
        "generated_at": generated_at,
        "report_type": "Data Quality Report",
        "dataset": {
            "id": dataset["dataset_id"],
            "version_id": profile.get("version_id"),
            "filename": dataset["filename"],
            "rows": profile.get("rows"),
            "columns": profile.get("columns"),
            "file_format": profile.get("file_format"),
            "file_size": profile.get("file_size"),
            "memory_usage": profile.get("memory_usage"),
            "quality_score": quality_score,
            "duplicate_rows": profile.get("duplicate_rows"),
            "empty_rows": profile.get("empty_rows"),
            "fingerprint": profile.get("dataset_fingerprint"),
        },
        "metrics": metric_items,
        "findings": findings,
        "columns": report_columns,
        "correlations": profile.get("pearson_correlation", {}),
        "run": run,
        "analysis": _analysis(profile, findings, run, null_cells, invalid_count),
        "charts": [],
    }
    if artifact_dir:
        artifact_dir.mkdir(parents=True, exist_ok=True)
        report["charts"] = generate_chart_artifacts(profile, findings, artifact_dir, theme)
        if saved_charts:
            report["charts"].extend(generate_saved_chart_artifacts(saved_charts, artifact_dir, theme))
        report["artifact_dir"] = str(artifact_dir)
    return _json_safe(report)


def generate_chart_artifacts(profile: dict[str, Any], findings: list[dict[str, Any]], artifact_dir: Path, theme: str) -> list[dict[str, Any]]:
    colors = _colors(theme)
    charts: list[dict[str, Any]] = []
    missingness = profile.get("missingness_chart", [])[:12]
    charts.append(_save_bar_chart(
        artifact_dir, "missing-values.png", "Missing values by column",
        [item["column"] for item in missingness], [item["percent"] for item in missingness],
        "% missing", "Column completeness and missingness", horizontal=True, color=colors["accent"], theme=theme,
    ))
    completeness = [{"column": item["column"], "percent": round(100 - item["percent"], 2)} for item in missingness]
    charts.append(_save_bar_chart(
        artifact_dir, "column-completeness.png", "Column completeness",
        [item["column"] for item in completeness], [item["percent"] for item in completeness],
        "% complete", "Completeness by field", horizontal=True, color=colors["success"], theme=theme,
    ))
    types = Counter(column.get("inferred_type", "unknown") for column in profile.get("column_metadata", []))
    charts.append(_save_bar_chart(
        artifact_dir, "data-types.png", "Detected column types", list(types.keys()), list(types.values()),
        "Columns", "Data type profile", color=colors["warning"], theme=theme,
    ))
    severity = Counter(finding["severity"] for finding in findings)
    charts.append(_save_bar_chart(
        artifact_dir, "quality-findings.png", "Data-quality findings by severity", list(severity.keys()) or ["Informational"], list(severity.values()) or [0],
        "Findings", "Severity distribution", color=colors["danger"], theme=theme,
    ))
    distributions = profile.get("numeric_distributions", [])
    if distributions:
        distribution = distributions[0]
        charts.append(_save_bar_chart(
            artifact_dir, "numeric-distribution.png", f"{distribution['column']} distribution",
            [item["label"] for item in distribution["bins"]], [item["count"] for item in distribution["bins"]],
            "Records", f"Distribution of {distribution['column']}", color=colors["accent"], rotate=True, theme=theme,
        ))
    return charts


def generate_saved_chart_artifacts(saved_charts: list[dict[str, Any]], artifact_dir: Path, theme: str) -> list[dict[str, Any]]:
    colors = _colors(theme)
    charts: list[dict[str, Any]] = []
    for index, chart in enumerate(saved_charts[:8], start=1):
        rows = chart.get("data", [])
        if not rows:
            continue
        title = chart.get("title") or f"Saved chart {index}"
        chart_type = chart.get("chart_type", "bar")
        x_field = chart.get("x_field") or (chart.get("groupby") or [None])[0] or "metric"
        y_field = chart.get("y_field") or "value"
        filename = f"saved-chart-{index}.png"
        path = artifact_dir / filename
        fig, axis = plt.subplots(figsize=(8.8, 4.8), dpi=300)
        fig.patch.set_facecolor(colors.get("page", "white"))
        axis.set_facecolor(colors.get("page", "white"))
        x_values = [str(row.get(x_field, row.get("metric", index))) for index, row in enumerate(rows)]
        y_values = [_finite_float(row.get(y_field, row.get("value")), 0.0) for row in rows]
        if chart_type == "scatter":
            axis.scatter(range(len(y_values)), y_values, color=colors["accent"], s=22)
            axis.set_xticks(range(len(x_values)))
            axis.set_xticklabels(x_values, rotation=30, ha="right")
        elif chart_type == "line":
            axis.plot(x_values, y_values, color=colors["accent"], marker="o", linewidth=1.8)
            axis.tick_params(axis="x", rotation=30)
        else:
            axis.bar(x_values, y_values, color=colors["accent"])
            axis.tick_params(axis="x", rotation=30)
        axis.set_title(title, loc="left", fontsize=13, fontweight="bold", color=colors["ink"], pad=14)
        axis.set_ylabel(str(y_field), color=colors["muted"])
        axis.grid(axis="y", alpha=0.2, color=colors["muted"])
        axis.spines[["top", "right"]].set_visible(False)
        axis.tick_params(colors=colors["muted"], labelsize=9)
        fig.tight_layout()
        fig.savefig(path, dpi=300, bbox_inches="tight")
        plt.close(fig)
        charts.append({"id": path.stem, "title": title, "type": chart_type, "file": filename, "objective": "Saved Graph Studio chart", "dpi": 300, "width": 8.8, "height": 4.8})
    return charts


def _save_bar_chart(directory: Path, filename: str, title: str, labels: list[str], values: list[float], y_label: str, objective: str, horizontal: bool = False, color: str = "#4e6ed9", rotate: bool = False, theme: str = "light") -> dict[str, Any]:
    colors = _colors(theme)
    path = directory / filename
    fig, axis = plt.subplots(figsize=(8.8, 4.8), dpi=300)
    fig.patch.set_facecolor(colors.get("page", "white"))
    axis.set_facecolor(colors.get("page", "white"))
    if horizontal:
        axis.barh(labels[::-1], values[::-1], color=color)
        axis.set_xlabel(y_label, color=colors["muted"])
    else:
        axis.bar(labels, values, color=color)
        axis.set_ylabel(y_label, color=colors["muted"])
        if rotate:
            axis.tick_params(axis="x", rotation=30)
    axis.set_title(title, loc="left", fontsize=13, fontweight="bold", color=colors["ink"], pad=14)
    axis.grid(axis="y" if not horizontal else "x", alpha=0.2, color=colors["muted"])
    axis.spines[["top", "right"]].set_visible(False)
    axis.tick_params(colors=colors["muted"], labelsize=9)
    fig.tight_layout()
    fig.savefig(path, dpi=300, bbox_inches="tight")
    plt.close(fig)
    return {"id": path.stem, "title": title, "type": "bar", "file": filename, "objective": objective, "dpi": 300, "width": 8.8, "height": 4.8}


def report_pdf(report: dict[str, Any]) -> bytes:
    """Render a multipage visual PDF from the same structured report and chart artifacts."""
    buffer = BytesIO()
    with PdfPages(buffer) as pdf:
        _pdf_overview_page(pdf, report)
        if len(report.get("charts", [])) > 5:
            _pdf_graph_studio_page(pdf, report)
        _pdf_dictionary_page(pdf, report)
    return buffer.getvalue()


def _pdf_overview_page(pdf: PdfPages, report: dict[str, Any]) -> None:
    colors = _colors(report.get("theme", "light"))
    figure = plt.figure(figsize=(8.27, 11.69), facecolor=colors.get("page", "white"))
    figure.text(0.07, 0.95, report["title"], fontsize=21, fontweight="bold", color=colors["ink"])
    figure.text(0.07, 0.925, f"{report['subtitle']}  |  {report['dataset'].get('version_id')}  |  Generated {report['generated_at'][:10]}", fontsize=9, color=colors["muted"])
    metrics = report["metrics"]
    for index, metric in enumerate(metrics):
        col, row = index % 4, index // 4
        axis = figure.add_axes([0.07 + col * 0.22, 0.82 - row * 0.095, 0.19, 0.075])
        axis.set_facecolor(colors["surface"])
        axis.set_xticks([]); axis.set_yticks([])
        for spine in axis.spines.values(): spine.set_edgecolor(colors["line"])
        axis.text(0.06, 0.72, metric["label"].upper(), fontsize=7, color=colors["muted"], transform=axis.transAxes)
        axis.text(0.06, 0.35, metric["value"], fontsize=15, fontweight="bold", color=colors["ink"], transform=axis.transAxes)
        axis.text(0.06, 0.1, metric["description"], fontsize=6.5, color=colors["muted"], transform=axis.transAxes)
    charts = report.get("charts", [])[:4]
    for index, chart in enumerate(charts):
        col, row = index % 2, index // 2
        axis = figure.add_axes([0.07 + col * 0.45, 0.45 - row * 0.22, 0.41, 0.18])
        image_path = Path(report.get("artifact_dir", "")) / chart["file"]
        if image_path.exists(): axis.imshow(plt.imread(image_path))
        axis.set_axis_off()
        axis.set_title(chart["title"], loc="left", fontsize=9, color=colors["ink"], pad=4)
    figure.text(0.07, 0.13, "Key findings", fontsize=12, fontweight="bold", color=colors["ink"])
    for index, finding in enumerate(report.get("findings", [])[:4]):
        figure.text(0.08, 0.105 - index * 0.022, f"• {finding['column']}: {finding['problem']} Suggested action: {finding['suggested_action']}", fontsize=8, color=colors["ink"])
    figure.text(0.07, 0.025, "Numdux visual data-quality report  |  Page 1", fontsize=7, color=colors["muted"])
    pdf.savefig(figure, bbox_inches="tight")
    plt.close(figure)


def _pdf_dictionary_page(pdf: PdfPages, report: dict[str, Any]) -> None:
    colors = _colors(report.get("theme", "light"))
    figure, axis = plt.subplots(figsize=(11.69, 8.27), facecolor=colors.get("page", "white"))
    axis.set_facecolor(colors.get("page", "white"))
    axis.axis("off")
    axis.set_title("Column dictionary and quality status", loc="left", fontsize=18, fontweight="bold", color=colors["ink"], pad=18)
    headers = ["Column", "Type", "Nulls", "Unique", "Range / mean", "Issue", "Suggested action"]
    rows = []
    for column in report["columns"]:
        range_value = f"{column.get('minimum')}..{column.get('maximum')}"
        if column.get("mean") is not None: range_value += f" / {column['mean']}"
        rows.append([column["name"], column["type"], f"{column['null_count']} ({column['null_percentage']}%)", str(column["unique_count"]), range_value, column["issue"] or "None", column["suggested_action"]])
    table = axis.table(cellText=rows, colLabels=headers, cellLoc="left", colLoc="left", loc="upper center", colWidths=[0.14, 0.1, 0.12, 0.09, 0.18, 0.17, 0.2])
    table.auto_set_font_size(False); table.set_fontsize(7); table.scale(1, 1.5)
    for (row, _), cell in table.get_celld().items():
        cell.set_edgecolor(colors["line"])
        if row == 0:
            cell.set_facecolor(colors["ink"]); cell.get_text().set_color(colors.get("page", "white")); cell.get_text().set_weight("bold")
        elif row % 2 == 0: cell.set_facecolor(colors["surface"])
        else: cell.set_facecolor(colors.get("page", "white"))
        cell.get_text().set_color(colors["ink"] if row else colors.get("page", "white"))
    figure.text(0.07, 0.025, "Numdux visual data-quality report  |  Page 2", fontsize=7, color=colors["muted"])
    pdf.savefig(figure, bbox_inches="tight")
    plt.close(figure)


def _pdf_graph_studio_page(pdf: PdfPages, report: dict[str, Any]) -> None:
    colors = _colors(report.get("theme", "light"))
    figure = plt.figure(figsize=(11.69, 8.27), facecolor=colors.get("page", "white"))
    figure.text(0.06, 0.94, "Graph Studio charts", fontsize=18, fontweight="bold", color=colors["ink"])
    figure.text(0.06, 0.91, "Saved charts attached to this dataset version.", fontsize=9, color=colors["muted"])
    charts = report.get("charts", [])[5:11]
    for index, chart in enumerate(charts):
        col, row = index % 3, index // 3
        axis = figure.add_axes([0.06 + col * 0.31, 0.52 - row * 0.35, 0.28, 0.28])
        image_path = Path(report.get("artifact_dir", "")) / chart["file"]
        if image_path.exists():
            axis.imshow(plt.imread(image_path))
        axis.set_axis_off()
        axis.set_title(chart["title"], loc="left", fontsize=8, color=colors["ink"], pad=4)
    figure.text(0.06, 0.025, "Numdux visual data-quality report  |  Graph Studio", fontsize=7, color=colors["muted"])
    pdf.savefig(figure, bbox_inches="tight")
    plt.close(figure)


def _metric(label: str, value: str, status: str, description: str) -> dict[str, str]:
    return {"label": label, "value": value, "status": status, "description": description}


def _findings(columns: list[dict[str, Any]], duplicate_rows: int, rows: int) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for column in columns:
        if column.get("null_count", 0):
            percentage = column["null_percentage"]
            findings.append({"severity": "Critical" if percentage >= 50 else "Medium", "column": column["name"], "problem": f"{percentage}% missing values", "affected_rows": column["null_count"], "percentage": percentage, "examples": [], "suggested_action": "Review or impute missing values", "confidence": 0.95, "risk": "medium"})
        if column.get("invalid_values"):
            findings.append({"severity": "High", "column": column["name"], "problem": f"{len(column['invalid_values'])} invalid {column['inferred_type']} values", "affected_rows": len(column["invalid_values"]), "percentage": round(len(column["invalid_values"]) / max(rows, 1) * 100, 2), "examples": column["invalid_values"][:3], "suggested_action": "Flag invalid values and replace only after review", "confidence": 0.99, "risk": "low"})
        if column.get("outlier_count", 0):
            findings.append({"severity": "Low", "column": column["name"], "problem": f"{column['outlier_count']} statistical outlier candidates", "affected_rows": column["outlier_count"], "percentage": round(column["outlier_count"] / max(rows, 1) * 100, 2), "examples": [], "suggested_action": "Review outliers before removal", "confidence": 0.75, "risk": "medium"})
    if duplicate_rows:
        findings.append({"severity": "Medium", "column": "Dataset", "problem": f"{duplicate_rows} duplicate rows", "affected_rows": duplicate_rows, "percentage": round(duplicate_rows / max(rows, 1) * 100, 2), "examples": [], "suggested_action": "Deduplicate only after confirming record identity", "confidence": 0.95, "risk": "medium"})
    severity_order = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3, "Informational": 4}
    return sorted(findings, key=lambda item: severity_order[item["severity"]])[:30]


def _report_column(column: dict[str, Any], findings: list[dict[str, Any]]) -> dict[str, Any]:
    column_findings = [finding for finding in findings if finding["column"] == column["name"]]
    first = column_findings[0] if column_findings else None
    return {
        "name": column.get("name"), "type": column.get("inferred_type"), "original_type": column.get("original_type"),
        "null_count": column.get("null_count"), "null_percentage": column.get("null_percentage"), "unique_count": column.get("unique_count"),
        "invalid_count": len(column.get("invalid_values", [])), "minimum": column.get("minimum"), "maximum": column.get("maximum"),
        "mean": column.get("mean"), "median": column.get("median"), "outlier_count": column.get("outlier_count"),
        "issue": first["problem"] if first else None, "suggested_action": first["suggested_action"] if first else "No action required", "status": "review" if first else "ready",
    }


def _analysis(profile: dict[str, Any], findings: list[dict[str, Any]], run: dict[str, Any] | None, null_cells: int, invalid_count: int) -> dict[str, Any]:
    rows = profile.get("rows", 0)
    summary = f"The selected dataset version contains {rows:,} rows and {profile.get('columns', 0)} columns. "
    summary += f"Profiling found {len(findings)} reportable quality findings across {null_cells:,} missing cells and {invalid_count:,} invalid values."
    recommendation = "Review highlighted findings before applying destructive transformations."
    if run and run.get("execution", {}).get("status") == "success": recommendation = "Review the validated cleaning comparison, then approve only the intended immutable output version."
    return {"objective": "Assess data quality, completeness, and readiness for analysis.", "method": "Computed from the selected immutable dataset profile and validation outputs.", "summary": summary, "limitations": "Outliers are statistical candidates and should not be treated as invalid without domain review.", "recommendation": recommendation}


def _colors(theme: str) -> dict[str, str]:
    return REPORT_DARK_COLORS if theme == "dark" else {**REPORT_COLORS, "page": "#ffffff"}


def _finite_float(value: Any, default: float) -> float:
    if isinstance(value, float) and math.isfinite(value):
        return value
    if isinstance(value, int):
        return float(value)
    return default


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [_json_safe(item) for item in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if hasattr(value, "item"):
        try:
            return _json_safe(value.item())
        except Exception:
            return str(value)
    return value
