# Review Findings — 2026-07-24 02:14 (+03:00)

Review of `plan/` (completeness), `apps/` (fidelity to the plan), and `docs/` (accuracy vs. the shipped
code). Read-only review at HEAD `f259651` (clean tree). Findings verified by direct code inspection;
plan/doc citations include file and line references.

**Verdict:** The code tracks the *newest* plan docs (M6 General Books, M7.1/M7.2 search, structured
refs, embeds, notes+Dropbox) closely — every planned endpoint, schema column, and UI feature claimed
as "DELIVERED" verifies against the code. The problems are concentrated in three places:

1. **Stale older plan docs** — `backend_design.md` / `frontend_design.md` describe an importer and
   frontend that no longer exist.
2. **A handful of real bugs and unimplemented safety requirements.**
3. **User docs that predate M7.2.**

---

## 1. Real bugs and missing safety requirements (act on these first)

1. **Versification misalignment is reported nowhere.** `plan/backend/backend_design.md:115` says
   "publication of a misaligned work is blocked with an actionable message." Reality: alignment diffs
   become *warnings* (`apps/importer/bibleimport/pipeline.py:391-399`), `Diagnostics.ok` ignores
   warnings (`validation.py:23-25`), and `build-all` **doesn't even print warnings on success**
   (`cli.py:157-160`). Verified live: KJV↔WEB genuinely differ (KJV-only: Acts 8:37, 15:34, 24:7,
   Luke 17:36, Rom 16:25-27; WEB-only: Rom 14:24-26) and the build swallows it silently. The required
   "deliberate versification-mismatch test that blocks publication" (`backend_design.md:136-137`) also
   doesn't exist.

2. **Mobile TOC breakpoint dead zone.** The single-pane layout switches at **720px**
   (`apps/web/src/App.tsx:19`) but the book TOC overlay/close-on-select CSS uses **640px**
   (`apps/web/src/styles/app.css:1091-1127`, `BookPane.tsx:93`). Between 641–720px you get the
   single-pane layout with a non-overlay TOC that doesn't close after selection.

3. **Importer hardening gaps** (required by `backend_design.md:117-118` and AGENTS.md
   "size/entropy limits"):
   - **No entropy limits anywhere** (zero matches for `entropy` in `apps/importer`).
   - **No size cap on the USFX source** (`usfx.py:232-244`) — every other adapter has one
     (64/128/256 MiB).
   - **No audit line per import** (checksum is stored in the DB but never logged/emitted).
   - **No diagnostics report artifact** — diagnostics are console-only; on `build-all` success they're
     not even printed.

4. **Deep-link chapter not range-validated.** `#/b/web/John/999` passes the parser
   (`state/deeplink.ts:64-67` integer-checks only) and fails at fetch time with a generic error.
   `plan/linking_and_embeds.md:22` explicitly requires "range-check book/chapter/verse … reject/clamp
   bad links, don't crash."

5. **Search `offset` uncapped.** `plan/search_workspace.md:259` requires capping offset;
   `apps/api/app/routers/search.py:34` has `ge=0` but no upper bound. All other knobs are capped.

6. **Stale local `data/content.sqlite`.** The gitignored local DB predates the M7.1/M7.2 schema
   commits — the current API orders by the new FTS columns, so anyone running the API against it gets
   errors until they rerun `bibleimport build-all`. Worth a note in the dev docs.

7. **Missing planned tests:** the read-only **concurrency test** (`backend_design.md:138`) doesn't
   exist anywhere; Playwright has no flow that clicks a cross-reference and lands on the verse; no
   words-of-Christ **bold** unit test; no UI-level i18n-switch test.

---

## 2. Does the code implement the plan correctly?

**Mostly yes.** Verified accurate: all 14 endpoints (incl. grouped `/search` with `total`/`has_more`,
filters, sort, 50-result pages, deterministic tie-breakers, bm25 headword/title weighting,
`/search/books` retired); WEB = 66 books / exactly 31,098 verses with red-letter + poetry; the
M7.1/M7.2 schema columns; 1,150 structured refs in the 1689 Confession; all five panes; notes with
tombstones/conflict copies/Dropbox PKCE; CSP; embed.js + scoped CORS; ETag/304 caching.

**Plan claims the code does *not* match (stale plan; code is usually the correct newer reality):**

| Plan claim | Reality |
|---|---|
| `backend_design.md:100` adapter protocol `probe/analyze/parse`; `formats/{osis,usfm,vpl,thml,sword}.py` | No protocol exists; adapters are plain `load_*` modules: `usfx.py`, `sword_bible.py`, `study.py`, `genbook.py` |
| `backend_design.md:93` runtime "WAL mode, opened `mode=ro&immutable=1`, one connection per worker" | Importer ships the DB in `journal_mode=DELETE` (`pipeline.py:158-160`); API opens `?mode=ro` only, one connection **per request** (`db.py:12-24`) |
| `backend_design.md:82-83` `Cache-Control: … immutable`; "SPA appends `?v=<checksum>`" | `immutable` only on hashed assets (`main.py:23`); API GETs get `max-age=86400` with no `immutable`; no `?v=` anywhere in the web client |
| `backend_design.md:72,79` `?verse=` and `?lang=` | Actual params are `?verses=` (single/range) and `?languages=` |
| `backend_design.md:53-54` CIR has `divineName, note, xref` inline nodes | Not modeled — deliberately deferred in `canonical.py:15-16` |
| `frontend_design.md:8,97` react-router; `/read?p1=web:John:3&p2=…` shareable layouts | No router installed; hash-only single-target links (`#/book/…`, `#/b/…`); **multi-pane shareable URLs are unimplemented** |
| `frontend_design.md:91-92` book names come from the API per work, independent of UI language | Client-side map follows the **interface language** (`i18n/bookNames.ts:41-47`), API name is only a fallback |
| `frontend_design.md:29-31` per-pane sync toggle; mobile "bottom segmented control, swipeable" | Sync is one global Settings checkbox; mobile switcher is a **top** tab bar, no swipe handling |
| `frontend_design.md:43-44,47` verse popover with commentary snippet + "open in commentary pane"; dictionary internal links | Neither exists — popover has only xrefs + add-note; Document CIR has no entry-link type |
| `frontend_design.md:67-68` search "highlights the verse" on open | Navigates to the chapter; verse is never highlighted. This requirement is **orphaned** — `search_workspace.md` doesn't carry it forward either |

