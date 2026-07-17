import Editor from "@monaco-editor/react";
import { useState } from "react";
import type { SqlRunResult } from "../lib/types";
import { Cell } from "./Cell";
import { DataTable } from "./DataTable";

export type ManualCellRecord = {
  id: string;
  type: "python" | "sql" | "markdown";
  source: string;
  sandboxId: string;
  includeInReport: boolean;
  status: "idle" | "running" | "success" | "failed" | "blocked";
  output?: string;
  sqlResult?: SqlRunResult;
};

export function ManualNotebookCell({
  cell,
  sandboxName,
  selected,
  onSelect,
  onChange,
  onRun,
  onDuplicate,
  onAddBelow,
  onToggleReport,
  onDelete
}: {
  cell: ManualCellRecord;
  sandboxName: string;
  selected: boolean;
  onSelect: () => void;
  onChange: (source: string) => void;
  onRun: () => void;
  onDuplicate: () => void;
  onAddBelow: () => void;
  onToggleReport: () => void;
  onDelete: () => void;
}) {
  const [showSource, setShowSource] = useState(true);
  const title = cell.type === "python" ? "Manual Python cell" : cell.type === "sql" ? "Manual SQL cell" : "Markdown cell";
  const output = cell.type === "sql" && cell.sqlResult ? <DataTable rows={cell.sqlResult.preview_rows} /> : cell.output ? <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs text-muted">{cell.output}</pre> : undefined;
  return <Cell type={cell.type} title={title} status={cell.status} sandbox={sandboxName} selected={selected} onSelect={onSelect} onRun={cell.type === "markdown" ? undefined : onRun} onDuplicate={onDuplicate} onAddBelow={onAddBelow} onToggleReport={onToggleReport} includeInReport={cell.includeInReport} onExport={() => setShowSource(true)} onExplain={() => setShowSource(true)} output={output}>
    <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted"><span>{cell.type === "markdown" ? "Manual content" : "Manual source - AI will not overwrite this cell."}</span><button className="text-action" onClick={onDelete} type="button">Delete</button></div>
    {showSource && (cell.type === "markdown" ? <textarea className="min-h-28 w-full resize-y border border-line bg-base p-3 text-sm text-ink outline-none focus:border-accent" value={cell.source} onChange={(event) => onChange(event.target.value)} placeholder="Write notebook notes..." /> : <Editor height="260px" defaultLanguage={cell.type} value={cell.source} onChange={(value) => onChange(value ?? "")} theme="vs-dark" options={{ minimap: { enabled: false }, fontSize: 12, wordWrap: "on", scrollBeyondLastLine: false }} />)}
    {cell.type === "sql" && <p className="mt-2 text-xs text-muted">Read-only queries only. The active dataset is available as <code>dataset</code>.</p>}
  </Cell>;
}
