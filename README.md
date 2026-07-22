<p align="center">
  <img src="NUMDUX.jpg" alt="Numdux banner" width="100%" />
</p>

# Numdux Notebook

<p>
  <img alt="Version" src="https://img.shields.io/badge/version-0.2.0-2f6fed" />
  <img alt="Status" src="https://img.shields.io/badge/status-local--first-18a058" />
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue" /></a>
  <img alt="Frontend" src="https://img.shields.io/badge/frontend-React%20%2B%20Vite-646cff" />
  <img alt="Backend" src="https://img.shields.io/badge/backend-FastAPI-009688" />
  <img alt="Python" src="https://img.shields.io/badge/python-3.11%2B-3776ab" />
</p>

**Current version:** `0.2.0`

Numdux is a local-first data-quality notebook for profiling datasets, planning cleaning work, running Python or SQL transformations, training models, and exporting visual reports. It is designed for iterative analysis: upload data, inspect quality signals, run controlled notebook actions, approve useful outputs as new versions, and keep all artifacts on your machine.

The app combines a React/Vite frontend with a FastAPI backend. Dataset processing happens through scoped backend execution paths and sandbox task runs, with deterministic local planning available by default and optional Gemini support for richer AI-assisted planning.

## Demo

<p align="center">
  <img src="o" alt="Numdux Notebook Demo" width="100%" />
</p>

## What You Can Do

### What You Can Do Today

- **Multi-Format Dataset Ingestion**: Upload and profile CSV, TSV, Excel (`.xlsx`, `.xls`), Parquet, JSON, and JSONL files.
- **Automated Data Quality Profiling**: Compute schema types, missingness percentages, duplicate counts, numerical/categorical distributions, correlation matrices, IQR outliers, sample preview rows, and an overall 0–100 data quality score.
- **Staged AI Workflow Execution**: Run a 10-step guided pipeline (*Load*, *Explore*, *Visualize*, *Clean*, *Feature Engineering*, *Prepare*, *Split*, *Train*, *Tune & Evaluate*, *Save & Predict*) with step-by-step progress tracking.
- **Interactive Hybrid Notebook Cells**: Execute Python code cells in isolated sandboxes and run read-only DuckDB SQL queries over dataset versions alongside markdown notes.
- **Deterministic & LLM Cleaning Plans**: Generate data cleaning proposals using the built-in rule provider or Google Gemini (`gemini-3.5-flash`).
- **Immutable Dataset Versioning**: Inspect transformation diffs, preview outputs, and promote approved sandbox runs into version snapshots stored in local storage (`.numdux_data/`).
- **Model Lab**: Train scikit-learn classification and regression models, evaluate performance metrics (R², RMSE, Accuracy, F1), view feature importances, and calculate overfit gaps.
- **Exporting & Reporting**: Export dataset versions (CSV, Parquet, JSON) and generate downloadable PDF visual data quality reports.

### Roadmap

- **Multi-Table Relational Joins**: Cross-table merging and relational join operations (currently operating on a single primary dataset at a time).
- **Remote Data Source Connectors**: Direct integration with S3, GCS, and remote SQL databases (currently strictly local storage under `.numdux_data/`).
- **Advanced Container Sandboxing**: Configurable container memory/CPU resource caps and egress network firewall rules for the Docker sandbox engine.
- **Multi-User Collaboration**: Shared workspace state and real-time collaborative notebook sessions (currently optimized for local-first single-user workflows).

## Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS, TanStack Query, Monaco Editor, Recharts.
- Backend: FastAPI, Pydantic, pandas, NumPy, SciPy, scikit-learn, matplotlib, seaborn, DuckDB, Polars.
- Runtime storage: `.numdux_data/` in the project root.
- Optional AI provider: Gemini via `GEMINI_API_KEY`.
- Sandbox execution: Docker when available; otherwise a local development subprocess sandbox is used.

## Requirements

