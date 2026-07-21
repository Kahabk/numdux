# Contributing to Numdux Notebook

Thank you for your interest in contributing to Numdux Notebook! We welcome contributions from developers of all skill levels.

## 1. Quick Setup

Before starting development, follow the setup instructions in the [README Quick Start](README.md#quick-start) to install Node.js and Python dependencies and start the application locally.

## 2. Project Structure

Here is a map of the codebase layout:

```text
numdux/
├── backend/app/        # FastAPI backend app
│   ├── main.py         # Route handlers & API endpoints
│   ├── models.py       # Pydantic request/response models
│   ├── tasking.py      # Staged AI & task workflow execution
│   ├── sandbox.py      # Execution sandbox (Docker & subprocess fallback)
│   ├── ai.py           # Rule-based & Gemini LLM plan providers
│   ├── profiler.py     # Data quality metrics & dataset profiling
│   ├── modeling.py     # Model Lab scikit-learn training & evaluation
│   ├── reporting.py    # Visual report data payload & PDF export generator
│   └── store.py        # Local versioning storage manager (.numdux_data/)
├── src/                # React / Vite frontend
│   ├── App.tsx         # Main application layout & notebook UI
│   ├── styles.css      # Custom styling & CSS design system
│   └── lib/api.ts      # Shared API fetch helpers & TypeScript types
├── numdux              # CLI runner script
└── README.md           # Documentation & setup guide
```

## 3. How to Pick a Task

- Browse open GitHub Issues labeled [`good first issue`](https://github.com/issues) for scoped, beginner-friendly tasks.
- For larger or ambiguous architectural proposals (e.g., changes to the sandbox runner or AI workflow pipeline), please open an issue or leave a comment to discuss the design before starting work.

## 4. Verification Before Opening a PR

Before submitting your Pull Request, ensure that all verification commands pass without errors:

**Frontend build and type-checking:**
```bash
npm run build
```

**Backend Python compilation check:**
```bash
python3 -m py_compile backend/app/*.py
```

## 5. Pull Request Guidelines

- **Keep PRs focused**: Submit small, single-purpose pull requests that address one specific bug or feature.
- **Link the Issue**: Include `Closes #123` or `Fixes #123` in your PR description.
- **Describe Manual Testing**: Automated test coverage is currently growing. Please provide a clear, factual description of how you manually verified your changes (e.g., uploaded dataset `sample.csv`, executed Python cell, verified output preview).

## 6. Code Style

- **Frontend (TypeScript / React)**: Follow modern React hooks patterns and clean TypeScript types (`tsconfig.json`).
- **Backend (Python)**: Follow standard PEP 8 formatting guidelines and explicit Pydantic type annotations (`backend/app/models.py`).
