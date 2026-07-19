from __future__ import annotations

import json
from pathlib import Path
from typing import Any
import uuid

import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response

from .ai import GeminiAIProvider, RuleBasedAIProvider, SYSTEM_PROMPT
from .config import get_settings, update_env_file
from .charts import ChartConfigStore, query_dataframe
from .modeling import ModelRunStore, train_model_in_sandbox
from .models import AppSettingsUpdate, ChartConfigCreate, ChartFilter, CleaningInstruction, CleaningPlan, CleaningRunResponse, CustomExecutionInstruction, ExecutionResult, GeneratedCode, ModelTrainingRequest, SandboxRepairAttempt, SandboxTaskInstruction, SandboxTaskResponse, SqlExecutionInstruction
from .profiler import load_dataset, profile_dataset
from .reporting import build_report, report_pdf
from .safety import validate_python_code
from .sandbox import SandboxManager
from .store import InMemoryStore
from .tasking import generate_task_code, infer_workflow, repair_task_code


ROOT = Path(__file__).resolve().parents[2]
STORAGE = ROOT / ".numdux_data"
store = InMemoryStore(STORAGE)
store.load_existing({"load": load_dataset, "profile": profile_dataset})
chart_store = ChartConfigStore(STORAGE)
model_store = ModelRunStore(STORAGE)
run_dirs: dict[str, Path] = {}
REPORTS = STORAGE / "reports"

app = FastAPI(title="Numdux Notebook API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/ai/system-prompt")
def system_prompt() -> dict[str, str]:
    return {"system_prompt": SYSTEM_PROMPT}


@app.get("/api/ai/provider")
def ai_provider_status(verify: bool = False) -> dict[str, Any]:
    settings = get_settings()
    provider = "gemini" if settings.ai_provider == "gemini" and settings.gemini_api_key else "rule"
    result = {
        "configured_provider": settings.ai_provider,
        "active_provider": provider,
        "gemini_model": settings.gemini_model,
        "has_gemini_api_key": bool(settings.gemini_api_key),
    }
    if verify and provider == "gemini":
        connected, error = GeminiAIProvider(settings.gemini_api_key, settings.gemini_model).verify_connection()
        result.update({"connection": "connected" if connected else "error", "connection_error": error})
    elif verify:
        result.update({"connection": "not_configured", "connection_error": "Set AI_PROVIDER=gemini and GEMINI_API_KEY in .env."})
    return result


@app.get("/api/settings")
def app_settings() -> dict[str, Any]:
    settings = get_settings()
    return {
        "ai_provider": settings.ai_provider,
        "gemini_model": settings.gemini_model,
        "has_gemini_api_key": bool(settings.gemini_api_key),
    }


@app.put("/api/settings")
def update_app_settings(request: AppSettingsUpdate) -> dict[str, Any]:
    provider = request.ai_provider.strip().lower()
    model = request.gemini_model.strip() or "gemini-3.5-flash"
    api_key = request.gemini_api_key.strip()
    if provider == "gemini" and not api_key and not get_settings().gemini_api_key:
        raise HTTPException(status_code=400, detail="Gemini API key is required when Gemini is selected.")
    updates = {
        "AI_PROVIDER": provider,
        "GEMINI_MODEL": model,
    }
    if api_key:
        updates["GEMINI_API_KEY"] = api_key
    update_env_file(updates)
    return app_settings()