- Python 3.11 or newer.
- Node.js and npm.
- Docker is optional but recommended for stronger local sandbox isolation.

## Quick Start

Install frontend dependencies:

```bash
npm install
```

Create and activate a Python environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Start the backend and frontend together:

```bash
./numdux run
```

Default URLs:

- API: `http://127.0.0.1:8000`
- App: `http://localhost:5173`

Run without opening a browser:

```bash
./numdux run --no-browser
```

Run with backend reload enabled:

```bash
./numdux run --reload
```

Use custom ports:

```bash
./numdux run --backend-port 8010 --frontend-port 5174
```

## Configuration

Numdux works without external AI by using `AI_PROVIDER="rule"`. To use Gemini, create a `.env` file in the project root:

```env
AI_PROVIDER="gemini"
GEMINI_API_KEY="your-api-key"
GEMINI_MODEL="gemini-3.5-flash"
```

Settings can also be updated from the app. The backend persists supported settings back into `.env`.

Useful environment keys:

| Key | Default | Purpose |
| --- | --- | --- |
| `AI_PROVIDER` | `rule` | Selects `rule` or `gemini`. |
| `GEMINI_API_KEY` | empty | Enables Gemini requests when the provider is `gemini`. |
| `GEMINI_MODEL` | `gemini-3.5-flash` | Gemini model name used by the backend provider. |
| `VITE_API_URL` | `http://127.0.0.1:8000` | Frontend proxy target for `/api` during Vite development. |

## Main Workflow

1. Upload a dataset from the command workspace.
2. Review the generated profile, quality score, column metadata, sample rows, and charts.
3. Run a prompt, staged workflow, manual Python cell, SQL query, or Model Lab training job.
4. Inspect execution status, stdout/stderr, generated files, validation reports, previews, and metrics.
5. Approve successful outputs as new dataset versions when they should become the current working state.
6. Export datasets or reports from the UI.

## AI And Sandbox Workflow

The staged AI workflow is defined in the frontend and executed step by step through backend sandbox tasks. The stages currently cover:

- Load Data
- Explore Data
- Visualize Data
- Clean Data
- Feature Engineering
- Prepare Data
- Split Data
- Train Model
- Tune & Evaluate
- Save & Predict

Sandbox task code is generated from the user instruction and dataset profile. The backend validates the generated code before execution, captures generated files, and can attempt repairs for failed code up to the configured attempt limit.

## Security

Numdux Notebook executes generated Python transformation code and manual code cells in a sandbox environment. The system supports two execution engines depending on host capabilities:

### Docker Sandbox Isolation (Recommended)
When Docker is available on the host machine, task execution runs inside isolated container instances:
- **Filesystem Isolation**: Code execution is restricted to mounted ephemeral volume paths (`/input` and `/output`), preventing unauthorized host read/write access.
- **Process Isolation**: Code runs within isolated container namespaces, preventing host process inspection or signaling.
- **Network & Egress Control**: Outbound network traffic can be disabled or firewalled via container runtime policies.

### Subprocess Sandbox Fallback (Development Only)
When Docker is absent, Numdux falls back to executing Python scripts via direct host `subprocess.run` inside temporary runtime directories (`.numdux_data/runs/`):
- **Host Filesystem Exposure**: Python scripts inherit the OS user permissions of the running FastAPI backend process and can read/write accessible host paths.
- **Network Egress**: Outbound socket connections and HTTP requests are not blocked by operating system sandbox policies.
- **Unconstrained Resources**: Hard execution timeouts (default: 120s) are enforced, but RAM, CPU utilization, and disk storage are unconstrained.

> **Security Warning**: Use Docker sandbox isolation whenever Numdux is deployed in shared environments, exposed to non-loopback network interfaces, or handling untrusted user datasets and prompt instructions.

## Local Data Layout

Runtime data is stored under:

```text
.numdux_data/
```

