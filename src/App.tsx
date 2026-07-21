import Editor from "@monaco-editor/react";
import { useMutation, useQuery, type UseMutationResult } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { BarChart3, BrainCircuit, CheckCircle2, Database, Download, FileCode2, FileText, FileUp, Filter, Gauge, GitBranch, KeyRound, Layers3, Menu, Moon, RefreshCw, Save, Search, Send, Settings, ShieldCheck, SlidersHorizontal, Sparkles, Sun, TestTube2, WandSparkles, XCircle } from "lucide-react";
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
import type { NotebookSandbox } from "./components/NotebookRows";
import { ProfileCharts } from "./components/ProfileCharts";
import { RightPanel } from "./components/RightPanel";
import { VisualReport } from "./components/VisualReport";

type WorkflowStepId = "clean" | "filter" | "pca" | "train" | "tune";

type WorkflowMemoryEntry = {
  stepId: WorkflowStepId;
  taskId: string;
  sandboxId: string;
  status: SandboxTaskResult["execution"]["status"];
  outputFiles: string[];
  rows?: number;
  instruction: string;
};

type SandboxMutationVariables = {
  sandboxId: string;
  prompt: string;
  workflowStepId?: WorkflowStepId;
};

type AutoAgentStepStatus = "waiting" | "running" | "success" | "failed";

type AutoAgentStep = {
  id: string;
  title: string;
  prompt: string;
  status: AutoAgentStepStatus;
  task?: SandboxTaskResult;
  versionId?: string;
  error?: string;
};

const WORKFLOW_STEP_ORDER: WorkflowStepId[] = ["clean", "filter", "pca", "train", "tune"];

const WORKFLOW_STEP_LABELS: Record<WorkflowStepId, string> = {
  clean: "Clean",
  filter: "Filter",
  pca: "PCA",
  train: "Train",
  tune: "Tune"
};

const AUTO_AGENT_BLUEPRINT: Array<{ id: string; title: string; prompt: string; promote: boolean }> = [
  {
    id: "load_data",
    title: "Load Data",
    promote: false,
    prompt: "Load the current dataset, verify schema, row count, columns, target candidates, missing values, duplicate rows, and write data_profile_summary.json."
  },
  {
    id: "explore_data",
    title: "Explore Data",
    promote: false,
    prompt: "Explore the current dataset. Summarize numeric and categorical columns, target candidates, missingness, duplicates, outliers, and data risks. Save inspection outputs."
  },
  {
    id: "visualize_data",
    title: "Visualize Data",
    promote: false,
    prompt: "Visualize the current dataset with histograms, pie chart, scatter plot, box plot, correlation heatmap, pair plot, and missingness. Save plots and review JSON."
  },
  {
    id: "clean_data",
    title: "Clean Data",
    promote: true,
    prompt: "Clean this dataset using the inspection metadata. Handle missing values, duplicates, invalid values, inconsistent categories, date formats, and defensible outlier handling. Save a validated cleaned dataset."
  },
  {
    id: "feature_engineering",
    title: "Engineer Features",
    promote: true,
    prompt: "Engineer model-ready features from the cleaned data. Select useful features, encode categorical variables, handle outliers left after cleaning, and save features.csv."
  },
  {
    id: "prepare_data",
    title: "Prepare Data (Encoding & Scaling)",
    promote: true,
    prompt: "Prepare data for modeling. Encode categorical features, scale numeric features, analyze variance/PCA when useful, and save prepared_features.csv, pca_features.csv, and pca_variance.json."
  },
  {
    id: "split_data",
    title: "Split Data",
    promote: false,
    prompt: "Split the prepared dataset into train and test sets. Preserve target distribution for classification when possible and save split_summary.json."
  },
  {
    id: "train_model",
    title: "Feature Loop & Train",
    promote: false,
    prompt: "Train multiple suitable models, then let the AI review performance. If score or overfit needs improvement, loop back through stronger feature engineering, retest feature sets, choose the best model again, and retrain."
  },
  {
    id: "tune_evaluate",
    title: "Improve, Tune & Evaluate",
    promote: false,
    prompt: "Tune hyperparameters and evaluate the best model from the feature loop. If improvement is still needed, retry engineered feature sets, compare tuned vs first models, and produce accuracy or regression score, confusion matrix, feature importance, and model comparison."
  },
  {
    id: "save_predict",
    title: "Save and Predict",
    promote: false,
    prompt: "Save the best model artifact, create predictions.csv, model_accuracy_report.json, confusion matrix files when available, histograms, review plots, and final sandbox summary."
  }
];