**Implemented but in no plan doc:** `GET /api/v1/meta`, security-headers middleware, `UpdateNotice`
build-update detection (now partially in plan), `WorkFooter` attribution dialog, notes PDF export,
Dropbox auto-sync machinery, storage-usage indicator, default UI language = Bulgarian (English-only
content — undocumented product choice).

---

## 3. Are the docs accurate?

**Developer, deployment, licensing, and security docs verify cleanly** — quickstart commands, all 8
routers, adapter names (the docs, not the plan, have these right), systemd/Docker/Tunnel/backup/
monitoring details against the live runbook, CSP, the 6-work license matrix, zero broken links.

**Stale docs:**

1. `docs/user/search-and-lookup.md:16-19` — claims search is Bible-only and "Search scopes are not
   available yet." False since M7.2: type tabs/counts, testament filter, per-work source filter, sort
   toggle, 50-of-N pagination all exist. The same stale claim is echoed in `docs/plan.md:78`.
2. `docs/user/general-books.md:14-16` — says external embedding "is still planned." `embed.js` shipped
   and is documented in the sibling page.
3. `docs/developer/web-spa.md:48-58` — says Bible deep links are not implemented and must not be
   documented as such. `#/b/<work>/<osis>/<chapter>` is shipped (`deeplink.ts:38-68`) and already
   documented as shipped in `docs/user/embedding-scripture.md` — the two docs contradict each other.
4. `docs/plan.md:23-52` — the "delivered structure" omits `docs/user/embedding-scripture.md`.
5. Minor UI-label drift: "+ Add pane" (docs say "+ New pane"), "Add note for this verse",
   "Undo deletion", "Back up (JSON)", "Restore…", "Dropbox notes sync"; commentary pane has no
   prev/next arrows though `search-and-lookup.md` implies both pane types do.
6. Undocumented in `docs/`: light/dark theme toggle + font-size slider (absent from
   `reading-modes.md`), `UpdateNotice`, in-app attribution footer, CORS-open read API, and the
   `deploy.yml` GHCR workflow.

**Also stale outside `docs/`:** `scripts/dev.sh` is still a fully commented-out M0 stub despite README
listing it; `deploy/docker-compose.yml:7` comment says Caddy fronts it (production uses the Cloudflare
Tunnel); `apps/importer/README.md` still says "Status (M6)".

---

## 4. Gaps in the plan itself

1. **The orphaned verse-highlight requirement** (§2 above) — no current document owns it.
2. **Linking plan §1 remainder has no milestone** — multi-pane layout URLs, the final URL scheme
   decision, and pane-count validation are "planned" with open questions and no delivery step.
3. **No load/concurrency verification** anywhere, despite the ≥100-concurrent-users claim being
   load-bearing for the architecture (read-only SQLite, free-tier hosting).
4. **`bible_reading_software_plan.md` describes the abandoned architecture** (Postgres, admin UI,
   server-side imports, Render managed DB) — `00_system_design.md:9-10` flags it as a process playbook,
   but its milestone sequence (Milestone 1–6) fully contradicts the actual M0–M8 and is a confusion
   trap for anyone (or any agent) reading the folder.
5. **Open-source release has three pending decisions** (LICENSE choice, KJV redistribution, runbook
   scrub) — and `plan/deployment/live-runbook.md` still contains the origin IP/SSH user that must be
   purged from git **history** before going public. That's currently the only hard blocker on the
   "Next" roadmap item.
6. **No language-filter UI** for search — the API accepts `languages=` and
   `search_workspace.md:129-131` mentions exposing it, but no milestone owns the UI (moot while v1 is
   English-only; worth explicitly deferring).
7. **M7.3/M7.4** (workspace drawer, refine, history) are legitimately planned-not-built; `refine=` is
   already in the §7 contract example but absent from API/client — fine, just note the contract
   example is aspirational.

---

## Suggested priority order

1. Fix the two real bugs: **breakpoint mismatch** and **silent versification warnings** (print the
   diff report in `build-all`, decide whether KJV's known deltas get an explicit allow-list, add the
   blocking test).
2. Importer safety: USFX size cap, entropy check, audit line, write the diagnostics report file.
3. Refresh `backend_design.md` §2/§4–§7 and `frontend_design.md` §1/§5/§7/§8 to match reality (or mark
   superseded sections); add a deprecation banner to `bible_reading_software_plan.md`.
4. Update the three stale user/dev doc pages + `docs/plan.md`; document theme/font-size and the update
   notice.
5. Add the missing tests (concurrency, xref-click e2e, woc-bold).
6. Before open-sourcing: resolve the three pending decisions and scrub the runbook from history.
