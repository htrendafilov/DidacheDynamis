# Proposition 2 — Tauri 2 + Python sidecar

Wrap the SPA in [Tauri 2](https://v2.tauri.app/) (Rust shell + OS webview) and run the
FastAPI backend as a **sidecar process**: a PyInstaller-frozen `bible-api` binary that
Tauri spawns and kills with the app.

## How it works

```
┌─────────────────────────────────────────┐
│ Tauri window (OS webview)               │
│  WKWebView / WebView2 / WebKitGTK       │
│  serves the built SPA from embedded     │
│  assets (tauri:// protocol)             │
└──────┬──────────────────────────────────┘
       │ fetch http://127.0.0.1:<port>/api/v1/*
       ▼
┌─────────────────────────────────────────┐
│ sidecar: bible-api (PyInstaller binary) │
│  uvicorn + app.main:app                 │
│  read-only content.sqlite on disk       │
└─────────────────────────────────────────┘
```

- `apps/web` builds with a desktop flag so `BASE` becomes `http://127.0.0.1:<port>/api/v1`
  (one config branch in `apps/web/src/data/api.ts:221`; port injected by the shell, e.g.
  via a Tauri command or a `window.__API_PORT__` global written at startup).
- Tauri's [sidecar pattern](https://v2.tauri.app/develop/sidecar/) bundles the frozen
  Python API as an external binary per target triple
  (`binaries/bible-api-aarch64-apple-darwin`, etc.).
- The shell picks a free port, spawns the sidecar with
  `CONTENT_DB_PATH=<app-data-dir>/content.sqlite`, waits for `/api/v1/health`, then shows
  the window.

## Packaging

- Tauri produces native installers directly: **DMG** (macOS, universal2 supported),
  **NSIS/MSI** (Windows), **AppImage/deb/rpm** (Linux).
- Rust toolchain is build-only — users get a static shell (~15–30 MB before the DB).
- **Built-in updater**: signed update manifests + delta updates
  (`tauri-plugin-updater`), hosting updates on GitHub Releases is a documented path.
- CSP story already solved in M5 — Tauri has its own CSP config; the Dropbox-scoped
  policy ports over.

## Effort estimate

- New code: a thin Rust shell (mostly config; ~200 lines of Rust for port-pick, sidecar
  spawn, health-wait, graceful kill) + the PyInstaller spec for the API + the
  `BASE`-override branch in the SPA.
- Build plumbing: `tauri-action` in CI builds all three OSes from one workflow; API
  sidecar frozen in the same matrix and copied in.
- Risk items: sidecar lifecycle bugs (orphan uvicorn after crash), Rust toolchain
  learning curve, code signing (see `desktop-05`).

## Pros

- **Smallest native installers** and memory footprint of the "real app" options.
- First-class auto-updater — solves the problem Proposition 1 punts on.
- OS webview = no bundled Chromium; security posture is good.
- Excellent multi-platform installer story from a single config.

## Cons

- **Two extra toolchains** (Rust + PyInstaller) and a process-boundary to debug.
- Sidecar orchestration is the classic failure mode: port races, zombie processes,
  slower cold start (spawn Python + bind + health-check ≈ 1–2 s).
- Same Linux WebKitGTK caveat as pywebview.
- Team must maintain a (small) Rust codebase.

## Verdict

**The best "real product" option.** Adopt when the desktop app justifies polished
updates and small downloads; start from the validated pywebview architecture and swap
the shell.