@app.post("/api/datasets")
async def upload_dataset(file: UploadFile = File(...)) -> dict[str, Any]:
    file.file.seek(0)
    content = file.file.read()
    try:
        record = store.create_dataset(
            file.filename or "dataset.csv",
            content,
            {"load": load_dataset, "profile": profile_dataset},
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return serialize_dataset(record)


@app.get("/api/datasets")
def list_datasets() -> list[dict[str, Any]]:
    store.load_existing({"load": load_dataset, "profile": profile_dataset})
    records = sorted(
        store.datasets.values(),
        key=lambda record: record.versions[-1].path.stat().st_mtime,
        reverse=True,
    )
    return [serialize_dataset(record) for record in records]


@app.delete("/api/datasets/{dataset_id}")
def delete_dataset(dataset_id: str, confirm: str = "DELETE") -> dict[str, Any]:
    store.load_existing({"load": load_dataset, "profile": profile_dataset})
    if dataset_id not in store.datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    if confirm != "DELETE":
        raise HTTPException(status_code=400, detail="Type DELETE to confirm deleting this dataset.")
    record = store.get(dataset_id)
    for run in record.runs:
        run_dir = run_dirs.pop(run.run_id, None)
        if run_dir and run_dir.exists():
            import shutil

            shutil.rmtree(run_dir)
    store.delete_dataset(dataset_id)
    chart_store.delete_dataset(dataset_id)
    model_store.delete_dataset(dataset_id)
    report_dir = REPORTS / dataset_id
    if report_dir.exists():
        import shutil

        shutil.rmtree(report_dir)
    return {"status": "deleted", "dataset_id": dataset_id}


@app.get("/api/storage")
def storage_index() -> dict[str, Any]:
    store.load_existing({"load": load_dataset, "profile": profile_dataset})
    return {
        "root": str(STORAGE),
        "datasets": [
            {
                "dataset_id": record.id,
                "filename": record.filename,
                "storage_path": str(record.storage_path),
                "versions": [
                    {"id": version.id, "path": str(version.path), "label": version.label}
                    for version in record.versions
                ],
            }
            for record in sorted(
                store.datasets.values(),
                key=lambda item: item.versions[-1].path.stat().st_mtime,
                reverse=True,
            )
        ],
    }


@app.delete("/api/storage")
def delete_storage(confirm: str) -> dict[str, Any]:
    if confirm != "DELETE":
        raise HTTPException(status_code=400, detail='Type DELETE to confirm deleting all stored datasets, reports, and run outputs.')
    store.clear_all()
    chart_store.clear_all()
    model_store.clear_all()
    run_dirs.clear()
    REPORTS.mkdir(parents=True, exist_ok=True)
    return {"status": "deleted", "datasets": 0}


@app.get("/api/datasets/{dataset_id}")
def dataset_detail(dataset_id: str) -> dict[str, Any]:
    store.load_existing({"load": load_dataset, "profile": profile_dataset})
    if dataset_id not in store.datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    record = store.get(dataset_id)
    return {**serialize_dataset(record), "runs": [run.model_dump() for run in record.runs]}


@app.get("/api/datasets/{dataset_id}/versions/{version_id}")
def dataset_version(dataset_id: str, version_id: str) -> dict[str, Any]:
    if dataset_id not in store.datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    record = store.get(dataset_id)
    return serialize_dataset(record, get_version(record, version_id))


@app.get("/api/datasets/{dataset_id}/versions/{version_id}/query")
def dataset_version_query(
    dataset_id: str,
    version_id: str,
    groupby: list[str] = Query(default=[]),
    agg: str = "count",
    value_field: str | None = None,
    filters: str = "[]",
    limit: int = 500,
) -> dict[str, Any]:
    if dataset_id not in store.datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    record = store.get(dataset_id)
    version = get_version(record, version_id)
    try:
        parsed_filters = [ChartFilter.model_validate(item) for item in json.loads(filters or "[]")]
        dataframe = load_dataset(version.path.read_bytes(), version.path.name)
        result = query_dataframe(dataframe, dataset_id, version.id, groupby, agg, value_field, parsed_filters, limit)
        return result.model_dump()
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="filters must be a JSON array.") from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Dataset query failed: {exc}") from exc


@app.post("/api/datasets/{dataset_id}/versions/{version_id}/train")
def train_dataset_model(dataset_id: str, version_id: str, request: ModelTrainingRequest) -> dict[str, Any]:
    if dataset_id not in store.datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    record = store.get(dataset_id)
    version = get_version(record, version_id)
    columns = [column.name for column in version.profile.column_metadata]
    try:
        model_run, run_dir = train_model_in_sandbox(STORAGE, version.path, dataset_id, version.id, request, columns)
        saved = model_store.save(model_run, run_dir) if run_dir else model_run
        return saved.model_dump()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Model training failed: {exc}") from exc


