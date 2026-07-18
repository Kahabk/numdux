# Numdux Notebook

Numdux is a local data-quality notebook for profiling datasets, planning cleaning work, running Python or SQL transformations, and exporting visual quality reports.

It has a React/Vite frontend and a FastAPI backend. Uploaded datasets are profiled on ingest, stored locally, and processed through scoped backend execution paths.

## Features

- Upload CSV, TSV, Excel, Parquet, JSON, or JSONL datasets.
- Inspect column profiles, missingness, duplicates, distributions, correlations, and sample rows.
- Generate cleaning plans with either the built-in rule-based provider or Gemini.
- Run generated or edited Python cleaning code.
- Run manual Python and SQL notebook cells.
- Approve successful cleaning runs as new dataset versions.
- Generate visual reports and PDF quality reports.
- Manage stored datasets and generated run artifacts locally.

## Requirements

- Python 3.11+
- Node.js and npm

## Install

Install frontend dependencies:

```bash
npm install
```

Install backend dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

Start the backend and frontend together:

```bash
./numdux run
```

By default, this starts:

- API: `http://127.0.0.1:8000`
- App: `http://localhost:5173`

Use `--no-browser` if you do not want the app to open automatically:

```bash
./numdux run --no-browser
```

Use `--reload` during backend development:

```bash
./numdux run --reload
```

## Configuration

Numdux works without an external AI provider by using its deterministic rule-based provider.

To use Gemini, create a `.env` file in the project root:

```env
AI_PROVIDER="gemini"
GEMINI_API_KEY="your-api-key"
GEMINI_MODEL="gemini-3.5-flash"
```

You can also update these settings from the app settings screen.

## Useful Scripts

```bash
npm run dev
```

Starts only the Vite frontend.

```bash
npm run build
```

Type-checks and builds the frontend.

```bash
npm run preview
```

Serves the built frontend locally.

```bash
npm run numdux -- run
```

Runs the Numdux CLI through npm.

## Local Data

Uploaded datasets, versions, reports, and run outputs are stored under:

```text
.numdux_data/
```

This directory is runtime data and should usually stay out of version control.

## Development Notes

The backend API lives in `backend/app/`.

The frontend app lives in `src/`.

The frontend calls backend endpoints under `/api`. When started through `./numdux run`, the CLI sets `VITE_API_URL` for the frontend process and starts both services with matching defaults.
