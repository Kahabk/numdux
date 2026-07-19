import Editor from "@monaco-editor/react";
import { useMutation, useQuery, type UseMutationResult } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Download, FileCode2, FileText, FileUp, KeyRound, Menu, Moon, RefreshCw, Save, Send, Settings, ShieldCheck, Sparkles, Sun, TestTube2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type React from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { approveRun, approveSandboxTask, createAnalysisPlan, deleteAllStorage, deleteDataset, getAIProviderStatus, getAppSettings, getDatasetReport, getDatasetVersion, getHealth, listDatasets, runCleaning, runCustomCode, runSandboxTask, runSql, updateAppSettings, uploadDataset } from "./lib/api";
import { useNotebookStore } from "./lib/store";
import type { AnalysisPlan, CleaningRun, DatasetRecord, DatasetReport, SandboxTaskResult, UploadResponse } from "./lib/types";
import { formatNumber } from "./lib/utils";
import { Cell } from "./components/Cell";
import { DataTable } from "./components/DataTable";
import { GraphStudio } from "./components/GraphStudio";
import { LeftPanel } from "./components/LeftPanel";
import { ManualNotebookCell, type ManualCellRecord } from "./components/ManualNotebookCell";
import { ModelLab } from "./components/ModelLab";
import { NotebookActionRow, type NotebookSandbox } from "./components/NotebookRows";
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
  const approveTask = useMutation({
    mutationFn: ({ taskId }: { taskId: string }) => approveSandboxTask(dataset!.dataset_id, taskId),
    onSuccess: (payload) => {
      addVersion(payload.version);
      savedDatasets.refetch();
    }
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
      approveTaskPendingId={approveTask.isPending ? approveTask.variables?.taskId : undefined}
      approveTaskError={approveTask.error?.message}
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
      onApproveSandboxTask={(taskId) => approveTask.mutate({ taskId })}
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
  approveTaskPendingId?: string;
  approveTaskError?: string;
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
  onApproveSandboxTask: (taskId: string) => void;
  onStop: () => void;
  onRestartSandbox: () => void;
};

function Notebook(props: NotebookProps) {
  const { dataset, run, code, instruction, upload, clean, executeCode, approve, healthStatus, providerStatus, isRefreshing, report, reportLoading, analysisPlan, planPending, agentPending, sandboxes, taskResults, taskError, approveTaskPendingId, approveTaskError, activeSandboxId, manualCells, selectedCellId, executionStage, reportPreview, appTheme, reportTheme, uploadInputRef } = props;
  const [openSection, setOpenSection] = useState<string | null>("dataset-status");
  const [artifactTab, setArtifactTab] = useState<"preview" | "schema" | "issues" | "compare" | "charts" | "graph" | "model" | "export">("preview");
  const expandSection = (section: string) => {
    setOpenSection((current) => current === section ? null : section);
    window.setTimeout(() => document.getElementById(section)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };
  const activeSandbox = sandboxes.find((sandbox) => sandbox.id === activeSandboxId);
  const selectedManualCell = manualCells.find((cell) => cell.id === selectedCellId);
  const taskList = Object.values(taskResults);
  const activeTask = taskResults[activeSandboxId] ?? (taskList.length ? taskList[taskList.length - 1] : undefined);
  const reportPdfUrl = dataset ? `/api/datasets/${dataset.dataset_id}/report.pdf?version_id=${dataset.profile.version_id}&theme=${reportTheme}${run ? `&run_id=${run.run_id}` : ""}` : "";
  return (
    <main className="notebook-main h-full overflow-auto bg-notebook">
      <NotebookHeader theme={appTheme} onToggleTheme={props.onToggleAppTheme} />
      <NotebookActionRow dataset={dataset} versions={dataset?.versions ?? []} activeVersionId={dataset?.profile.version_id} sandboxId={activeSandboxId} sandboxes={sandboxes} onVersionChange={props.onVersionChange} onSandboxChange={props.onSandboxChange} onUpload={() => uploadInputRef.current?.click()} onCreateSandbox={props.onCreateSandbox} onAddCell={props.onAddManualCell} onRun={() => selectedManualCell ? props.onRunManualCell(selectedManualCell) : props.onRunCode()} onStop={props.onStop} onRestart={props.onRestartSandbox} onAskAI={() => expandSection("pipeline-plan")} onCharts={() => setArtifactTab("charts")} onReport={() => { props.onShowReport(); expandSection("pipeline-report"); }} onExport={() => dataset && window.open(`/api/datasets/${dataset.dataset_id}/export?version_id=${dataset.profile.version_id}`, "_self")} />

      <PipelineStepper
        dataset={dataset}
        upload={upload}
        uploadInputRef={uploadInputRef}
        activeSandbox={activeSandbox}
        activeVersionId={dataset?.profile.version_id}
        healthStatus={healthStatus}
        providerStatus={providerStatus}
        isRefreshing={isRefreshing}
        executionStage={executionStage}
        instruction={instruction}
        onInstructionChange={props.onInstructionChange}
        onRefresh={props.onRefresh}
        onRunSandboxTask={(prompt) => props.onRunSandboxTask(activeSandboxId, prompt)}
        sandboxPending={agentPending}
        task={activeTask}
        taskError={taskError}
        approvePending={activeTask ? approveTaskPendingId === activeTask.task_id : approve.isPending}
        approveError={approveTaskError ?? approve.error?.message}
        onApprove={() => activeTask ? props.onApproveSandboxTask(activeTask.task_id) : props.onApprove()}
        run={run}
        code={activeTask?.generated_code.code ?? code}
        onCodeChange={props.onCodeChange}
        onRunCode={props.onRunCode}
        codePending={executeCode.isPending}
        codeError={executeCode.error?.message}
        report={report}
        reportLoading={reportLoading}
        reportPreview={reportPreview}
        reportTheme={reportTheme}
        reportPdfUrl={reportPdfUrl}
        onShowReport={props.onShowReport}
        onRefreshReport={props.onRefreshReport}
        onToggleReportTheme={props.onToggleReportTheme}
      />

      {dataset && <ArtifactTabs tab={artifactTab} onTabChange={setArtifactTab} dataset={dataset} report={report} reportPdfUrl={reportPdfUrl} onReportChanged={props.onRefreshReport} />}

      {manualCells.map((cell) => <ManualNotebookCell key={cell.id} cell={cell} sandboxName={sandboxes.find((sandbox) => sandbox.id === cell.sandboxId)?.name ?? "Unassigned"} selected={selectedCellId === cell.id} onSelect={() => props.onSelectManualCell(cell.id)} onChange={(source) => props.onUpdateManualCell(cell.id, { source, status: "idle" })} onRun={() => props.onRunManualCell(cell)} onDuplicate={() => props.onAddManualCell(cell.type, cell.id)} onAddBelow={() => props.onAddManualCell("python", cell.id)} onToggleReport={() => props.onUpdateManualCell(cell.id, { includeInReport: !cell.includeInReport })} onDelete={() => props.onRemoveManualCell(cell.id)} />)}
    </main>
  );
}

function PipelineStepper({
  dataset,
  upload,
  uploadInputRef,
  activeSandbox,
  activeVersionId,
  healthStatus,
  providerStatus,
  isRefreshing,
  executionStage,
  instruction,
  onInstructionChange,
  onRefresh,
  onRunSandboxTask,
  sandboxPending,
  task,
  taskError,
  approvePending,
  approveError,
  onApprove,
  run,
  code,
  onCodeChange,
  onRunCode,
  codePending,
  codeError,
  report,
  reportLoading,
  reportPreview,
  reportTheme,
  reportPdfUrl,
  onShowReport,
  onRefreshReport,
  onToggleReportTheme
}: {
  dataset: UploadResponse | null;
  upload: UseMutationResult<UploadResponse, Error, File, unknown>;
  uploadInputRef: React.RefObject<HTMLInputElement>;
  activeSandbox?: NotebookSandbox;
  activeVersionId?: string;
  healthStatus: "checking" | "connected" | "offline";
  providerStatus?: import("./lib/api").AIProviderStatus;
  isRefreshing: boolean;
  executionStage: string;
  instruction: string;
  onInstructionChange: (value: string) => void;
  onRefresh: () => void;
  onRunSandboxTask: (prompt: string) => void;
  sandboxPending: boolean;
  task?: SandboxTaskResult;
  taskError?: string;
  approvePending: boolean;
  approveError?: string;
  onApprove: () => void;
  run: CleaningRun | null;
  code: string;
  onCodeChange: (value: string) => void;
  onRunCode: () => void;
  codePending: boolean;
  codeError?: string;
  report?: DatasetReport;
  reportLoading: boolean;
  reportPreview: boolean;
  reportTheme: "light" | "dark";
  reportPdfUrl: string;
  onShowReport: () => void;
  onRefreshReport: () => void;
  onToggleReportTheme: () => void;
}) {
  const [openStep, setOpenStep] = useState("plan");
  const [provider, setProvider] = useState<"rule" | "gemini">((providerStatus?.active_provider as "rule" | "gemini" | undefined) ?? "rule");
  const command = instruction.trim();
  const sandboxSuccess = task?.execution.status === "success" || run?.execution.status === "success";
  const approved = Boolean(dataset && dataset.versions.length > 1);
  const originalQuality = dataset?.versions[0]?.quality ?? dataset?.profile.data_quality_score ?? 0;
  const qualityDelta = dataset ? dataset.profile.data_quality_score - originalQuality : 0;
  const runRowsBefore = task ? dataset?.profile.rows : Number(run?.comparison.rows_before ?? dataset?.profile.rows ?? 0);
  const runRowsAfter = task ? Number(task.execution.cleaned_metadata.rows ?? 0) : Number(run?.comparison.rows_after ?? 0);
  const previewRows = task?.execution.preview_rows ?? run?.execution.preview_rows ?? [];
  const originalRows = run?.original_preview ?? dataset?.profile.sample_rows ?? [];
  const generatedFiles = task?.execution.generated_files ?? run?.execution.generated_files ?? [];
  const status = sandboxPending || codePending ? "running" : task?.execution.status ?? run?.execution.status ?? "idle";
  const disabledReason = dataset ? undefined : "Upload a dataset first.";
  const displayCode = redactTaskTextFromCode(code, instruction);

  return (
    <section className="pipeline-shell">
      <div className="pipeline-header">
        <div className="min-w-0">
          <div className="text-xs uppercase text-muted">Pipeline</div>
          <div className="mt-1 truncate text-sm font-medium text-ink">
            {dataset ? `${dataset.filename} · ${activeVersionId ?? "v1"} · ${activeSandbox?.name ?? "Main analysis"}` : "No dataset loaded"}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={healthStatus === "connected" ? "text-ok" : healthStatus === "checking" ? "text-warn" : "text-bad"}>API {healthStatus}</span>
          {providerStatus && <span className={providerStatus.connection === "connected" ? "text-ok" : "text-muted"}>Provider {providerStatus.active_provider}</span>}
          <button className="icon-button" disabled={isRefreshing} onClick={onRefresh} title="Refresh datasets" type="button"><RefreshCw className={isRefreshing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /></button>
        </div>
      </div>

      <div className="pipeline-steps">
        <PipelineStep index={1} id="upload" title="Upload" status={dataset ? "complete" : upload.isPending ? "running" : "active"} summary={dataset ? `${formatNumber(dataset.profile.rows)} rows profiled automatically` : "Dataset ingestion starts the pipeline"} open={openStep === "upload" || !dataset} onOpen={setOpenStep}>
          <div className="flex flex-wrap items-center gap-2">
            <label className="command-button cursor-pointer">
              <FileUp className="h-3.5 w-3.5" />
              <span>{upload.isPending ? "Uploading..." : dataset ? "Replace dataset" : "Upload dataset"}</span>
              <input ref={uploadInputRef} type="file" accept=".csv,.tsv,.xlsx,.xls,.parquet,.json,.jsonl" className="hidden" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) upload.mutate(file);
                event.currentTarget.value = "";
              }} />
            </label>
            {dataset && <span className="text-xs text-muted">{dataset.profile.file_format.toUpperCase()} · {formatNumber(dataset.profile.columns)} columns · quality {dataset.profile.data_quality_score}%</span>}
          </div>
          {upload.error && <p className="mt-2 text-xs text-bad">{upload.error.message}</p>}
        </PipelineStep>

        <PipelineStep index={2} id="profile" title="Profile" status={dataset ? "complete" : "locked"} summary={dataset ? `${formatNumber(dataset.profile.rows)} rows · ${formatNumber(dataset.profile.columns)} columns · ${dataset.profile.data_quality_score}% quality` : disabledReason} open={openStep === "profile"} onOpen={setOpenStep}>
          {dataset && <div className="grid gap-3">
            <div className="metric-grid"><Metric label="Rows" value={formatNumber(dataset.profile.rows)} /><Metric label="Columns" value={formatNumber(dataset.profile.columns)} /><Metric label="Duplicates" value={formatNumber(dataset.profile.duplicate_rows)} /><Metric label="Quality" value={`${dataset.profile.data_quality_score}%`} /></div>
            <div className="grid gap-2 sm:grid-cols-2">
              {(dataset.profile.detected_problems.length ? dataset.profile.detected_problems.slice(0, 6) : ["No major profile issues detected."]).map((issue) => <div key={issue} className="border border-line bg-base px-2 py-1.5 text-xs text-muted">{issue}</div>)}
            </div>
          </div>}
        </PipelineStep>

        <PipelineStep index={3} id="plan" title="Plan" status={dataset ? command ? "active" : "ready" : "locked"} summary={dataset ? "Enter the task once, choose provider, then run the sandbox." : disabledReason} open={openStep === "plan" && Boolean(dataset)} onOpen={setOpenStep}>
          {dataset && <div id="pipeline-plan" className="grid gap-3">
            <textarea
              className="min-h-24 w-full resize-y border border-line bg-base p-3 text-sm text-ink outline-none focus:border-accent"
              value={instruction}
              onChange={(event) => onInstructionChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && command && !sandboxPending) {
                  event.preventDefault();
                  onRunSandboxTask(command);
                  setOpenStep("run");
                }
              }}
              placeholder="Clean nulls and duplicates, filter age > 30, or train Random Forest to predict churn."
            />
            <div className="flex flex-wrap items-center gap-2">
              <select className="compact-select" value={provider} onChange={(event) => setProvider(event.target.value as "rule" | "gemini")}>
                <option value="rule">Rule-based</option>
                <option value="gemini">Gemini</option>
              </select>
              <button className="primary-button" disabled={!command || sandboxPending} onClick={() => { onRunSandboxTask(command); setOpenStep("run"); }} type="button">
                <Sparkles className="h-3.5 w-3.5" />
                {sandboxPending ? <ThinkingPill compact /> : "Run sandbox"}
              </button>
              <span className="text-xs text-muted">{provider === "gemini" ? "Uses configured Gemini when available." : "Uses local deterministic rules."}</span>
            </div>
            {taskError && <p className="text-xs text-bad">{taskError}</p>}
          </div>}
        </PipelineStep>

        <PipelineStep index={4} id="run" title="Sandbox Run" status={dataset ? status : "locked"} summary={dataset ? `${executionStage}${generatedFiles.length ? ` · ${generatedFiles.length} files` : ""}` : disabledReason} open={openStep === "run" && Boolean(dataset)} onOpen={setOpenStep}>
          {dataset && <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <StatusBadge status={status} />
              <button className="command-button text-muted" disabled={!command || sandboxPending} onClick={() => onRunSandboxTask(command)} type="button"><RefreshCw className="h-3.5 w-3.5" />Re-run</button>
            </div>
            {code ? <Editor height="300px" defaultLanguage="python" value={displayCode} onChange={(value) => onCodeChange(value ?? "")} theme="vs-dark" options={{ minimap: { enabled: false }, fontSize: 12, lineNumbersMinChars: 3, scrollBeyondLastLine: false, wordWrap: "on", padding: { top: 12 } }} /> : <div className="pipeline-empty">Generated code appears here after the sandbox run starts.</div>}
            <div className="flex flex-wrap items-center gap-2">
              <button className="command-button text-muted" disabled={!code.trim() || codePending} onClick={onRunCode} type="button"><FileCode2 className="h-3.5 w-3.5" />{codePending ? "Running edited code..." : "Run edited code"}</button>
              {generatedFiles.map((file) => <span key={file} className="pipeline-chip">{file}</span>)}
            </div>
            {(task?.execution.stderr || run?.execution.stderr || codeError) && <pre className="max-h-40 overflow-auto whitespace-pre-wrap border border-line bg-base p-2 font-mono text-xs text-bad">{codeError ?? task?.execution.stderr ?? run?.execution.stderr}</pre>}
          </div>}
        </PipelineStep>

        <PipelineStep index={5} id="review" title="Review & Diff" status={sandboxSuccess ? "active" : "locked"} summary={sandboxSuccess ? `${formatNumber(Number(runRowsBefore ?? 0))} -> ${formatNumber(Number(runRowsAfter ?? 0))} rows` : "Shown after a successful sandbox run."} open={openStep === "review" && sandboxSuccess} onOpen={setOpenStep}>
          {sandboxSuccess && <div className="grid gap-3">
            <div className="metric-grid"><Metric label="Rows" value={`${formatNumber(Number(runRowsBefore ?? 0))} -> ${formatNumber(Number(runRowsAfter ?? 0))}`} /><Metric label="Files" value={generatedFiles.length} /><Metric label="Quality delta" value={approved ? `${qualityDelta >= 0 ? "+" : ""}${qualityDelta.toFixed(1)}%` : "Pending approval"} /><Metric label="Status" value="Ready to review" /></div>
            <div className="grid gap-3 xl:grid-cols-2">
              <div><div className="mb-2 text-xs text-muted">Before sample</div><DataTable rows={originalRows.slice(0, 8)} /></div>
              <div><div className="mb-2 text-xs text-muted">After sample</div><DataTable rows={previewRows.slice(0, 8)} /></div>
            </div>
          </div>}
        </PipelineStep>

        <PipelineStep index={6} id="approve" title="Approve" status={approved ? "complete" : sandboxSuccess ? "active" : "locked"} summary={approved ? `Approved version ${dataset?.versions[dataset.versions.length - 1]?.id}` : sandboxSuccess ? "Promote this run into an immutable dataset version." : "Available after review."} open={openStep === "approve" && Boolean(dataset) && sandboxSuccess} onOpen={setOpenStep}>
          {sandboxSuccess && <div className="flex flex-wrap items-center gap-2">
            <button className="success-button" disabled={approvePending || approved} onClick={onApprove} type="button"><ShieldCheck className="h-3.5 w-3.5" />{approvePending ? "Approving..." : approved ? "Approved" : "Approve as version"}</button>
            {approveError && <span className="text-xs text-bad">{approveError}</span>}
          </div>}
        </PipelineStep>

        <PipelineStep index={7} id="report" title="Report" status={approved ? reportLoading ? "running" : "active" : "locked"} summary={approved ? "Visual report and PDF export are enabled." : "Enabled only after approval."} open={openStep === "report" && approved} onOpen={setOpenStep}>
          {approved && <div id="pipeline-report" className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button className="command-button text-muted" onClick={onShowReport} type="button"><FileText className="h-3.5 w-3.5" />Preview report</button>
              <a className="command-button text-muted" href={reportPdfUrl}><Download className="h-3.5 w-3.5" />Download PDF</a>
            </div>
            {reportPreview && report && <VisualReport report={report} pdfUrl={reportPdfUrl} onRefresh={onRefreshReport} theme={reportTheme} onToggleTheme={onToggleReportTheme} />}
            {reportPreview && !report && <div className="pipeline-empty">Building visual report from the approved version...</div>}
          </div>}
        </PipelineStep>
      </div>
    </section>
  );
}

