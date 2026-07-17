from __future__ import annotations

import shutil
import uuid
from dataclasses import dataclass, field
from datetime import datetime
import json
from pathlib import Path

import pandas as pd

from .models import CleaningRunResponse, DatasetProfile


@dataclass
class DatasetVersion:
    id: str
    label: str
    path: Path
    profile: DatasetProfile
    approved: bool = True


@dataclass
class DatasetRecord:
    id: str
    filename: str
    storage_path: Path
    versions: list[DatasetVersion] = field(default_factory=list)
    runs: list[CleaningRunResponse] = field(default_factory=list)


class InMemoryStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.datasets: dict[str, DatasetRecord] = {}

    def load_existing(self, profile_factory) -> None:
        datasets_dir = self.root / "datasets"
        if not datasets_dir.exists():
            return
        for dataset_dir in sorted(datasets_dir.iterdir(), key=lambda path: path.stat().st_mtime, reverse=True):
            if not dataset_dir.is_dir() or dataset_dir.name in self.datasets:
                continue
            version_paths = sorted(
                dataset_dir.glob("version_*.*"),
                key=lambda path: int(path.stem.split("_")[-1]) if path.stem.split("_")[-1].isdigit() else 0,
            )
            if not version_paths:
                continue
            manifest = self._read_manifest(dataset_dir)
            filename = manifest.get("original_filename") or f"{dataset_dir.name}/{version_paths[0].name}"
            if not manifest:
                self._write_manifest(
                    dataset_dir,
                    {
                        "dataset_id": dataset_dir.name,
                        "original_filename": filename,
                        "created_at": datetime.utcfromtimestamp(version_paths[0].stat().st_mtime).isoformat() + "Z",
                        "versions": [
                            {
                                "id": f"v{index}",
                                "path": path.name,
                                "label": "Original upload" if index == 1 else f"Approved cleaned dataset v{index}",
                            }
                            for index, path in enumerate(version_paths, start=1)
                        ],
                    },
                )
            versions: list[DatasetVersion] = []
            for index, path in enumerate(version_paths, start=1):
                content = path.read_bytes()
                display_name = filename if index == 1 else path.name
                df = profile_factory["load"](content, display_name)
                profile = profile_factory["profile"](dataset_dir.name, f"v{index}", display_name, content, df)
                label = "Original upload" if index == 1 else f"Approved cleaned dataset v{index}"
                versions.append(DatasetVersion(id=f"v{index}", label=label, path=path, profile=profile))
            self.datasets[dataset_dir.name] = DatasetRecord(
                id=dataset_dir.name,
                filename=filename,
                storage_path=version_paths[0],
                versions=versions,
            )

    def create_dataset(self, filename: str, content: bytes, profile_factory) -> DatasetRecord:
        dataset_id = f"ds_{uuid.uuid4().hex[:10]}"
        dataset_dir = self.root / "datasets" / dataset_id
        dataset_dir.mkdir(parents=True, exist_ok=True)
        suffix = Path(filename).suffix or ".csv"
        path = dataset_dir / f"version_1{suffix}"
        path.write_bytes(content)
        self._write_manifest(
            dataset_dir,
            {
                "dataset_id": dataset_id,
                "original_filename": filename,
                "created_at": datetime.utcnow().isoformat() + "Z",
                "versions": [{"id": "v1", "path": path.name, "label": "Original upload"}],
            },
        )
        df = profile_factory["load"](content, filename)
        profile = profile_factory["profile"](dataset_id, "v1", filename, content, df)
        version = DatasetVersion(id="v1", label="Original upload", path=path, profile=profile)
        record = DatasetRecord(id=dataset_id, filename=filename, storage_path=path, versions=[version])
        self.datasets[dataset_id] = record
        return record

    def get(self, dataset_id: str) -> DatasetRecord:
        return self.datasets[dataset_id]

    def delete_dataset(self, dataset_id: str) -> None:
        self.datasets.pop(dataset_id, None)
        dataset_dir = self.root / "datasets" / dataset_id
        if dataset_dir.exists():
            shutil.rmtree(dataset_dir)

    def current_version(self, dataset_id: str) -> DatasetVersion:
        return self.get(dataset_id).versions[-1]

    def clear_all(self) -> None:
        self.datasets.clear()
        if self.root.exists():
            shutil.rmtree(self.root)
        self.root.mkdir(parents=True, exist_ok=True)

    def approve_run(self, dataset_id: str, run_id: str, run_dir: Path, profile_factory) -> DatasetVersion:
        record = self.get(dataset_id)
        next_number = len(record.versions) + 1
        source = run_dir / "output" / "cleaned.parquet"
        target = self.root / "datasets" / dataset_id / f"version_{next_number}.parquet"
        shutil.copy2(source, target)
        df = pd.read_parquet(target)
        content = target.read_bytes()
        profile = profile_factory["profile"](dataset_id, f"v{next_number}", target.name, content, df)
        version = DatasetVersion(id=f"v{next_number}", label=f"Approved cleaning run {run_id}", path=target, profile=profile)
        record.versions.append(version)
        manifest_path = self.root / "datasets" / dataset_id
        manifest = self._read_manifest(manifest_path)
        manifest.setdefault("versions", []).append(
            {"id": version.id, "path": target.name, "label": version.label, "approved_at": datetime.utcnow().isoformat() + "Z"}
        )
        self._write_manifest(manifest_path, manifest)
        return version

    @staticmethod
    def _read_manifest(dataset_dir: Path) -> dict:
        path = dataset_dir / "dataset_manifest.json"
        if not path.exists():
            return {}
        return json.loads(path.read_text())

    @staticmethod
    def _write_manifest(dataset_dir: Path, data: dict) -> None:
        (dataset_dir / "dataset_manifest.json").write_text(json.dumps(data, indent=2))