@app.get("/api/datasets/{dataset_id}/models")
def list_model_runs(dataset_id: str) -> list[dict[str, Any]]:
    if dataset_id not in store.datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return [item.model_dump() for item in model_store.list(dataset_id)]


@app.get("/api/datasets/{dataset_id}/models/{run_id}")
def get_model_run(dataset_id: str, run_id: str) -> dict[str, Any]:
    if dataset_id not in store.datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    model_run = model_store.get(dataset_id, run_id)
    if not model_run:
        raise HTTPException(status_code=404, detail="Model run not found")
    return model_run.model_dump()


@app.get("/api/datasets/{dataset_id}/charts")
def list_chart_configs(dataset_id: str) -> list[dict[str, Any]]:
    if dataset_id not in store.datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return [chart.model_dump() for chart in chart_store.list(dataset_id)]


@app.post("/api/datasets/{dataset_id}/charts")
def create_chart_config(dataset_id: str, request: ChartConfigCreate) -> dict[str, Any]:
    if dataset_id not in store.datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    get_version(store.get(dataset_id), request.version_id)
    try:
        return chart_store.create(dataset_id, request).model_dump()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Chart config could not be saved: {exc}") from exc


@app.get("/api/datasets/{dataset_id}/charts/{chart_id}")
def get_chart_config(dataset_id: str, chart_id: str) -> dict[str, Any]:
    if dataset_id not in store.datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    chart = chart_store.get(dataset_id, chart_id)
    if not chart:
        raise HTTPException(status_code=404, detail="Chart config not found")
    return chart.model_dump()


@app.delete("/api/datasets/{dataset_id}/charts/{chart_id}")
def delete_chart_config(dataset_id: str, chart_id: str) -> dict[str, str]:
    if dataset_id not in store.datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    if not chart_store.delete(dataset_id, chart_id):
        raise HTTPException(status_code=404, detail="Chart config not found")
    return {"status": "deleted", "chart_id": chart_id}


@app.get("/api/datasets/{dataset_id}/report")
def dataset_report(dataset_id: str, run_id: str | None = None, version_id: str | None = None, theme: str = "light") -> dict[str, Any]:
    if dataset_id not in store.datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    record = store.get(dataset_id)
    run = next((item for item in reversed(record.runs) if item.run_id == run_id), None) if run_id else (record.runs[-1] if record.runs else None)
    version = get_version(record, version_id)
    report = build_report(
        serialize_dataset(record, version),
        run.model_dump() if run else None,
        REPORTS / dataset_id / version.id / ("dark" if theme == "dark" else "light"),
        theme,
        saved_charts=report_saved_charts(record, version),
    )
    for chart in report.get("charts", []):
        chart["url"] = f"/api/reports/{dataset_id}/{version.id}/{report['theme']}/assets/{chart['file']}"
    return report