This directory can contain uploaded datasets, dataset versions, cleaning runs, sandbox outputs, charts, model artifacts, reports, and generated PDFs. It is runtime state and should normally stay out of version control.

## Useful Scripts

Run only the Vite frontend:

```bash
npm run dev
```

Type-check and build the frontend:

```bash
npm run build
```

Preview the production frontend build:

```bash
npm run preview
```

Run the CLI through npm:

```bash
npm run numdux -- run
```

Start through the package script:

```bash
npm start
```

## API Overview

The frontend calls backend routes under `/api`. Common endpoints include:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Backend health check. |
| `GET` | `/api/ai/provider` | Current provider status and optional Gemini verification. |
| `GET` / `PUT` | `/api/settings` | Read or update AI settings. |
| `POST` | `/api/datasets` | Upload and profile a dataset. |
| `GET` | `/api/datasets` | List stored datasets. |
| `DELETE` | `/api/datasets/{dataset_id}` | Delete one dataset. |
| `GET` / `DELETE` | `/api/storage` | Inspect or clear local storage. |
| `GET` | `/api/datasets/{dataset_id}/versions/{version_id}` | Read a specific dataset version. |
| `GET` | `/api/datasets/{dataset_id}/versions/{version_id}/query` | Query a version with read-only SQL. |
| `POST` | `/api/cleaning-runs` | Generate and run a cleaning plan. |
| `POST` | `/api/cleaning-runs/custom` | Run custom Python cleaning code. |
| `POST` | `/api/sql-runs` | Run a SQL notebook query. |
| `POST` | `/api/sandbox-tasks` | Run an AI or manual sandbox task. |
| `POST` | `/api/sandbox-tasks/{task_id}/approve` | Promote a successful sandbox task to a dataset version. |
| `POST` | `/api/datasets/{dataset_id}/versions/{version_id}/train` | Train a model from a dataset version. |
| `GET` | `/api/datasets/{dataset_id}/models` | List model runs. |
| `GET` / `POST` | `/api/datasets/{dataset_id}/charts` | List or create saved chart configs. |
| `GET` | `/api/datasets/{dataset_id}/report` | Generate a visual report payload. |
| `GET` | `/api/datasets/{dataset_id}/report.pdf` | Download a PDF report. |
| `GET` | `/api/datasets/{dataset_id}/export` | Export a dataset version. |

## Development Notes

- Backend source lives in `backend/app/`.
- Frontend source lives in `src/`.
- Shared frontend API helpers live in `src/lib/api.ts`.
- Pydantic request and response models live in `backend/app/models.py`.
- The Vite dev server proxies `/api` to `VITE_API_URL`.
- `./numdux run` starts both services and injects the backend URL into the frontend process.
- The backend loads `.env` from the repository root on demand.

Before shipping changes, run:

```bash
npm run build
```

For Python-only changes, at minimum compile the backend modules:

```bash
python3 -m py_compile backend/app/*.py
```

## Troubleshooting

Backend is not reachable:

- Start the full app with `./numdux run`.
- Confirm the API is available at `http://127.0.0.1:8000/api/health`.
- If using separate frontend/backend processes, set `VITE_API_URL` to the backend URL.

Gemini shows local mode or needs attention:

- Confirm `AI_PROVIDER="gemini"` is set.
- Confirm `GEMINI_API_KEY` is present.
- Check the model name in `GEMINI_MODEL`.
- Use the app settings screen to verify provider connectivity.

Uploads fail:

- Confirm the file type is supported.
- Reinstall Python dependencies if Excel, Parquet, or JSONL support is missing.
- Check that `.numdux_data/` is writable.

Sandbox tasks fail:

- Inspect stderr, validation reports, and safety errors in the task result.
- Install and start Docker for stronger sandbox support.
- Retry with a narrower instruction if generated code is too broad.

Build fails:

- Run `npm install` to restore frontend dependencies.
- Activate the Python virtual environment before running backend commands.
- Re-run `npm run build` after TypeScript or dependency changes.
