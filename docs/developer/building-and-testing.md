# Building, Testing & Quality Assurance

The repository maintains a strict quality bar. All linting, unit testing, type checking, and build checks are unified in a single command.

## Verification Pipeline Diagram

```mermaid
flowchart TD
    Start[Run scripts/check.sh] --> ImporterCheck[apps/importer\nRuff + Pytest]
    ImporterCheck --> APICheck[apps/api\nRuff + Pytest]
    APICheck --> WebLint[apps/web\nESLint]
    WebLint --> WebType[apps/web\nTypeScript tsc]
    WebType --> WebTest[apps/web\nVitest Unit Tests]
    WebTest --> WebBuild[apps/web\nVite Production Build]
    WebBuild --> Success([Clean Pass ✅])
```

## Running Verification Commands

### 1. Canonical Check Entrypoint
Before opening a Pull Request or pushing changes, run the main check script:
```bash
./scripts/check.sh
```
This script executes the exact same verification suite used by GitHub Actions CI ([`.github/workflows/ci.yml`](file:///Users/hristo.trendafilov/mydev/bible_app_bg/.github/workflows/ci.yml)).

### 2. Frontend Unit Tests (Vitest)
```bash
cd apps/web
npm run test           # Run tests once
npm run test -- --watch # Run tests in watch mode
```

### 3. End-to-End Integration Tests (Playwright)
To execute full-stack E2E smoke tests and accessibility (`axe-core`) scans:
```bash
./scripts/e2e-server.sh
```
This launches a temporary API server, compiles the web SPA, and runs Playwright integration tests ([`.github/workflows/e2e.yml`](file:///Users/hristo.trendafilov/mydev/bible_app_bg/.github/workflows/e2e.yml)).