const EDA_PLOT_FILES = ["histograms.png", "pie_chart.png", "scatter_plot.png", "box_plot.png", "correlation_heatmap.png", "pair_plot.png", "missingness.png"];
const MODEL_PLOT_FILES = ["model_comparison.png", "feature_importance.png", "confusion_matrix.png", "pca_variance.png", "prediction_review.png"];

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
  const [workflowMemory, setWorkflowMemory] = useState<WorkflowMemoryEntry[]>([]);
  const [autoAgentSteps, setAutoAgentSteps] = useState<AutoAgentStep[]>(() => createAutoAgentSteps());
  const [autoAgentStatus, setAutoAgentStatus] = useState<"idle" | "running" | "success" | "failed">("idle");
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

  useEffect(() => {
    setWorkflowMemory([]);
    setAutoAgentSteps(createAutoAgentSteps());
    setAutoAgentStatus("idle");
  }, [dataset?.dataset_id]);

  const upload = useMutation({
    mutationFn: uploadDataset,
    onSuccess: (payload) => {
      setDataset(payload);
      setCode("");
      setWorkflowMemory([]);
      setAutoAgentSteps(createAutoAgentSteps());
      setAutoAgentStatus("idle");
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
    mutationFn: ({ sandboxId, prompt }: SandboxMutationVariables) => runSandboxTask(dataset!.dataset_id, sandboxId, prompt, dataset!.profile.version_id),
    onMutate: ({ sandboxId }) => setExecutionStage(`Running ${sandboxes.find((sandbox) => sandbox.id === sandboxId)?.name ?? "sandbox"} task`),
    onSuccess: (result, variables) => {
      setTaskResults((items) => ({ ...items, [result.sandbox_id]: result }));
      setExecutionStage(result.execution.status === "success" ? "Completed" : "Failed");
      if (variables.workflowStepId && result.execution.status === "success") {
        setWorkflowMemory((items) => {
          const nextEntry = workflowMemoryEntryFromTask(variables.workflowStepId!, result);
          return [...items.filter((item) => item.stepId !== variables.workflowStepId), nextEntry];
        });
        const nextStep = nextWorkflowStep(variables.workflowStepId);
        if (nextStep) setInstruction(buildWorkflowPrompt(nextStep, [...workflowMemory, workflowMemoryEntryFromTask(variables.workflowStepId, result)], dataset));
      }
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
      setWorkflowMemory([]);
      setAutoAgentSteps(createAutoAgentSteps());
      setAutoAgentStatus("idle");
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
        setWorkflowMemory([]);
        setAutoAgentSteps(createAutoAgentSteps());
        setAutoAgentStatus("idle");
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

  function runNewSandboxTask(prompt: string, workflowStepId?: WorkflowStepId) {
    const trimmed = prompt.trim();
    if (!dataset || !trimmed || sandboxTask.isPending) return;
    const id = `sandbox_${crypto.randomUUID().slice(0, 8)}`;
    const name = workflowStepId ? WORKFLOW_STEP_LABELS[workflowStepId] : `Run ${Object.keys(taskResults).length + 1}`;
    const agentPrompt = buildAgentPrompt(trimmed, Object.values(taskResults), workflowMemory, dataset);
    setInstruction(agentPrompt);
    setSandboxes((items) => [...items, { id, name, mode: "ephemeral", status: "ready" }]);
    setActiveSandboxId(id);
    sandboxTask.mutate({ sandboxId: id, prompt: agentPrompt, workflowStepId });
  }

  async function runAutoAgentPipeline() {
    if (!dataset || autoAgentStatus === "running") return;
    setAutoAgentStatus("running");
    setAutoAgentSteps(createAutoAgentSteps());
    setExecutionStage("Auto agent planning");
    let currentDataset = dataset;
    const completed: SandboxTaskResult[] = [];
    try {
      for (const blueprint of AUTO_AGENT_BLUEPRINT) {
        const sandboxId = `auto_${blueprint.id}_${crypto.randomUUID().slice(0, 6)}`;
        const prompt = buildAutoAgentPrompt(blueprint, currentDataset, completed);
        setInstruction(prompt);
        setSandboxes((items) => [...items, { id: sandboxId, name: blueprint.title, mode: "ephemeral", status: "ready" }]);
        setActiveSandboxId(sandboxId);
        setExecutionStage(`Auto agent: ${blueprint.title}`);
        setAutoAgentSteps((steps) => steps.map((step) => step.id === blueprint.id ? { ...step, status: "running", prompt } : step));
        const task = await runSandboxTask(currentDataset.dataset_id, sandboxId, prompt, currentDataset.profile.version_id);
        setTaskResults((items) => ({ ...items, [task.sandbox_id]: task }));
        completed.push(task);
        if (task.execution.status !== "success") {
          setAutoAgentSteps((steps) => steps.map((step) => step.id === blueprint.id ? { ...step, status: "failed", task, error: task.execution.stderr || "Sandbox step failed." } : step));
          throw new Error(`${blueprint.title} failed.`);
        }
        let versionId: string | undefined;
        if (blueprint.promote) {
          const approved = await approveSandboxTask(currentDataset.dataset_id, task.task_id);
          addVersion(approved.version);
          versionId = approved.version.id;
          currentDataset = await getDatasetVersion(currentDataset.dataset_id, versionId);
          setDataset(currentDataset);
          savedDatasets.refetch();
        }
        setAutoAgentSteps((steps) => steps.map((step) => step.id === blueprint.id ? { ...step, status: "success", task, versionId } : step));
        await delay(450);
      }
      setAutoAgentStatus("success");
      setExecutionStage("Auto agent completed");
      setInstruction(buildAutoAgentFinalPrompt(completed, currentDataset));
    } catch (error) {
      setAutoAgentStatus("failed");
      setExecutionStage("Auto agent failed");
      const message = error instanceof Error ? error.message : "Auto agent failed.";
      setAutoAgentSteps((steps) => steps.map((step) => step.status === "running" ? { ...step, status: "failed", error: message } : step));
    }
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
      onRunNewSandboxTask={runNewSandboxTask}
      workflowMemory={workflowMemory}
      autoAgentSteps={autoAgentSteps}
      autoAgentStatus={autoAgentStatus}
      onRunAutoAgent={runAutoAgentPipeline}
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
  onRunNewSandboxTask: (prompt: string, workflowStepId?: WorkflowStepId) => void;
  workflowMemory: WorkflowMemoryEntry[];
  autoAgentSteps: AutoAgentStep[];
  autoAgentStatus: "idle" | "running" | "success" | "failed";
  onRunAutoAgent: () => void;
  onApproveSandboxTask: (taskId: string) => void;
  onStop: () => void;
  onRestartSandbox: () => void;
};

function Notebook(props: NotebookProps) {
  const { dataset, instruction, upload, healthStatus, providerStatus, isRefreshing, agentPending, sandboxes, taskResults, taskError, approveTaskPendingId, approveTaskError, activeSandboxId, manualCells, selectedCellId, appTheme, uploadInputRef, workflowMemory, autoAgentSteps, autoAgentStatus } = props;
  const autoPending = autoAgentStatus === "running";
  const activeSandbox = sandboxes.find((sandbox) => sandbox.id === activeSandboxId);
  const taskList = Object.values(taskResults);
  const activeTask = taskResults[activeSandboxId] ?? (taskList.length ? taskList[taskList.length - 1] : undefined);
  return (
    <main className="notebook-main h-full overflow-auto bg-notebook">
      <NotebookHeader theme={appTheme} onToggleTheme={props.onToggleAppTheme} />
      <CommandWorkspace
        dataset={dataset}
        upload={upload}
        uploadInputRef={uploadInputRef}
        healthStatus={healthStatus}
        providerStatus={providerStatus}
        isRefreshing={isRefreshing}
        onRefresh={props.onRefresh}
        sandbox={activeSandbox}
        pending={agentPending || autoPending}
        result={activeTask}
        error={taskError}
        command={instruction}
        onCommandChange={props.onInstructionChange}
        onRun={props.onRunNewSandboxTask}
        onRunAutoAgent={props.onRunAutoAgent}
        autoAgentStatus={autoAgentStatus}
      />
      {dataset && <AutoAgentPanel steps={autoAgentSteps} />}
      <SimpleWorkflowGuide
        dataset={dataset}
        pending={agentPending || autoPending}
        result={activeTask}
        memory={workflowMemory}
        onUsePrompt={props.onInstructionChange}
        onRunPrompt={props.onRunNewSandboxTask}
      />
      <div className="simple-cell-stream">
        {taskList.map((task) => (
          <TaskResultCell
            key={task.task_id}
            task={task}
            sandboxName={sandboxes.find((sandbox) => sandbox.id === task.sandbox_id)?.name ?? task.sandbox_id}
            datasetId={dataset?.dataset_id}
            approvePending={approveTaskPendingId === task.task_id}
            approveError={approveTaskError}
            onApprove={() => props.onApproveSandboxTask(task.task_id)}
          />
        ))}
        {manualCells.map((cell) => <ManualNotebookCell key={cell.id} cell={cell} sandboxName={sandboxes.find((sandbox) => sandbox.id === cell.sandboxId)?.name ?? "Unassigned"} selected={selectedCellId === cell.id} onSelect={() => props.onSelectManualCell(cell.id)} onChange={(source) => props.onUpdateManualCell(cell.id, { source, status: "idle" })} onRun={() => props.onRunManualCell(cell)} onDuplicate={() => props.onAddManualCell(cell.type, cell.id)} onAddBelow={() => props.onAddManualCell("python", cell.id)} onToggleReport={() => props.onUpdateManualCell(cell.id, { includeInReport: !cell.includeInReport })} onDelete={() => props.onRemoveManualCell(cell.id)} />)}
      </div>
    </main>
  );
}

function SimpleWorkflowGuide({
  dataset,
  pending,
  result,
  memory,
  onUsePrompt,
  onRunPrompt
}: {
  dataset: UploadResponse | null;
  pending: boolean;
  result?: SandboxTaskResult;
  memory: WorkflowMemoryEntry[];
  onUsePrompt: (value: string) => void;
  onRunPrompt: (prompt: string, workflowStepId?: WorkflowStepId) => void;
}) {
  const completedIds = new Set(memory.map((item) => item.stepId));
  const activeStep = WORKFLOW_STEP_ORDER.find((step) => !completedIds.has(step)) ?? "tune";
  const activePrompt = dataset ? buildWorkflowPrompt(activeStep, memory, dataset) : "";
  return (
    <section className="workflow-guide border-b border-line bg-notebook px-4 py-3">
      <div className="mx-auto grid w-full max-w-4xl gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-medium text-ink">Saved workflow memory</span>
          <span className="text-muted">{pending ? "Sandbox is running the current step." : dataset ? `Next step: ${WORKFLOW_STEP_LABELS[activeStep]}` : "Upload a dataset to start."}</span>
        </div>
        <div className="workflow-step-grid">
          {WORKFLOW_STEP_ORDER.map((stepId, index) => {
            const entry = memory.find((item) => item.stepId === stepId);
            const complete = Boolean(entry);
            const active = dataset && stepId === activeStep;
            const locked = !dataset || (!complete && !active);
            const prompt = buildWorkflowPrompt(stepId, memory, dataset);
            return (
              <button
                key={stepId}
                className={`${locked ? "workflow-step-card workflow-step-card-locked" : "workflow-step-card"} ${complete ? "workflow-step-card-complete" : ""} ${active ? "workflow-step-card-active" : ""}`}
                disabled={locked || pending}
                onClick={() => {
                  onUsePrompt(prompt);
                  onRunPrompt(prompt, stepId);
                }}
                title={locked ? "Finish the current step first" : prompt}
                type="button"
              >
                <span className="workflow-step-number">{index + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{WORKFLOW_STEP_LABELS[stepId]}</span>
                  <span className="block truncate text-muted">{complete ? `saved ${entry?.taskId}` : active ? "run this next" : "waiting"}</span>
                </span>
              </button>
            );
          })}
        </div>
        {dataset && <div className="workflow-memory-box">
          <div className="text-xs font-medium text-ink">What the AI will know next</div>
          <div className="mt-1 text-xs text-muted">{memory.length ? workflowContextText(memory) : `${dataset.filename} is loaded and profiled. No step output saved yet.`}</div>
          <button className="command-button mt-2 text-muted" disabled={pending} onClick={() => onUsePrompt(activePrompt)} type="button">Put next prompt in box</button>
        </div>}
      </div>
    </section>
  );
}

function workflowMemoryEntryFromTask(stepId: WorkflowStepId, task: SandboxTaskResult): WorkflowMemoryEntry {
  return {
    stepId,
    taskId: task.task_id,
    sandboxId: task.sandbox_id,
    status: task.execution.status,
    outputFiles: task.execution.generated_files,
    rows: Number(task.execution.cleaned_metadata?.rows ?? 0) || undefined,
    instruction: task.instruction
  };
}

function nextWorkflowStep(stepId: WorkflowStepId) {
  const index = WORKFLOW_STEP_ORDER.indexOf(stepId);
  return WORKFLOW_STEP_ORDER[index + 1];
}

function workflowContextText(memory: WorkflowMemoryEntry[]) {
  return memory
    .map((item) => `${WORKFLOW_STEP_LABELS[item.stepId]} done in ${item.taskId}${item.rows ? ` with ${formatNumber(item.rows)} rows` : ""}${item.outputFiles.length ? `; saved ${item.outputFiles.join(", ")}` : ""}.`)
    .join(" ");
}

function buildWorkflowPrompt(stepId: WorkflowStepId, memory: WorkflowMemoryEntry[], dataset: UploadResponse | null) {
  const datasetLine = dataset ? `Dataset: ${dataset.filename}, ${formatNumber(dataset.profile.rows)} rows, ${formatNumber(dataset.profile.columns)} columns, version ${dataset.profile.version_id}.` : "Dataset is not uploaded yet.";
  const contextLine = memory.length
    ? `Saved context from previous steps: ${workflowContextText(memory)} Use these outputs as the current working state; do not repeat completed steps unless validation shows a problem.`
    : "No previous workflow step has been completed yet.";
  const requests: Record<WorkflowStepId, string> = {
    clean: "Step 1 Clean: fix missing values, duplicate rows, invalid values, inconsistent text/category values, and date formats. Save a cleaned dataset and validation summary.",
    filter: "Step 2 Filter: use the cleaned dataset from Step 1. Apply sensible row filters, remove invalid or extreme rows only when justified, and save the filtered dataset plus filter decisions.",
    pca: "Step 3 PCA: use the filtered dataset from Step 2. Prepare numeric features, scale them, run PCA dimensionality reduction, keep the lowest useful number of components, and save the PCA feature table.",
    train: "Step 4 Train: use the PCA/features output from Step 3. Train a suitable model, evaluate accuracy for classification or the best regression score, and show feature importance.",
    tune: "Step 5 Tune: use the trained model setup from Step 4. Tune hyperparameters, compare tuned vs first model, and report the best accuracy or score."
  };
  return `${datasetLine}\n${contextLine}\n${requests[stepId]}`;
}

function buildAgentPrompt(prompt: string, tasks: SandboxTaskResult[], memory: WorkflowMemoryEntry[], dataset: UploadResponse | null) {
  const text = prompt.toLowerCase();
  const asksForAgentModel = ["clean", "train", "test", "accuracy", "acuracy", "current model", "curant model", "score"].some((token) => text.includes(token));
  if (!asksForAgentModel) return prompt;
  const latestModelTask = [...tasks].reverse().find((task) => {
    const model = task.execution.validation_report?.model as Record<string, unknown> | undefined;
    return model?.status === "success";
  });
  const model = latestModelTask?.execution.validation_report?.model as Record<string, any> | undefined;
  const datasetLine = dataset ? `Dataset context: ${dataset.filename}, version ${dataset.profile.version_id}, ${formatNumber(dataset.profile.rows)} rows, ${formatNumber(dataset.profile.columns)} columns.` : "";
  const memoryLine = memory.length ? `Workflow memory: ${workflowContextText(memory)}` : "Workflow memory: no saved step output yet.";
  const modelLine = model
    ? `Current model memory: task ${latestModelTask?.task_id}, target ${model.target}, model ${model.model}, metrics ${JSON.stringify(model.metrics)}. If the user asks for current model accuracy, report these metrics and retrain/test only when requested.`
    : "Current model memory: no trained model has been saved yet. If accuracy is requested, clean the data, choose a reasonable target, train/test a model, and report the test accuracy or regression score.";
  return `${datasetLine}\n${memoryLine}\n${modelLine}\nUser request: ${prompt}`;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function createAutoAgentSteps(): AutoAgentStep[] {
  return AUTO_AGENT_BLUEPRINT.map((step) => ({ id: step.id, title: step.title, prompt: step.prompt, status: "waiting" }));
}

function buildAutoAgentPrompt(
  blueprint: { id: string; title: string; prompt: string; promote: boolean },
  dataset: UploadResponse,
  completed: SandboxTaskResult[]
) {
  const context = completed.length
    ? completed.map((task) => {
      const model = task.execution.validation_report?.model as Record<string, any> | undefined;
      const pca = model?.pca ?? task.execution.validation_report?.pca;
      const metric = model?.metrics ? taskModelMetric(model.metrics as Record<string, number | null>) : null;
      return [
        `${task.sandbox_id}/${task.task_id}`,
        `workflow=${task.workflow.join("->")}`,
        `files=${task.execution.generated_files.join(",") || "none"}`,
        `rows=${task.execution.cleaned_metadata?.rows ?? "unknown"}`,
        metric ? `model_metric=${metric.label}:${metric.value}` : "",
        pca?.status === "success" ? `pca_variance=${Number(pca.cumulative_variance).toFixed(4)}` : "",
      ].filter(Boolean).join("; ");
    }).join("\n")
    : "No prior sandbox output yet.";
  return [
    `AUTO_AGENT_STAGE_ID: ${blueprint.id}`,
    `You are the staged Auto AI agent. Run only this stage: ${blueprint.title}.`,
    `Current dataset version: ${dataset.profile.version_id}; file ${dataset.filename}; rows ${formatNumber(dataset.profile.rows)}; columns ${formatNumber(dataset.profile.columns)}; quality ${dataset.profile.data_quality_score}%.`,
    `Previous sandbox outputs and memory:\n${context}`,
    "Think step by step inside the code. Write auditable outputs, validation_report.json, execution_summary.json, and any requested review artifacts.",
    ["train_model", "tune_evaluate", "save_predict"].includes(blueprint.id) ? "Do not skip validation. Train, review whether improvement is needed, loop through stronger engineered features when needed, choose the best model by test performance with an overfit penalty, and retrain/retest before finalizing." : "Do not skip validation. Do not train a model in this stage.",
    blueprint.prompt
  ].join("\n");
}

function buildAutoAgentFinalPrompt(tasks: SandboxTaskResult[], dataset: UploadResponse) {
  const finalTask = [...tasks].reverse().find((task) => task.execution.validation_report?.model);
  const model = finalTask?.execution.validation_report?.model as Record<string, any> | undefined;
  const metric = model?.metrics ? taskModelMetric(model.metrics as Record<string, number | null>) : null;
  return [
    `Auto agent finished on dataset version ${dataset.profile.version_id}.`,
    metric ? `Best current model: ${model?.model} on target ${model?.target}; ${metric.label} ${metric.value}; overfit gap ${model?.overfit_gap == null ? "-" : Number(model.overfit_gap).toFixed(4)}.` : "No final model metric was found.",
    `Generated steps: ${tasks.map((task) => task.sandbox_id).join(" -> ")}.`,
    "Review the result cells below for cleaned data, generated files, plots, prediction review, and accuracy report."
  ].join("\n");
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
  onRun,
  onRunAutoAgent,
  autoAgentStatus
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
  onRunAutoAgent: () => void;
  autoAgentStatus: "idle" | "running" | "success" | "failed";
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
            <button
              className="command-button text-muted"
              disabled={!dataset || pending}
              onClick={onRunAutoAgent}
              title="Run the full staged agent pipeline"
              type="button"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {autoAgentStatus === "running" ? "AI working" : "Run AI workflow"}
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

function AutoAgentPanel({ steps }: { steps: AutoAgentStep[] }) {
  const latestSuccess = [...steps].reverse().find((step) => step.status === "success" && step.task);
  const model = latestSuccess?.task?.execution.validation_report?.model as Record<string, any> | undefined;
  const metric = model?.metrics ? taskModelMetric(model.metrics as Record<string, number | null>) : null;
  return (
    <section className="auto-agent-panel border-b border-line bg-notebook px-4 py-5" aria-live="polite">
      <div className="auto-agent-flow-shell w-full">
        <div className="auto-agent-vertical" role="list" aria-label="AI workflow progress">
          {steps.map((step, index) => (
            <div
              key={step.id}
              className={`auto-agent-flow-step auto-agent-flow-step-${step.status}`}
              role="listitem"
              aria-current={step.status === "running" ? "step" : undefined}
            >
              <div className="auto-agent-step-rail" aria-hidden="true">
                <div className="auto-agent-step-icon">
                  <AutoAgentIcon stepId={step.id} />
                </div>
                {index < steps.length - 1 && <span className="auto-agent-connector" />}
              </div>
              <div className="auto-agent-step-content">
                <div className="min-w-0">
                  <span className={step.status === "running" ? "auto-agent-step-label shimmer-text" : "auto-agent-step-label"}>{step.title}</span>
                  {["train_model", "tune_evaluate"].includes(step.id) && step.status === "running" && <div className="auto-agent-mini-loop" aria-label="Feature engineering training loop">
                    <span>features</span>
                    <span>review</span>
                    <span>retest</span>
                    <span>choose model</span>
                  </div>}
                </div>
                <span className="auto-agent-step-state">
                  {step.status === "running" ? ["train_model", "tune_evaluate"].includes(step.id) ? "looping" : "processing" : step.status === "success" ? step.versionId ? `saved ${step.versionId}` : "done" : step.status === "failed" ? "failed" : ""}
                </span>
              </div>
            </div>
          ))}
        </div>
        {model?.status === "success" && <div className="auto-agent-result-strip metric-grid">
          <Metric label={metric?.label ?? "score"} value={metric?.value ?? "-"} />
          <Metric label="Best model" value={model.model ?? "-"} />
          <Metric label="Feature set" value={model.feature_set ?? "-"} />
          <Metric label="Target" value={model.target ?? "-"} />
          <Metric label="Overfit gap" value={model.overfit_gap == null ? "-" : Number(model.overfit_gap).toFixed(4)} />
        </div>}
      </div>
    </section>
  );
}

function AutoAgentIcon({ stepId }: { stepId: string }) {
  const className = "h-[18px] w-[18px]";
  if (stepId === "load_data") return <Database className={className} />;
  if (stepId === "explore_data") return <Search className={className} />;
  if (stepId === "visualize_data") return <BarChart3 className={className} />;
  if (stepId === "clean_data") return <Filter className={className} />;
  if (stepId === "feature_engineering") return <WandSparkles className={className} />;
  if (stepId === "prepare_data") return <SlidersHorizontal className={className} />;
  if (stepId === "split_data") return <Layers3 className={className} />;
  if (stepId === "train_model") return <BrainCircuit className={className} />;
  if (stepId === "tune_evaluate") return <Gauge className={className} />;
  if (stepId === "save_predict") return <Download className={className} />;
  return <GitBranch className={className} />;
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
  const featureLoop = Array.isArray(model?.feature_loop) ? model.feature_loop as Array<Record<string, any>> : [];
  const predictionPreview = Array.isArray(model?.predictions_preview) ? model.predictions_preview as Record<string, unknown>[] : [];
  const modelMetric = model?.metrics ? taskModelMetric(model.metrics as Record<string, number | null>) : null;
  const plotFiles = task.execution.generated_files.filter((file) => file.endsWith(".png"));
  const shouldShowEdaPlots = task.workflow.some((step) => ["inspect_data", "explore_data", "visualize_data", "clean_and_preprocess", "feature_engineering", "prepare_data", "train_model", "evaluate_model"].includes(step)) || plotFiles.some((file) => EDA_PLOT_FILES.includes(file));
  const shouldShowModelPlots = task.workflow.some((step) => ["train_model", "evaluate_model", "generate_predictions"].includes(step)) || plotFiles.some((file) => MODEL_PLOT_FILES.includes(file));
  const edaPlotFiles = shouldShowEdaPlots ? EDA_PLOT_FILES.filter((file) => plotFiles.includes(file)) : [];
  const modelPlotFiles = shouldShowModelPlots ? MODEL_PLOT_FILES.filter((file) => plotFiles.includes(file)) : [];
  const expectedEdaPlotsMissing = shouldShowEdaPlots && edaPlotFiles.length === 0;
  const extraFiles = task.execution.generated_files.filter((file) => !["cleaned.csv", "features.csv", "predictions.csv", "model_accuracy_report.json"].includes(file) && !file.endsWith(".parquet") && !file.endsWith(".png"));
  const [draftCode, setDraftCode] = useState(task.generated_code.code);
  return (
    <Cell type="sandbox" title={`${sandboxName}: ${task.workflow.join(" -> ")}`} status={task.execution.status} sandbox={sandboxName}>
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-2 text-xs">
          <Metric label="Workflow" value={task.workflow.join(" -> ")} />
          <Metric label="Local dataset" value={task.local_dataset_path} />
          <Metric label="Generated files" value={task.execution.generated_files.join(", ") || "None"} />
          {model && <Metric label="Model" value={`${model.model ?? model.status}${model.target ? ` · target ${model.target}` : ""}`} />}
          {model?.status === "success" && <div className="metric-grid">
            <Metric label={modelMetric?.label ?? "score"} value={modelMetric?.value ?? "-"} />
            <Metric label="Target" value={model.target ?? "-"} />
            <Metric label="Feature set" value={model.feature_set ?? "-"} />
            <Metric label="Loop" value={model.loop_iteration == null ? "-" : `pass ${model.loop_iteration}`} />
            <Metric label="Train rows" value={formatNumber(Number(model.rows_train ?? 0))} />
            <Metric label="Test rows" value={formatNumber(Number(model.rows_test ?? 0))} />
          </div>}
          {featureLoop.length > 0 ? <FeatureLoopProgress loops={featureLoop} selectedLoop={Number(model?.loop_iteration ?? 0)} /> : model?.ai_review && <FeatureLoopReview review={model.ai_review as Record<string, any>} />}
          {model?.metrics && <pre className="max-h-40 overflow-auto border border-line bg-base p-2 font-mono text-muted">{JSON.stringify(model.metrics, null, 2)}</pre>}
          <div className="flex flex-wrap gap-2 pt-1">
            {datasetId && <button className="success-button" disabled={task.execution.status !== "success" || approvePending} onClick={onApprove} type="button"><ShieldCheck className="h-3.5 w-3.5" />{approvePending ? "Approving..." : "Approve as version"}</button>}
            <a className="command-button text-muted" href={`/api/sandbox-tasks/${task.task_id}/files/cleaned.csv`}><Download className="h-3.5 w-3.5" />Cleaned CSV</a>
            <a className="command-button text-muted" href={`/api/sandbox-tasks/${task.task_id}/files/features.csv`}><Download className="h-3.5 w-3.5" />Features</a>
            {task.execution.generated_files.includes("model_accuracy_report.json") && <a className="command-button text-muted" href={`/api/sandbox-tasks/${task.task_id}/files/model_accuracy_report.json`}><Download className="h-3.5 w-3.5" />Accuracy report</a>}
            {task.execution.generated_files.includes("predictions.csv") && <a className="command-button text-muted" href={`/api/sandbox-tasks/${task.task_id}/files/predictions.csv`}><Download className="h-3.5 w-3.5" />Predictions</a>}
            {extraFiles.map((file) => <a key={file} className="command-button text-muted" href={`/api/sandbox-tasks/${task.task_id}/files/${file}`}><Download className="h-3.5 w-3.5" />{file}</a>)}
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
      {expectedEdaPlotsMissing && (
        <div className="plot-generation-error mt-3" role="alert">
          <strong>EDA plots were not generated by this sandbox run.</strong>
          <span>The backend returned no PNG artifacts. Restart the backend and rerun this step; an EDA run must return real files before it can pass.</span>
        </div>
      )}
      {edaPlotFiles.length > 0 && <PlotPreview title="EDA plot preview" taskId={task.task_id} files={edaPlotFiles} />}
      {modelPlotFiles.length > 0 && <PlotPreview title="Model plot preview" taskId={task.task_id} files={modelPlotFiles} />}
      {task.execution.preview_rows.length > 0 && <div className="mt-3"><div className="mb-2 text-xs text-muted">Cleaned output preview</div><DataTable rows={task.execution.preview_rows} /></div>}
      {predictionPreview.length > 0 && <div className="mt-3"><div className="mb-2 text-xs text-muted">Prediction sample</div><DataTable rows={predictionPreview} /></div>}
      <details className="mt-3 border border-line bg-base p-2 text-xs">
        <summary className="cursor-pointer text-muted">Generated code</summary>
        <div className="mt-2">
          <div className="mb-2 flex items-center justify-between gap-2 text-xs">
            <span className="text-muted">Sandbox code</span>
            <span className="font-mono text-muted">{task.generated_code.engine}</span>
          </div>
          <Editor height="320px" defaultLanguage="python" value={draftCode} onChange={(value) => setDraftCode(value ?? "")} theme="vs-dark" options={{ minimap: { enabled: false }, fontSize: 12, lineNumbersMinChars: 3, scrollBeyondLastLine: false, wordWrap: "on", padding: { top: 12 } }} />
        </div>
      </details>
    </Cell>
  );
}

function PlotPreview({ title, taskId, files }: { title: string; taskId: string; files: string[] }) {
  return (
    <div className="plot-preview-shell mt-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-ink">{title}</span>
        <span className="text-muted">{files.length} plots</span>
      </div>
      <div className="plot-preview-grid">
        {files.map((file) => (
          <PlotImage key={file} taskId={taskId} file={file} />
        ))}
      </div>
    </div>
  );
}

function FeatureLoopProgress({ loops, selectedLoop }: { loops: Array<Record<string, any>>; selectedLoop: number }) {
  return (
    <section className="feature-loop-panel" aria-label="AI feature engineering loop progress">
      <div className="feature-loop-head">
        <div>
          <div className="text-xs font-medium text-ink">AI feature loop</div>
          <div className="text-[11px] text-muted">Engineer features, train, review, then retrain when improvement is needed.</div>
        </div>
        <span>{loops.length} pass{loops.length === 1 ? "" : "es"}</span>
      </div>
      <div className="feature-loop-steps">
        {loops.map((loop) => {
          const review = (loop.review ?? {}) as Record<string, any>;
          const iteration = Number(loop.iteration ?? 0);
          const selected = selectedLoop === iteration;
          const needsImprovement = Boolean(review.needs_improvement);
          return (
            <div key={`${loop.feature_set}-${iteration}`} className={selected ? "feature-loop-card feature-loop-card-selected" : "feature-loop-card"}>
              <div className="feature-loop-card-top">
                <span className="feature-loop-pass">Pass {iteration || "-"}</span>
                <span className={needsImprovement ? "feature-loop-badge feature-loop-badge-warn" : "feature-loop-badge feature-loop-badge-ok"}>
                  {needsImprovement ? <RefreshCw className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                  {needsImprovement ? "needs retry" : "accepted"}
                </span>
              </div>
              <div className="feature-loop-name">{String(loop.feature_set ?? "feature_set").split("_").join(" ")}</div>
              <div className="feature-loop-metrics">
                <span>model <strong>{String(loop.best_model ?? "-").split("_").join(" ")}</strong></span>
                <span>score <strong>{formatMaybeNumber(review.score)}</strong></span>
                <span>gap <strong>{formatMaybeNumber(review.overfit_gap)}</strong></span>
              </div>
              {Array.isArray(loop.actions) && loop.actions.length > 0 && <div className="feature-loop-actions">
                {loop.actions.map((action: unknown) => <span key={String(action)}>{String(action)}</span>)}
              </div>}
              {review.reason && <p>{String(review.reason)}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FeatureLoopReview({ review }: { review: Record<string, any> }) {
  return (
    <section className="feature-loop-panel">
      <div className="feature-loop-head">
        <div className="text-xs font-medium text-ink">AI model review</div>
        <span>{review.needs_improvement ? "needs improvement" : "accepted"}</span>
      </div>
      <p className="text-xs text-muted">{String(review.reason ?? "Model review completed.")}</p>
    </section>
  );
}

function formatMaybeNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(4) : "-";
}

function PlotImage({ taskId, file }: { taskId: string; file: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className={failed ? "artifact-plot artifact-plot-missing" : "artifact-plot"}>
      {failed ? (
        <div className="artifact-plot-placeholder">
          <span>{plotLabel(file)}</span>
          <small>the generated file could not be loaded</small>
        </div>
      ) : (
        <img src={`/api/sandbox-tasks/${taskId}/files/${file}`} alt={file} loading="lazy" onError={() => setFailed(true)} />
      )}
      <figcaption>
        <span>{plotLabel(file)}</span>
        <a href={`/api/sandbox-tasks/${taskId}/files/${file}`} target="_blank" rel="noreferrer">open</a>
      </figcaption>
    </figure>
  );
}

function plotLabel(file: string) {
  return file.replace(".png", "").split("_").join(" ");
}

function taskModelMetric(metrics: Record<string, number | null>) {
  const label = metrics.accuracy != null ? "accuracy" : metrics.r2 != null ? "r2" : metrics.mae != null ? "mae" : Object.keys(metrics)[0] ?? "score";
  const value = metrics[label];
  return { label, value: value == null ? "-" : Number(value).toFixed(4) };
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