function PipelineStep({ index, id, title, status, summary, open, onOpen, children }: { index: number; id: string; title: string; status: "idle" | "ready" | "active" | "running" | "success" | "failed" | "blocked" | "complete" | "locked"; summary?: React.ReactNode; open: boolean; onOpen: (id: string) => void; children: React.ReactNode }) {
  const locked = status === "locked";
  const complete = status === "complete" || status === "success";
  return (
    <article className={`pipeline-step ${locked ? "pipeline-step-locked" : complete ? "pipeline-step-complete" : "pipeline-step-active"}`}>
      <button className="pipeline-step-head" disabled={locked} onClick={() => onOpen(open ? "" : id)} type="button">
        <span className="pipeline-step-index">{index}</span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm font-medium text-ink">{title}</span>
          {summary && <span className="mt-0.5 block truncate text-xs text-muted">{summary}</span>}
        </span>
        <StatusBadge status={status} />
      </button>
      {open && !locked && <div className="pipeline-step-body">{children}</div>}
    </article>
  );
}

function redactTaskTextFromCode(code: string, instruction: string) {
  const trimmed = instruction.trim();
  if (!trimmed) return code;
  const escapedSingle = trimmed.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const escapedDouble = trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return code
    .replace(`'instruction': '${escapedSingle}'`, "'instruction': '[task text kept in Plan step]'")
    .replace(`"instruction": "${escapedDouble}"`, '"instruction": "[task text kept in Plan step]"');
}

