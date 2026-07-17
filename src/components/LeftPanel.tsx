import { Database, FileArchive, FileText, Folder, GitBranch, RefreshCw, ScrollText, Settings, Trash2 } from "lucide-react";
import type React from "react";
import type { DatasetRecord, DatasetVersion } from "../lib/types";
import { cn } from "../lib/utils";

export function LeftPanel({
  datasets,
  filename,
  isRefreshing,
  exportHref,
  reportHref,
  runStatus,
  selectedDatasetId,
  activeVersionId,
  versions,
  onRefresh,
  onOpenSettings,
  onDeleteAll,
  onDeleteDataset,
  onSelectDataset
}: {
  datasets: DatasetRecord[];
  filename?: string;
  isRefreshing: boolean;
  exportHref?: string;
  reportHref?: string;
  runStatus?: string;
  selectedDatasetId?: string;
  activeVersionId?: string;
  versions: DatasetVersion[];
  onRefresh: () => void;
  onOpenSettings: () => void;
  onDeleteAll: () => void;
  onDeleteDataset: (dataset: DatasetRecord) => void;
  onSelectDataset: (dataset: DatasetRecord) => void;
}) {
  return (
    <aside className="flex h-full min-w-0 flex-col border-r border-line bg-base text-xs">
      <div className="flex h-10 shrink-0 items-center border-b border-line px-3 font-medium text-ink">Numdux</div>
      <nav className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden p-2">
        <button
          className="flex h-7 w-full items-center gap-2 rounded-sm border border-line px-2 text-left text-muted hover:border-accent hover:text-ink disabled:opacity-50"
          disabled={isRefreshing}
          onClick={onRefresh}
          type="button"
        >
          <RefreshCw className={isRefreshing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          <span className="truncate">Refresh files</span>
        </button>
        <button
          className="flex h-7 w-full items-center gap-2 rounded-sm border border-line px-2 text-left text-muted hover:border-accent hover:text-ink"
          onClick={onOpenSettings}
          type="button"
        >
          <Settings className="h-3.5 w-3.5" />
          <span className="truncate">Settings</span>
        </button>
        <Group title="Files" icon={<Folder className="h-3.5 w-3.5" />}>
          {datasets.length ? (
            <>
              <button
                className="mb-1 flex h-7 w-full min-w-0 items-center gap-2 rounded-sm border border-bad/50 px-2 text-left text-bad hover:bg-bad hover:text-white"
                onClick={onDeleteAll}
                type="button"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="truncate">Delete all files</span>
              </button>
              {datasets.map((dataset) => (
                <Row
                  key={dataset.dataset_id}
                  icon={<FileText className="h-3.5 w-3.5" />}
                  label={dataset.filename}
                  active={dataset.dataset_id === selectedDatasetId}
                  onClick={() => onSelectDataset(dataset)}
                  onDelete={() => onDeleteDataset(dataset)}
                />
              ))}
            </>
          ) : (
            <Row icon={<FileText className="h-3.5 w-3.5" />} label={filename || "No dataset"} muted={!filename} />
          )}
        </Group>
        <Group title="Dataset versions" icon={<GitBranch className="h-3.5 w-3.5" />}>
          {versions.length ? (
            versions.map((version) => (
              <Row
                key={version.id}
                icon={<Database className="h-3.5 w-3.5" />}
                label={`${version.id} · ${version.rows} rows`}
                sublabel={version.id === activeVersionId ? "active" : undefined}
              />
            ))
          ) : (
            <Row icon={<Database className="h-3.5 w-3.5" />} label="Version 1 awaits upload" muted />
          )}
        </Group>
        <Group title="Runs" icon={<ScrollText className="h-3.5 w-3.5" />}>
          <Row icon={<ScrollText className="h-3.5 w-3.5" />} label={runStatus ? `Latest: ${runStatus}` : "No cleaning run"} muted={!runStatus} />
        </Group>
        <Group title="Exports" icon={<FileArchive className="h-3.5 w-3.5" />}>
          <Row icon={<FileArchive className="h-3.5 w-3.5" />} label="Export current dataset" href={exportHref} muted={!exportHref} />
          <Row icon={<FileText className="h-3.5 w-3.5" />} label="Download quality report" href={reportHref} muted={!reportHref} />
        </Group>
      </nav>
    </aside>
  );
}

function Group({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 px-1 text-muted">
        {icon}
        <span>{title}</span>
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Row({
  icon,
  label,
  sublabel,
  muted,
  active,
  href,
  onDelete,
  onClick
}: {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  muted?: boolean;
  active?: boolean;
  href?: string;
  onDelete?: () => void;
  onClick?: () => void;
}) {
  const content = (
    <>
      {icon}
      <span className={muted ? "truncate text-muted" : "truncate text-ink"}>{label}</span>
      {sublabel && <span className="ml-auto shrink-0 text-[10px] text-muted">{sublabel}</span>}
    </>
  );
  const className = cn(
    "flex h-7 w-full min-w-0 items-center gap-2 rounded-sm px-2 text-left text-muted",
    (onClick || href) && "hover:bg-panel hover:text-ink",
    active && "bg-panel text-ink"
  );

  if (href && !muted) {
    return (
      <a className={className} href={href}>
        {content}
      </a>
    );
  }
  if (onClick) {
    if (onDelete) {
      return (
        <div className={cn(className, "p-0")}>
          <button className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left" onClick={onClick} type="button">
            {content}
          </button>
          <button
            className="mr-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-bad hover:text-white"
            onClick={onDelete}
            title={`Delete ${label}`}
            type="button"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      );
    }
    return (
      <button className={className} onClick={onClick} type="button">
        {content}
      </button>
    );
  }
  return (
    <div
      className={cn(
        "flex h-7 w-full min-w-0 items-center gap-2 rounded-sm px-2 text-left text-muted",
        active && "bg-panel text-ink"
      )}
    >
      {content}
    </div>
  );
}
