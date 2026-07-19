import { useMutation, useQuery } from "@tanstack/react-query";
import { BrainCircuit, Play, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { listModelRuns, trainModel } from "../lib/api";
import type { ModelRunRecord, ModelTaskType, ModelType, UploadResponse } from "../lib/types";
import { GraphPreview } from "./GraphStudio";

const TASK_TYPES: ModelTaskType[] = ["auto", "classification", "regression"];
const MODEL_TYPES: ModelType[] = ["random_forest", "gradient_boosting", "logistic_regression", "linear_regression"];

export function ModelLab({ dataset }: { dataset: UploadResponse }) {
  const columns = dataset.profile.column_metadata.map((column) => column.name);
  const headVersionId = dataset.profile.version_id;
  const [target, setTarget] = useState(columns[columns.length - 1] ?? "");
  const [features, setFeatures] = useState<string[]>(columns.filter((column) => column !== target));
  const [autoFeatures, setAutoFeatures] = useState(true);
  const [taskType, setTaskType] = useState<ModelTaskType>("auto");
  const [modelType, setModelType] = useState<ModelType>("random_forest");
  const [nEstimators, setNEstimators] = useState(120);
  const [maxDepth, setMaxDepth] = useState("");
  const [learningRate, setLearningRate] = useState("0.1");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const runs = useQuery({ queryKey: ["model-runs", dataset.dataset_id], queryFn: () => listModelRuns(dataset.dataset_id) });
  const train = useMutation({
    mutationFn: () => trainModel(dataset.dataset_id, dataset.profile.version_id, {
      target,
      features: autoFeatures ? "auto" : features,
      task_type: taskType,
      model_type: modelType,
      hyperparameters: hyperparameters(modelType, nEstimators, maxDepth, learningRate),
    }),
    onSuccess: (run) => {
      setSelectedRunId(run.id);
      runs.refetch();
    },
  });
  const sortedRuns = useMemo(() => [...(runs.data ?? [])].sort((a, b) => keyMetricValue(b) - keyMetricValue(a)), [runs.data]);
  const selectedRun = sortedRuns.find((run) => run.id === selectedRunId) ?? sortedRuns[0] ?? train.data;
  const status = train.isPending ? "running" : train.error ? "failed" : train.data ? "success" : "idle";

  function updateTarget(nextTarget: string) {
    setTarget(nextTarget);
    if (autoFeatures) setFeatures(columns.filter((column) => column !== nextTarget));
  }

  return (
    <div className="model-lab">
      <div className="model-trainer">
        <div className="model-lab-heading"><BrainCircuit className="h-4 w-4 text-accent" /><div><div className="text-sm font-medium text-ink">Model Lab</div><div className="text-xs text-muted">Training uses immutable version {headVersionId} and local sandbox execution.</div></div></div>
        <div className="model-form-grid">
          <label className="settings-field"><span>Target</span><select className="settings-input" value={target} onChange={(event) => updateTarget(event.target.value)}>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>
          <label className="settings-field"><span>Task type</span><select className="settings-input" value={taskType} onChange={(event) => setTaskType(event.target.value as ModelTaskType)}>{TASK_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label className="settings-field"><span>Model</span><select className="settings-input" value={modelType} onChange={(event) => setModelType(event.target.value as ModelType)}>{MODEL_TYPES.map((item) => <option key={item} value={item}>{item.split("_").join(" ")}</option>)}</select></label>
          <label className="settings-field"><span>Features</span><select className="settings-input" multiple disabled={autoFeatures} value={features} onChange={(event) => setFeatures(Array.from(event.target.selectedOptions).map((option) => option.value))}>{columns.filter((column) => column !== target).map((column) => <option key={column} value={column}>{column}</option>)}</select></label>
          <label className="settings-field model-checkbox"><span>Auto features</span><input type="checkbox" checked={autoFeatures} onChange={(event) => { setAutoFeatures(event.target.checked); if (event.target.checked) setFeatures(columns.filter((column) => column !== target)); }} /></label>
          <label className="settings-field"><span>Estimators</span><input className="settings-input" type="number" value={nEstimators} onChange={(event) => setNEstimators(Number(event.target.value))} disabled={!["random_forest", "gradient_boosting"].includes(modelType)} /></label>
          <label className="settings-field"><span>Max depth</span><input className="settings-input" value={maxDepth} onChange={(event) => setMaxDepth(event.target.value)} placeholder="auto" disabled={!["random_forest", "gradient_boosting"].includes(modelType)} /></label>
          <label className="settings-field"><span>Learning rate</span><input className="settings-input" value={learningRate} onChange={(event) => setLearningRate(event.target.value)} disabled={modelType !== "gradient_boosting"} /></label>
        </div>
        <div className="model-status-row">
          <button className="primary-button" disabled={!target || train.isPending} onClick={() => train.mutate()} type="button"><Play className="h-3.5 w-3.5" />{train.isPending ? "Training..." : "Train model"}</button>
          <button className="command-button text-muted" disabled={runs.isFetching} onClick={() => runs.refetch()} type="button"><RefreshCw className={runs.isFetching ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />Refresh</button>
          <span className={`pipeline-status ${status === "success" ? "pipeline-status-ok" : status === "failed" ? "pipeline-status-bad" : status === "running" ? "pipeline-status-neutral" : "pipeline-status-muted"}`}>{status}</span>
        </div>
        {train.error && <pre className="max-h-32 overflow-auto whitespace-pre-wrap border border-line bg-base p-2 text-xs text-bad">{train.error.message}</pre>}
      </div>

      <div className="model-leaderboard">
        <div className="mb-2 text-xs font-medium text-ink">Leaderboard</div>
        <div className="max-h-72 overflow-auto border border-line">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-panel text-muted"><tr><th className="px-2 py-2">Run</th><th className="px-2 py-2">Model</th><th className="px-2 py-2">Metric</th><th className="px-2 py-2">Time</th><th className="px-2 py-2">Version</th></tr></thead>
            <tbody>{sortedRuns.map((run) => <tr key={run.id} className={selectedRun?.id === run.id ? "border-t border-line/60 bg-accent/10" : "border-t border-line/60"} onClick={() => setSelectedRunId(run.id)}><td className="px-2 py-1.5 font-mono text-ink">{run.id}</td><td className="px-2 py-1.5 text-muted">{run.model_type}</td><td className="px-2 py-1.5 text-muted">{keyMetricLabel(run)} {keyMetricValue(run).toFixed(4)}</td><td className="px-2 py-1.5 text-muted">{run.training_time_seconds.toFixed(2)}s</td><td className="px-2 py-1.5 text-muted">{run.version_id}</td></tr>)}</tbody>
          </table>
          {sortedRuns.length === 0 && <div className="pipeline-empty">No model runs yet.</div>}
        </div>
      </div>

      {selectedRun && <ModelRunDetail run={selectedRun} />}
    </div>
  );
}

function ModelRunDetail({ run }: { run: ModelRunRecord }) {
  const importanceData = { columns: ["feature", "importance"], data: run.feature_importances.map((item) => ({ feature: item.feature, importance: item.importance })) };
  return (
    <div className="model-detail">
      <div className="mb-2 text-xs font-medium text-ink">Run detail</div>
      <div className="metric-grid">{Object.entries(run.metrics).map(([key, value]) => <MetricMini key={key} label={key} value={value == null ? "-" : value.toFixed(4)} />)}<MetricMini label="target" value={run.target} /><MetricMini label="task" value={run.task_type} /></div>
      <div className="mt-3"><div className="mb-2 text-xs text-muted">Feature importance</div><GraphPreview chartType="bar" result={importanceData} xField="feature" yField="importance" /></div>
      {run.execution?.stderr && <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap border border-line bg-base p-2 text-xs text-bad">{run.execution.stderr}</pre>}
    </div>
  );
}

function MetricMini({ label, value }: { label: string; value: string }) {
  return <div className="border border-line bg-panel px-2 py-1.5"><div className="text-[10px] uppercase text-muted">{label}</div><div className="truncate font-mono text-ink">{value}</div></div>;
}

function hyperparameters(modelType: ModelType, nEstimators: number, maxDepth: string, learningRate: string) {
  const params: Record<string, unknown> = {};
  if (["random_forest", "gradient_boosting"].includes(modelType)) {
    params.n_estimators = Math.max(10, Number(nEstimators) || 120);
    if (maxDepth.trim()) params.max_depth = Number(maxDepth);
  }
  if (modelType === "gradient_boosting") params.learning_rate = Number(learningRate) || 0.1;
  return params;
}

function keyMetricLabel(run: ModelRunRecord) {
  if (run.task_type === "classification") return run.metrics.auc != null ? "auc" : run.metrics.accuracy != null ? "accuracy" : "f1";
  return run.metrics.r2 != null ? "r2" : run.metrics.rmse != null ? "rmse" : "mae";
}

function keyMetricValue(run: ModelRunRecord) {
  const label = keyMetricLabel(run);
  const value = run.metrics[label];
  if (value == null) return Number.NEGATIVE_INFINITY;
  return label === "rmse" || label === "mae" ? -Number(value) : Number(value);
}