function StatusBadge({ status }: { status: string }) {
  if (status === "running") return <ThinkingPill />;
  const label = status === "complete" ? "complete" : status === "active" ? "ready" : status;
  const tone = status === "success" || status === "complete" ? "pipeline-status-ok" : status === "failed" || status === "blocked" ? "pipeline-status-bad" : status === "locked" ? "pipeline-status-muted" : "pipeline-status-neutral";
  return <span className={`pipeline-status ${tone}`}>{label}</span>;
}

type ArtifactTab = "preview" | "schema" | "issues" | "compare" | "charts" | "graph" | "model" | "export";

function ArtifactTabs({ tab, onTabChange, dataset, report, reportPdfUrl, onReportChanged }: { tab: ArtifactTab; onTabChange: (tab: ArtifactTab) => void; dataset: UploadResponse; report?: DatasetReport; reportPdfUrl: string; onReportChanged?: () => void }) {
  const approved = dataset.versions.length > 1;
  const tabs: Array<{ id: ArtifactTab; label: string }> = [
    { id: "preview", label: "Preview" },
    { id: "schema", label: "Schema" },
    { id: "issues", label: "Quality issues" },
    { id: "compare", label: "Compare versions" },
    { id: "charts", label: "Charts" },
    { id: "graph", label: "Graph Studio" },
    { id: "model", label: "Model Lab" },
    { id: "export", label: "Export" }
  ];
  return (
    <section className="artifact-panel">
      <div className="artifact-tabs">
        {tabs.map((item) => <button key={item.id} className={tab === item.id ? "artifact-tab artifact-tab-active" : "artifact-tab"} onClick={() => onTabChange(item.id)} type="button">{item.label}</button>)}
      </div>
      <div className="artifact-body">
        {tab === "preview" && <DataTable rows={dataset.profile.sample_rows} />}
        {tab === "schema" && <SchemaTable columns={report?.columns ?? dataset.profile.column_metadata.map((column) => ({ name: column.name, type: column.inferred_type, null_count: column.null_count, null_percentage: column.null_percentage, unique_count: column.unique_count, mean: column.mean, outlier_count: column.outlier_count }))} />}
        {tab === "issues" && <div className="grid gap-2 sm:grid-cols-2">{(dataset.profile.detected_problems.length ? dataset.profile.detected_problems : ["No quality issues detected."]).map((issue) => <div key={issue} className="border border-line bg-base px-2 py-1.5 text-xs text-muted">{issue}</div>)}</div>}
        {tab === "compare" && <VersionTable versions={dataset.versions} activeVersionId={dataset.profile.version_id} onGraphStudio={() => onTabChange("graph")} />}
        {tab === "charts" && <ProfileCharts profile={dataset.profile} />}
        {tab === "graph" && <GraphStudio dataset={dataset} onReportChanged={onReportChanged} />}
        {tab === "model" && <ModelLab dataset={dataset} />}
        {tab === "export" && <div className="flex flex-wrap items-center gap-2"><a className="command-button text-muted" href={`/api/datasets/${dataset.dataset_id}/export?version_id=${dataset.profile.version_id}`}><Download className="h-3.5 w-3.5" />Export current version</a>{approved ? <a className="command-button text-muted" href={reportPdfUrl}><FileText className="h-3.5 w-3.5" />Report PDF</a> : <span className="text-xs text-muted">Report PDF unlocks after approval.</span>}</div>}
      </div>
    </section>
  );
}

