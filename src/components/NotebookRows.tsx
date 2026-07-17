import { BarChart3, Bot, FileDown, FilePlus2, Play, RotateCcw, ShieldCheck, Square, WandSparkles } from "lucide-react";
import type React from "react";
import type { DatasetVersion, UploadResponse } from "../lib/types";

export type NotebookSandbox = {
  id: string;
  name: string;
  mode: "persistent" | "ephemeral";
  status: "ready" | "stopped";
};

export function NotebookActionRow({
  dataset,
  versions,
  activeVersionId,
  sandboxId,
  sandboxes,
  onSandboxChange,
  onVersionChange,
  onUpload,
  onCreateSandbox,
  onAddCell,
  onRun,
  onStop,
  onRestart,
  onAskAI,
  onCharts,
  onReport,
  onExport
}: {
  dataset: UploadResponse | null;
  versions: DatasetVersion[];
  activeVersionId?: string;
  sandboxId: string;
  sandboxes: NotebookSandbox[];
  onSandboxChange: (id: string) => void;
  onVersionChange: (id: string) => void;
  onUpload: () => void;
  onCreateSandbox: () => void;
  onAddCell: (type: "python" | "sql" | "markdown") => void;
  onRun: () => void;
  onStop: () => void;
  onRestart: () => void;
  onAskAI: () => void;
  onCharts: () => void;
  onReport: () => void;
  onExport: () => void;
}) {
  return (
    <div className="sticky top-10 z-[5] border-b border-line bg-notebook/95 px-3 py-2 text-xs backdrop-blur">
      <div className="flex flex-wrap items-center gap-1.5">
        <button className="command-button" onClick={onUpload} type="button"><FilePlus2 className="h-3.5 w-3.5" />Upload</button>
        <select className="compact-select" aria-label="Dataset version" disabled={!dataset} value={activeVersionId ?? ""} onChange={(event) => onVersionChange(event.target.value)}>{versions.map((version) => <option key={version.id} value={version.id}>{version.id} · {version.rows} rows</option>)}</select>
        <button className="icon-button" title="Restart sandbox" onClick={onRestart} type="button"><RotateCcw className="h-3.5 w-3.5" /></button>
        <details className="relative"><summary className="command-button list-none"><FilePlus2 className="h-3.5 w-3.5" />Add cell</summary><div className="action-popover"><button onClick={() => onAddCell("python")} type="button">Python cell</button><button onClick={() => onAddCell("sql")} type="button">SQL cell</button><button onClick={() => onAddCell("markdown")} type="button">Markdown cell</button></div></details>
        <button className="icon-button" title="Run selected cell" disabled={!dataset} onClick={onRun} type="button"><Play className="h-3.5 w-3.5" /></button>
        <button className="icon-button" title="Stop execution" onClick={onStop} type="button"><Square className="h-3.5 w-3.5" /></button>
        <select className="compact-select" aria-label="Active sandbox" value={sandboxId} onChange={(event) => onSandboxChange(event.target.value)}>{sandboxes.map((sandbox) => <option key={sandbox.id} value={sandbox.id}>{sandbox.name} ({sandbox.mode})</option>)}</select>
        <button className="icon-button" title="Create sandbox" onClick={onCreateSandbox} type="button"><ShieldCheck className="h-3.5 w-3.5" /></button>
        <span className="h-4 w-px bg-line" />
        <button className="command-button text-muted" disabled={!dataset} onClick={onAskAI} type="button"><Bot className="h-3.5 w-3.5" />Ask AI</button>
        <button className="icon-button" title="Generate charts" disabled={!dataset} onClick={onCharts} type="button"><BarChart3 className="h-3.5 w-3.5" /></button>
        <button className="icon-button" title="Build report" disabled={!dataset} onClick={onReport} type="button"><WandSparkles className="h-3.5 w-3.5" /></button>
        <button className="icon-button" title="Export current version" disabled={!dataset} onClick={onExport} type="button"><FileDown className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}

export function DatasetStatusRow({ dataset, sandbox, lastStatus }: { dataset: UploadResponse; sandbox?: NotebookSandbox; lastStatus?: string }) {
  return <details className="border-b border-line bg-base/40" open><summary className="cursor-pointer px-4 py-2 text-xs text-muted">Dataset status</summary><div className="grid grid-cols-2 gap-x-3 gap-y-1 px-4 pb-3 text-xs sm:grid-cols-4 lg:grid-cols-8"><Status label="Dataset" value={dataset.filename} /><Status label="Version" value={dataset.versions[dataset.versions.length - 1]?.id ?? "v1"} /><Status label="Format" value={dataset.profile.file_format} /><Status label="Rows" value={dataset.profile.rows} /><Status label="Columns" value={dataset.profile.columns} /><Status label="Size" value={formatBytes(dataset.profile.file_size)} /><Status label="Quality" value={`${dataset.profile.data_quality_score}%`} /><Status label="Sandbox" value={sandbox ? `${sandbox.name} · ${sandbox.status}` : "None"} /><Status label="Profile" value="Complete" /><Status label="Last run" value={lastStatus ?? "Waiting"} /></div></details>;
}

export function DatasetActionRow({ onPreview, onProfile, onSchema, onIssues, onCompare, onExport }: { onPreview: () => void; onProfile: () => void; onSchema: () => void; onIssues: () => void; onCompare: () => void; onExport: () => void }) {
  return <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2 text-xs"><span className="mr-1 text-muted">Dataset</span><button className="text-action" onClick={onPreview} type="button">Preview</button><button className="text-action" onClick={onProfile} type="button">Profile</button><button className="text-action" onClick={onSchema} type="button">Schema</button><button className="text-action" onClick={onIssues} type="button">Quality issues</button><button className="text-action" onClick={onCompare} type="button">Compare versions</button><button className="text-action" onClick={onExport} type="button">Export version</button></div>;
}

function Status({ label, value }: { label: string; value: React.ReactNode }) { return <div className="min-w-0"><div className="text-[10px] uppercase text-muted">{label}</div><div className="truncate font-mono text-ink">{value}</div></div>; }
function formatBytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`; return `${(value / (1024 * 1024)).toFixed(1)} MB`; }
