from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Any, Literal


class ColumnProfile(BaseModel):
    name: str
    original_type: str
    inferred_type: str
    null_count: int
    null_percentage: float
    unique_count: int
    minimum: Any = None
    maximum: Any = None
    mean: float | None = None
    median: float | None = None
    mode: Any = None
    std: float | None = None
    variance: float | None = None
    quantiles: dict[str, Any] = Field(default_factory=dict)
    skewness: float | None = None
    kurtosis: float | None = None
    outlier_count: int = 0
    top_values: list[dict[str, Any]] = Field(default_factory=list)
    rare_values: list[Any] = Field(default_factory=list)
    invalid_values: list[Any] = Field(default_factory=list)
    string_patterns: list[str] = Field(default_factory=list)
    date_patterns: list[str] = Field(default_factory=list)
    category_cardinality: int | None = None
    sensitive_data_probability: float = 0.0


class DatasetProfile(BaseModel):
    dataset_id: str
    version_id: str
    file_name: str
    file_format: str
    file_size: int
    encoding: str
    rows: int
    columns: int
    memory_usage: int
    duplicate_rows: int
    empty_rows: int
    dataset_fingerprint: str
    data_quality_score: float
    column_metadata: list[ColumnProfile]
    pearson_correlation: dict[str, dict[str, float | None]] = Field(default_factory=dict)
    spearman_correlation: dict[str, dict[str, float | None]] = Field(default_factory=dict)
    covariance_matrix: dict[str, dict[str, float | None]] = Field(default_factory=dict)
    missingness_chart: list[dict[str, Any]] = Field(default_factory=list)
    numeric_distributions: list[dict[str, Any]] = Field(default_factory=list)
    category_distributions: list[dict[str, Any]] = Field(default_factory=list)
    detected_problems: list[str] = Field(default_factory=list)
    sample_rows: list[dict[str, Any]] = Field(default_factory=list)


class CleaningInstruction(BaseModel):
    dataset_id: str
    version_id: str | None = None
    instruction: str
    max_repair_attempts: int = 3


class CustomExecutionInstruction(BaseModel):
    dataset_id: str
    version_id: str | None = None
    code: str = Field(min_length=1)
    instruction: str = "Manual notebook execution"


class SqlExecutionInstruction(BaseModel):
    dataset_id: str
    version_id: str | None = None
    query: str = Field(min_length=1, max_length=20_000)


class SandboxTaskInstruction(BaseModel):
    dataset_id: str
    sandbox_id: str
    instruction: str = Field(min_length=1)
    version_id: str | None = None
    max_repair_attempts: int = Field(default=3, ge=0, le=8)


class AppSettingsUpdate(BaseModel):
    ai_provider: Literal["rule", "gemini"] = "rule"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash"


class ChartFilter(BaseModel):
    column: str
    operator: Literal["=", "!=", ">", ">=", "<", "<=", "contains", "not_contains", "is_null", "not_null"]
    value: Any = None


class ChartConfigCreate(BaseModel):
    version_id: str
    chart_type: Literal["histogram", "bar", "line", "scatter", "box", "heatmap", "missingness"]
    x_field: str | None = None
    y_field: str | None = None
    groupby: list[str] = Field(default_factory=list)
    agg: Literal["count", "sum", "mean", "min", "max"] = "count"
    filters: list[ChartFilter] = Field(default_factory=list)
    title: str = Field(min_length=1, max_length=160)


class ChartConfig(ChartConfigCreate):
    id: str
    dataset_id: str
    created_at: str


class DatasetQueryResponse(BaseModel):
    dataset_id: str
    version_id: str
    rows: int
    columns: list[str]
    data: list[dict[str, Any]]


class ModelTrainingRequest(BaseModel):
    target: str
    features: list[str] | Literal["auto"] = "auto"
    task_type: Literal["auto", "classification", "regression"] = "auto"
    model_type: Literal["logistic_regression", "linear_regression", "random_forest", "gradient_boosting"] = "random_forest"
    hyperparameters: dict[str, Any] = Field(default_factory=dict)


class ModelRunRecord(BaseModel):
    id: str
    dataset_id: str
    version_id: str
    target: str
    features: list[str]
    task_type: Literal["classification", "regression"]
    model_type: str
    hyperparameters: dict[str, Any] = Field(default_factory=dict)
    metrics: dict[str, float | None] = Field(default_factory=dict)
    feature_importances: list[dict[str, Any]] = Field(default_factory=list)
    training_time_seconds: float = 0.0
    created_at: str
    model_path: str = ""
    execution: dict[str, Any] | None = None


class CleaningOperation(BaseModel):
    id: str
    title: str
    reason: str
    columns: list[str]
    operation_type: str
    parameters: dict[str, Any] = Field(default_factory=dict)
    destructive: bool = False
    reversible: bool = True
    confidence: float = 0.0


class CleaningPlan(BaseModel):
    summary: str
    detected_issues: list[str]
    operations: list[CleaningOperation]
    risk_level: Literal["low", "medium", "high"]
    requires_approval: bool = True


class GeneratedCode(BaseModel):
    language: Literal["python"] = "python"
    engine: Literal["pandas", "polars"] = "pandas"
    code: str
    expected_outputs: list[str] = Field(
        default_factory=lambda: [
            "cleaned.parquet",
            "cleaning_manifest.json",
            "validation_report.json",
            "execution_summary.json",
        ]
    )


class ExecutionResult(BaseModel):
    status: Literal["success", "failed", "blocked"]
    stdout: str = ""
    stderr: str = ""
    exit_code: int | None = None
    duration_ms: int = 0
    resource_usage: dict[str, Any] = Field(default_factory=dict)
    generated_files: list[str] = Field(default_factory=list)
    validation_report: dict[str, Any] = Field(default_factory=dict)
    transformation_manifest: dict[str, Any] = Field(default_factory=dict)
    preview_rows: list[dict[str, Any]] = Field(default_factory=list)
    cleaned_metadata: dict[str, Any] = Field(default_factory=dict)
    safety_errors: list[str] = Field(default_factory=list)


class CleaningRunResponse(BaseModel):
    run_id: str
    dataset_id: str
    plan: CleaningPlan
    generated_code: GeneratedCode
    execution: ExecutionResult
    original_preview: list[dict[str, Any]]
    comparison: dict[str, Any]


class SandboxRepairAttempt(BaseModel):
    attempt: int
    status: Literal["success", "failed", "blocked"]
    detected_error: str = ""
    applied_fix: str = ""
    duration_ms: int = 0


class SandboxTaskResponse(BaseModel):
    task_id: str
    dataset_id: str
    sandbox_id: str
    instruction: str
    workflow: list[str]
    generated_code: GeneratedCode
    execution: ExecutionResult
    attempts: list[SandboxRepairAttempt]
    local_dataset_path: str