function SchemaTable({ columns }: { columns: Array<Record<string, unknown>> }) {
  return <div className="max-h-72 overflow-auto border border-line"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-panel text-muted"><tr><th className="px-2 py-2">Column</th><th className="px-2 py-2">Type</th><th className="px-2 py-2">Nulls</th><th className="px-2 py-2">Unique</th><th className="px-2 py-2">Mean</th><th className="px-2 py-2">Outliers</th></tr></thead><tbody>{columns.map((column) => <tr key={String(column.name)} className="border-t border-line/60"><td className="px-2 py-1.5 font-mono text-ink">{String(column.name)}</td><td className="px-2 py-1.5 text-muted">{String(column.type)}</td><td className="px-2 py-1.5 text-muted">{String(column.null_count)} ({String(column.null_percentage)}%)</td><td className="px-2 py-1.5 text-muted">{String(column.unique_count)}</td><td className="px-2 py-1.5 text-muted">{column.mean == null ? "-" : String(column.mean)}</td><td className="px-2 py-1.5 text-muted">{String(column.outlier_count)}</td></tr>)}</tbody></table></div>;
}

function VersionTable({ versions, activeVersionId, onGraphStudio }: { versions: DatasetRecord["versions"]; activeVersionId: string; onGraphStudio: () => void }) {
  return <div className="max-h-64 overflow-auto border border-line"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-panel text-muted"><tr><th className="px-2 py-2">Version</th><th className="px-2 py-2">Rows</th><th className="px-2 py-2">Columns</th><th className="px-2 py-2">Quality</th><th className="px-2 py-2">Fingerprint</th><th className="px-2 py-2">Graph</th></tr></thead><tbody>{versions.map((version) => <tr key={version.id} className={version.id === activeVersionId ? "border-t border-line/60 bg-accent/10" : "border-t border-line/60"}><td className="px-2 py-1.5 font-mono text-ink">{version.id}</td><td className="px-2 py-1.5 text-muted">{version.rows}</td><td className="px-2 py-1.5 text-muted">{version.columns}</td><td className="px-2 py-1.5 text-muted">{version.quality}%</td><td className="px-2 py-1.5 font-mono text-muted">{version.fingerprint.slice(0, 12)}</td><td className="px-2 py-1.5"><button className="text-action" onClick={onGraphStudio} type="button">Graph Studio</button></td></tr>)}</tbody></table></div>;
}

