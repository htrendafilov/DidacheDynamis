# Proposition 4 — PWA (+ optional WASM SQLite)

Two variants, very different costs. Both avoid "packaging" entirely: the app installs
straight from the browser (Add to Dock / Install app) on macOS, Windows, and Linux.

## 4a — Online PWA against the hosted API (cheap)

The app is already an SPA with all personal state client-side. Making it an installable
PWA is close to free:

- `manifest.webmanifest` (icons, name, `display: standalone`) — ~30 lines.
- Service worker caching the SPA shell + static assets (Workbox or hand-rolled;
  Vite: `vite-plugin-pwa`). API responses can get a short stale-while-revalidate cache,
  but passages stay network-backed.
- Done: users "install" bible.trendafilovi.net and get an icon, own window, offline
  shell with a friendly "you're offline" state.

**This is a one-afternoon change and should probably happen regardless of any other
proposition.**

## 4b — Offline PWA via SQLite WASM (the rewrite)

Eliminate the backend: run the read-only queries **in the browser** against
`content.sqlite` compiled to WASM.

- [wa-sqlite](https://github.com/rhashimoto/wa-sqlite) or official `sqlite-wasm` with
  **OPFS** persistence: the 189 MB DB is downloaded once (progressively, resumable,
  chunked with integrity checks — reuse the importer's checksum/audit line) and stored
  in the origin's OPFS; SQLite pages it from disk — no 189 MB memory hit.
- FTS5 works in WASM SQLite builds (it's compiled in by default in sqlite-wasm).
- The FastAPI routers' SQL (`apps/api/app/routers/*.py`, `search_providers.py`) is ported
  to a TS data layer behind the same interface `apps/web/src/data/api.ts` already
  abstracts. The read surface is small: passages, search, commentary, dictionary,
  xrefs, works, general books, lexicon, health.
- Verse-preview/search ranking parity must be re-verified (the M7.1/M7.2 semantics
  live in Python today).

### Why this variant is strategically interesting

- Desktop app becomes a **static bundle** — Tauri/Electron shrink to trivial wrappers,
  no sidecar, no localhost port, no Python at all.
- The hosted deployment could serve the SPA + ranged DB and drop the Python service
  too (the read-only architecture makes this safe).
- Offline-first for every platform including tablets/phones (PWA on Android/iOS).

### Cost

- The biggest engineering effort of all propositions: port ~10 SQL-heavy modules,
  verify FTS5 ranking parity, build chunked-DB download/resume/verify UI, OPFS quota
  handling (Safari is the laggard — ask-before-persist required).
- 189 MB first-run download is unavoidable (see `desktop-06` for trimming ideas).

## Pros / Cons

| | 4a online PWA | 4b offline WASM |
|---|---|---|
| Effort | **Hours** | Weeks |
| Offline | Shell only | Full |
| Installer/signing pain | None | None |
| Backend needed | Yes (hosted) | No |
| Unlocks mobile/tablet | Partially | Fully |

## Verdict

**Do 4a immediately** as the baseline "computer app" answer. Track 4b as the
long-term architecture: it's the only option that removes the server entirely and turns
"desktop app" into "same bundle, any shell".