@app.get("/api/datasets/{dataset_id}/report.pdf")
def dataset_report_pdf(dataset_id: str, run_id: str | None = None, version_id: str | None = None, theme: str = "light") -> Response:
    report = dataset_report(dataset_id, run_id, version_id, theme)
    filename = f"{Path(report['dataset']['filename']).stem or 'dataset'}-quality-report.pdf"
    return Response(
        content=report_pdf(report),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/reports/{dataset_id}/{version_id}/{theme}/assets/{filename}")
def report_asset(dataset_id: str, version_id: str, theme: str, filename: str) -> FileResponse:
    if Path(filename).name != filename:
        raise HTTPException(status_code=400, detail="Invalid report asset path")
    asset = REPORTS / dataset_id / version_id / ("dark" if theme == "dark" else "light") / filename
    if not asset.exists():
        raise HTTPException(status_code=404, detail="Report asset not found")
    return FileResponse(asset)


@app.post("/api/cleaning-runs")
def create_cleaning_run(request: CleaningInstruction) -> CleaningRunResponse:
    if request.dataset_id not in store.datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    record = store.get(request.dataset_id)
    version = get_version(record, request.version_id)
    metadata = version.profile.model_dump()
    provider = create_ai_provider()
    try:
        plan = provider.create_plan(request.instruction, metadata)
        generated = provider.generate_code(plan, metadata)
    except Exception:
        fallback = RuleBasedAIProvider()
        plan = fallback.create_plan(request.instruction, metadata)
        generated = fallback.generate_code(plan, metadata)
    return execute_run(request.dataset_id, record, plan, generated, version)


@app.post("/api/analysis-plans")
def create_analysis_plan(request: CleaningInstruction) -> CleaningPlan:
    if request.dataset_id not in store.datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    metadata = get_version(store.get(request.dataset_id), request.version_id).profile.model_dump()
    try:
        return create_ai_provider().create_plan(request.instruction, metadata)
    except Exception:
        return RuleBasedAIProvider().create_plan(request.instruction, metadata)


@app.post("/api/cleaning-runs/custom")
def create_custom_cleaning_run(request: CustomExecutionInstruction) -> CleaningRunResponse:
    if request.dataset_id not in store.datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    record = store.get(request.dataset_id)
    plan = CleaningPlan(
        summary=request.instruction or "Manual notebook execution.",
        detected_issues=[],
        operations=[],
        risk_level="medium",
        requires_approval=True,
    )
    return execute_run(request.dataset_id, record, plan, GeneratedCode(code=request.code), get_version(record, request.version_id))


@app.post("/api/sql-runs")
def execute_sql(request: SqlExecutionInstruction) -> dict[str, Any]:
    if request.dataset_id not in store.datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    query = request.query.strip()
    normalized = query.lower().lstrip()
    blocked = ("insert", "update", "delete", "drop", "alter", "attach", "copy", "install", "load", "pragma", "read_csv", "read_parquet")
    if not (normalized.startswith("select") or normalized.startswith("with")) or ";" in query or any(token in normalized for token in blocked):
        raise HTTPException(status_code=400, detail="Only one read-only SELECT or WITH query is allowed.")
    try:
        record = store.get(request.dataset_id)
        version = get_version(record, request.version_id)
        dataframe = load_dataset(version.path.read_bytes(), version.path.name)
        try:
            import duckdb

            connection = duckdb.connect(":memory:")
            connection.register("dataset", dataframe)
            result = connection.execute(query).fetchdf()
        except ModuleNotFoundError:
            import sqlite3

            connection = sqlite3.connect(":memory:")
            dataframe.to_sql("dataset", connection, index=False, if_exists="replace")
            result = pd.read_sql_query(query, connection)
        return {
            "status": "success",
            "rows": int(result.shape[0]),
            "columns": [str(column) for column in result.columns],
            "preview_rows": result.head(100).where(result.notna(), None).to_dict(orient="records"),
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"SQL execution failed: {exc}") from exc


@app.post("/api/sandbox-tasks")
def create_sandbox_task(request: SandboxTaskInstruction) -> SandboxTaskResponse:
    if request.dataset_id not in store.datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    record = store.get(request.dataset_id)
    version = get_version(record, request.version_id)
    metadata = version.profile.model_dump()
    generated = generate_task_code(request.instruction, metadata)
    workflow = infer_workflow(request.instruction)
    task_id = f"task_{uuid.uuid4().hex[:10]}"
    sandbox = SandboxManager(STORAGE)
    attempts: list[SandboxRepairAttempt] = []
    execution = ExecutionResult(status="failed", stderr="Task was not executed.")
    code = generated.code
    run_dir: Path | None = None

    for attempt_number in range(1, request.max_repair_attempts + 2):
        errors = validate_python_code(code)
        if errors:
            execution = ExecutionResult(
                status="blocked",
                stderr="\n".join(errors),
                safety_errors=errors,
                validation_report={"status": "blocked", "checks": [{"name": "safety_validation", "passed": False}]},
            )
            attempts.append(SandboxRepairAttempt(attempt=attempt_number, status="blocked", detected_error=execution.stderr, applied_fix="Stopped because generated code violated local safety policy."))
            break
        execution, run_dir = sandbox.run(version.path, code)
        detected_error = execution.stderr.strip() or ("" if execution.status == "success" else "Task did not produce the expected cleaned dataset output.")
        attempts.append(SandboxRepairAttempt(
            attempt=attempt_number,
            status=execution.status,
            detected_error=detected_error,
            applied_fix="No fix needed; execution completed successfully." if execution.status == "success" else "",
            duration_ms=execution.duration_ms,
        ))
        if execution.status == "success":
            break
        if attempt_number > request.max_repair_attempts:
            attempts[-1].applied_fix = "Retry limit reached; marked as non-recoverable."
            break
        code, fix = repair_task_code(code, detected_error, attempt_number)
        attempts[-1].applied_fix = fix

    generated = GeneratedCode(code=code, expected_outputs=generated.expected_outputs)
    if run_dir:
        run_dirs[task_id] = run_dir
    return SandboxTaskResponse(
        task_id=task_id,
        dataset_id=request.dataset_id,
        sandbox_id=request.sandbox_id,
        instruction=request.instruction,
        workflow=workflow,
        generated_code=generated,
        execution=execution,
        attempts=attempts,
        local_dataset_path=str(version.path),
    )


def execute_run(dataset_id: str, record, plan, generated: GeneratedCode, version=None) -> CleaningRunResponse:
    version = version or record.versions[-1]
    metadata = version.profile.model_dump()
    errors = validate_python_code(generated.code)
    run_id = f"run_{uuid.uuid4().hex[:10]}"
    if errors:
        execution = {
            "status": "blocked",
            "safety_errors": errors,
            "duration_ms": 0,
            "generated_files": [],
        }
        response = CleaningRunResponse(
            run_id=run_id,
            dataset_id=dataset_id,
            plan=plan,
            generated_code=generated,
            execution=execution,
            original_preview=metadata.get("sample_rows", []),
            comparison={},
        )
        record.runs.append(response)
        return response

    try:
        sandbox = SandboxManager(STORAGE)
        execution, run_dir = sandbox.run(version.path, generated.code)
        run_dirs[run_id] = run_dir
    except Exception as exc:
        execution = ExecutionResult(
            status="failed",
            stderr=f"Sandbox failed before returning a result: {exc}",
            validation_report={"status": "failed", "checks": [{"name": "sandbox_result", "passed": False}]},
        )
    comparison = build_comparison(metadata, execution.cleaned_metadata, execution.validation_report)
    response = CleaningRunResponse(
        run_id=run_id,
        dataset_id=dataset_id,
        plan=plan,
        generated_code=generated,
        execution=execution,
        original_preview=metadata.get("sample_rows", []),
        comparison=comparison,
    )
    record.runs.append(response)
    return response


@app.post("/api/cleaning-runs/{run_id}/approve")
def approve_run(run_id: str, dataset_id: str) -> dict[str, Any]:
    if dataset_id not in store.datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    if run_id not in run_dirs:
        raise HTTPException(status_code=404, detail="Run output not found")
    version = store.approve_run(dataset_id, run_id, run_dirs[run_id], {"profile": profile_dataset})
    return {"status": "approved", "version": serialize_version(version)}


@app.post("/api/sandbox-tasks/{task_id}/approve")
def approve_sandbox_task(task_id: str, dataset_id: str) -> dict[str, Any]:
    if dataset_id not in store.datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    if task_id not in run_dirs:
        raise HTTPException(status_code=404, detail="Task output not found")
    version = store.approve_run(dataset_id, task_id, run_dirs[task_id], {"profile": profile_dataset})
    return {"status": "approved", "version": serialize_version(version)}


@app.get("/api/sandbox-tasks/{task_id}/files/{filename}")
def sandbox_task_file(task_id: str, filename: str) -> FileResponse:
    if Path(filename).name != filename:
        raise HTTPException(status_code=400, detail="Invalid task asset path")
    run_dir = run_dirs.get(task_id)
    if not run_dir:
        raise HTTPException(status_code=404, detail="Task output not found")
    output = run_dir / "output" / filename
    if not output.exists() or not output.is_file():
        raise HTTPException(status_code=404, detail="Task file not found")
    return FileResponse(output, filename=filename)


@app.get("/api/datasets/{dataset_id}/export")
def export_current(dataset_id: str, version_id: str | None = None) -> FileResponse:
    if dataset_id not in store.datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    version = get_version(store.get(dataset_id), version_id)
    return FileResponse(version.path, filename=version.path.name)


def serialize_version(version) -> dict[str, Any]:
    return {
        "id": version.id,
        "label": version.label,
        "rows": version.profile.rows,
        "columns": version.profile.columns,
        "quality": version.profile.data_quality_score,
        "fingerprint": version.profile.dataset_fingerprint,
    }


def get_version(record, version_id: str | None = None):
    if not version_id:
        return record.versions[-1]
    version = next((item for item in record.versions if item.id == version_id), None)
    if not version:
        raise HTTPException(status_code=404, detail="Dataset version not found")
    return version


def serialize_dataset(record, version=None) -> dict[str, Any]:
    version = version or record.versions[-1]
    return {
        "dataset_id": record.id,
        "filename": record.filename,
        "storage_path": str(record.storage_path),
        "profile": version.profile.model_dump(),
        "versions": [serialize_version(v) for v in record.versions],
    }


def report_saved_charts(record, version) -> list[dict[str, Any]]:
    configs = [chart for chart in chart_store.list(record.id) if chart.version_id == version.id]
    if not configs:
        return []
    profile = version.profile.model_dump()
    dataframe: pd.DataFrame | None = None
    charts: list[dict[str, Any]] = []
    for chart in configs:
        data: list[dict[str, Any]] = []
        if chart.chart_type == "missingness":
            data = [{"column": item["column"], "value": item["percent"]} for item in profile.get("missingness_chart", [])[:30]]
        elif chart.chart_type == "heatmap":
            correlations = profile.get("pearson_correlation", {})
            data = [
                {"x": left, "y": right, "value": value}
                for left, values in correlations.items()
                for right, value in values.items()
                if value is not None
            ][:100]
        else:
            if dataframe is None:
                dataframe = load_dataset(version.path.read_bytes(), version.path.name)
            try:
                result = query_dataframe(
                    dataframe,
                    record.id,
                    version.id,
                    chart.groupby or ([chart.x_field] if chart.x_field else []),
                    chart.agg,
                    chart.y_field,
                    chart.filters,
                    100,
                )
                data = result.data
            except Exception:
                data = []
        charts.append({**chart.model_dump(), "data": data})
    return charts


def build_comparison(original: dict[str, Any], cleaned: dict[str, Any], validation: dict[str, Any]) -> dict[str, Any]:
    metrics = validation.get("metrics", {}) if validation else {}
    return {
        "rows_before": original.get("rows"),
        "rows_after": cleaned.get("rows"),
        "columns_before": original.get("columns"),
        "columns_after": cleaned.get("columns"),
        "duplicates_before": original.get("duplicate_rows"),
        "duplicates_after": cleaned.get("duplicate_rows"),
        "null_cells_before": sum(metrics.get("nulls_before", {}).values()) if metrics else None,
        "null_cells_after": sum(metrics.get("nulls_after", {}).values()) if metrics else cleaned.get("null_cells"),
        "transformed_values": metrics.get("transformed_values", 0),
        "validation_status": validation.get("status", "unknown") if validation else "unknown",
    }


def create_ai_provider():
    settings = get_settings()
    if settings.ai_provider == "gemini" and settings.gemini_api_key:
        return GeminiAIProvider(api_key=settings.gemini_api_key, model=settings.gemini_model)
    return RuleBasedAIProvider()
