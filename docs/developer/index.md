# Developer Guide: Quickstart & Setup

Welcome to the developer documentation for **bible_app_bg**. This guide covers local environment setup, architecture principles, and building the project locally.

## Monorepo High-Level Workflow

```mermaid
flowchart TD
    subgraph Data Build Phase [Offline Data Pipeline]
        RawSources[data/sources/*\nUSFX / SWORD / ThML] -->|bibleimport build-all| ImporterCLI[apps/importer]
        ImporterCLI -->|Compiles| SQLiteDB[(data/content.sqlite\nRead-Only SQLite + FTS5)]
    end

    subgraph Runtime Phase [Local Development]
        SQLiteDB -.->|Reads mode=ro| API[apps/api\nFastAPI on :8080]
        API <-->|REST API / JSON| SPA[apps/web\nReact + Vite on :5173]
        ClientNotes[(Browser IndexedDB)] <-->|Save/Load| SPA
    end
```

## System Requirements

- **Python**: 3.11 or higher
- **Node.js**: 18.x or 20.x
- **Package Managers**: `pip`, `npm`
- **OS**: macOS, Linux, or WSL2

## Step-by-Step Local Setup

### 1. Clone & Set Up Virtual Environments

```bash
git clone https://github.com/htrendafilov/bible_app_bg.git
cd bible_app_bg

# Set up importer virtualenv
python3 -m venv apps/importer/.venv
. apps/importer/.venv/bin/activate
pip install -e apps/importer
deactivate

# Set up API virtualenv
python3 -m venv apps/api/.venv
. apps/api/.venv/bin/activate
pip install -e apps/api
deactivate
```

### 2. Build the Content Database

Build the single read-only SQLite database (`data/content.sqlite`) from committed source files:

```bash
. apps/importer/.venv/bin/activate
bibleimport build-all --sources-dir data/sources --out data/content.sqlite
deactivate
```

### 3. Run Development Servers

Start the FastAPI backend (Port `8080`):
```bash
. apps/api/.venv/bin/activate
uvicorn app.main:app --app-dir apps/api --port 8080 --reload
```

In a second terminal, start the Vite SPA dev server (Port `5173`):
```bash
cd apps/web
npm install
npm run dev
```

Open `http://localhost:5173/` in your browser.

---

## Developer Documentation Topics

- [Architecture Overview](file:///Users/hristo.trendafilov/mydev/bible_app_bg/docs/developer/architecture-overview.md) — System boundaries & Canonical Intermediate Representation (CIR)
- [Web SPA](file:///Users/hristo.trendafilov/mydev/bible_app_bg/docs/developer/web-spa.md) — React 18, Vite, Zustand layout engine & TipTap notes
- [API Service](file:///Users/hristo.trendafilov/mydev/bible_app_bg/docs/developer/api-service.md) — FastAPI endpoints, read-only SQLite & FTS5 queries
- [Importer CLI](file:///Users/hristo.trendafilov/mydev/bible_app_bg/docs/developer/importer-cli.md) — `bibleimport` format adapters & database compiler
- [Building & Testing](file:///Users/hristo.trendafilov/mydev/bible_app_bg/docs/developer/building-and-testing.md) — Check script, Pytest, Vitest & Playwright E2E
- [Contributing](file:///Users/hristo.trendafilov/mydev/bible_app_bg/docs/developer/contributing.md) — Code style standards, PR workflow & contribution rules
