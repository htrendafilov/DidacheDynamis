# Remediation Plan — Review Findings 2026-07-24

Status: **implemented on `fix/review-remediations` (2026-07-24)**. Source:
[`reviews/review_findings_2026-07-24_02-14.md`](../reviews/review_findings_2026-07-24_02-14.md)
(reviewed at HEAD `f259651`). Key concrete claims were re-verified by code inspection before triage
(breakpoint 720≠640, uncapped `offset`, USFX has no size cap, versification diffs are swallowed on a
successful `build-all`) — all confirmed. This plan buckets the **relevant** findings into fix groups
R1–R6 and records what is **not relevant** (stale plan vs. correct newer code) at the end.

Guiding call: the app tracks the *newest* plan docs closely; most Section-2 "mismatches" are **stale
plan text**, not code bugs — those are fixed by editing the plan, not the code.

One review claim is already false at its stated `f259651` snapshot: API responses do **not** use a
24-hour browser TTL. They use `Cache-Control: public, max-age=0, must-revalidate`; only fingerprinted
Vite assets are immutable. Do not undo the cache-remediation work.

---

## R1 — Real bugs (small, high-value; do first)

1. **Mobile breakpoint dead zone (641–720px).** `useIsNarrow()` switches the single-pane layout at
   `720px` (`apps/web/src/App.tsx:19`) but the book-TOC overlay + close-on-select use `640px`
   (`apps/web/src/styles/app.css:1091`, `BookPane.tsx:93`). Between 641–720 you get single-pane with a
   non-overlay TOC that never closes.
   **Fix:** one shared breakpoint. Export a `MOBILE_MAX_WIDTH = 720` constant, use it in `useIsNarrow`
   and `BookPane`'s `matchMedia`, and change the CSS `@media (max-width: 640px)` block to `720px`.
   CSS cannot import the TypeScript constant, so keep a cross-reference comment beside the CSS value.
   Extend the mobile Playwright flow with a viewport around `680–700px`; a unit test alone cannot
   verify the overlay CSS.

2. **Search `offset` uncapped.** `apps/api/app/routers/search.py:34` has `ge=0` but no upper bound
   (`plan/search_workspace.md` requires capping every knob).
   **Fix:** `Query(0, ge=0, le=100000)`. A 10,000 cap could make real matches unreachable and would
   regress M7.1's “every result is reachable” guarantee; 100,000 covers the current maximum
   single-provider corpus while rejecting pathological values. Add boundary tests, including the
   FastAPI validation response (`422`) above the cap. Revisit cursor pagination if a provider grows
   beyond this ceiling.

3. **Bible deep-link chapter not range-validated.** `#/b/web/John/999` parses (`state/deeplink.ts`
   integer-checks only) and fails at fetch with a generic error; `plan/linking_and_embeds.md:22`
   requires range-checking/clamping.
   **Fix:** in `App.tsx`'s deep-link apply, validate the chapter against the loaded book list
   (`/works/{id}/books` `chapter_count`) before `openPassage`. Reject unknown books and out-of-range
   chapters, remove the invalid hash with `history.replaceState`, and show a localized, dismissible
   “invalid Bible link” message. Silently leaving the reader on its previously persisted passage is
   confusing and is the failure mode that prompted this review. Add parser tests plus an App-level
   valid/invalid-link test.

4. **Local DB schema compatibility.** The gitignored `data/content.sqlite` can predate the M7 FTS
   columns and currently fails only when a query reaches missing columns.
   **Fix:** define one schema-version constant, write it through SQLite `PRAGMA user_version` in the
   importer, and check it in API readiness/startup. `/ready` returns `503` with an actionable
   `schema-outdated` result instead of allowing later opaque SQL errors. Add current/old-version
   tests and a developer note with the exact `bibleimport build-all` rebuild command. This changes
   importer output and therefore requires a production DB rebuild when deployed.

## R2 — Importer safety parity (required by `backend_design.md:117-118` / AGENTS.md)

1. **USFX source size and ZIP-expansion caps.** `formats/usfx.py:242` does a bare `read_bytes()` and
   `ZipFile.read()`; every other adapter has a byte ceiling. **Fix:** cap the ZIP container, inspect
   `ZipInfo.file_size` before extraction, cap the expanded XML bytes while reading, and reject an
   excessive compression ratio. Apply the same expanded-byte cap to raw XML. Tests cover oversized
   raw XML, an oversized declared ZIP member, and a high-ratio ZIP bomb without allocating the full
   payload.
2. **Diagnostics visibility.** `build-all` only prints diagnostics on failure (`cli.py:157-160`), so
   versification warnings vanish on success (see R3). **Fix:** aggregate every build step's
   diagnostics and always print warnings plus a concise stats/audit summary.
3. **Per-import audit line.** Emit a stable structured line containing work ID, source filename,
   source byte count, SHA-256, imported counts and result. Avoid leaking arbitrary absolute operator
   paths. The checksum is already stored in the DB; this surfaces it for review and CI logs.
