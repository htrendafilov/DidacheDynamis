# Desktop App Packaging — Overview

Brainstorm: how to ship `DidacheDynamis` as an installable desktop app for macOS, Linux, and
Windows. This is a set of propositions, not a decision. See `AGENTS.md` — packaging choice
is a product decision and needs owner sign-off before implementation.

## What we're packaging

Current architecture (see `plan/00_system_design.md`):

- **`apps/web`** — React + Vite SPA. Talks only to `BASE = "/api/v1"` (single fetch
  wrapper in `apps/web/src/data/api.ts:236`). One-line change to point at any base URL.
- **`apps/api`** — FastAPI, read-only over `data/content.sqlite` (SQLite + FTS5).
  In production it also serves the built SPA via `StaticFiles` (see `deploy/Dockerfile`).
- **`data/content.sqlite`** — 189 MB build artifact, reproducible via `bibleimport
  build-all`. Versioned; the release pipeline already does atomic symlink swaps.
- **Personal state** — already 100% client-side (IndexedDB) with optional Dropbox sync.
  Nothing about notes changes in a desktop app.

Two properties make desktop packaging unusually easy for this app:

1. **The server holds no mutable state.** A desktop app can run the whole "server"
   on localhost with zero conflict/locking concerns.
2. **All personal data already lives in the browser.** No account/migration story needed.

The two hard problems are:

1. **The 291 MB database** — largely solved by content modularity: ship a ~40–45 MB
   minimal base (WEB + Easton + 1689 + TSK) and install MHC/KJV+Strong's in-app (see
   `desktop-07-content-modularity-and-sword-installer.md`; measured numbers inside —
   MHC ~118 MB and the KJV+Strong's layer ~125 MB are ~84% of the full build).
2. **Code signing / notarization** on macOS and Windows (see
   `desktop-05-distribution-and-signing.md`).

## The propositions

| # | Approach | Installer size (excl. DB) | Effort | App feel | Notes |
|---|----------|---------------------------|--------|----------|-------|
| 1 | [pywebview + PyInstaller](desktop-01-pywebview.md) | ~40–60 MB | **Low** | Good (OS webview) | All-Python; fewest new moving parts |
| 2 | [Tauri 2 + Python sidecar](desktop-02-tauri.md) | ~15–30 MB | Medium | Excellent | Best size/updater; adds Rust toolchain |
| 3 | [Electron + Python sidecar](desktop-03-electron.md) | ~200+ MB | Medium | Excellent | Most mature; heaviest |
| 4 | [PWA (+ optional WASM SQLite)](desktop-04-pwa.md) | 0 (browser) | Low → High | Good | Zero-install step; offline variant is a bigger rewrite |

Cross-cutting concerns (apply to all four):

- [Distribution & code signing](desktop-05-distribution-and-signing.md) — macOS
  notarization, Windows SmartScreen/signing, Linux package formats.
- [Content database delivery & updates](desktop-06-content-updates.md) — bundle vs.
  first-run download, compression, versioning.
- [Content modularity & SWORD module installer](desktop-07-content-modularity-and-sword-installer.md)
  — **decided direction:** minimal ~50–60 MB base + in-app module installs (MHC, KJV,
  Strong's, future Bulgarian text) from a curated license-vetted registry.

## Recommendation (straw man)

Staged approach:

1. **Now:** Proposition 4a — PWA against the hosted API. Costs almost nothing (manifest +
   service worker), gives "installed app" on all three OSes for users who are online.
2. **Next:** Proposition 1 — pywebview offline bundle. Single language, reuses FastAPI
   in-process, PyInstaller per-OS builds in CI. Validates the offline-desktop product
   with minimal new tech.
3. **Later (if the desktop app proves popular):** Proposition 2 — Tauri for smaller
   installers, proper auto-updates, and a more polished feel.

Proposition 3 (Electron) is the fallback if webview quirks (WebKitGTK on Linux, WebView2
runtime on Windows) bite in practice.

Also seriously consider the **WASM SQLite** variant of Proposition 4b long-term: if the
read queries ever run fully client-side, the desktop app becomes a static bundle, every
packaging option above collapses to "wrap the SPA", and the hosted server becomes
optional rather than load-bearing. It is the only path that eliminates the localhost
backend entirely.
