# Proposition 3 — Electron + Python sidecar

The classic: Chromium + Node shell ([Electron](https://www.electronjs.org/)) with the
FastAPI backend frozen as a child process, same sidecar topology as Proposition 2.

## How it works

Identical architecture to the Tauri option — SPA loaded from local files, Python API
spawned on an ephemeral localhost port — except the shell is Electron's main process
(Node) instead of Rust:

```js
// main.js sketch
const port = await getPort();
const api = spawn(path.join(process.resourcesPath, 'bible-api'),
  { env: { CONTENT_DB_PATH: dbPath, API_PORT: String(port) } });
await waitFor(`http://127.0.0.1:${port}/api/v1/health`);
new BrowserWindow({ width: 1280, height: 800 }).loadFile('dist/index.html');
```

- The SPA's `BASE` override works the same way (`window.__API_PORT__` injected via
  preload or query param).
- IndexedDB notes live in Chromium's profile — most robust persistence of all options,
  and identical engine to what users already run in browsers today.

## Packaging

- **electron-builder** per OS: DMG (mac), NSIS/MSI (Windows), AppImage/deb/snap (Linux).
- **electron-updater** gives mature auto-updates from GitHub Releases (mac uses Squirrel
  via a release server or `update.electronjs.org`).
- Installer size: **~200 MB+ before the DB** — every app ships its own Chromium + Node.

## Effort estimate

Same shape as Tauri: sidecar freeze + spawn/wait/kill logic + one CI matrix. Slightly
more example code available than any other option; Playwright e2e suite
(`apps/web/e2e/`) can even run against the Electron build.

## Pros

- **Most mature ecosystem** — every problem has a Stack Overflow answer.
- One rendering engine everywhere: no WebKitGTK/Linux or WebView2/Windows variance.
  What you test is what users get.
- Auto-updates (electron-updater) and crash reporting (Sentry) are off the shelf.

## Cons

- **Size and RAM**: ~200 MB installer, ~300 MB idle RAM — hard to justify for a reader
  app whose backend is a read-only file.
- Bundled Chromium ages: you must ship updates to patch browser CVEs even when app code
  doesn't change.
- Same sidecar process-management burden as Tauri.
- Heaviest CI builds of the four options.

## Verdict

**The safe fallback.** If OS-webview quirks (Linux WebKitGTK fonts/HiDPI, Windows
WebView2 edge cases) become real support costs, Electron trades disk/RAM for a uniform
platform. Otherwise its weight is a poor fit for this app.