4. **Diagnostics report artifact.** Add `--report <path>`, defaulting to
   `<out>.diagnostics.json`, and write it atomically on both success and validation failure. Include
   source versions/checksums, statistics, expected and unexpected alignment deltas, warnings and
   errors. This is a required build artifact, not an optional future enhancement.
5. **Entropy requirement — replace it with enforceable bounds.** Imported files remain **untrusted**
   under AGENTS.md even when owner-supplied; do not weaken that threat model. A generic Shannon-entropy
   threshold would reject normal compressed inputs without reliably detecting hostile ones. Replace
   the vague “entropy limits” wording in AGENTS.md / `backend_design.md` with compressed/expanded byte
   ceilings, compression-ratio limits, bounded entry counts/depth where applicable, safe XML parsing,
   and no shell interpolation.

## R3 — Versification: explicit expected deltas, unexpected deltas block

`backend_design.md:115` claims "publication of a misaligned work is blocked." That is **wrong for this
data**: KJV↔WEB legitimately differ (KJV-only Acts 8:37 / 15:34 / 24:7 / Luke 17:36 / Rom 16:25-27;
WEB-only Rom 14:24-26 — textual-variant verses omitted in modern critical texts). Blocking would reject
correct data if every difference were treated identically. Silently allowing every future difference
would be equally unsafe, especially for the later Bulgarian source.

**Approved policy (implemented after owner approval):**

1. Record expected alignment deltas per imported Bible specification, tied to the reviewed source
   version/checksum. The current WEB/KJV differences become an explicit reviewed allow-list and remain
   visible in the diagnostics report.
2. Compute alignment before writing the appended work. Expected deltas are warnings; any undeclared
   delta is an error and the work is not written.
3. New sources, including a future Bulgarian Bible, begin with an empty allow-list. The owner reviews
   the generated diff before deliberately accepting any exception.
4. Add tests for exact alignment, expected/reported deltas, unexpected blocking deltas, and the
   guarantee that a blocked append leaves the existing DB unchanged.

The implementation follows this expected-delta policy; it does not use either blanket alternative.

## R4 — Missing tests (plan-required)

1. **Read-only concurrency verification** (`backend_design.md:138` and the ≥100-concurrent claim) —
   split this into (a) a deterministic integration test issuing simultaneous reads against the fixture
   DB to catch connection/thread-safety failures, and (b) a repeatable local/VM load-smoke command at
   100 concurrent clients with recorded latency/error-rate criteria. Do not make a timing-sensitive
   100-client benchmark a required unit test.
2. **Words-of-Christ `bold`** render unit test (only `off`/`red` covered today).
3. **UI i18n-switch** test (EN↔BG toggle updates visible chrome).
4. **Playwright cross-reference navigation:** extend the existing popover test to click a reference
   and confirm the destination Bible work/chapter and target verse text. Exact scrolling/highlighting
   requires the R6.1 product feature and is not merely a missing test. Keep e2e runs manual per the
   existing decision.

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
  workflow. Document Bulgarian as the default interface language while the shipped content remains
  English-only. Fix UI-label drift ("+ New pane" → "+ Add pane", etc.) and the commentary-pane
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
  Cloudflare Tunnel now), and `scripts/dev.sh` (still a commented-out M0 stub) — refresh them.
  `scripts/dev.sh` is linked from the README, so make it functional rather than removing it.
- Document the R1.4 schema-version error and the exact local rebuild procedure.

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
   the only hard blocker on the "Next" roadmap item. History rewriting is a separate, destructive
   owner-approved maintenance operation; it is not part of the ordinary remediation PRs.

---

## Not relevant / won't-do (stale plan, code is the correct newer reality)

These Section-2 items are **not bugs** — they are fixed by the R5 plan-doc edits, not by changing code:
adapter `probe/analyze/parse` protocol, `immutable=1`, `?verse=`/`?lang=` param names, react-router,
per-work API book names, `divineName/note/xref` CIR nodes. `immutable=1` on the read connection is a
possible micro-optimization but is intentionally **out of scope** (per-request `?mode=ro` is correct and
safe with the atomic-swap deploy). The review's 24-hour API-cache claim is also not relevant; it was
already false at the reviewed commit. M7.3/M7.4 and the language-filter UI remain legitimate deferred
roadmap work, not remediation defects.

## Completion record

- R1–R5 are implemented with unit/integration/Playwright coverage and refreshed docs/tooling.
- R6.1 is assigned to M7.3; R6.2 is explicitly deferred until after M8; language UI and `refine=`
  remain documented M7 follow-ups; load verification is implemented and recorded.
- The destructive open-source history cleanup remains separate and was not attempted.
- Deployment still requires a current-schema DB rebuild and deliberate atomic/manual rollout; source
  changes alone do not alter the live service.
