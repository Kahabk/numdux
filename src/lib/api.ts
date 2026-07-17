import type { AnalysisPlan, CleaningRun, DatasetRecord, DatasetReport, SandboxTaskResult, SqlRunResult, UploadResponse } from "./types";

type ApproveResponse = {
  status: string;
  version: DatasetRecord["versions"][number];
};

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.ok) return response.json();
  const text = await response.text();
  if (response.status === 500 && text.trim() === "Internal Server Error") {
    throw new Error("Backend is not reachable. Start Numdux with ./numdux run, or restart the backend after code changes.");
  }
  try {
    const data = JSON.parse(text);
    return Promise.reject(new Error(data.detail || text));
  } catch {
    throw new Error(text || `${response.status} ${response.statusText}`);
  }
}

export async function getHealth(): Promise<{ status: string }> {
  const response = await fetch("/api/health");
  return parseResponse(response);
}

export type AIProviderStatus = {
  configured_provider: string;
  active_provider: string;
  gemini_model: string;
  has_gemini_api_key: boolean;
  connection?: "connected" | "error" | "not_configured";
  connection_error?: string | null;
};

export type AppSettings = {
  ai_provider: "rule" | "gemini";
  gemini_model: string;
  has_gemini_api_key: boolean;
};

export async function getAIProviderStatus(): Promise<AIProviderStatus> {
  const response = await fetch("/api/ai/provider?verify=true");
  return parseResponse<AIProviderStatus>(response);
}

export async function getAppSettings(): Promise<AppSettings> {
  const response = await fetch("/api/settings");
  return parseResponse<AppSettings>(response);
}

export async function updateAppSettings(settings: {
  ai_provider: "rule" | "gemini";
  gemini_api_key: string;
  gemini_model: string;
}): Promise<AppSettings> {
  const response = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings)
  });
  return parseResponse<AppSettings>(response);
}

export async function listDatasets(): Promise<DatasetRecord[]> {
  const response = await fetch("/api/datasets");
  return parseResponse<DatasetRecord[]>(response);
}

export async function deleteAllStorage(confirm: string): Promise<{ status: string; datasets: number }> {
  const response = await fetch(`/api/storage?confirm=${encodeURIComponent(confirm)}`, {
    method: "DELETE"
  });
  return parseResponse(response);
}

export async function deleteDataset(datasetId: string, confirm: string): Promise<{ status: string; dataset_id: string }> {
  const response = await fetch(`/api/datasets/${datasetId}?confirm=${encodeURIComponent(confirm)}`, {
    method: "DELETE"
  });
  return parseResponse(response);
}

export async function getDatasetVersion(datasetId: string, versionId: string): Promise<UploadResponse> {
  const response = await fetch(`/api/datasets/${datasetId}/versions/${versionId}`);
  return parseResponse<UploadResponse>(response);
}

export async function uploadDataset(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/datasets", { method: "POST", body: form });
  return parseResponse<UploadResponse>(response);
}

export async function runCleaning(datasetId: string, instruction: string, versionId?: string): Promise<CleaningRun> {
  const response = await fetch("/api/cleaning-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset_id: datasetId, version_id: versionId, instruction })
  });
  return parseResponse<CleaningRun>(response);
}

export async function createAnalysisPlan(datasetId: string, instruction: string, versionId?: string): Promise<AnalysisPlan> {
  const response = await fetch("/api/analysis-plans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset_id: datasetId, version_id: versionId, instruction })
  });
  return parseResponse<AnalysisPlan>(response);
}

export async function runCustomCode(datasetId: string, code: string, instruction: string, versionId?: string): Promise<CleaningRun> {
  const response = await fetch("/api/cleaning-runs/custom", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset_id: datasetId, version_id: versionId, code, instruction })
  });
  return parseResponse<CleaningRun>(response);
}

export async function runSql(datasetId: string, query: string, versionId?: string): Promise<SqlRunResult> {
  const response = await fetch("/api/sql-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset_id: datasetId, version_id: versionId, query })
  });
  return parseResponse<SqlRunResult>(response);
}

export async function runSandboxTask(datasetId: string, sandboxId: string, instruction: string, versionId?: string): Promise<SandboxTaskResult> {
  const response = await fetch("/api/sandbox-tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset_id: datasetId, sandbox_id: sandboxId, version_id: versionId, instruction })
  });
  return parseResponse<SandboxTaskResult>(response);
}

export async function getDatasetReport(datasetId: string, runId?: string, versionId?: string, theme: "light" | "dark" = "light"): Promise<DatasetReport> {
  const params = new URLSearchParams();
  if (runId) params.set("run_id", runId);
  if (versionId) params.set("version_id", versionId);
  params.set("theme", theme);
  const query = params.size ? `?${params.toString()}` : "";
  const response = await fetch(`/api/datasets/${datasetId}/report${query}`);
  return parseResponse<DatasetReport>(response);
}

export async function approveRun(datasetId: string, runId: string): Promise<ApproveResponse> {
  const response = await fetch(`/api/cleaning-runs/${runId}/approve?dataset_id=${datasetId}`, {
    method: "POST"
  });
  return parseResponse<ApproveResponse>(response);
}
