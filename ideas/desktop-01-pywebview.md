# Proposition 1 — pywebview + PyInstaller (all-Python shell)

Wrap the existing FastAPI app in a thin native window using
[pywebview](https://pywebview.flowrl.com/), then freeze the whole thing per-OS with
PyInstaller.

## How it works

```
┌────────────────────────────────────────┐
│ Native OS webview window               │
│  macOS: WKWebView  Win: WebView2       │
│  Linux: WebKitGTK                      │
│                                        │
│  loads http://127.0.0.1:<port>/  ──────┼──► in-process uvicorn (or threaded
└────────────────────────────────────────┘    WSGI server) serving:
                                               - built SPA (StaticFiles)
                                               - /api/v1/* over content.sqlite
```

- A small `desktop/main.py` entrypoint: opens `content.sqlite` read-only, starts the
  **existing `app.main:app` FastAPI app** on an ephemeral localhost port, then opens a
  pywebview window pointed at it.
- The SPA needs **zero changes** — it already uses a relative `/api/v1` base
  (`apps/web/src/data/api.ts:221`).
- IndexedDB notes persist inside the webview's profile dir; Dropbox sync keeps working
  (it's pure browser-side OAuth + fetch).

## Packaging

- **PyInstaller** per OS (`--windowed --onefile` or `--onedir`):
  - macOS: `.app` bundle → DMG. Universal2 via two builds (arm64 + x86_64) merged with
    `lipo`, or two separate DMGs.
  - Windows: single `.exe` (NSIS installer optional) — needs WebView2 runtime, which is
    preinstalled on Win10 1803+ / Win11; installer can bootstrap it if missing.
  - Linux: `--onedir` + AppImage (linuxdeploy) or `.deb`; WebKitGTK is a system
    dependency (`apt install gir1.2-webkit2-4.1` etc.) — the roughest edge of this
    option.
- The 189 MB `content.sqlite` ships as a data file next to the binary (see
  `desktop-06-content-updates.md` for bundle-vs-download).

## Effort estimate

- New code: ~100 lines (`desktop/main.py`, window/menu plumbing, port picking, shutdown
  handling).
- Build plumbing: one PyInstaller spec + CI matrix job (macOS, Windows, Linux runners).
- Risk items: WebKitGTK variance across Linux distros; PyInstaller AV false positives on
  Windows; code signing (see `desktop-05`).

## Pros

- **Single language.** No Rust/Node runtime in the desktop shell; the team already knows
  this stack.
- Reuses the FastAPI app **in-process** — no sidecar process management, no IPC format.
- Small-ish installers (~40–60 MB before the DB).
- The API's existing tests keep covering the desktop backend unchanged.

## Cons

- No built-in auto-updater — need a third-party solution or manual "download new
  version" flow.
- Linux WebKitGTK dependency is a real support burden (fonts, HiDPI, older distros).
- PyInstaller startup time (onefile unpack) can add 1–3 s.
- Windows WebView2 evergreen runtime is almost always present but is still an external
  dependency to verify in installer.

## Verdict

**Best effort-to-value ratio.** The natural first offline desktop build.
