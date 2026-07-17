import { Bot, CheckCircle2, ChevronDown, ChevronUp, CircleAlert, Clock3, Copy, Download, FilePlus2, FileText, MoreHorizontal, Play, Wrench } from "lucide-react";
import { useState } from "react";
import type React from "react";
import { cn } from "../lib/utils";

type CellProps = {
  type: string;
  title: string;
  status?: "idle" | "running" | "success" | "failed" | "blocked";
  duration?: string;
  children: React.ReactNode;
  output?: React.ReactNode;
  onRun?: () => void;
  sandbox?: string;
  selected?: boolean;
  onSelect?: () => void;
  onDuplicate?: () => void;
  onAddBelow?: () => void;
  onAskAI?: () => void;
  onExplain?: () => void;
  onExport?: () => void;
  includeInReport?: boolean;
  onToggleReport?: () => void;
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  onToggleCollapsed?: () => void;
};

export function Cell({ type, title, status = "idle", duration, children, output, onRun, sandbox, selected, onSelect, onDuplicate, onAddBelow, onAskAI, onExplain, onExport, includeInReport, onToggleReport, collapsed: controlledCollapsed, defaultCollapsed = false, onToggleCollapsed }: CellProps) {
  const [localCollapsed, setLocalCollapsed] = useState(defaultCollapsed);
  const collapsed = controlledCollapsed ?? localCollapsed;
  const toggleCollapsed = () => {
    if (onToggleCollapsed) onToggleCollapsed();
    else setLocalCollapsed((value) => !value);
  };
  const controlsClass = selected ? "flex" : "hidden group-hover:flex group-focus-within:flex";
  const statusIcon = {
    idle: <Clock3 className="h-3.5 w-3.5 text-muted" />,
    running: <Clock3 className="h-3.5 w-3.5 animate-pulse text-accent" />,
    success: <CheckCircle2 className="h-3.5 w-3.5 text-ok" />,
    failed: <CircleAlert className="h-3.5 w-3.5 text-bad" />,
    blocked: <CircleAlert className="h-3.5 w-3.5 text-warn" />
  }[status];

  return (
    <section className={cn("group border-b border-line bg-notebook", selected && "bg-panel/20")} onMouseDown={onSelect}>
      <div className="flex min-h-9 items-center gap-2 border-b border-line/70 px-3 text-xs" onDoubleClick={toggleCollapsed}>
        <span className="w-20 shrink-0 font-mono uppercase tracking-normal text-muted">{type}</span>
        <span className="min-w-0 flex-1 truncate text-ink">{title}</span>
        {sandbox && <span className="hidden max-w-24 truncate border border-line px-1 py-0.5 font-mono text-[10px] text-muted lg:inline">{sandbox}</span>}
        {duration && <span className="text-muted">{duration}</span>}
        <span>{statusIcon}</span>
        <div className={cn("items-center gap-0.5", controlsClass)}>
        {onRun && (
          <button
            className="cell-icon-button"
            onClick={onRun}
            title="Run cell"
            type="button"
          >
            <Play className="h-3.5 w-3.5" />
          </button>
        )}
        {onAskAI && <button className="cell-icon-button" onClick={onAskAI} title="Ask AI" type="button"><Bot className="h-3.5 w-3.5" /></button>}
        {onExplain && <button className="cell-icon-button" onClick={onExplain} title="Explain cell" type="button"><Wrench className="h-3.5 w-3.5" /></button>}
        <button className="cell-icon-button" onClick={toggleCollapsed} title={collapsed ? "Expand cell" : "Collapse cell"} type="button">{collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}</button>
        {(onDuplicate || onAddBelow || onToggleReport || onExport) && <details className="relative">
          <summary className="cell-icon-button list-none" title="More cell actions"><MoreHorizontal className="h-3.5 w-3.5" /></summary>
          <div className="absolute right-0 z-20 mt-1 w-36 border border-line bg-panel p-1 text-xs shadow-lg">
            {onDuplicate && <button className="cell-menu-item" onClick={onDuplicate} type="button"><Copy className="h-3.5 w-3.5" />Duplicate</button>}
            {onAddBelow && <button className="cell-menu-item" onClick={onAddBelow} type="button"><FilePlus2 className="h-3.5 w-3.5" />Add below</button>}
            {onToggleReport && <button className="cell-menu-item" onClick={onToggleReport} type="button"><FileText className="h-3.5 w-3.5" />{includeInReport ? "Remove report" : "Add to report"}</button>}
            {onExport && <button className="cell-menu-item" onClick={onExport} type="button"><Download className="h-3.5 w-3.5" />Export output</button>}
          </div>
        </details>}
        </div>
      </div>
      {!collapsed && <><div className={cn("px-4 py-3", output && "border-b border-line/60")}>{children}</div>
      {output && <div className="bg-base/40 px-4 py-3">{output}</div>}</>}
    </section>
  );
}
