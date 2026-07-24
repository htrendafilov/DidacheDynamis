# Remediation Plan — Review Findings 2026-07-24

Status: **proposed**. Source: [`reviews/review_findings_2026-07-24_02-14.md`](../reviews/review_findings_2026-07-24_02-14.md)
(reviewed at HEAD `f259651`). Key concrete claims were re-verified by code inspection before triage
(breakpoint 720≠640, uncapped `offset`, USFX has no size cap, versification diffs are swallowed on a
successful `build-all`) — all confirmed. This plan buckets the **relevant** findings into fix groups
R1–R6 and records what is **not relevant** (stale plan vs. correct newer code) at the end.

Guiding call: the app tracks the *newest* plan docs closely; most Section-2 "mismatches" are **stale
plan text**, not code bugs — those are fixed by editing the plan, not the code.

---

## R1 — Real bugs (small, high-value; do first)

1. **Mobile breakpoint dead zone (641–720px).** `useIsNarrow()` switches the single-pane layout at
   `720px` (`apps/web/src/App.tsx:19`) but the book-TOC overlay + close-on-select use `640px`
   (`apps/web/src/styles/app.css:1091`, `BookPane.tsx:93`). Between 641–720 you get single-pane with a
   non-overlay TOC that never closes.
   **Fix:** one shared breakpoint. Export a `MOBILE_MAX_WIDTH = 720` constant, use it in `useIsNarrow`
   and `BookPane`'s `matchMedia`, and change the CSS `@media (max-width: 640px)` block to `720px`.
   Add/adjust an a11y or unit assertion at ~700px.

2. **Search `offset` uncapped.** `apps/api/app/routers/search.py:34` has `ge=0` but no upper bound
   (`plan/search_workspace.md` requires capping every knob).
   **Fix:** `Query(0, ge=0, le=10000)` (or similar). One-line + a 400 test.

3. **Bible deep-link chapter not range-validated.** `#/b/web/John/999` parses (`state/deeplink.ts`
   integer-checks only) and fails at fetch with a generic error; `plan/linking_and_embeds.md:22`
   requires range-checking/clamping.
   **Fix:** in `App.tsx`'s deep-link apply, validate the chapter against the loaded book list
   (`/works/{id}/books` chapter_count) before `openPassage`; ignore out-of-range links (same pattern
   already used to ignore unknown work ids). Low severity but closes the plan requirement.

## R2 — Importer safety parity (required by `backend_design.md:117-118` / AGENTS.md)

1. **USFX source size cap.** `formats/usfx.py:242` does a bare `read_bytes()`; every other adapter uses
   a MiB ceiling. **Fix:** reuse the `_read_limited(path, limit)` pattern (e.g. 128 MiB) before parsing;
   applies to the ZIP path too (cap the extracted member).
2. **Diagnostics visibility.** `build-all` only prints diagnostics on failure (`cli.py:157-160`), so
   versification warnings vanish on success (see R3). **Fix:** always print `diag.warnings` (and a
   one-line stats/audit summary incl. the source checksum) after each successful step.
3. **Per-import audit line.** Emit `work_id, source path, sha256, verse/section count` to stdout on each
   import (checksum is already computed and stored — just surface it).
4. **Diagnostics report artifact (optional).** Add `--report <path>` to write the full diff/warnings as
   JSON, for the owner to review when importing a new Bulgarian text later.
5. **Entropy limit — revise the requirement, don't implement.** The importer only ingests
   owner-supplied, trusted public-domain files; an entropy heuristic adds complexity with little value.
   **Action:** delete the "entropy limits" line from AGENTS.md / `backend_design.md` and keep the real
   guards (size caps, DTD/entity/external disabled, no shell) that already exist.

## R3 — Versification: visibility, not blocking

`backend_design.md:115` claims "publication of a misaligned work is blocked." That is **wrong for this
data**: KJV↔WEB legitimately differ (KJV-only Acts 8:37 / 15:34 / 24:7 / Luke 17:36 / Rom 16:25-27;
WEB-only Rom 14:24-26 — textual-variant verses omitted in modern critical texts). Blocking would reject
correct data.
**Fix:** (a) surface the alignment diff on every build (R2.2) instead of blocking; (b) rewrite
`backend_design.md:115,136-137` to require **reporting** the diff (not blocking) and to record the
known WEB/KJV deltas as *expected*; (c) add an importer test asserting the diff is **reported** for a
deliberately-misaligned fixture (replaces the never-written "blocking" test).

## R4 — Missing tests (plan-required)

1. **Read-only concurrency test** (`backend_design.md:138`, and the ≥100-concurrent claim, §4.3 of
   remediation) — many parallel reads against the fixture DB; assert no errors and stable responses.
2. **Words-of-Christ `bold`** render unit test (only `off`/`red` covered today).
3. **UI i18n-switch** test (EN↔BG toggle updates visible chrome).
4. **Playwright: click a cross-reference → land on the verse** (currently no e2e for that flow).
   (Keep e2e runs manual, per the existing decision.)

