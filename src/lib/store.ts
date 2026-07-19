import { create } from "zustand";
import type { CleaningRun, DatasetRecord, DatasetVersion, UploadResponse } from "./types";

type NotebookState = {
  dataset: UploadResponse | null;
  datasets: DatasetRecord[];
  run: CleaningRun | null;
  versions: DatasetVersion[];
  instruction: string;
  setDatasets: (datasets: DatasetRecord[]) => void;
  setDataset: (dataset: UploadResponse) => void;
  setRun: (run: CleaningRun | null) => void;
  setInstruction: (instruction: string) => void;
  addVersion: (version: DatasetVersion) => void;
  removeDataset: (datasetId: string) => void;
  resetWorkspace: () => void;
};

export const useNotebookStore = create<NotebookState>((set) => ({
  dataset: null,
  datasets: [],
  run: null,
  versions: [],
  instruction:
    "Clean this customer dataset. Fix missing values, duplicate records, invalid emails, inconsistent country names, and incorrect date formats.",
  setDatasets: (datasets) => set({ datasets }),
  setDataset: (dataset) =>
    set((state) => ({
      dataset,
      versions: dataset.versions,
      run: null,
      datasets: state.datasets.some((item) => item.dataset_id === dataset.dataset_id)
        ? state.datasets.map((item) => (item.dataset_id === dataset.dataset_id ? dataset : item))
        : [dataset, ...state.datasets]
    })),
  setRun: (run) => set({ run }),
  setInstruction: (instruction) => set({ instruction }),
  addVersion: (version) =>
    set((state) => ({
      versions: [...state.versions, version],
      dataset: state.dataset ? { ...state.dataset, versions: [...state.dataset.versions, version] } : state.dataset,
      datasets: state.datasets.map((item) =>
        state.dataset && item.dataset_id === state.dataset.dataset_id
          ? { ...item, versions: [...item.versions, version] }
          : item
      )
    })),
  removeDataset: (datasetId) =>
    set((state) => {
      const datasets = state.datasets.filter((item) => item.dataset_id !== datasetId);
      if (state.dataset?.dataset_id !== datasetId) return { datasets };
      return { dataset: null, datasets, run: null, versions: [] };
    }),
  resetWorkspace: () => set({ dataset: null, datasets: [], run: null, versions: [] })
}));
