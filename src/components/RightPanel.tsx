import { Bot, CircleAlert, Code2, Database, Play, Sparkles, Trash2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type React from "react";
import type { CleaningRun, DatasetProfile } from "../lib/types";

const QUICK_PROMPTS = [
  "Clean duplicates, missing values, invalid emails, inconsistent country names, and date formats.",
  "Profile missingness and duplicate rows, then generate conservative cleaning code.",
  "Validate the cleaned output and warn me about destructive transformations."
];

export function RightPanel({
  profile,
  run,
  instruction,
  isRunning,
  deletePending,
  deleteError,
  onInstructionChange,
  onRejectRun,
  onDeleteAllData,
  onRun
}: {
  profile?: DatasetProfile;
  run?: CleaningRun | null;
  instruction: string;
  isRunning: boolean;
  deletePending?: boolean;
  deleteError?: string;
  onInstructionChange: (instruction: string) => void;
  onRejectRun: () => void;
  onDeleteAllData: (confirm: string) => void;
  onRun: (instruction: string) => void;
}) {
  const [draft, setDraft] = useState(instruction);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  useEffect(() => {
    setDraft(instruction);
  }, [instruction]);

  return (
    <aside className="flex h-full min-w-0 flex-col border-l border-line bg-base text-xs">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3 font-medium text-ink">
        <Bot className="h-4 w-4 text-accent" />
        Assistant
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden p-3">
        <PanelTitle icon={<Sparkles className="h-3.5 w-3.5" />} label="Ask AI" />
        <textarea
          className="min-h-24 w-full resize-y border border-line bg-panel p-2 text-xs text-ink outline-none focus:border-accent"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Tell the assistant what to clean..."
        />
        <div className="flex gap-2">
          <button
            className="inline-flex h-7 flex-1 items-center justify-center gap-2 rounded-sm border border-line px-2 text-muted hover:border-accent hover:text-ink disabled:opacity-50"
            disabled={!draft.trim()}
            onClick={() => onInstructionChange(draft.trim())}
            type="button"
          >
            Use prompt
          </button>
          <button
            className="inline-flex h-7 flex-1 items-center justify-center gap-2 rounded-sm bg-accent px-2 font-medium text-white disabled:opacity-50"
            disabled={!profile || !draft.trim() || isRunning}
            onClick={() => onRun(draft.trim())}
            type="button"
          >
            <Play className="h-3.5 w-3.5" />
            {isRunning ? "Running" : "Run"}
          </button>
        </div>

        <PanelTitle icon={<Database className="h-3.5 w-3.5" />} label="Dataset context" />
        {profile ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Metric label="Rows" value={profile.rows} />
              <Metric label="Columns" value={profile.columns} />
              <Metric label="Quality" value={`${profile.data_quality_score}%`} />
              <Metric label="Duplicates" value={profile.duplicate_rows} />
            </div>
            <div className="max-h-28 overflow-auto border border-line">
              {profile.column_metadata.slice(0, 24).map((column) => (
                <button
                  key={column.name}
                  className="flex h-7 w-full items-center justify-between gap-2 border-b border-line/60 px-2 text-left text-muted hover:bg-panel hover:text-ink"
                  onClick={() => {
                    const next = `Focus on column "${column.name}". ${draft}`;
                    setDraft(next);
                    onInstructionChange(next);
                  }}
                  type="button"
                >
                  <span className="truncate font-mono">{column.name}</span>
                  <span className="shrink-0 text-[10px]">{column.inferred_type}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="text-muted">Upload a dataset to build context.</p>
        )}

        <PanelTitle icon={<Sparkles className="h-3.5 w-3.5" />} label="Suggested actions" />
        <div className="space-y-1">
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              className="w-full rounded-sm border border-line px-2 py-1.5 text-left text-muted hover:border-accent hover:text-ink"
              onClick={() => {
                setDraft(prompt);
                onInstructionChange(prompt);
              }}
              type="button"
            >
              {prompt}
            </button>
          ))}
        </div>

        <PanelTitle icon={<Code2 className="h-3.5 w-3.5" />} label="Execution status" />
        {run ? (
          <div className="space-y-2">
            <Metric label="Status" value={run.execution.status} />
            <Metric label="Runtime" value={`${run.execution.duration_ms}ms`} />
            <Metric label="Validation" value={String(run.comparison.validation_status ?? "unknown")} />
            <button
              className="inline-flex h-7 w-full items-center justify-center gap-2 rounded-sm border border-line px-2 text-muted hover:border-accent hover:text-ink"
              onClick={onRejectRun}
              type="button"
            >
              <XCircle className="h-3.5 w-3.5" />
              Clear result
            </button>
          </div>
        ) : (
          <p className="text-muted">No sandbox execution yet.</p>
        )}

        {run?.execution.stderr && (
          <>
            <PanelTitle icon={<CircleAlert className="h-3.5 w-3.5" />} label="Sandbox errors" />
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-sm border border-line bg-panel p-2 font-mono text-[11px] text-bad">
              {run.execution.stderr}
            </pre>
          </>
        )}

        <PanelTitle icon={<Trash2 className="h-3.5 w-3.5" />} label="Database" />
        <div className="space-y-2 border border-bad/40 bg-panel p-2">
          <p className="text-muted">Delete every uploaded dataset, approved version, report, and run output.</p>
          <input
            className="h-8 w-full border border-line bg-base px-2 text-xs text-ink outline-none focus:border-bad"
            value={deleteConfirm}
            onChange={(event) => setDeleteConfirm(event.target.value)}
            placeholder="Type DELETE"
          />
          <button
            className="inline-flex h-7 w-full items-center justify-center gap-2 rounded-sm border border-bad px-2 text-bad hover:bg-bad hover:text-white disabled:opacity-50"
            disabled={deleteConfirm !== "DELETE" || deletePending}
            onClick={() => onDeleteAllData(deleteConfirm)}
            type="button"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {deletePending ? "Deleting..." : "Delete entire database"}
          </button>
          {deleteError && <p className="text-bad">{deleteError}</p>}
        </div>
      </div>
    </aside>
  );
}

function PanelTitle({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-muted">
      {icon}
      <span>{label}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border border-line bg-panel px-2 py-1.5">
      <div className="text-[10px] uppercase text-muted">{label}</div>
      <div className="truncate font-mono text-ink">{value}</div>
    </div>
  );
}