function SandboxPromptBars({
  sandboxes,
  defaultPrompt,
  taskResults,
  pendingSandboxId,
  error,
  onRun
}: {
  sandboxes: NotebookSandbox[];
  defaultPrompt: string;
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
          const value = drafts[sandbox.id] ?? defaultPrompt;
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
              {pending ? <ThinkingPill /> : result && <span className={result.execution.status === "success" ? "agent-status-success" : "text-bad"}>{result.execution.status === "success" ? "✓ success" : result.execution.status}</span>}
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

function CommandWorkspace({
  dataset,
  upload,
  uploadInputRef,
  healthStatus,
  providerStatus,
  isRefreshing,
  onRefresh,
  sandbox,
  pending,
  result,
  error,
  command,
  onCommandChange,
  onRun
}: {
  dataset: UploadResponse | null;
  upload: UseMutationResult<UploadResponse, Error, File, unknown>;
  uploadInputRef: React.RefObject<HTMLInputElement>;
  healthStatus: "checking" | "connected" | "offline";
  providerStatus?: import("./lib/api").AIProviderStatus;
  isRefreshing: boolean;
  onRefresh: () => void;
  sandbox?: NotebookSandbox;
  pending: boolean;
  result?: SandboxTaskResult;
  error?: string;
  command: string;
  onCommandChange: (value: string) => void;
  onRun: (prompt: string) => void;
}) {
  const trimmedCommand = command.trim();
  return (
    <section className="command-workspace border-b border-line bg-notebook px-4 py-6">
      <div className="mx-auto grid w-full max-w-4xl gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="min-w-0">
            <div className="font-medium text-ink">{dataset ? dataset.filename : "Start with a dataset"}</div>
            <div className="mt-0.5 truncate text-muted">
              {dataset ? `${formatNumber(dataset.profile.rows)} rows · ${formatNumber(dataset.profile.columns)} columns · ${sandbox?.name ?? "Main sandbox"}` : "Upload, profile, then ask the agent for the exact output you want."}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={healthStatus === "connected" ? "text-ok" : healthStatus === "checking" ? "text-warn" : "text-bad"}>API {healthStatus}</span>
            {providerStatus && <span className={providerStatus.connection === "connected" ? "text-ok" : "text-warn"} title={providerStatus.connection_error ?? undefined}>Gemini {providerStatus.connection === "connected" ? "connected" : providerStatus.connection === "error" ? "needs attention" : "local mode"}</span>}
            <button className="icon-button" disabled={isRefreshing} onClick={onRefresh} title="Refresh datasets" type="button"><RefreshCw className={isRefreshing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /></button>
          </div>
        </div>
        <div className="agent-prompt-box">
          <textarea
            className="min-h-20 flex-1 resize-none bg-transparent text-sm text-ink outline-none"
            value={command}
            disabled={!dataset || pending}
            onChange={(event) => onCommandChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && trimmedCommand && !pending && dataset) {
                event.preventDefault();
                onRun(trimmedCommand);
              }
            }}
            placeholder={dataset ? "Clean nulls and duplicates, or: only filter age > 30, or: train Random Forest to predict churn." : "Upload a CSV, Excel, Parquet, JSON, or TSV file first."}
          />
          <div className="flex shrink-0 flex-col justify-end gap-2">
            <label className="command-button cursor-pointer">
              <FileUp className="h-3.5 w-3.5" />
              <span>{upload.isPending ? "Uploading" : dataset ? "Replace" : "Upload"}</span>
              <input ref={uploadInputRef} type="file" accept=".csv,.tsv,.xlsx,.xls,.parquet,.json,.jsonl" className="hidden" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) upload.mutate(file);
                event.currentTarget.value = "";
              }} />
            </label>
            <button className="primary-button" disabled={!dataset || !trimmedCommand || pending} onClick={() => onRun(trimmedCommand)} type="button">
              <Send className="h-3.5 w-3.5" />
              {pending ? <ThinkingPill compact /> : "Run"}
            </button>
          </div>
        </div>
        {(pending || result) && <AgentTimeline stages={result?.workflow.length ? result.workflow : ["planning", "preprocessing", "execution", "validation"]} pending={pending} result={result} />}
        {upload.isPending && <p className="text-xs text-muted">Uploading and profiling the file...</p>}
        {upload.error && <p className="text-xs text-bad">{upload.error.message}</p>}
        {error && <p className="text-xs text-bad">{error}</p>}
      </div>
    </section>
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
          <span className={pending ? "truncate text-[#b9bed6]" : "truncate"}>{stage.split("_").join(" ")}</span>
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