## R5 — Documentation refresh (accuracy)

**Stale user/dev docs (`docs/`):**
- `docs/user/search-and-lookup.md:16-19` + `docs/plan.md:78` — remove "Bible-only / scopes not available
  yet"; document M7.2 (type tabs+counts, testament + source filters, sort toggle, 50-of-N pagination).
- `docs/user/general-books.md:14-16` — external embedding **shipped** (`embed.js`), not "planned".
- `docs/developer/web-spa.md:48-58` — Bible deep links (`#/b/<work>/<osis>/<chapter>`) are **shipped**;
  reconcile with `docs/user/embedding-scripture.md` (they currently contradict).
- `docs/plan.md:23-52` — add `docs/user/embedding-scripture.md` to the delivered structure.
- Document the undocumented shipped features: light/dark theme + font-size slider (`reading-modes.md`),
  `UpdateNotice`, the in-app attribution footer, the CORS-open read API, and the `deploy.yml` GHCR
  workflow. Fix UI-label drift ("+ New pane" → "+ Add pane", etc.) and the commentary-pane
  "prev/next arrows" implication.

**Stale plan docs (biggest accuracy gap):**
- `backend/backend_design.md` — §2 adapter protocol (`probe/analyze/parse`, `formats/{osis,usfm,vpl,
  thml,sword}.py`) never existed; §3 `mode=ro&immutable=1` / per-worker / `journal_mode` and §4 params
  (`?verse=`/`?lang=` → `?verses=`/`?languages=`), §5 CIR inline `divineName/note/xref` deferred. Update
  to the real `load_*` adapters, per-request `?mode=ro` connection, and current params, or mark the
  superseded sections.
- `frontend/frontend_design.md` — §1 react-router + `/read?p1=…` multi-pane URLs (not built), §5 book
  names follow UI language (not per-work API), §3 per-pane sync (it's one global toggle) + mobile
  "swipeable bottom segmented control" (it's a top tab bar), §7 verse popover commentary snippet /
  dictionary internal links / "highlights the verse" (none built). Update to reality or mark superseded.
- `bible_reading_software_plan.md` — add a **deprecation banner**: it describes the abandoned
  Postgres/admin-UI/server-import architecture and a Milestone 1–6 that contradicts the real M0–M8.
- `apps/importer/README.md` "Status (M6)", `deploy/docker-compose.yml:7` Caddy comment (it's the
  Cloudflare Tunnel now), and `scripts/dev.sh` (still a commented-out M0 stub) — refresh or remove.
- **Dev note:** a local gitignored `data/content.sqlite` from before M7.1/M7.2 will error against the
  current API (orders by new FTS columns) — add "rerun `bibleimport build-all` after pulling schema
  changes" to the developer setup docs.

## R6 — Plan gaps / product decisions (decide, then schedule)

1. **Orphaned "highlight the verse on search open"** — no doc owns it. Decision: fold into M7.3 (open a
   Bible pane *and* scroll/mark the verse) or explicitly drop. Recommend: keep as a small M7.3 item.
2. **Linking §1 remainder** (multi-pane shareable URLs, final URL scheme, pane-count validation) — give
   it a real milestone in `linking_and_embeds.md` or explicitly defer; today it's "planned" with open
   questions and no delivery step.
3. **Load/concurrency verification** — the ≥100-concurrent claim is architecturally load-bearing; add
   R4.1 plus a short note in `deployment_design.md` on the measured/expected ceiling.
4. **Language-filter UI** — API accepts `languages=`; UI deferred (moot while content is English-only).
   Mark explicitly deferred in `search_workspace.md`.
5. **`refine=`** appears in the §7 contract example but is M7.4 (not built) — annotate the example as
   aspirational.
6. **Open-source blocker** (unchanged, already in `open_source_release.md`): purge the origin IP / SSH
   user from `live-runbook.md` **git history** + LICENSE choice + KJV redistribution decision. This is
   the only hard blocker on the "Next" roadmap item.

---

## Not relevant / won't-do (stale plan, code is the correct newer reality)

These Section-2 items are **not bugs** — they are fixed by the R5 plan-doc edits, not by changing code:
adapter `probe/analyze/parse` protocol, `immutable=1`, `?verse=`/`?lang=` param names, react-router,
per-work API book names, `divineName/note/xref` CIR nodes. `immutable=1` on the read connection is a
possible micro-optimization but is intentionally **out of scope** (per-request `?mode=ro` is correct and
safe with the atomic-swap deploy).

## Suggested order
R1 (bugs) → R2 (importer safety) + R3 (versification) in one importer pass + rebuild → R4 (tests) →
R5 (docs) → R6 (decisions). R1–R4 touch code (need a `content.sqlite` rebuild only if importer output
changes — R2/R3 don't change the schema, so no rebuild needed for those).
