import Editor from "@monaco-editor/react";
import { useMutation, useQuery, type UseMutationResult } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Download, FileCode2, FileText, FileUp, KeyRound, Menu, Moon, RefreshCw, Save, Send, Settings, ShieldCheck, Sparkles, Sun, TestTube2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type React from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { approveRun, createAnalysisPlan, deleteAllStorage, deleteDataset, getAIProviderStatus, getAppSettings, getDatasetReport, getDatasetVersion, getHealth, listDatasets, runCleaning, runCustomCode, runSandboxTask, runSql, updateAppSettings, uploadDataset } from "./lib/api";
import { useNotebookStore } from "./lib/store";
import type { AnalysisPlan, CleaningRun, DatasetRecord, DatasetReport, SandboxTaskResult, UploadResponse } from "./lib/types";
import { formatNumber } from "./lib/utils";
import { Cell } from "./components/Cell";
import { DataTable } from "./components/DataTable";
import { LeftPanel } from "./components/LeftPanel";
import { ManualNotebookCell, type ManualCellRecord } from "./components/ManualNotebookCell";
import { DatasetActionRow, DatasetStatusRow, NotebookActionRow, type NotebookSandbox } from "./components/NotebookRows";
import { ProfileCharts } from "./components/ProfileCharts";
import { RightPanel } from "./components/RightPanel";
import { VisualReport } from "./components/VisualReport";

