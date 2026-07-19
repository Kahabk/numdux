import { useMutation, useQuery } from "@tanstack/react-query";
import { BarChart3, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { createChartConfig, deleteChartConfig, listChartConfigs, queryDatasetVersion } from "../lib/api";
import type { ChartAgg, ChartConfig, ChartFilter, ChartType, DatasetQueryResult, UploadResponse } from "../lib/types";

const CHART_TYPES: Array<{ value: ChartType; label: string }> = [
  { value: "bar", label: "Bar" },
  { value: "line", label: "Line" },
  { value: "scatter", label: "Scatter" },
  { value: "histogram", label: "Histogram" },
  { value: "box", label: "Box plot" },
  { value: "heatmap", label: "Correlation heatmap" },
  { value: "missingness", label: "Missingness matrix" }
];

const AGGS: ChartAgg[] = ["count", "sum", "mean", "min", "max"];
const OPERATORS: ChartFilter["operator"][] = ["=", "!=", ">", ">=", "<", "<=", "contains", "not_contains", "is_null", "not_null"];

export function GraphStudio({ dataset, onReportChanged }: { dataset: UploadResponse; onReportChanged?: () => void }) {
  const headVersionId = dataset.versions[dataset.versions.length - 1]?.id ?? dataset.profile.version_id;
  const numericColumns = dataset.profile.column_metadata.filter((column) => column.inferred_type === "numeric").map((column) => column.name);
  const allColumns = dataset.profile.column_metadata.map((column) => column.name);
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [xField, setXField] = useState(allColumns[0] ?? "");
  const [yField, setYField] = useState(numericColumns[0] ?? "");
  const [groupby, setGroupby] = useState(allColumns[0] ?? "");
  const [agg, setAgg] = useState<ChartAgg>("count");
  const [filterColumn, setFilterColumn] = useState(allColumns[0] ?? "");
  const [filterOperator, setFilterOperator] = useState<ChartFilter["operator"]>("=");
  const [filterValue, setFilterValue] = useState("");
  const [title, setTitle] = useState("Untitled chart");

  const filters: ChartFilter[] = filterColumn && (filterValue || filterOperator === "is_null" || filterOperator === "not_null")
    ? [{ column: filterColumn, operator: filterOperator, value: filterValue }]
    : [];
  const previewOptions = buildPreviewOptions(chartType, xField, yField, groupby, agg, filters);
  const preview = useQuery({
    queryKey: ["graph-preview", dataset.dataset_id, dataset.profile.version_id, chartType, xField, yField, groupby, agg, JSON.stringify(filters)],
    queryFn: () => queryDatasetVersion(dataset.dataset_id, dataset.profile.version_id, previewOptions),
    enabled: !["heatmap", "missingness"].includes(chartType) && Boolean(dataset.dataset_id),
  });
  const saved = useQuery({ queryKey: ["charts", dataset.dataset_id], queryFn: () => listChartConfigs(dataset.dataset_id) });
  const saveChart = useMutation({
    mutationFn: () => createChartConfig(dataset.dataset_id, {
      version_id: dataset.profile.version_id,
      chart_type: chartType,
      x_field: xField || null,
      y_field: previewOptions.value_field,
      groupby: previewOptions.groupby,
      agg: previewOptions.agg,
      filters,
      title: title.trim() || `${chartType} chart`,
    }),
    onSuccess: () => {
      saved.refetch();
      onReportChanged?.();
    },
  });
  const removeChart = useMutation({
    mutationFn: (chartId: string) => deleteChartConfig(dataset.dataset_id, chartId),
    onSuccess: () => {
      saved.refetch();
      onReportChanged?.();
    },
  });

  const previewData = chartType === "missingness"
    ? { data: dataset.profile.missingness_chart.map((item) => ({ column: item.column, value: item.percent })).slice(0, 30), columns: ["column", "value"] }
    : chartType === "heatmap"
      ? heatmapData(dataset.profile.pearson_correlation)
      : preview.data;

  return (
    <div className="graph-studio">
      <div className="graph-builder">
        <div className="graph-controls">
          <label className="settings-field"><span>Chart type</span><select className="settings-input" value={chartType} onChange={(event) => setChartType(event.target.value as ChartType)}>{CHART_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label className="settings-field"><span>X field</span><select className="settings-input" value={xField} onChange={(event) => { setXField(event.target.value); setGroupby(event.target.value); }}>{allColumns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>
          <label className="settings-field"><span>Y field</span><select className="settings-input" value={yField} onChange={(event) => setYField(event.target.value)}><option value="">Count</option>{numericColumns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>
          <label className="settings-field"><span>Aggregation</span><select className="settings-input" value={agg} onChange={(event) => setAgg(event.target.value as ChartAgg)}>{AGGS.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label className="settings-field"><span>Group by</span><select className="settings-input" value={groupby} onChange={(event) => setGroupby(event.target.value)}><option value="">None</option>{allColumns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>
          <label className="settings-field"><span>Filter column</span><select className="settings-input" value={filterColumn} onChange={(event) => setFilterColumn(event.target.value)}><option value="">No filter</option>{allColumns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>
          <label className="settings-field"><span>Filter operator</span><select className="settings-input" value={filterOperator} onChange={(event) => setFilterOperator(event.target.value as ChartFilter["operator"])}>{OPERATORS.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label className="settings-field"><span>Filter value</span><input className="settings-input" value={filterValue} onChange={(event) => setFilterValue(event.target.value)} disabled={filterOperator === "is_null" || filterOperator === "not_null"} /></label>
          <label className="settings-field graph-title-field"><span>Title</span><input className="settings-input" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        </div>
        <div className="graph-preview">
          <div className="graph-preview-head"><span>{title}</span>{preview.isFetching && <span className="text-muted">refreshing</span>}</div>
          <GraphPreview chartType={chartType} result={previewData} xField={xField || groupby || "metric"} yField={yField || "value"} />
          {preview.error && <p className="text-xs text-bad">{preview.error.message}</p>}
          <button className="primary-button" disabled={saveChart.isPending} onClick={() => saveChart.mutate()} type="button"><Save className="h-3.5 w-3.5" />{saveChart.isPending ? "Saving..." : "Save chart"}</button>
        </div>
      </div>
      <div className="saved-chart-list">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-ink"><BarChart3 className="h-3.5 w-3.5 text-accent" />Saved charts</div>
        <div className="grid gap-2">
          {(saved.data ?? []).map((chart) => <SavedChart key={chart.id} chart={chart} stale={chart.version_id !== headVersionId} pending={removeChart.isPending} onDelete={() => removeChart.mutate(chart.id)} />)}
          {saved.data?.length === 0 && <div className="pipeline-empty">No saved charts yet.</div>}
        </div>
      </div>
    </div>
  );
}

export function GraphPreview({ chartType, result, xField, yField }: { chartType: ChartType; result?: DatasetQueryResult | { data: Record<string, unknown>[]; columns: string[] }; xField: string; yField: string }) {
  const data = result?.data ?? [];
  if (!data.length) return <div className="pipeline-empty">No aggregated chart data yet.</div>;
  if (chartType === "heatmap") return <Heatmap data={data} />;
  if (chartType === "missingness" || chartType === "bar" || chartType === "histogram" || chartType === "box") {
    return <ResponsiveContainer width="100%" height={280}><BarChart data={data}><CartesianGrid stroke="#2a2a2a" /><XAxis dataKey={dataKey(data, xField)} tick={{ fill: "#9a9a9a", fontSize: 11 }} /><YAxis tick={{ fill: "#9a9a9a", fontSize: 11 }} /><Tooltip contentStyle={{ background: "#1a1a1a", border: "1px solid #2a2a2a" }} /><Bar dataKey={dataKey(data, yField)} fill="#6c8cff" /></BarChart></ResponsiveContainer>;
  }
  if (chartType === "line") {
    return <ResponsiveContainer width="100%" height={280}><LineChart data={data}><CartesianGrid stroke="#2a2a2a" /><XAxis dataKey={dataKey(data, xField)} tick={{ fill: "#9a9a9a", fontSize: 11 }} /><YAxis tick={{ fill: "#9a9a9a", fontSize: 11 }} /><Tooltip contentStyle={{ background: "#1a1a1a", border: "1px solid #2a2a2a" }} /><Line type="monotone" dataKey={dataKey(data, yField)} stroke="#6c8cff" dot={false} /></LineChart></ResponsiveContainer>;
  }
  return <ResponsiveContainer width="100%" height={280}><ScatterChart><CartesianGrid stroke="#2a2a2a" /><XAxis dataKey={dataKey(data, xField)} tick={{ fill: "#9a9a9a", fontSize: 11 }} /><YAxis dataKey={dataKey(data, yField)} tick={{ fill: "#9a9a9a", fontSize: 11 }} /><ZAxis range={[50, 80]} /><Tooltip contentStyle={{ background: "#1a1a1a", border: "1px solid #2a2a2a" }} /><Scatter data={data} fill="#6c8cff" /></ScatterChart></ResponsiveContainer>;
}

function Heatmap({ data }: { data: Record<string, unknown>[] }) {
  const max = Math.max(...data.map((item) => Math.abs(Number(item.value) || 0)), 1);
  return <div className="heatmap-grid">{data.map((item) => <div key={`${item.x}-${item.y}`} className="heatmap-cell" style={{ opacity: 0.25 + Math.abs(Number(item.value) || 0) / max * 0.75 }} title={`${String(item.x)} / ${String(item.y)}: ${Number(item.value).toFixed(3)}`}><span>{String(item.x).slice(0, 10)}</span><strong>{Number(item.value).toFixed(2)}</strong></div>)}</div>;
}

function SavedChart({ chart, stale, pending, onDelete }: { chart: ChartConfig; stale: boolean; pending: boolean; onDelete: () => void }) {
  return <div className="saved-chart-row"><div className="min-w-0"><div className="truncate text-xs font-medium text-ink">{chart.title}</div><div className="mt-0.5 truncate font-mono text-[11px] text-muted">{chart.chart_type} · {chart.version_id} · {chart.agg}</div></div>{stale && <span className="pipeline-status pipeline-status-muted">stale</span>}<button className="cell-icon-button" disabled={pending} onClick={onDelete} title="Delete chart" type="button"><Trash2 className="h-3.5 w-3.5" /></button></div>;
}

function buildPreviewOptions(chartType: ChartType, xField: string, yField: string, groupby: string, agg: ChartAgg, filters: ChartFilter[]) {
  const nextAgg = chartType === "histogram" || !yField ? "count" : agg;
  return {
    groupby: groupby ? [groupby] : xField ? [xField] : [],
    agg: nextAgg as ChartAgg,
    value_field: nextAgg === "count" ? null : yField || null,
    filters,
    limit: 200,
  };
}

function heatmapData(correlations: Record<string, Record<string, number | null>>) {
  return {
    columns: ["x", "y", "value"],
    data: Object.entries(correlations).flatMap(([x, row]) => Object.entries(row).map(([y, value]) => ({ x, y, value: value ?? 0 }))).slice(0, 144),
  };
}

function dataKey(data: Record<string, unknown>[], preferred: string) {
  if (preferred && data.some((row) => preferred in row)) return preferred;
  if (data.some((row) => "value" in row)) return "value";
  return Object.keys(data[0] ?? {})[0] ?? "value";
}