function ThinkingPill({ compact = false }: { compact?: boolean }) {
  return <span className={compact ? "thinking-pill thinking-pill-compact" : "thinking-pill"}>Thinking</span>;
}

function TaskResultCell({
  task,
  sandboxName,
  datasetId,
  approvePending,
  approveError,
  onApprove
}: {
  task: SandboxTaskResult;
  sandboxName: string;
  datasetId?: string;
  approvePending: boolean;
  approveError?: string;
  onApprove: () => void;
}) {
  const model = task.execution.validation_report?.model as Record<string, any> | undefined;
  const featureImportance = Array.isArray(model?.feature_importance) ? model.feature_importance as Array<{ feature: string; importance: number }> : [];
  const predictionPreview = Array.isArray(model?.predictions_preview) ? model.predictions_preview as Record<string, unknown>[] : [];
  return (
    <Cell type="sandbox" title={`Task: ${task.instruction}`} status={task.execution.status} sandbox={sandboxName} defaultCollapsed>
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-2 text-xs">
          <Metric label="Workflow" value={task.workflow.join(" -> ")} />
          <Metric label="Local dataset" value={task.local_dataset_path} />
          <Metric label="Generated files" value={task.execution.generated_files.join(", ") || "None"} />
          {model && <Metric label="Model" value={`${model.model ?? model.status}${model.target ? ` · target ${model.target}` : ""}`} />}
          {model?.metrics && <pre className="max-h-40 overflow-auto border border-line bg-base p-2 font-mono text-muted">{JSON.stringify(model.metrics, null, 2)}</pre>}
          <div className="flex flex-wrap gap-2 pt-1">
            {datasetId && <button className="success-button" disabled={task.execution.status !== "success" || approvePending} onClick={onApprove} type="button"><ShieldCheck className="h-3.5 w-3.5" />{approvePending ? "Approving..." : "Approve as version"}</button>}
            <a className="command-button text-muted" href={`/api/sandbox-tasks/${task.task_id}/files/cleaned.csv`}><Download className="h-3.5 w-3.5" />Cleaned CSV</a>
            <a className="command-button text-muted" href={`/api/sandbox-tasks/${task.task_id}/files/features.csv`}><Download className="h-3.5 w-3.5" />Features</a>
            {task.execution.generated_files.includes("predictions.csv") && <a className="command-button text-muted" href={`/api/sandbox-tasks/${task.task_id}/files/predictions.csv`}><Download className="h-3.5 w-3.5" />Predictions</a>}
            {approveError && <span className="self-center text-bad">{approveError}</span>}
          </div>
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
      {featureImportance.length > 0 && <ModelBars items={featureImportance} />}
      {task.execution.preview_rows.length > 0 && <div className="mt-3"><div className="mb-2 text-xs text-muted">Cleaned output preview</div><DataTable rows={task.execution.preview_rows} /></div>}
      {predictionPreview.length > 0 && <div className="mt-3"><div className="mb-2 text-xs text-muted">Prediction sample</div><DataTable rows={predictionPreview} /></div>}
    </Cell>
  );
}

function ModelBars({ items }: { items: Array<{ feature: string; importance: number }> }) {
  const max = Math.max(...items.map((item) => Number(item.importance) || 0), 0.001);
  return (
    <div className="mt-3 border border-line bg-base p-3">
      <div className="mb-2 text-xs font-medium text-ink">Feature importance</div>
      <div className="grid gap-1.5">
        {items.map((item) => {
          const width = `${Math.max(3, (Number(item.importance) / max) * 100)}%`;
          return (
            <div key={item.feature} className="grid grid-cols-[minmax(110px,180px)_1fr_64px] items-center gap-2 text-xs">
              <span className="truncate font-mono text-muted">{item.feature}</span>
              <span className="h-2 bg-panel"><span className="block h-2 bg-accent" style={{ width }} /></span>
              <span className="text-right font-mono text-ink">{Number(item.importance).toFixed(3)}</span>
            </div>
          );
        })}
      </div>
    </div>
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