export function App() {
  const { dataset, datasets, run, versions, instruction, setDatasets, setDataset, setInstruction, setRun, addVersion, removeDataset, resetWorkspace } = useNotebookStore();
  const [code, setCode] = useState("");
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [sandboxes, setSandboxes] = useState<NotebookSandbox[]>([
    { id: "sandbox_main", name: "Main analysis", mode: "persistent", status: "ready" },
    { id: "sandbox_cleaning", name: "AI cleaning", mode: "ephemeral", status: "ready" }
  ]);
  const [activeSandboxId, setActiveSandboxId] = useState("sandbox_main");
  const [manualCells, setManualCells] = useState<ManualCellRecord[]>([]);
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const [executionStage, setExecutionStage] = useState("Waiting");
  const [analysisPlan, setAnalysisPlan] = useState<AnalysisPlan | null>(null);
  const [reportPreview, setReportPreview] = useState(false);
  const [taskResults, setTaskResults] = useState<Record<string, SandboxTaskResult>>({});
  const [agentPrompt, setAgentPrompt] = useState("");
  const [appTheme, setAppTheme] = useState<"dark" | "light">("dark");
  const [reportTheme, setReportTheme] = useState<"light" | "dark">("light");
  const [leftOpen, setLeftOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [activeView, setActiveView] = useState<"notebook" | "settings">("notebook");
  const compact = useCompactLayout();
  const savedDatasets = useQuery({ queryKey: ["datasets"], queryFn: listDatasets });
  const health = useQuery({ queryKey: ["health"], queryFn: getHealth, refetchInterval: 10000 });
  const provider = useQuery({ queryKey: ["ai-provider"], queryFn: getAIProviderStatus, refetchInterval: 300000 });
  const settings = useQuery({ queryKey: ["settings"], queryFn: getAppSettings });
  const report = useQuery({
    queryKey: ["report", dataset?.dataset_id, dataset?.profile.version_id, run?.run_id, reportTheme],
    queryFn: () => getDatasetReport(dataset!.dataset_id, run?.run_id, dataset!.profile.version_id, reportTheme),
    enabled: Boolean(dataset)
  });

  useEffect(() => {
    if (!savedDatasets.data) return;
    setDatasets(savedDatasets.data);
    if (!dataset && savedDatasets.data.length) setDataset(savedDatasets.data[0]);
  }, [dataset, savedDatasets.data, setDataset, setDatasets]);

  useEffect(() => {
    if (run?.generated_code.code) setCode(run.generated_code.code);
  }, [run?.run_id]);

  const upload = useMutation({
    mutationFn: uploadDataset,
    onSuccess: (payload) => {
      setDataset(payload);
      setCode("");
      savedDatasets.refetch();
    }
  });
  const clean = useMutation({ mutationFn: (nextInstruction: string) => runCleaning(dataset!.dataset_id, nextInstruction, dataset!.profile.version_id), onMutate: () => setExecutionStage("Preparing sandbox"), onSuccess: (nextRun) => { setRun(nextRun); setAnalysisPlan(nextRun.plan); setExecutionStage(nextRun.execution.status === "success" ? "Completed" : "Failed"); } });
  const planOnly = useMutation({ mutationFn: (nextInstruction: string) => createAnalysisPlan(dataset!.dataset_id, nextInstruction, dataset!.profile.version_id), onMutate: () => setExecutionStage("Generating plan"), onSuccess: (plan) => { setAnalysisPlan(plan); setExecutionStage("Completed"); }, onError: () => setExecutionStage("Failed") });
  const executeCode = useMutation({ mutationFn: () => runCustomCode(dataset!.dataset_id, code, instruction, dataset!.profile.version_id), onSuccess: setRun });
  const approve = useMutation({
    mutationFn: () => approveRun(dataset!.dataset_id, run!.run_id),
    onSuccess: (payload) => {
      addVersion(payload.version);
      savedDatasets.refetch();
    }
  });
  const manualPython = useMutation({
    mutationFn: ({ source }: { id: string; source: string }) => runCustomCode(dataset!.dataset_id, source, "Manual notebook execution", dataset!.profile.version_id),
    onMutate: ({ id }) => { setExecutionStage("Running code"); updateManualCell(id, { status: "running", output: undefined }); },
    onSuccess: (nextRun, { id }) => { setRun(nextRun); updateManualCell(id, { status: nextRun.execution.status, output: nextRun.execution.stderr || nextRun.execution.stdout || "Execution completed." }); setExecutionStage(nextRun.execution.status === "success" ? "Completed" : "Failed"); },
    onError: (error, { id }) => { updateManualCell(id, { status: "failed", output: error.message }); setExecutionStage("Failed"); }
  });
  const manualSql = useMutation({
    mutationFn: ({ source }: { id: string; source: string }) => runSql(dataset!.dataset_id, source, dataset!.profile.version_id),
    onMutate: ({ id }) => { setExecutionStage("Running code"); updateManualCell(id, { status: "running", output: undefined }); },
    onSuccess: (result, { id }) => { updateManualCell(id, { status: "success", sqlResult: result, output: `${result.rows} rows returned.` }); setExecutionStage("Completed"); },
    onError: (error, { id }) => { updateManualCell(id, { status: "failed", output: error.message }); setExecutionStage("Failed"); }
  });
  const sandboxTask = useMutation({
    mutationFn: ({ sandboxId, prompt }: { sandboxId: string; prompt: string }) => runSandboxTask(dataset!.dataset_id, sandboxId, prompt, dataset!.profile.version_id),
    onMutate: ({ sandboxId }) => setExecutionStage(`Running ${sandboxes.find((sandbox) => sandbox.id === sandboxId)?.name ?? "sandbox"} task`),
    onSuccess: (result) => {
      setTaskResults((items) => ({ ...items, [result.sandbox_id]: result }));
      setExecutionStage(result.execution.status === "success" ? "Completed" : "Failed");
    },
    onError: () => setExecutionStage("Failed")
  });
  const saveSettings = useMutation({
    mutationFn: updateAppSettings,
    onSuccess: () => {
      settings.refetch();
      provider.refetch();
    }
  });
  const deleteStorage = useMutation({
    mutationFn: deleteAllStorage,
    onSuccess: () => {
      resetWorkspace();
      setCode("");
      setAnalysisPlan(null);
      setManualCells([]);
      setTaskResults({});
      setSelectedCellId(null);
      setExecutionStage("Waiting");
      savedDatasets.refetch();
    }
  });
  const deleteOneDataset = useMutation({
    mutationFn: ({ datasetId, confirm }: { datasetId: string; confirm: string }) => deleteDataset(datasetId, confirm),
    onSuccess: (payload) => {
      removeDataset(payload.dataset_id);
      if (dataset?.dataset_id === payload.dataset_id) {
        setCode("");
        setAnalysisPlan(null);
        setManualCells([]);
        setTaskResults({});
        setSelectedCellId(null);
        setExecutionStage("Waiting");
      }
      savedDatasets.refetch();
    }
  });

  function runWithInstruction(nextInstruction = instruction) {
    const trimmed = nextInstruction.trim();
    if (!dataset || !trimmed || clean.isPending) return;
    setInstruction(trimmed);
    clean.mutate(trimmed);
  }

  function createPlan(nextInstruction = instruction) {
    const trimmed = nextInstruction.trim();
    if (!dataset || !trimmed || planOnly.isPending) return;
    setInstruction(trimmed);
    setRun(null);
    planOnly.mutate(trimmed);
  }

  function runEditedCode() {
    if (!dataset || !code.trim() || executeCode.isPending) return;
    executeCode.mutate();
  }

  function updateManualCell(id: string, patch: Partial<ManualCellRecord>) {
    setManualCells((cells) => cells.map((cell) => cell.id === id ? { ...cell, ...patch } : cell));
  }

  function addManualCell(type: ManualCellRecord["type"], afterId?: string) {
    const id = `cell_${crypto.randomUUID().slice(0, 8)}`;
    const source = type === "sql" ? "SELECT *\nFROM dataset\nLIMIT 100" : type === "python" ? "# Manual notebook code\n# Use approved input/output paths for sandbox execution.\n" : "## Analysis note\n\nDescribe the objective, finding, and next step.";
    const cell: ManualCellRecord = { id, type, source, sandboxId: activeSandboxId, includeInReport: false, status: "idle" };
    setManualCells((cells) => {
      if (!afterId) return [...cells, cell];
      const index = cells.findIndex((item) => item.id === afterId);
      return index < 0 ? [...cells, cell] : [...cells.slice(0, index + 1), cell, ...cells.slice(index + 1)];
    });
    setSelectedCellId(id);
  }

  function createSandbox() {
    const name = window.prompt("Sandbox name", "Experimental");
    if (!name?.trim()) return;
    const id = `sandbox_${crypto.randomUUID().slice(0, 8)}`;
    setSandboxes((items) => [...items, { id, name: name.trim(), mode: "ephemeral", status: "ready" }]);
    setActiveSandboxId(id);
  }

  function restartSandbox() {
    setSandboxes((items) => items.map((sandbox) => sandbox.id === activeSandboxId ? { ...sandbox, status: "ready" } : sandbox));
    setExecutionStage("Waiting");
  }

  const notebook = (
    activeView === "settings" ? (
      <SettingsView
        appTheme={appTheme}
        settings={settings.data}
        providerStatus={provider.data}
        settingsLoading={settings.isFetching}
        providerLoading={provider.isFetching}
        savePending={saveSettings.isPending}
        saveError={saveSettings.error?.message}
        onSave={(payload) => saveSettings.mutate(payload)}
        onTest={() => provider.refetch()}
        onBack={() => setActiveView("notebook")}
        onToggleAppTheme={() => setAppTheme((theme) => theme === "dark" ? "light" : "dark")}
      />
    ) : (
      <Notebook
      dataset={dataset}
      run={run}
      code={code}
      instruction={instruction}
      upload={upload}
      clean={clean}
      executeCode={executeCode}
      approve={approve}
      healthStatus={health.isSuccess ? "connected" : health.isLoading || health.isFetching ? "checking" : "offline"}
      providerStatus={provider.data}
      isRefreshing={savedDatasets.isFetching}
      report={report.data}
      reportLoading={report.isFetching}
      analysisPlan={analysisPlan}
      planPending={planOnly.isPending}
      agentPrompt={agentPrompt}
      agentPending={sandboxTask.isPending}
      sandboxes={sandboxes}
      taskResults={taskResults}
      taskPendingSandboxId={sandboxTask.isPending ? sandboxTask.variables?.sandboxId : undefined}
      taskError={sandboxTask.error?.message}
      activeSandboxId={activeSandboxId}
      manualCells={manualCells}
      selectedCellId={selectedCellId}
      executionStage={executionStage}
      reportPreview={reportPreview}
      appTheme={appTheme}
      reportTheme={reportTheme}
      uploadInputRef={uploadInputRef}
      onRefresh={() => savedDatasets.refetch()}
      onInstructionChange={setInstruction}
      onRunInstruction={runWithInstruction}
      onCreatePlan={createPlan}
      onVersionChange={(versionId) => getDatasetVersion(dataset!.dataset_id, versionId).then(setDataset)}
      onShowReport={() => setReportPreview(true)}
      onHideReport={() => setReportPreview(false)}
      onRefreshReport={() => report.refetch()}
      onAgentPromptChange={setAgentPrompt}
      onToggleAppTheme={() => setAppTheme((theme) => theme === "dark" ? "light" : "dark")}
      onToggleReportTheme={() => setReportTheme((theme) => theme === "light" ? "dark" : "light")}
      onCodeChange={setCode}
      onRunCode={runEditedCode}
      onApprove={() => approve.mutate()}
      onReject={() => setRun(null)}
      onSandboxChange={setActiveSandboxId}
      onCreateSandbox={createSandbox}
      onAddManualCell={addManualCell}
      onSelectManualCell={setSelectedCellId}
      onUpdateManualCell={updateManualCell}
      onRemoveManualCell={(id) => { setManualCells((cells) => cells.filter((cell) => cell.id !== id)); setSelectedCellId((current) => current === id ? null : current); }}
      onRunManualCell={(cell) => { if (!dataset) return; if (cell.type === "python") manualPython.mutate({ id: cell.id, source: cell.source }); else if (cell.type === "sql") manualSql.mutate({ id: cell.id, source: cell.source }); }}
      onRunSandboxTask={(sandboxId, prompt) => {
        sandboxTask.mutate({ sandboxId, prompt });
        setAgentPrompt("");
      }}
      onStop={() => setExecutionStage("Cancelled")}
      onRestartSandbox={restartSandbox}
    />
    )
  );
  const left = (
    <LeftPanel
      datasets={datasets}
      filename={dataset?.filename}
      selectedDatasetId={dataset?.dataset_id}
      activeVersionId={dataset?.profile.version_id}
      versions={versions}
      isRefreshing={savedDatasets.isFetching}
      exportHref={dataset ? `/api/datasets/${dataset.dataset_id}/export?version_id=${dataset.profile.version_id}` : undefined}
      reportHref={dataset ? `/api/datasets/${dataset.dataset_id}/report.pdf?version_id=${dataset.profile.version_id}${run ? `&run_id=${run.run_id}` : ""}` : undefined}
      runStatus={run?.execution.status}
      onRefresh={() => savedDatasets.refetch()}
      onOpenSettings={() => {
        setActiveView("settings");
        setLeftOpen(false);
      }}
      onDeleteAll={() => {
        deleteStorage.mutate("DELETE");
      }}
      onDeleteDataset={(item) => {
        deleteOneDataset.mutate({ datasetId: item.dataset_id, confirm: "DELETE" });
      }}
      onSelectDataset={(next) => {
        setDataset(next);
        setActiveView("notebook");
        setLeftOpen(false);
      }}
    />
  );
  const assistant = (
    <RightPanel
      profile={dataset?.profile}
      run={run}
      instruction={instruction}
      isRunning={clean.isPending}
      deletePending={deleteStorage.isPending}
      deleteError={deleteStorage.error?.message}
      onInstructionChange={setInstruction}
      onRejectRun={() => setRun(null)}
      onDeleteAllData={(confirm) => deleteStorage.mutate(confirm)}
      onRun={runWithInstruction}
    />
  );

  if (compact) {
    return (
      <div className={`app-theme-${appTheme} h-screen overflow-hidden bg-base text-ink`}>
        <div className="flex h-10 items-center justify-between border-b border-line bg-base px-3 text-xs">
          <button className="icon-button" title="Open files" onClick={() => setLeftOpen(true)} type="button"><Menu className="h-4 w-4" /></button>
          <span className="font-medium">{activeView === "settings" ? "Settings" : "Cleaning notebook"}</span>
          <button className="icon-button" title="Open assistant" onClick={() => setAssistantOpen(true)} type="button"><Sparkles className="h-4 w-4" /></button>
        </div>
        {notebook}
        {leftOpen && <MobileDrawer side="left" onClose={() => setLeftOpen(false)}>{left}</MobileDrawer>}
        {assistantOpen && <MobileDrawer side="right" onClose={() => setAssistantOpen(false)}>{assistant}</MobileDrawer>}
      </div>
    );
  }

  return (
    <div className={`app-theme-${appTheme} h-screen overflow-hidden bg-base text-ink`}>
      <PanelGroup direction="horizontal">
        <Panel defaultSize={19} minSize={15} collapsible>{left}</Panel>
        <PanelResizeHandle className="w-px bg-line" />
        <Panel minSize={42}>{notebook}</Panel>
        <PanelResizeHandle className="w-px bg-line" />
        <Panel defaultSize={27} minSize={20} collapsible>{assistant}</Panel>
      </PanelGroup>
    </div>
  );
}

type NotebookProps = {
  dataset: UploadResponse | null;
  run: CleaningRun | null;
  code: string;
  instruction: string;
  upload: UseMutationResult<UploadResponse, Error, File, unknown>;
  clean: UseMutationResult<CleaningRun, Error, string, unknown>;
  executeCode: UseMutationResult<CleaningRun, Error, void, unknown>;
  approve: UseMutationResult<{ status: string; version: DatasetRecord["versions"][number] }, Error, void, unknown>;
  healthStatus: "checking" | "connected" | "offline";
  providerStatus?: import("./lib/api").AIProviderStatus;
  isRefreshing: boolean;
  report?: DatasetReport;
  reportLoading: boolean;
  analysisPlan: AnalysisPlan | null;
  planPending: boolean;
  agentPrompt: string;
  agentPending: boolean;
  sandboxes: NotebookSandbox[];
  taskResults: Record<string, SandboxTaskResult>;
  taskPendingSandboxId?: string;
  taskError?: string;
  activeSandboxId: string;
  manualCells: ManualCellRecord[];
  selectedCellId: string | null;
  executionStage: string;
  reportPreview: boolean;
  appTheme: "dark" | "light";
  reportTheme: "light" | "dark";
  uploadInputRef: React.RefObject<HTMLInputElement>;
  onRefresh: () => void;
  onInstructionChange: (value: string) => void;
  onRunInstruction: (instruction?: string) => void;
  onCreatePlan: (instruction?: string) => void;
  onVersionChange: (versionId: string) => void;
  onShowReport: () => void;
  onHideReport: () => void;
  onRefreshReport: () => void;
  onAgentPromptChange: (value: string) => void;
  onToggleAppTheme: () => void;
  onToggleReportTheme: () => void;
  onCodeChange: (value: string) => void;
  onRunCode: () => void;
  onApprove: () => void;
  onReject: () => void;
  onSandboxChange: (id: string) => void;
  onCreateSandbox: () => void;
  onAddManualCell: (type: ManualCellRecord["type"], afterId?: string) => void;
  onSelectManualCell: (id: string) => void;
  onUpdateManualCell: (id: string, patch: Partial<ManualCellRecord>) => void;
  onRemoveManualCell: (id: string) => void;
  onRunManualCell: (cell: ManualCellRecord) => void;
  onRunSandboxTask: (sandboxId: string, prompt: string) => void;
  onStop: () => void;
  onRestartSandbox: () => void;
};

function Notebook(props: NotebookProps) {
  const { dataset, run, code, instruction, upload, clean, executeCode, approve, healthStatus, providerStatus, isRefreshing, report, reportLoading, analysisPlan, planPending, agentPrompt, agentPending, sandboxes, taskResults, taskPendingSandboxId, taskError, activeSandboxId, manualCells, selectedCellId, executionStage, reportPreview, appTheme, reportTheme, uploadInputRef } = props;
  const [openSection, setOpenSection] = useState<string | null>("dataset-status");
  const expandSection = (section: string) => {
    setOpenSection((current) => current === section ? null : section);
    window.setTimeout(() => document.getElementById(section)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };
  const activeSandbox = sandboxes.find((sandbox) => sandbox.id === activeSandboxId);
  const selectedManualCell = manualCells.find((cell) => cell.id === selectedCellId);
  const reportPdfUrl = dataset ? `/api/datasets/${dataset.dataset_id}/report.pdf?version_id=${dataset.profile.version_id}&theme=${reportTheme}${run ? `&run_id=${run.run_id}` : ""}` : "";
  return (
    <main className="notebook-main h-full overflow-auto bg-notebook">
      <NotebookHeader theme={appTheme} onToggleTheme={props.onToggleAppTheme} />
      <NotebookActionRow dataset={dataset} versions={dataset?.versions ?? []} activeVersionId={dataset?.profile.version_id} sandboxId={activeSandboxId} sandboxes={sandboxes} onVersionChange={props.onVersionChange} onSandboxChange={props.onSandboxChange} onUpload={() => uploadInputRef.current?.click()} onCreateSandbox={props.onCreateSandbox} onAddCell={props.onAddManualCell} onRun={() => selectedManualCell ? props.onRunManualCell(selectedManualCell) : props.onRunCode()} onStop={props.onStop} onRestart={props.onRestartSandbox} onAskAI={() => expandSection("ai-prompt")} onCharts={() => expandSection("profile-charts")} onReport={() => { props.onShowReport(); expandSection("report-cell"); }} onExport={() => dataset && window.open(`/api/datasets/${dataset.dataset_id}/export?version_id=${dataset.profile.version_id}`, "_self")} />
      <Cell type="dataset" title="Upload or select dataset" status={dataset ? "success" : "idle"} collapsed={false}>
        <div className="flex flex-wrap items-center gap-2">
          <label className="command-button cursor-pointer">
            <FileUp className="h-3.5 w-3.5" />
            <span>{upload.isPending ? "Uploading..." : "Upload dataset"}</span>
            <input ref={uploadInputRef} type="file" accept=".csv,.tsv,.xlsx,.xls,.parquet,.json,.jsonl" className="hidden" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload.mutate(file);
              event.currentTarget.value = "";
            }} />
          </label>
          <button className="command-button text-muted" disabled={isRefreshing} onClick={props.onRefresh} type="button"><RefreshCw className={isRefreshing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> Refresh</button>
          <span className={healthStatus === "connected" ? "text-xs text-ok" : healthStatus === "checking" ? "text-xs text-warn" : "text-xs text-bad"}>API {healthStatus}</span>
          {providerStatus && <span className={providerStatus.connection === "connected" ? "text-xs text-ok" : "text-xs text-warn"} title={providerStatus.connection_error ?? undefined}>Gemini {providerStatus.connection === "connected" ? "connected" : providerStatus.connection === "error" ? "needs attention" : "not configured"}</span>}
        </div>
        {upload.isPending && <p className="mt-2 text-xs text-muted">Uploading and profiling the file...</p>}
        {dataset?.storage_path && <p className="mt-2 truncate font-mono text-xs text-muted">Stored at {dataset.storage_path}</p>}
        {upload.error && <p className="mt-2 text-xs text-bad">{upload.error.message}</p>}
      </Cell>

      {dataset && <>
        <div id="dataset-status"><DatasetStatusRow dataset={dataset} sandbox={activeSandbox} lastStatus={executionStage} /></div>
        <DatasetActionRow onPreview={() => expandSection("dataset-preview")} onProfile={() => expandSection("dataset-profile")} onSchema={() => expandSection("report-cell")} onIssues={() => expandSection("dataset-profile")} onCompare={() => expandSection("comparison-cell")} onExport={() => window.open(`/api/datasets/${dataset.dataset_id}/export`, "_self")} />
        <AgentCommandCenter
          dataset={dataset}
          sandbox={activeSandbox}
          prompt={agentPrompt}
          pending={agentPending}
          result={taskResults[activeSandboxId]}
          error={taskError}
          onPromptChange={props.onAgentPromptChange}
          onRun={(prompt) => props.onRunSandboxTask(activeSandboxId, prompt)}
        />
        {(run || Object.keys(taskResults).length > 0) && <SandboxPromptBars sandboxes={sandboxes} taskResults={taskResults} pendingSandboxId={taskPendingSandboxId} error={taskError} onRun={props.onRunSandboxTask} />}
        <div id="dataset-profile"><Cell type="profile" title="Dataset metadata" status="success" sandbox={activeSandbox?.name} collapsed={openSection !== "dataset-profile"} onToggleCollapsed={() => expandSection("dataset-profile")}>
          <div className="metric-grid"><Metric label="Rows" value={formatNumber(dataset.profile.rows)} /><Metric label="Columns" value={formatNumber(dataset.profile.columns)} /><Metric label="Duplicates" value={formatNumber(dataset.profile.duplicate_rows)} /><Metric label="Quality" value={`${dataset.profile.data_quality_score}%`} /></div>
          {dataset.profile.detected_problems.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2">{dataset.profile.detected_problems.slice(0, 8).map((issue) => <div key={issue} className="border border-line bg-base px-2 py-1.5 text-xs text-muted">{issue}</div>)}</div>}
        </Cell></div>

        <div id="profile-charts"><Cell type="graph" title="Profile visualizations" status="success" sandbox={activeSandbox?.name} collapsed={openSection !== "profile-charts"} onToggleCollapsed={() => expandSection("profile-charts")}><ProfileCharts profile={dataset.profile} /></Cell></div>
        <div id="dataset-preview"><Cell type="preview" title="Original data preview" status="success" sandbox={activeSandbox?.name} collapsed={openSection !== "dataset-preview"} onToggleCollapsed={() => expandSection("dataset-preview")}><DataTable rows={dataset.profile.sample_rows} /></Cell></div>
        <div id="ai-prompt"><Cell type="ai prompt" title="Notebook instruction" status={clean.isPending ? "running" : run ? run.execution.status : "idle"} sandbox={activeSandbox?.name} onRun={() => props.onRunInstruction()} collapsed={openSection !== "ai-prompt"} onToggleCollapsed={() => expandSection("ai-prompt")}>
          <textarea className="min-h-24 w-full resize-y border border-line bg-base p-3 text-sm text-ink outline-none focus:border-accent" value={instruction} onChange={(event) => props.onInstructionChange(event.target.value)} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select className="compact-select" value={activeSandboxId} onChange={(event) => props.onSandboxChange(event.target.value)}>{sandboxes.map((sandbox) => <option key={sandbox.id} value={sandbox.id}>{sandbox.name}</option>)}</select>
            <select className="compact-select" defaultValue="gemini"><option value="gemini">Gemini</option><option value="rule">Local fallback</option></select>
            <select className="compact-select" defaultValue="run"><option value="plan">Plan only</option><option value="cells">Generate cells</option><option value="run">Generate and run</option><option value="report">Generate report</option></select>
            <button className="primary-button" disabled={clean.isPending || !instruction.trim()} onClick={() => props.onRunInstruction()} type="button"><Sparkles className="h-3.5 w-3.5" />{clean.isPending ? "Planning..." : "Generate and run"}</button>
            <button className="text-action" disabled={!instruction.trim() || planPending} onClick={() => props.onCreatePlan()} type="button">{planPending ? "Planning..." : "Plan only"}</button>
            {(clean.isPending || planPending) && <span className="text-xs text-muted">{executionStage}: structured plan, safety validation, then execution.</span>}
            {clean.error && <span className="text-xs text-bad">{clean.error.message}</span>}
          </div>
        </Cell></div>
      </>}

      {analysisPlan && !run && <PlanCell plan={analysisPlan} sandboxName={activeSandbox?.name} onRun={() => props.onRunInstruction()} />}

      {run && <>
        <Cell type="cleaning plan" title="AI cleaning plan" status="success" sandbox="AI cleaning">
          <p className="mb-3 text-sm text-muted">{run.plan.summary}</p>
          <div className="space-y-1.5">{run.plan.operations.length ? run.plan.operations.map((operation) => <div key={operation.id} className="border border-line bg-base px-3 py-2 text-xs"><div className="flex items-center justify-between gap-3"><span className="font-medium text-ink">{operation.title}</span><span className={operation.destructive ? "text-warn" : "text-muted"}>{operation.destructive ? "destructive" : "reversible"}</span></div><p className="mt-1 text-muted">{operation.reason}</p></div>) : <p className="text-xs text-muted">Manual code execution. Review the source and validation output before approval.</p>}</div>
        </Cell>
        <Cell type="ai python" title="cleaning_script.py" status={executeCode.isPending ? "running" : run.execution.status} duration={`${run.execution.duration_ms}ms`} sandbox="AI cleaning" onRun={props.onRunCode}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="inline-flex items-center gap-2 text-muted"><ShieldCheck className="h-3.5 w-3.5 text-ok" />{run.plan.operations.length ? "AI-generated source. You can edit it before running again." : "Manual notebook source."}</span><button className="command-button text-muted" disabled={!code.trim() || executeCode.isPending} onClick={props.onRunCode} type="button"><FileCode2 className="h-3.5 w-3.5" />{executeCode.isPending ? "Running..." : "Run edited code"}</button></div>
          <Editor height="420px" defaultLanguage="python" value={code} onChange={(value) => props.onCodeChange(value ?? "")} theme="vs-dark" options={{ minimap: { enabled: false }, fontSize: 12, lineNumbersMinChars: 3, scrollBeyondLastLine: false, wordWrap: "on", padding: { top: 12 } }} />
          {executeCode.error && <p className="mt-2 text-xs text-bad">{executeCode.error.message}</p>}
        </Cell>
        <ResultCell run={run} approvePending={approve.isPending} approveError={approve.error?.message} datasetId={dataset?.dataset_id} onApprove={props.onApprove} onReject={props.onReject} />
        <div id="comparison-cell"><Cell type="comparison" title="Original versus cleaned preview" status={run.execution.status} sandbox="AI cleaning" collapsed={openSection !== "comparison-cell"} onToggleCollapsed={() => expandSection("comparison-cell")}><div className="grid gap-3 xl:grid-cols-2"><div><div className="mb-2 text-xs text-muted">Original</div><DataTable rows={run.original_preview} /></div><div><div className="mb-2 text-xs text-muted">Cleaned</div><DataTable rows={run.execution.preview_rows} /></div></div></Cell></div>
      </>}

      {Object.values(taskResults).map((task) => <TaskResultCell key={task.task_id} task={task} sandboxName={sandboxes.find((sandbox) => sandbox.id === task.sandbox_id)?.name ?? task.sandbox_id} />)}

      {manualCells.map((cell) => <ManualNotebookCell key={cell.id} cell={cell} sandboxName={sandboxes.find((sandbox) => sandbox.id === cell.sandboxId)?.name ?? "Unassigned"} selected={selectedCellId === cell.id} onSelect={() => props.onSelectManualCell(cell.id)} onChange={(source) => props.onUpdateManualCell(cell.id, { source, status: "idle" })} onRun={() => props.onRunManualCell(cell)} onDuplicate={() => props.onAddManualCell(cell.type, cell.id)} onAddBelow={() => props.onAddManualCell("python", cell.id)} onToggleReport={() => props.onUpdateManualCell(cell.id, { includeInReport: !cell.includeInReport })} onDelete={() => props.onRemoveManualCell(cell.id)} />)}

      {dataset && <div id="report-cell"><Cell type="report" title="Data quality report" status={reportLoading ? "running" : "success"} sandbox={activeSandbox?.name} collapsed={openSection !== "report-cell"} onToggleCollapsed={() => expandSection("report-cell")}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm text-ink">{report?.title ?? "Preparing report..."}</p><p className="mt-1 text-xs text-muted">Column statistics, profile findings, correlations, and the latest run validation are kept with this dataset.</p></div><div className="flex gap-2"><button className="command-button text-muted" onClick={props.onShowReport} type="button"><FileText className="h-3.5 w-3.5" /> Preview report</button><a className="command-button text-muted" href={reportPdfUrl}><Download className="h-3.5 w-3.5" /> Download PDF</a></div></div>
        {reportPreview && report && <VisualReport report={report} pdfUrl={reportPdfUrl} onRefresh={props.onRefreshReport} theme={reportTheme} onToggleTheme={props.onToggleReportTheme} />}
        {reportPreview && !report && <div className="mt-3 border border-line p-3 text-xs text-muted">Building visual report from the selected dataset version...</div>}
        {report && <div id="column-report" className="mt-3 max-h-64 overflow-auto border border-line"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-panel text-muted"><tr><th className="px-2 py-2">Column</th><th className="px-2 py-2">Type</th><th className="px-2 py-2">Nulls</th><th className="px-2 py-2">Unique</th><th className="px-2 py-2">Mean</th><th className="px-2 py-2">Outliers</th></tr></thead><tbody>{report.columns.map((column) => <tr key={String(column.name)} className="border-t border-line/60"><td className="px-2 py-1.5 font-mono text-ink">{String(column.name)}</td><td className="px-2 py-1.5 text-muted">{String(column.type)}</td><td className="px-2 py-1.5 text-muted">{String(column.null_count)} ({String(column.null_percentage)}%)</td><td className="px-2 py-1.5 text-muted">{String(column.unique_count)}</td><td className="px-2 py-1.5 text-muted">{column.mean == null ? "-" : String(column.mean)}</td><td className="px-2 py-1.5 text-muted">{String(column.outlier_count)}</td></tr>)}</tbody></table></div>}
      </Cell></div>}
    </main>
  );
}

function SandboxPromptBars({
  sandboxes,
  taskResults,
  pendingSandboxId,
  error,
  onRun
}: {
  sandboxes: NotebookSandbox[];
  taskResults: Record<string, SandboxTaskResult>;
  pendingSandboxId?: string;
  error?: string;
  onRun: (sandboxId: string, prompt: string) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  return (
    <div className="border-b border-line bg-base/30 px-4 py-2 text-xs">
      <div className="space-y-1.5">
        {sandboxes.map((sandbox) => {
          const value = drafts[sandbox.id] ?? "";
          const result = taskResults[sandbox.id];
          const pending = pendingSandboxId === sandbox.id;
          return (
            <div key={sandbox.id} className="sandbox-prompt-row">
              <span className="min-w-28 truncate font-mono text-muted">{sandbox.name}</span>
              <input
                className="min-w-0 flex-1 bg-transparent text-ink outline-none"
                value={value}
                onChange={(event) => setDrafts((items) => ({ ...items, [sandbox.id]: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && value.trim() && !pending) {
                    onRun(sandbox.id, value.trim());
                    setDrafts((items) => ({ ...items, [sandbox.id]: "" }));
                  }
                }}
                placeholder="Clean this dataset, train a Random Forest model, evaluate accuracy..."
              />
              {pending ? <span className="agent-status-shine">working</span> : result && <span className={result.execution.status === "success" ? "agent-status-success" : "text-bad"}>{result.execution.status === "success" ? "✓ success" : result.execution.status}</span>}
              <button
                className="cell-icon-button"
                disabled={!value.trim() || pending}
                onClick={() => {
                  onRun(sandbox.id, value.trim());
                  setDrafts((items) => ({ ...items, [sandbox.id]: "" }));
                }}
                title="Run follow-up prompt"
                type="button"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
      {error && <p className="mt-2 text-bad">{error}</p>}
    </div>
  );
}

function AgentCommandCenter({
  dataset,
  sandbox,
  prompt,
  pending,
  result,
  error,
  onPromptChange,
  onRun
}: {
  dataset: UploadResponse;
  sandbox?: NotebookSandbox;
  prompt: string;
  pending: boolean;
  result?: SandboxTaskResult;
  error?: string;
  onPromptChange: (value: string) => void;
  onRun: (prompt: string) => void;
}) {
  const stages = result?.workflow.length ? result.workflow : ["planning", "preprocessing", "execution", "validation", "finalizing"];
  const inputPlaceholder = result
    ? "Ask the agent what to do next: feature engineering, train Random Forest, evaluate accuracy..."
    : "Tell the local agent what to do: Clean this dataset, train a model, evaluate accuracy...";
  return (
    <section className="agent-command-shell border-b border-line bg-notebook px-4 py-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div>
          <div className="font-medium text-ink">Local dataset agent</div>
          <div className="mt-0.5 text-muted">
            {dataset.filename} · {formatNumber(dataset.profile.rows)} rows · {sandbox?.name ?? "Main sandbox"}
          </div>
        </div>
        <span className={pending ? "agent-status-shine" : result?.execution.status === "success" ? "agent-status-success" : "text-muted"}>
          {pending ? "planning and executing" : result?.execution.status === "success" ? "✓ success" : result ? result.execution.status : "ready"}
        </span>
      </div>
      <div className="agent-prompt-box">
        <textarea
          className="min-h-16 flex-1 resize-none bg-transparent text-sm text-ink outline-none"
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && prompt.trim() && !pending) onRun(prompt.trim());
          }}
          placeholder={inputPlaceholder}
        />
        <button className="primary-button self-end" disabled={!prompt.trim() || pending} onClick={() => onRun(prompt.trim())} type="button">
          <Send className="h-3.5 w-3.5" />
          {pending ? "Working" : "Send"}
        </button>
      </div>
      {(pending || result) && (
        <div className="mt-3">
          <AgentTimeline stages={stages} pending={pending} result={result} />
        </div>
      )}
      {result && (
        <div className="mt-3 grid gap-2 text-xs md:grid-cols-3">
          <Metric label="Workflow" value={result.workflow.join(" -> ")} />
          <Metric label="Outputs" value={result.execution.generated_files.join(", ") || "None"} />
          <Metric label="Retries" value={result.attempts.length} />
        </div>
      )}
      {error && <p className="mt-2 text-xs text-bad">{error}</p>}
    </section>
  );
}

function AgentTimeline({ stages, pending, result }: { stages: string[]; pending: boolean; result?: SandboxTaskResult }) {
  const attempt = result?.attempts[result.attempts.length - 1];
  const labels = pending ? ["planning", "preprocessing", "generating code", "executing locally", "validating"] : stages;
  return (
    <div className="agent-timeline">
      {labels.map((stage, index) => (
        <div key={`${stage}-${index}`} className="agent-stage">
          <span className={pending ? "agent-stage-dot agent-stage-dot-live" : "agent-stage-dot"} />
          <span className={pending ? "agent-status-shine truncate" : "truncate"}>{stage.split("_").join(" ")}</span>
        </div>
      ))}
      {attempt?.detected_error && (
        <div className="agent-repair-note">
          <span className="text-bad">error detected</span>
          <span>{attempt.applied_fix || "replanning local code"}</span>
        </div>
      )}
    </div>
  );
}

function TaskResultCell({ task, sandboxName }: { task: SandboxTaskResult; sandboxName: string }) {
  const model = task.execution.validation_report?.model as Record<string, any> | undefined;
  return (
    <Cell type="sandbox" title={`Task: ${task.instruction}`} status={task.execution.status} sandbox={sandboxName} defaultCollapsed>
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-2 text-xs">
          <Metric label="Workflow" value={task.workflow.join(" -> ")} />
          <Metric label="Local dataset" value={task.local_dataset_path} />
          <Metric label="Generated files" value={task.execution.generated_files.join(", ") || "None"} />
          {model && <Metric label="Model" value={`${model.model ?? model.status}${model.target ? ` · target ${model.target}` : ""}`} />}
          {model?.metrics && <pre className="max-h-40 overflow-auto border border-line bg-base p-2 font-mono text-muted">{JSON.stringify(model.metrics, null, 2)}</pre>}
        </div>
        <div>
          <div className="mb-2 text-xs text-muted">Self-healing attempts</div>
          <div className="space-y-1.5">
            {task.attempts.map((attempt) => (
              <div key={attempt.attempt} className="border border-line bg-base px-2 py-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-ink">Attempt {attempt.attempt}</span>
                  <span className={attempt.status === "success" ? "text-ok" : attempt.status === "blocked" ? "text-warn" : "text-bad"}>{attempt.status}</span>
                </div>
                {attempt.detected_error && <p className="mt-1 whitespace-pre-wrap text-bad">{attempt.detected_error}</p>}
                {attempt.applied_fix && <p className="mt-1 text-muted">{attempt.applied_fix}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Cell>
  );
}

function SettingsView({
  appTheme,
  settings,
  providerStatus,
  settingsLoading,
  providerLoading,
  savePending,
  saveError,
  onSave,
  onTest,
  onBack,
  onToggleAppTheme
}: {
  appTheme: "dark" | "light";
  settings?: import("./lib/api").AppSettings;
  providerStatus?: import("./lib/api").AIProviderStatus;
  settingsLoading: boolean;
  providerLoading: boolean;
  savePending: boolean;
  saveError?: string;
  onSave: (settings: { ai_provider: "rule" | "gemini"; gemini_api_key: string; gemini_model: string }) => void;
  onTest: () => void;
  onBack: () => void;
  onToggleAppTheme: () => void;
}) {
  const [provider, setProvider] = useState<"rule" | "gemini">(settings?.ai_provider ?? "rule");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(settings?.gemini_model ?? "gemini-3.5-flash");

  useEffect(() => {
    if (!settings) return;
    setProvider(settings.ai_provider);
    setModel(settings.gemini_model);
    setApiKey("");
  }, [settings]);

  const canSave = provider === "rule" || apiKey.trim() || settings?.has_gemini_api_key;
  const statusTone = providerStatus?.connection === "connected" ? "text-ok" : providerStatus?.connection === "error" ? "text-bad" : "text-warn";

  return (
    <main className="notebook-main h-full overflow-auto bg-notebook">
      <NotebookHeader theme={appTheme} onToggleTheme={onToggleAppTheme} />
      <Cell type="settings" title="Settings" status={settingsLoading ? "running" : "idle"}>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="settings-field">
                <span>AI provider</span>
                <select className="settings-input" value={provider} onChange={(event) => setProvider(event.target.value as "rule" | "gemini")}>
                  <option value="rule">Local fallback</option>
                  <option value="gemini">Gemini</option>
                </select>
              </label>
              <label className="settings-field">
                <span>Gemini model</span>
                <input className="settings-input" value={model} onChange={(event) => setModel(event.target.value)} placeholder="gemini-3.5-flash" />
              </label>
            </div>
            <label className="settings-field">
              <span>Gemini API key</span>
              <div className="flex min-w-0 gap-2">
                <input
                  className="settings-input min-w-0 flex-1"
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={settings?.has_gemini_api_key ? "Saved key is set. Enter a new key to replace it." : "Paste Gemini API key"}
                />
                <KeyRound className="mt-2 h-4 w-4 shrink-0 text-muted" />
              </div>
            </label>
            <div className="flex flex-wrap gap-2">
              <button className="primary-button" disabled={!canSave || savePending} onClick={() => onSave({ ai_provider: provider, gemini_api_key: apiKey, gemini_model: model })} type="button">
                <Save className="h-3.5 w-3.5" />
                {savePending ? "Saving..." : "Save settings"}
              </button>
              <button className="command-button text-muted" disabled={providerLoading} onClick={onTest} type="button">
                <TestTube2 className="h-3.5 w-3.5" />
                {providerLoading ? "Testing..." : "Test key"}
              </button>
              <button className="command-button text-muted" onClick={onBack} type="button">Back to notebook</button>
            </div>
            {saveError && <p className="text-xs text-bad">{saveError}</p>}
          </div>
          <div className="border border-line bg-base p-3 text-xs">
            <div className="mb-3 flex items-center gap-2 font-medium text-ink">
              <Settings className="h-4 w-4 text-accent" />
              Provider status
            </div>
            <div className="space-y-2 text-muted">
              <StatusRow label="Configured" value={providerStatus?.configured_provider ?? settings?.ai_provider ?? "unknown"} />
              <StatusRow label="Active" value={providerStatus?.active_provider ?? "unknown"} />
              <StatusRow label="Model" value={providerStatus?.gemini_model ?? model} />
              <StatusRow label="Key" value={settings?.has_gemini_api_key || providerStatus?.has_gemini_api_key ? "saved" : "missing"} />
              <div className={statusTone}>{providerStatus?.connection === "connected" ? "Gemini connection verified." : providerStatus?.connection_error ?? "Save settings, then test the connection."}</div>
            </div>
          </div>
        </div>
      </Cell>
    </main>
  );
}

function StatusRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line/60 pb-1">
      <span>{label}</span>
      <span className="min-w-0 truncate font-mono text-ink">{value}</span>
    </div>
  );
}

function ResultCell({ run, datasetId, approvePending, approveError, onApprove, onReject }: { run: CleaningRun; datasetId?: string; approvePending: boolean; approveError?: string; onApprove: () => void; onReject: () => void }) {
  return <Cell type="result" title={run.execution.status === "success" ? "Cleaning result" : "Execution failure"} status={run.execution.status}>
    <div className="metric-grid"><Metric label="Rows" value={`${formatNumber(Number(run.comparison.rows_before ?? 0))} -> ${formatNumber(Number(run.comparison.rows_after ?? 0))}`} /><Metric label="Columns" value={`${formatNumber(Number(run.comparison.columns_before ?? 0))} -> ${formatNumber(Number(run.comparison.columns_after ?? 0))}`} /><Metric label="Duplicates" value={`${formatNumber(Number(run.comparison.duplicates_before ?? 0))} -> ${formatNumber(Number(run.comparison.duplicates_after ?? 0))}`} /><Metric label="Transformed" value={formatNumber(Number(run.comparison.transformed_values ?? 0))} /></div>
    <details className="mt-3 border border-line bg-base p-2 text-xs text-muted"><summary className="cursor-pointer text-ink">Execution logs and validation</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono">{JSON.stringify(run.execution.validation_report, null, 2)}{"\n"}{run.execution.stderr || run.execution.stdout}</pre></details>
    <div className="mt-3 flex flex-wrap gap-2"><button className="success-button" disabled={run.execution.status !== "success" || approvePending} onClick={onApprove} type="button"><ShieldCheck className="h-3.5 w-3.5" />{approvePending ? "Approving..." : "Approve cleaned dataset"}</button><button className="command-button text-muted" onClick={onReject} type="button"><XCircle className="h-3.5 w-3.5" />Reject result</button>{datasetId && <a className="command-button text-muted" href={`/api/datasets/${datasetId}/export`}><Download className="h-3.5 w-3.5" />Export dataset</a>}{approveError && <span className="self-center text-xs text-bad">{approveError}</span>}</div>
  </Cell>;
}

function PlanCell({ plan, sandboxName, onRun }: { plan: AnalysisPlan; sandboxName?: string; onRun: () => void }) {
  return <Cell type="analysis plan" title="AI notebook plan" status="success" sandbox={sandboxName} onRun={onRun}><div className="flex flex-wrap items-start justify-between gap-3"><p className="text-sm text-muted">{plan.summary}</p><button className="primary-button" onClick={onRun} type="button">Generate and run</button></div><div className="mt-3 space-y-1.5">{plan.operations.map((operation, index) => <div key={operation.id} className="grid gap-2 border border-line bg-base px-3 py-2 text-xs sm:grid-cols-[24px_1fr_auto]"><span className="font-mono text-muted">{index + 1}</span><div><div className="text-ink">{operation.title}</div><div className="mt-1 text-muted">{operation.reason}</div></div><span className={operation.destructive ? "text-warn" : "text-ok"}>{operation.destructive ? "approval required" : "reversible"}</span></div>)}</div></Cell>;
}

function NotebookHeader({ theme, onToggleTheme }: { theme: "dark" | "light"; onToggleTheme: () => void }) { return <motion.header initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="sticky top-0 z-10 flex min-h-10 items-center justify-between gap-3 border-b border-line bg-base/95 px-4 text-xs backdrop-blur"><div className="font-medium text-ink">Cleaning notebook</div><div className="flex items-center gap-2"><div className="hidden text-right text-muted sm:block">Reviewable code, isolated execution, immutable approval.</div><button className="icon-button h-7 w-7" title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} onClick={onToggleTheme} type="button">{theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}</button></div></motion.header>; }
function Metric({ label, value }: { label: string; value: React.ReactNode }) { return <div className="border border-line bg-panel px-2 py-1.5"><div className="text-[10px] uppercase text-muted">{label}</div><div className="truncate font-mono text-ink">{value}</div></div>; }
function MobileDrawer({ side, children, onClose }: { side: "left" | "right"; children: React.ReactNode; onClose: () => void }) { return <div className="fixed inset-0 z-30 bg-black/60" onMouseDown={onClose}><div className={`mobile-drawer ${side === "right" ? "right-0" : "left-0"}`} onMouseDown={(event) => event.stopPropagation()}>{children}</div></div>; }
function useCompactLayout() { const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 900px)").matches); useEffect(() => { const query = window.matchMedia("(max-width: 900px)"); const update = () => setCompact(query.matches); update(); query.addEventListener("change", update); return () => query.removeEventListener("change", update); }, []); return compact; }
