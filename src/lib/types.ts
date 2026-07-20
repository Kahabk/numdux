export type ColumnProfile = {
  name: string;
  original_type: string;
  inferred_type: string;
  null_count: number;
  null_percentage: number;
  unique_count: number;
  minimum: unknown;
  maximum: unknown;
  mean: number | null;
  median: number | null;
  mode: unknown;
  std: number | null;
  variance: number | null;
  quantiles: Record<string, unknown>;
  skewness: number | null;
  kurtosis: number | null;
  outlier_count: number;
  top_values: Array<{ value: string; count: number }>;
  rare_values: unknown[];
  invalid_values: unknown[];
  sensitive_data_probability: number;
};

export type DatasetProfile = {
  dataset_id: string;
  version_id: string;
  file_name: string;
  file_format: string;
  file_size: number;
  rows: number;
  columns: number;
  memory_usage: number;
  duplicate_rows: number;
  empty_rows: number;
  dataset_fingerprint: string;
  data_quality_score: number;
  column_metadata: ColumnProfile[];
  detected_problems: string[];
  sample_rows: Record<string, unknown>[];
  pearson_correlation: Record<string, Record<string, number | null>>;
  spearman_correlation: Record<string, Record<string, number | null>>;
  covariance_matrix: Record<string, Record<string, number | null>>;
  missingness_chart: Array<{ column: string; nulls: number; percent: number }>;
  numeric_distributions: Array<{ column: string; bins: Array<{ label: string; count: number }> }>;
  category_distributions: Array<{ column: string; values: Array<{ label: string; count: number }> }>;
};

export type DatasetReport = {
  title: string;
  subtitle: string;
  generated_at: string;
  report_type: string;
  dataset: Record<string, unknown>;
  metrics: Array<{ label: string; value: string; status: "success" | "warning" | "neutral"; description: string }>;
  findings: Array<{ severity: string; column: string; problem: string; affected_rows: number; percentage: number; examples: unknown[]; suggested_action: string; confidence: number; risk: string }>;
  columns: Array<Record<string, unknown>>;
  correlations: Record<string, Record<string, number | null>>;
  charts: Array<{ id: string; title: string; type: string; url: string; objective: string; dpi: number }>;
  analysis: { objective: string; method: string; summary: string; limitations: string; recommendation: string };
  run: CleaningRun | null;
};

export type DatasetVersion = {
  id: string;
  label: string;
  rows: number;
  columns: number;
  quality: number;
  fingerprint: string;
};

export type UploadResponse = {
  dataset_id: string;
  filename: string;
  storage_path: string;
  profile: DatasetProfile;
  versions: DatasetVersion[];
};

export type DatasetRecord = UploadResponse;

export type ChartType = "histogram" | "bar" | "line" | "scatter" | "box" | "heatmap" | "missingness";
export type ChartAgg = "count" | "sum" | "mean" | "min" | "max";
export type ChartFilter = {
  column: string;
  operator: "=" | "!=" | ">" | ">=" | "<" | "<=" | "contains" | "not_contains" | "is_null" | "not_null";
  value?: unknown;
};

export type ChartConfig = {
  id: string;
  dataset_id: string;
  version_id: string;
  chart_type: ChartType;
  x_field: string | null;
  y_field: string | null;
  groupby: string[];
  agg: ChartAgg;
  filters: ChartFilter[];
  title: string;
  created_at: string;
};

export type DatasetQueryResult = {
  dataset_id: string;
  version_id: string;
  rows: number;
  columns: string[];
  data: Record<string, unknown>[];
};

export type ModelTaskType = "auto" | "classification" | "regression";
export type ModelType = "logistic_regression" | "linear_regression" | "random_forest" | "gradient_boosting";
export type ModelTrainingRequest = {
  target: string;
  features: string[] | "auto";
  task_type: ModelTaskType;
  model_type: ModelType;
  hyperparameters: Record<string, unknown>;
  filter_expression?: string;
  use_pca?: boolean;
  pca_components?: number | null;
  tune_hyperparameters?: boolean;
};
export type ModelRunRecord = {
  id: string;
  dataset_id: string;
  version_id: string;
  target: string;
  features: string[];
  task_type: "classification" | "regression";
  model_type: ModelType;
  hyperparameters: Record<string, unknown>;
  filter_expression?: string;
  use_pca?: boolean;
  tune_hyperparameters?: boolean;
  metrics: Record<string, number | null>;
  feature_importances: Array<{ feature: string; importance: number }>;
  training_time_seconds: number;
  created_at: string;
  model_path: string;
  execution?: CleaningRun["execution"] | null;
};

export type CleaningOperation = {
  id: string;
  title: string;
  reason: string;
  columns: string[];
  operation_type: string;
  parameters: Record<string, unknown>;
  destructive: boolean;
  reversible: boolean;
  confidence: number;
};

export type AnalysisPlan = {
  summary: string;
  detected_issues: string[];
  operations: CleaningOperation[];
  risk_level: "low" | "medium" | "high";
  requires_approval: boolean;
};

export type CleaningRun = {
  run_id: string;
  dataset_id: string;
  plan: AnalysisPlan;
  generated_code: {
    language: "python";
    engine: "pandas" | "polars";
    code: string;
    expected_outputs: string[];
  };
  execution: {
    status: "success" | "failed" | "blocked";
    stdout: string;
    stderr: string;
    exit_code: number | null;
    duration_ms: number;
    generated_files: string[];
    validation_report: Record<string, any>;
    transformation_manifest: Record<string, any>;
    preview_rows: Record<string, unknown>[];
    cleaned_metadata: Record<string, any>;
    safety_errors: string[];
  };
  original_preview: Record<string, unknown>[];
  comparison: Record<string, unknown>;
};

export type SandboxTaskAttempt = {
  attempt: number;
  status: "success" | "failed" | "blocked";
  detected_error: string;
  applied_fix: string;
  duration_ms: number;
};

export type SandboxTaskResult = {
  task_id: string;
  dataset_id: string;
  sandbox_id: string;
  instruction: string;
  workflow: string[];
  generated_code: CleaningRun["generated_code"];
  execution: CleaningRun["execution"];
  attempts: SandboxTaskAttempt[];
  local_dataset_path: string;
};

export type SqlRunResult = {
  status: "success";
  rows: number;
  columns: string[];
  preview_rows: Record<string, unknown>[];
};
