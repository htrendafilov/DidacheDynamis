# Plan: Going public — release as **DidacheDynamis**

**Status:** in execution. **Audit snapshot:** 2026-08-01, `main` at `3206aba` plus the `cleanup`
branch (merged as PR #30, `cc25716`). **Goal:** publish the project without exposing credentials,
private infrastructure details, non-redistributable content, or misleading historical plans.

**Decisions recorded 2026-08-01 (owner-approved):** clean-public-repo strategy (§0 path 2);
code license **MIT**; **KJV dropped** from the public source set (fetched at build instead; its
presence in the built database and image was settled separately — decision 11, resolved 2026-08-06);
live runbook stays **private/untracked**; `render.yaml` and the GitHub uptime workflow are
**deleted**; UptimeRobot is the sole uptime monitor; `uv.lock` is **ignored**.
New public repo: **`htrendafilov/DidacheDynamis`** — created 2026-08-01 as **private**; it flips
to public only after the §6 gate passes (§7). The app renames to **DidacheDynamis** (§4.4).
`bible_app_bg` remains the private operational archive.

This supersedes the deleted `plan/open_source_release.md`. It deliberately does not record the
literal private values that must be removed; keep the replacement map outside the repository.

## 0. Release strategy decision — RESOLVED 2026-08-01

The original goal was to flip `htrendafilov/bible_app_bg` from private to public after rewriting its
history. That preserves issues and pull requests, but it cannot promise that every old value becomes
unreachable: GitHub documents that rewritten commits can remain reachable through pull-request refs
and cached views, and GitHub Support generally purges only data it judges sensitive. See GitHub's
[sensitive-data removal guidance](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).

**Chosen: path 2 — clean public repository.** `htrendafilov/bible_app_bg` stays private as the
operational archive; only sanitized history is pushed to the new **`htrendafilov/DidacheDynamis`**
repository (created private 2026-08-01; flipped to public at §7 after the §6 gate). This is the
only path that guarantees the old origin/operator metadata is unreachable, and it sidesteps the
read-only `refs/pull/*` residue of the 27 PRs in this repository. Path 1 (rewrite in place) is
recorded here only for context.

Note: the clean-repo path eliminates the PR-ref residue, **not** the rewrite — §5 still runs in
full against a disposable mirror before anything is pushed.

## 1. Audit findings

### 1.1 No credential exposure found in the current audit

- Only example environment files with placeholder values are tracked; `.env` is ignored.
- No private keys or live API tokens were found in the tree/history searches performed for this
  audit. OpenRouter-looking values are placeholders or test sentinels.
- GitHub Actions references secret names, not values. The currently configured repository secret is
  `DROPBOX_APP_KEY`; it remains private when repository visibility changes.
- The Dropbox PKCE client id is public by design, but it should still be configured through the
  build environment rather than hard-coded.
- `data/content.sqlite`, diagnostics, private source naming patterns, and the local release driver
  are ignored.

This is not the final secret-scan sign-off. Run a dedicated scanner across the rewritten mirror and
inspect its findings before publication.

### 1.2 Private metadata to remove from the tree and history

| Item | Current locations | Required treatment |
|---|---|---|
| Origin IP | live deployment runbook | Remove the runbook from every published ref/history; keep the literal value only in the external replacement map. |
| Operator username and home path | live runbook and two generic deployment docs | Remove the runbook; rewrite generic docs to `deploy` and `/opt/bible-app`; replace historical occurrences. |
| Former employer registry hostname | old `apps/web/package-lock.json` blobs | Replace with the public npm registry throughout published history. |
| Tunnel id fragment, co-tenant service, local password-store entry names | live runbook | Remove the runbook from published history rather than trying to sanitize it into a public operations guide. |
| Commit author address at the employer domain | 180 of 234 reachable commits (re-measured 2026-08-12; was 152 of 193 on 2026-08-01) | **Decision 8: rewrite** to `hristo@trendafilovi.eu` in the §5 pass. 27 commits already use that address and 27 use a Yahoo one. |

The current repository contains infrastructure metadata, not a proven live credential. If a later
scan finds a real credential, revoke/rotate it before doing anything else.

### 1.3 Local-only material

- `.claude/` and `.ua/` are now ignored on `main` (landed via PR #30); neither belongs in the
  public repository.
- `apps/api/uv.lock` and `apps/importer/uv.lock` are untracked. The repository, CI, and Docker build
  currently use `pip`. **Resolved 2026-08-01: ignore `uv.lock`** until `uv` becomes the documented
  install path; committing two unused lock systems would imply reproducibility the build does not
  actually consume.
- Before release, start from a fresh clone or a clean worktree. Do not use the current working tree as
  the history-rewrite input.

### 1.4 GitHub-hosted material also becomes public

Changing visibility exposes more than git objects. GitHub explicitly states that Actions history and
logs become public and that all push rulesets are disabled during a private-to-public change; review
the current [visibility-change consequences](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility).

**Audited 2026-08-10 — and most of this list turns out to be moot.** It was written for §0's
path 1, flipping *this* repository to public. Path 2 was chosen instead: `bible_app_bg` stays
private permanently as the operational archive, and only sanitized history is pushed to a fresh
`DidacheDynamis` that starts with no pull requests, issues, runs or artifacts. So none of the
GitHub-hosted material below ever becomes public, and auditing 384 run logs for operator metadata
would have been work done against a risk the strategy already removed. Recorded rather than
deleted, because it is exactly what would be required if the strategy ever reverted to path 1.

**"Starts with" is the operative word.** None of this archive's history transfers, but the new
repository begins accruing its own the moment it is written to: `ci.yml` runs on `push` to `main`,
so pushing the sanitized mirror (§7.2) creates a workflow run there, and *that* run's logs are
public after the flip. The §6 gate therefore applies to the new repository's own runs, not to this
one's. Either review that first run's logs before flipping visibility, or disable Actions on
`DidacheDynamis` for the initial push and re-enable once the tree is verified.

Inventory at the 2026-08-10 audit, for the archive record:

- 41 pull requests and 2 issues, including bodies, comments, reviews, attachments, and referenced
  commit SHAs — **stay private with this repository**;
- 384 workflow runs — **stay private**; under path 1 the instruction was to delete any run whose
  logs reveal private paths, hostnames, runner details, or other operator metadata;
- 2 retained Docker build-record artifacts (44.5 KiB total) — **stay private**;
- repository variables (0), environments (0), deployments (none), releases (none), GitHub Pages
  (not configured), webhooks (none), wiki (disabled) — nothing to audit;
- Actions secrets: **1**, `DROPBOX_APP_KEY`. It does not transfer: the new repository needs its own
  copy before `publish-image.yml` can build there;
- ~~remote branches. Eleven merged topic branches are still advertised in addition to `main`; delete
  obsolete branches before the rewrite and ensure no stale branch can reintroduce old history;~~
  **Done 2026-08-05.** Only `main` remains, locally and on the remote. The last five were checked
  against `main` by content rather than by commit SHA — every one had landed through a squash, so
  none of their commits was an ancestor of `main` and a SHA test would have called them all
  unmerged. Each added line was confirmed present in `main` or deliberately superseded (schema
  version 3 → 4, the three-value `ai_context_policy` union → four, `m9.0b-bulgarian-benchmark.md`
  split into `m9.0b-1`/`m9.0b-2`, and a `.gitignore` comment rewritten by this very cleanup). Their
  tip SHAs are recorded in the release issue in case anything needs recovering before gc;
- **GHCR package — the one item path 2 does *not* neutralise.** Package visibility is managed
  separately from repository visibility, so a private repo does not imply a private package. An
  image **was published and may still exist**: run `30153760051` (2026-07-25) shows `Build and push
  image` succeeding before the run failed at `Deploy to VM`, so `ghcr.io/htrendafilov/bible_app_bg`
  received a full `content.sqlite` — every imported text, including the KJV (decision 11) — under
  the pre-rename name. Whether it is *still* there, and whether it is public, is **not established**:
  the audit token lacked `read:packages`, and an unauthenticated pull returns 401 either way, which
  cannot distinguish a private package from a deleted one. Before §7, check with a `read:packages`
  token and then delete it or confirm it is private. Note the two historical runs are both marked *failure* while one of them
  published successfully — the misleading signal §4.3 has since fixed by splitting the jobs.

GitHub supports deleting completed workflow runs. Keep an audit note listing which runs/artifacts
were retained or removed rather than assuming secret masking made every log safe.

## 2. Repository cleanup

### 2.1 Removed (landed on `main` via PR #30)

These files were complete, superseded, or misleading. Git history remains the archive while the
private repository exists; they do not need a second in-tree `archive/` copy.

| Removed file | Reason |
|---|---|
| `reviews/review_findings_2026-07-24_02-14.md` | Point-in-time findings; its fixes shipped. |
| `plan/review_remediation_2026-07-24.md` | Fully implemented remediation checklist. |
| `plan/open_source_release.md` | Superseded by this re-audited plan. |
| `plan/bible_reading_software_plan.md` | Deprecated 42 KiB proposal for the abandoned Render/Postgres/admin architecture. |
| `docs/plan.md` | Completed documentation-generation plan whose roadmap language was stale. |
| `data/sources/.gitkeep` | Redundant in a populated directory. |

Inbound links in `README.md` and `plan/00_system_design.md` were updated in the same PR, which also
delivered the README M9 status, the Render-wording scrub in the Dropbox section, and the "Next:
prepare the repository for public release" line.

### 2.2 Keep in the repository

- The current system, backend, frontend, deployment, content/licensing, General Books, search,
  linking/embed, and Easton-reference designs remain useful descriptions or decision records.
- `plan/interactive_chat_plan.md` remains active: M9.0, M9.0b-1, and M9.1–M9.3d shipped, but
  M9.0b-2, M9.4, and M9.5 remain. The chat briefs and benchmark corpus/results retain safety,
  privacy, token-budget, and model-selection evidence; archive them together only after M9 closes
  and code comments are updated.
- `plan/search_workspace.md` still owns the shipped search and Strong's design. Its two concept images
  are linked, so they are not orphaned data.
- User-guide screenshots are linked from the guide and reproducible via
  `scripts/capture_real_docs_screenshots.js`. Re-capture them when the public UI changes; do not
  delete them merely because they are binaries.
- `ideas/` is clearly future-facing and can remain public after a content review.
- `plan/mhc_translation/` — **excluded from the public tree (owner, 2026-08-10).** The Bulgarian
  Matthew Henry translation is a separate project; only its finished result is intended to reach
  the new repository, not its planning history. Nothing here excludes it automatically: the
  sanitized tree carries whatever is tracked, so this has to be an explicit path removal in the
  §5 `git-filter-repo` invocation, and it must be re-checked at §6 rather than assumed. Note the
  directory is untracked today, so if it is never committed the removal is a no-op — which is the
  cheapest way to honour this decision.

### 2.3 Source-data disposition

After removing the tracked KJV export, no other committed source-data file is presently a safe stale
deletion other than `.gitkeep`:

- eight committed active compressed/TSV inputs are consumed by `bibleimport build-all`; the ninth
  (`KJV.imp.gz`) is generated locally by the checksum-pinned CrossWire fetch step;
- the original English 1689 export is the immutable provenance base for the reviewed edition;
- the uncompressed Bulgarian 1689 IMP drives the revision, SWORD-package, and benchmark scripts;
- the JSON metadata and correction record provide required rights/provenance evidence.

A later addition will change these numbers: `plan/mhc_translation/07_master_plan.md` §M3 adds an
LFS rule for `data/sources/mhc_bg/books/*.jsonl.gz`, and the translated book packages that follow
land as new LFS objects. The rule alone costs nothing — no objects exist until that project's M5/M6
— but the budget and alert set below are calibrated against today's set and will need revisiting
before those packages are committed.

The remaining committed source directory is about 24 MiB and nine inputs use Git LFS. Public forks and downloads count
against the repository owner's LFS bandwidth, so set a budget/alert and reconsider release assets or
external immutable source hosting if usage grows. GitHub's current
[LFS billing documentation](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-git-large-file-storage/upgrading-git-large-file-storage)
records a 10 GiB monthly bandwidth allowance for GitHub Free/Pro and charges downloads to the owner.

## 3. Licensing and public-project files

**Resolved 2026-08-01:** code license is **MIT**; **KJV is dropped** from the committed public source
set and fetched only while building (option "remove" in item 3 below).

1. Add a root code `LICENSE` (**MIT**). State explicitly that it covers code and original
   documentation, not third-party content.
2. ~~Add `NOTICE` plus a `LICENSES/README.md` (and full applicable license texts) that maps every
   file in `data/sources/` to its source, version, rights holder, redistribution terms, attribution,
   and modification status.~~ **Done.** Root `NOTICE` covers every committed source, the
   build-fetched KJV, and the original assets (logo, screenshots); `LICENSES/` carries the verbatim
   CC BY 4.0 and CC0 1.0 texts. `NOTICE` is written against the *distribution surfaces* — repository
   versus built database/image — because they do not carry the same set of works. Kept aligned with
   `data/sources/README.md`, the `works` rows written by `apps/importer/bibleimport`, and
   `docs/extra/content-and-licensing.md`; re-check all four together whenever a source changes.
   "Aligned" is exact for the **attribution** strings — `NOTICE` quotes what actually ships — and
   substantive but not verbatim for the **license** fields, where `works.license` carries a short UI
   label and `NOTICE` spells out the basis. Writing this record surfaced one real divergence: the
   WEB attribution in `works` had dropped eBible's middle sentence, so the app showed a trademark
   notice with no rights grant. Fixed in `WEB_SPEC.attribution`, not papered over in `NOTICE`.
3. **KJV (partly resolved): remove `KJV.imp.gz` from the public source set and fetch it from
   CrossWire at build time** (pinned URL + checksum), rather than redistributing it in-repo.
   CrossWire's current module page records Crown rights on the base text, broad use of the KJV2003
   project text, and a `GPL` module-distribution label. Implemented by `scripts/fetch-kjv.sh`, the
   ignored `SOURCE_FILES["kjv"]` build input, the Docker/CI build path, and the in-app KJV
   attribution. The clean `DidacheDynamis` history must never contain `data/sources/KJV.imp.gz`,
   even while the target repository is still private.

   **What this does not settle — settled instead by decision 11 (§8).** Removing the export from git
   removes it from *git*, not from what the project distributes. `deploy/Dockerfile` fetches the
   module, compiles all 31,102 verses into `content.sqlite`, and copies that database into the
   runtime image; `publish-image.yml` pushes the image to GHCR, whose visibility §7.5 sets deliberately.
   The converted KJV text therefore ships inside the published image and is served by the live
   site. An earlier draft of this section claimed removal "sidesteps the redistribution question
   entirely" — it does so for the repository only. **Resolved 2026-08-06 by decision 11:** the KJV
   ships in the built database, the GHCR image, and the live site, on the basis that CrossWire
   grants use of the KJV2003 text for any purpose and that the Crown's rights are UK-territorial.
   `NOTICE` §3 records the upstream terms and the decision. The rejected alternative — excluding the
   KJV from the distributable artifacts via a build flag — stays available as a fallback, and is
   cheap because the fetch step is isolated in one script.
   See the [official CrossWire module record](https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=KJV)
   and [CrossWire's KJV licensing notes](https://wiki.crosswire.org/CrossWire_KJV).
4. Preserve the WEB trademark wording and TSK CC BY 4.0 attribution in both repository and UI.
5. ~~Update the contributing guide with the selected inbound contribution terms.~~
   **Done** (decision 9): MIT for code, CC0 for content, plus a provenance requirement for text. ~~Add root
   `SECURITY.md`~~ **done**: private vulnerability reporting via the GitHub Security tab rather than
   a published email address, so no personal contact detail is committed. It states the supported
   versions and, in scope, that provider-side issues belong to the provider because the assistant
   calls it directly from the browser. Add a code of conduct only if the maintainer is prepared to
   enforce it.

## 4. Tree and documentation changes before release

### 4.1 Private operations material

- Untrack `plan/deployment/live-runbook.md`, add it to `.gitignore`, and add a short tracked
  `plan/deployment/README.md` explaining that the live operator runbook is intentionally private.
- Replace the real operator account/path in `docs/deployment/hosting-options.md` and
  `docs/deployment/backups-and-rollback.md` with portable examples.
- Remove public links to the private runbook from **all five referrers** (verified 2026-08-01;
  `docs/deployment/index.md` was listed here earlier but is not a referrer):
  `docs/deployment/hosting-options.md`, `docs/deployment/monitoring-and-alerts.md`,
  `plan/deployment/deployment_design.md` (3 mentions), `plan/chat/m9.1-licence-metadata.md`,
  `plan/interactive_chat_plan.md` — plus `.github/workflows/publish-image.yml`'s runbook pointer in its
  header comment. Where the surrounding procedure is generic, repoint to
  `docs/deployment/backups-and-rollback.md` (which documents the same atomic DB replacement and
  restart ordering).
- Keep the private runbook in an encrypted/operator-controlled location outside this checkout and
  verify that its recovery procedure is documented there.

### 4.2 Public-facing docs

- ~~Finish the README transition: code/content license links, build status, public contribution link,
  privacy summary, and accurate production/chat feature status.~~ **Done.** Licence links and
  `NOTICE`/`LICENSES` pointers landed with the attribution record; this pass adds CI and MIT badges,
  a "Privacy in short" section (local-first, plus the two opt-in third-party paths), a
  "Contributing and security" section linking `CONTRIBUTING.md` and `SECURITY.md`,
  and the two `docs/extra/` guides to the documentation list. The chat status line was already
  accurate at the time — it recorded M9.1–M9.3d as shipped and the feature as gated off in
  production. Updated 2026-08-07 when the assistant was enabled as an alpha; the §4.2 privacy
  documentation that had to land first was this PR's own work. The contribution *terms* behind that
  link were settled by decision 9 and now live in `CONTRIBUTING.md` at the repository root.
- ~~Document the optional browser-direct OpenRouter assistant in user/developer privacy docs before
  it is enabled in any public build: what leaves the browser, key storage, context selection,
  provider terms, local history, and the content `ai_context_policy` gate.~~ **Done** in
  `docs/extra/security-and-privacy.md`, which had no mention of the assistant at all. Covers all
  six points, states that the API server is not in the request path and that the CSP `connect-src`
  is what enforces it, and is explicit that privacy routing and the account-logging confirmation
  constrain what the app *sends* rather than proving what the provider *does*. Re-check it whenever
  the request body, the stored credentials, or `connect-src` change.
- ~~Refresh `docs/extra/security-and-privacy.md` and `docs/extra/content-and-licensing.md` against
  the final source set and NOTICE.~~ **Done 2026-08-08.** The refresh was not cosmetic: the
  user-facing rights matrix was missing **Strong's Greek and Hebrew entirely** — two works the
  application serves, with no rights row at all, under a heading claiming every shipped work had
  recorded terms. Both added, and three rows corrected to state obligations the table omitted: the
  WEB trademark, TSK's CC BY 4.0 attribution travelling with the data into `content.sqlite` and the
  image, and that the shipped English 1689 is editorial revision 1 with 67 documented corrections
  rather than the raw module. `security-and-privacy.md` needed nothing — PR #34 added the assistant
  section and PR #42 updated it for the alpha.

  Review then caught that the doc asserted more than the artifacts delivered: TSK's `works` row
  carried the licence *name* but no licence URI and no modification statement, and the runtime
  image copied neither `NOTICE` nor `LICENSES/`. Someone holding only `content.sqlite` or the
  image — which is what redistribution means here — therefore could not see either. Both fixed:
  the CC BY notice is now inside `works.attribution` (so it reaches the DB, the image, and the
  app's attribution UI) and the image ships `NOTICE` and `LICENSES/`. Whether the earlier form was
  already "reasonable for the medium" under CC BY §3(a)(2) is a judgement this plan does not make;
  carrying more is unambiguous and cost nothing.

  The invariant is **one-way and enforced in CI**: every work the application serves must appear
  in the matrix and in `NOTICE`; the matrix may also list works deliberately not shipped, which is
  why "equal, work for work" was the wrong claim. `test_every_shipped_work_is_declared_in_notice_
  and_the_rights_matrix` asserts it against `SOURCE_FILES`, so the omission that started this
  cannot recur silently.
- ~~Add issue/PR templates if Issues remain enabled. Decide whether Discussions will be
  enabled.~~ **Done** (decision 9): `.github/ISSUE_TEMPLATE/` carries a bug-report form, a
  content-correction form that **asks** for provenance and offers the CC0 grant when a reporter
  proposes wording — optional, because a plain "this verse is wrong" report must not be blocked by
  a licensing checkbox, and terms only bind text that is actually accepted,
  and a `config.yml` routing security reports to private disclosure. That URL is **absolute and
  must stay absolute** — GitHub drops a `contact_links` entry it cannot resolve, so a relative path
  removes the security option from the chooser with no error at all. It is therefore repointed at
  the rename instead, alongside the badges (§4.4). `.github/PULL_REQUEST_TEMPLATE.md` carries the
  test plan and a content-change checklist, and links to `CONTRIBUTING.md` absolutely for the same
  reason. Discussions stay off.
- ~~Sweep links and references after deletions and the private-runbook move.~~ **Done 2026-08-05 —
  nothing to fix.** All 169 relative markdown links across 63 files resolve, and all 89 repo-path
  references inside source files point at something that exists. Every surviving mention of a
  removed file (`render.yaml`, `uptime.yml`, the six PR #30 deletions, the two chat proposals, the
  live runbook) is a deliberate record of the removal — the "Removed" table here, `plan/deployment/
  README.md` explaining the private runbook, `monitoring-and-alerts.md` noting the retired workflow,
  and `interactive_chat_plan.md` §Appendix B listing what was carried over — not a dangling pointer.
  Re-run before the §6 gate, since the rewrite moves files again.

### 4.2b Corpus completeness — MHC repair before the flip

**Prerequisite for publication, added 2026-08-10.** The shipped Matthew Henry commentary is
materially incomplete, and `NOTICE` says otherwise.

Measured against the built `content.sqlite`, not inferred from the plan that reported it:

| | |
|---|---|
| Books with commentary | **48 of 66** |
| Entries imported | **3,479**, from **5,506** keys in `MHC.imp.gz` |
| Missing entirely | every numbered book — 1/2 Sam, 1/2 Kgs, 1/2 Chr, 1/2 Cor, 1/2 Thess, 1/2 Tim, 1/2 Pet, 1/2/3 John — plus **Revelation** |
| Build result | `result: ok`, no warnings |

Two independent causes, both diagnosed in `plan/mhc_translation/07_master_plan.md` §M1.

Book-name aliases: Roman-numeral and alternative forms are not matched, so every numbered book falls
out. And records keyed at verse `0`, which `apps/importer/bibleimport/formats/study.py:297` discards
on `chapter < 1 or verse < 1`. Both halves of that guard bite, on different things, and only one of
them is losing prose. Measured directly from `MHC.imp.gz`, 1,255 keys end in `:0`:

| Keys | Caught by | Content |
|---|---|---|
| **66** `Book 0:0` | `chapter < 1` | milestone markup only, **max 2 words** — not introductions, and no loss |
| **1,106** `Book N:0` | `verse < 1` | **real chapter introductions: 199,096 words**, up to 1,248 each |
| **83** `Book N:0` | `verse < 1` | scaffolding, under 5 words |

The split is clean — nothing falls between 5 and 20 words — so the repair can classify by content
rather than guess. **The loss that matters is those 1,106 introductions**, not the raw 1,255. An
earlier draft of this section named only `chapter < 1` and called the 66 "book introductions"; both
would have pointed a repair at the wrong records.

Why this is a going-public item and not only a product bug: `NOTICE` records MHC as *"Modifications:
None to the text"*, which a reader takes to mean the complete Matthew Henry. It is not. No licence
is breached — the work is public domain and no obligation is unmet — but it is an inaccuracy in the
attribution record this whole section exists to make trustworthy, and the same claim now ships
inside `content.sqlite` and the container image. It is also plainly user-visible: the reader and the
assistant both return nothing for Revelation.

**Do M1 before §5.** Publishing first and repairing after means the public repository's opening
state is a silently lossy importer paired with a `NOTICE` that contradicts it. Repairing first costs
one milestone of work that was already planned.

**M2 and M3 are not prerequisites**, but M3 is not as invisible as it first looks. M2 bumps the
content schema and adds `entry_id` to the API — ordinary product work with no bearing on licensing,
privacy or history, and with no users to migrate.

M3 is *not* merely gitignored scaffolding: only its `data/mhc_bg_work/` workspace and caches are
ignored. It also commits **`scripts/mhc_bg/`** tooling, the benchmark manifest, rubric, frozen
prompt, `model_snapshot.json`, blinded scores and results under `plan/mhc_translation/bench/v1/`,
the `.gitattributes` LFS rule (§2.3) and the `.gitignore` entry. The split matters here: the bench
artifacts sit inside the path §2.2 excludes and are removed by §5, but **`scripts/mhc_bg/` does
not** — it would ship publicly like any other tooling. That is acceptable (it is the owner's own
MIT-licensed code), but it should be a decision rather than a surprise, so run M3 before the flip
only if that tooling is meant to be public on day one.

**D1 is not triggered yet but will be.** That project gates the Bulgarian translation's licence on
"any public release". No translated text exists, so nothing blocks this flip. When `mhcbg` ships it
needs a `NOTICE` entry and a rights-matrix row, and
`test_every_shipped_work_is_declared_in_notice_and_the_rights_matrix` will fail until it has both —
which is the intended behaviour, not an obstacle.

### 4.3 Stale deployment choices

- `render.yaml` describes an M0-era free-tier route and contains comments that no longer match the
  implemented service. **Resolved 2026-08-01: delete it.** The README's Render-specific wording was
  already scrubbed in PR #30; no other references remain.
- **Resolved 2026-08-02:** delete `.github/workflows/uptime.yml`; UptimeRobot is the sole uptime
  monitor and must probe `/ready`. This avoids duplicate alerts and recurring Actions runs.
- ~~Decide whether to keep the manual GHCR deploy workflow.~~ **Resolved 2026-08-07: keep it, and
  rename it.** The image build works and is worth having; only the SSH step is inert, and its
  preflight already fails loudly with a summary explaining why. What was wrong was the name:
  `deploy.yml` promised a deployment it does not perform — production is the native systemd service
  released from the operator's local `scripts/release.sh`. Renamed to **`publish-image.yml`**, with
  the workflow's `name:` changed to match, since that is what shows in the Actions UI. Deliberately
  **not** `release.yml`: that is what `release.sh` already is, and two things called "release" would
  be a worse trap than one called "deploy".

  Review then caught that renaming alone swaps one misleading action for another: the workflow
  still ran `docker compose up -d`, so once the four VM secrets existed, dispatching something
  called "publish image" would also have changed production. And with the secrets absent it exited
  1 *after* a successful push, leaving a publishing workflow with no green path — a red that means
  nothing. Publishing and rolling out are now separate jobs; the rollout is opt-in via a
  `deploy_to_vm` dispatch input, is skipped rather than failed when not requested, and its
  preflight failure now means "you asked for a deploy that cannot happen". Runbook references were
  already removed in PR #31; least-privilege permissions and fork-PR approval remain due at §7.4.

### 4.4 App rename to DidacheDynamis

The public app is named **DidacheDynamis** (decided 2026-08-01). The rename lands in the sanitized
tree before the first push, not in the private repo's day-to-day history:

- README/docs product name, repository description/topics, and the `NOTICE`/attribution lines.
- **Hard-coded repository URLs.** Six of them, all silent when stale, and all pointing at the
  private archive once the tree moves. Two are badges: CI
  (`github.com/htrendafilov/bible_app_bg/actions/workflows/ci.yml`, renders as "no status") and MIT.
  Four are in `.github/`, and every one of them is **absolute deliberately and must stay absolute**:
  `ISSUE_TEMPLATE/config.yml`'s security `contact_links.url`, because GitHub drops a `contact_links`
  entry it cannot resolve and the option then vanishes from the chooser with no error at all; and the
  `CONTRIBUTING.md`/`SECURITY.md` links in `PULL_REQUEST_TEMPLATE.md`,
  `ISSUE_TEMPLATE/content-correction.yml` and `ISSUE_TEMPLATE/bug-report.yml`, because templates are
  rendered into issue and pull-request bodies, where a relative link resolves against that item's
  URL rather than the repository root. The `bug-report.yml` one is the sharpest: it is what steers a
  reporter away from filing a vulnerability publicly. Repoint all six in the rename pass.
- GHCR image path becomes `ghcr.io/htrendafilov/didachedynamis` in `publish-image.yml` and Compose (the
  package itself is created by the first push from the new repo).
- **Not renamed by default:** the public domain `bible.trendafilovi.net`, the Cloudflare tunnel, and
  the Caddy vhost keep working regardless of the repo name. Changing the domain is a separate owner
  decision — **direction taken 2026-08-06 (decision 10): rebrand**, domain not yet bought. Run the
  checklist below when it is.

#### Domain cutover checklist

Nothing here is required for the repository to go public; the site keeps working on the current
domain. Run it when the new domain is registered.

**Do first — the two that break silently.**

1. **Dropbox redirect URI.** Register the new origin in the Dropbox App Console alongside the old
   one *before* the domain serves traffic. It is an exact-match allowlist: notes sync fails at the
   OAuth step for anyone on the new host until it is added, and the failure looks like a Dropbox
   problem rather than a DNS change.
2. **Keep the old host SERVING `/embed.js` and `/api/*` — a redirect is not enough for embeds.**
   Third-party sites load `https://bible.trendafilovi.net/embed.js` and, per
   `docs/user/embedding-scripture.md`, we tell them to allowlist that exact host in *their*
   `script-src`. A cross-origin redirect is re-checked against that policy and blocked, so **the
   embedders who followed our own security advice are precisely the ones a blanket redirect
   breaks**. Even without a CSP it only half-works: `apps/web/public/embed.js` derives its API base
   from `script.src`, which reflects the original attribute rather than the redirect target, so its
   API calls keep going to the old host regardless.

   So: redirect the app/HTML routes, but keep serving `/embed.js` and `/api/*` from the old
   hostname, which means keeping its Tunnel route alive. Publicly shared deep links need no special
   handling — `#/b/…` and `#/book/…` are hash fragments that never reach the server, and browsers
   reattach them after a 301.

**Infrastructure.**

3. ~~Register the domain~~ **done 2026-08-05 at Porkbun** (decision 10). Create a Cloudflare zone
   for each domain, then replace Porkbun's nameservers with the two Cloudflare assigns —
   they are still on `*.ns.porkbun.com` as registered, so nothing routes through Cloudflare yet.
4. Add the new public hostname to the Cloudflare Tunnel ingress; keep the old hostname routed until
   the redirect is in place.
5. **No webserver change — Caddy is not in this app's request path.** `cloudflared` reaches the
   service directly on `127.0.0.1:8080`; `docs/deployment/index.md` states there is no public Caddy
   vhost or direct-IP route for it, and Caddy serves only unrelated applications on that VM.
   `deploy/Caddyfile.snippet` is a leftover template, not live configuration. Serving a new hostname
   is entirely step 4 (a Tunnel ingress entry) plus Cloudflare DNS — nothing on the VM changes.
   Consider deleting the snippet, or retitling it so it stops implying a vhost exists.
6. Repoint the UptimeRobot monitor at `https://<new-domain>/ready`. **It is currently pointed at
   `https://bible.trendafilovi.net/health`, which is the wrong endpoint** (monitor id 803560065,
   checked 2026-08-06): `apps/api/app/routers/health.py` documents `/health` as liveness that
   "stays 200 even if the content DB is missing", while `/ready` returns 503 when content is
   missing, corrupt, or schema-incompatible. Today a content-database failure would leave the site
   reported UP while serving no Bible text. Worth fixing now rather than waiting for the cutover —
   it is a one-call change and independent of the domain.
7. **`.app` is on the HSTS preload list.** Browsers refuse plain HTTP to any `.app` host, with no
   click-through. That is satisfied automatically behind the Cloudflare proxy, but it also means
   there is no HTTP fallback for debugging on that hostname — including locally, if a
   `didachedynamis.app` name is ever mapped in `/etc/hosts` for testing. Not an issue for `.com` or
   `.org`.
8. **If mail is ever put on a DidacheDynamis domain** (Proton, as with the existing domains): keep
   the three DKIM records **DNS-only (grey cloud)** — Cloudflare will otherwise proxy the CNAMEs and
   DKIM resolves to the proxy instead of Proton, so signing fails silently — and do **not** enable
   Cloudflare Email Routing on that zone, since it inserts its own MX records and fights Proton's.
9. Set the GitHub repository Website field and social preview to the new domain.

**Tracked references — 16 files at the 2026-08-06 audit** (`git grep -l bible\.trendafilovi\.net`).

10. Update: `README.md` (header line and the Dropbox redirect-URI example),
   `apps/web/public/embed.js` (header comment and usage example),
   `apps/web/src/state/deeplink.ts` (comment), `deploy/Caddyfile.snippet`,
   `docs/deployment/index.md`, `docs/deployment/monitoring-and-alerts.md`,
   `docs/user/embedding-scripture.md` (four mentions, including the CSP guidance quoted to
   embedders), `ideas/desktop-04-pwa.md`, `plan/00_system_design.md` (two mentions),
   `plan/linking_and_embeds.md`, and this file.
11. **Untracked operator tooling can hold the hostname too, and no repo sweep will see it.**
    Anything git-ignored under §4.1 is invisible to the audit above by construction. After a
    hostname change, grep it separately. One such tool did break on this cutover, in a way that
    reported a failure on a healthy release; the specifics belong in the private runbook, not
    here.
12. **Two that are not prose and will misbehave rather than merely read wrong:**
   - `scripts/capture_real_docs_screenshots.js` — `LIVE_URL` points at the live site, so
     re-captured user-guide screenshots would keep showing the old domain in the address bar;
   - `scripts/bench_measure_tokens.py` — sends `HTTP-Referer: https://bible.trendafilovi.net` to
     OpenRouter, which is how the account attributes benchmark spend.
13. **Leave alone — dated evidence, not configuration.** `plan/chat/m9.0-findings.md` and
    `plan/chat/m9.2-workspace-and-provider.md` record that a CORS preflight *from that origin*
    returned a particular status on a particular date; rewriting the host would falsify a record of
    what was actually tested. `plan/interactive_chat_plan.md` Appendix A names the origin a user
    would have to put in `OLLAMA_ORIGINS` for a deferred local-model provider — update it only if
    that provider is ever built.

**The shipped assistant needs no change.** `apps/web/src/chat/providers.ts` carries no app-domain
dependency: the CSP `connect-src` is `'self'` plus the provider origin, and the request identifies
the app with a fixed `X-Title` header, not a URL. The only `HTTP-Referer` carrying the domain is in
the benchmark script above, which is tooling rather than the product. Re-check this if a second
provider is added.
- Code identifiers (`apps/*` package names, i18n strings, SPA title) can be renamed incrementally
  post-release; only user-visible branding blocks publication.
- **Logo (selected 2026-08-01):** a geometric lighthouse mark — dark-navy interlocking triangles
  forming the tower, white light beams fanning left and right, flanked by cyan accent dots with red
  centers. AI-generated with Gemini by the owner (2026); the owner dedicates it to the public
  domain via CC0, recorded alongside `NOTICE` (purely AI-generated images may not be copyrightable
  in some jurisdictions — the explicit dedication removes downstream ambiguity).

  **Landed in `apps/web/public/brand/`** rather than waiting for the sanitized tree: `git
  filter-repo` removes paths, it does not add them, so the asset has to be committed somewhere
  before the mirror is built. Corrected on the way in — the delivered export was RGB with **no
  alpha channel**, carrying the editor's transparency checkerboard as real pixels (80% of the
  image), plus a detached artifact in the lower right. This section previously described that
  checkerboard as "a light-gray field"; it was neither a field nor intended. Both were removed, the
  mark cropped and padded square, and a dark-theme variant recoloured from it because the navy
  tower is illegible on a dark tab strip. `index.html` selects between them with
  `prefers-color-scheme`; the icons are ordinary blobs, not LFS, so forks cost no LFS bandwidth.

  Two properties of the artwork itself were **not** changed, and are open if the owner wants them
  addressed: the cream light beams are near-white and all but vanish on a white background, and the
  mark is a wide horizontal composition, so squaring it for a 16/32px favicon leaves the tower
  small. A tower-only crop for the small sizes would fix the second.

  Set as the GitHub social preview at §7.

## 5. History rewrite procedure

This section applies only to a release path that publishes rewritten history.

1. Freeze pushes; merge/close open PRs; delete obsolete remote branches; record all branch/tag/PR
   refs, LFS objects, and the current default-branch SHA.
2. Make two backups: an untouched private mirror and a separate disposable mirror for rewriting.
   Never run the rewrite in the day-to-day checkout.
3. Use `git-filter-repo` 2.47+ with sensitive-data removal mode:
   - remove every historical path of the live runbook;
   - remove every historical `data/sources/KJV.imp.gz` path and its LFS object so the new repository
     never receives the KJV export, even during its private verification phase;
   - remove every historical `plan/mhc_translation/` path (§2.2 — the translation project's planning
     history stays out of the public tree; only its finished result is intended to reach it). A
     no-op while the directory is untracked, which is why it must be *in* the invocation rather than
     assumed: if any of it is ever committed, an unchanged command would carry it over silently;
   - replace the origin, operator/path, and internal-registry strings using a replacement file stored
     outside the repository;
   - rewrite author **and committer** addresses in the same pass (decision 8) with
     `git-filter-repo --mailmap <file>`, which applies to both sides. The mailmap maps the two old
     addresses to `hristo@trendafilovi.eu`, one `Name <new> <old>` line each. **The literal old
     addresses belong in the external replacement map, not in this file** — §1.2 requires that, and
     writing them here would publish in the plan the values the rewrite exists to remove. Leave `noreply@github.com` alone —
     it is GitHub's merge identity, and rewriting it would attribute merges to a human who did not
     make them. The account verification this depends on was completed 2026-08-12 (decision 8);
     confirm it still holds before running, since an unattributed history has to be rewritten
     twice;
   - record first-changed commits, changed refs, and orphaned LFS objects from the report.
4. Inspect the rewritten mirror before pushing: all refs, all commits, commit metadata, large blobs,
   LFS pointers, and exact searches for every private value and encoded variant.
5. Push the complete rewritten mirror only after approval. Expect GitHub's read-only `refs/pull/*` to
   reject updates; that is a documented limitation, not a successful purge.
6. If retaining the current GitHub repository, follow the GitHub Support procedure for affected PR
   refs/caches when eligible. If Support will not purge the non-credential metadata, return to the
   release-strategy decision rather than claiming full removal.
7. Delete or rebase every other clone/worktree. Never merge an old branch into rewritten history.

## 6. Verification gate

All of these must pass before visibility changes:

- a secret scanner over every rewritten ref, with findings reviewed rather than merely counting a
  zero exit code;
- **no commit on any ref carries the employer or Yahoo address** on either the author or the
  committer side (decision 8), and a sample commit resolves to the owner's GitHub account rather
  than to nobody — an unattributed history is a rewrite that has to be done twice;
- exact history searches for the external replacement-map values,
  private runbook, `data/sources/KJV.imp.gz` and `plan/mhc_translation/` paths, `.env` files,
  key formats, tokens, and
  unusually high-entropy strings;
- `git fsck`, changed-ref review, current-tree diff review, and before/after `git lfs ls-files`;
- `scripts/check.sh` on the candidate public tree;
- fresh clone with no local config → `git lfs pull` → `bibleimport build-all` → API/SPA smoke test;
- Markdown-link check and a manual pass through README, docs, license/attribution, and screenshots;
- anonymous-access rehearsal against the candidate remote, including source archives and LFS;
- audit of PRs/issues, Actions logs/artifacts, packages, deployments, variables, and repository
  settings; record the result in the release issue;
- MHC corpus repair landed and verified (§4.2b): 66 books present, the source's 5,506 keys fully
  accounted for, and `NOTICE`'s "None to the text" true of what actually ships;
- the **new** repository's own workflow runs reviewed, not this archive's. Pushing the mirror
  triggers `ci.yml`, and those logs are public after the flip — check them for anything the runner
  echoed, or keep Actions disabled on `DidacheDynamis` until the tree is verified (§1.4);
- ~~decision 11 answered and recorded: whether the KJV ships inside the published
  `content.sqlite` and GHCR image, or is excluded from the distributed artifacts.~~ **Answered
  2026-08-06 — it ships (§8).** What remains verifiable here: `LICENSES/GPL-2.0.txt` is present,
  `NOTICE` §3 carries the CrossWire attribution, and the app's attribution UI still shows the KJV
  terms in the built artifact.

## 7. Publication and post-flip checks

The target repository **`htrendafilov/DidacheDynamis`** already exists (created 2026-08-01,
**private** — deliberately, so the §6 gate runs before anything is publicly reachable).

1. Temporarily restrict writes during the cutover.
2. Push the verified sanitized mirror to `DidacheDynamis`; set description and topics.
3. Immediately restore branch/ruleset protection because GitHub disables push rulesets on a
   private-to-public visibility change.
4. Configure public-fork Actions approval, read-only default `GITHUB_TOKEN`, Dependabot, secret
   scanning/push protection, and code scanning as appropriate.
5. Set repository features to match decision 9: **Issues on**, **Discussions off**, Wiki and
   Projects off. The issue forms ship in the tree and appear automatically once Issues are on;
   `CODE_OF_CONDUCT.md` and `CONTRIBUTING.md` are picked up by GitHub's community profile.
   Create the **`content`** label and point `content-correction.yml` at it — labels do not travel
   with the tree, and GitHub drops a label a form names but the repository does not have, silently.
   The form ships pointing at `documentation`, which exists, so it degrades rather than breaks.
6. **Create the `conduct@didachedynamis.com` alias before Issues are enabled.**
   `CODE_OF_CONDUCT.md` tells reporters not to raise conduct concerns publicly and names that
   address as the private route. A GitHub profile is not a channel — profiles carry no private
   messaging, and this one publishes no contact — so without the alias the document forbids the
   only route it leaves open. Same failure as SECURITY.md pointing at a Security tab that did not
   exist (§7.6): the document is only true once the channel does.
7. **Enable private vulnerability reporting** (Settings → Code security). `SECURITY.md` sends
   reporters to the Security tab's "Report a vulnerability" button, and that button does not exist
   until this is switched on — GitHub offers the feature for **public repositories only**, so it
   cannot be enabled on `bible_app_bg` in advance and must be done here, right after the flip.
   Until then `SECURITY.md`'s fallback (open an issue asking for a private channel, no details)
   is the only route. There is no automation to add: `repository_advisory` is not an event that can
   trigger a workflow, and reading unpublished advisories over the API needs a token with
   `repository_advisories:read`, which is not worth storing as a secret in a public repository.
   GitHub already notifies maintainers on submission and confirms receipt to the reporter.
8. Deliberately set GHCR package visibility and source linkage; do not assume it follows the repo.
   Also settle the **old** `ghcr.io/htrendafilov/bible_app_bg` package: an image holding a full
   `content.sqlite` was pushed to it on 2026-07-25 and may still be there (§1.4 — current state
   unverified, needs `read:packages`). Check, then delete it or confirm it is private. It is not
   covered by the repository staying private.
9. Recreate the `DROPBOX_APP_KEY` Actions secret on the new repository — secrets do not transfer,
   and `publish-image.yml` builds the SPA with it, so without it a published image would ship a
   build whose Dropbox sync cannot authenticate.
10. Verify Actions secrets still exist, workflow permissions are minimal, and untrusted fork PRs do
    not receive secrets or write tokens.
11. Check README badges, community profile, LICENSE/NOTICE rendering, LFS download, release build, and
    the live site from an anonymous browser.
12. Watch Actions/LFS usage and security alerts during the first week.

## 8. Decisions

**Resolved 2026-08-01:**

1. ~~Existing repository rewrite vs clean public repository~~ → **clean public repository**
   (`htrendafilov/DidacheDynamis`).
2. ~~Code license~~ → **MIT**.
3. ~~KJV in the repository~~ → **removed** from the public source set; fetched from CrossWire at
   build time (§3.3). Distributing it in the built database/image is settled by decision 11.
4. ~~Live runbook~~ → **private/untracked** (§4.1).
5. ~~`render.yaml`~~ → **deleted** (§4.3).
6. ~~`uv.lock`~~ → **ignored** (§1.3).
7. ~~GitHub Actions uptime workflow~~ → **deleted**; UptimeRobot is the sole monitor (§4.3).

**Resolved 2026-08-06:**

10. ~~Public domain: keep `bible.trendafilovi.net` or rebrand with the app name~~ → **rebrand.**
    Registered 2026-08-05 at **Porkbun**: `didachedynamis.com`, `didachedynamis.org`, and
    `didachedynamis.app`.

    **Cut over 2026-08-06 — done.** `didachedynamis.com` is the primary and serves the app through
    the existing Cloudflare Tunnel. `www.didachedynamis.com` and `didachedynamis.org` (+`www`)
    301 to it. `bible.trendafilovi.net` **302**s to it — deliberately 302 rather than 301 so it
    stays reversible while it proves itself; promote to 301 before public launch so search engines
    transfer authority. `/embed.js` and `/api/*` are **excluded from that redirect** and still
    served from the old hostname, because existing third-party embeds allowlist it in their own CSP
    (§4.4 checklist item 2). UptimeRobot now probes `https://didachedynamis.com/ready`. The Dropbox
    OAuth allowlist carries `.com` and `.org` alongside the old host, verified against Dropbox's
    authorize endpoint with an unregistered control URI to prove the check discriminates.

    **`didachedynamis.app` is reserved, not redirected — unused for now.** It is held for a future
    *technical* site about the software itself: release notes and new-feature announcements,
    contributor documentation, and developer-facing material — as distinct from `.com`, which is
    the reader-facing application. It is still on Porkbun nameservers with no Cloudflare zone and
    no DNS pointing anywhere, and it is deliberately **not** in the Dropbox redirect-URI allowlist.
    When it is built out: create the zone, move its nameservers, add the Dropbox URI only if it
    ever needs sync, and note that `.app` is HSTS-preloaded (§4.4 checklist item 7).

    **Blog — decided 2026-08-06: `blog.didachedynamis.com`**, a subdomain rather than a `/blog`
    path. A separate project; hosting undecided. The subdomain keeps the two independently
    deployable and lets the blog move hosts without touching the reader app's routing. It also
    avoids a real collision: the API falls back to the SPA's `index.html` for any unknown path, so
    `didachedynamis.com/blog` already returns the reader app today and would have to be routed
    around at the edge or in the tunnel before a blog could claim it. Hash routing (`#/book/…`)
    means app routes never occupy path space, so the conflict is only that fallback.

    Nothing to do now beyond the reservation. When it is built: add the DNS record, and — if the
    blog is ever expected to serve from `.org` instead — carve its path out of the `.org` redirect,
    which is currently blanket. For the scripture pop-ups the blog wants, `embed.js` already does
    exactly that for third-party pages (`docs/user/embedding-scripture.md`); it needs no new code,
    only the host allowlisted if the blog sets a CSP. The blog's own README should carry the WEB
    trademark line and the TSK CC BY 4.0 attribution rather than relying on this repository's
    `NOTICE`.

    **Registrar: Porkbun, DNS: Cloudflare.** Cloudflare Registrar was the first candidate — registry
    cost, no markup, one account — but it **does not support `.eu`**, so it can never hold
    `trendafilovi.eu` and cannot be a single home for these domains. Porkbun carries `.eu`, `.com`,
    `.net`, `.org`, and — unlike Cloudflare Registrar, which mandates its own nameservers — permits
    external ones. So the registrar consolidates while Cloudflare keeps DNS, the proxy, and the
    Tunnel exactly as they are today.

    Consolidating the existing domains is a **separate, later** job: transfers need the domain 60+
    days old, unlocked, with an auth code, and `.eu` follows EURid's own transfer-code process
    rather than the ICANN rule. Do not couple either to this release.

11. ~~KJV in the distributable artifacts~~ → **accepted; the KJV ships in `content.sqlite`, the
    GHCR image, and the live site.** The basis, from the two primary sources:

    - CrossWire holds whatever copyright exists in the KJV2003 effort (© 2003–2023) and
      **grants use for any purpose**: "the CrossWire Bible Society hereby grants a general public
      license to use this text for any purpose", repeated on the wiki as "we in turn offer the
      KJV2003 Project text and its successors freely for any purpose". The rights holder has
      permitted in writing exactly what this project does.
    - The `DistributionLicense: GPL` field is module metadata, added at module 3.1, and best read
      as covering the **SWORD module package** — which this project does not redistribute. The
      build fetches the module, extracts the text with `mod2imp`, and ships a derived database.
    - The Crown's rights are **territorial**: the KJV is under perpetual Crown copyright in the
      United Kingdom only, by royal prerogative under Letters Patent. CrossWire's own wiki records
      that "in most of the world, the Authorized Version has passed out of copyright and is freely
      reproduced". The residual exposure is that the site is reachable from the UK, which is the
      same position as every other KJV site.

    Treated as an engineering risk assessment, not legal advice. The obligations a GPL reading
    would impose are met anyway, deliberately, because they cost nothing: attribution and copyright
    notices are preserved in `NOTICE` §3 and in the app's attribution UI; the licence text is
    included at `LICENSES/GPL-2.0.txt`; and `scripts/fetch-kjv.sh` is the corresponding source —
    checksum-pinned to the exact upstream archive and to the exact `mod2imp` output.

    Copyleft is **not** treated as reaching the MIT code. `content.sqlite` is data the application
    reads, not code linked into it. If that reading is ever challenged, the fallback is a build flag
    that excludes the KJV from the shipped artifacts; the fetch step is already isolated in one
    script, so it is a small change rather than a re-architecture.

    Note the module records `GPL` with no version. SWORD itself is GPL-2.0, so `LICENSES/` carries
    GPL-2.0; the any-purpose grant above is the operative permission regardless of version.

9. ~~Issues, Discussions, contribution terms, and code-of-conduct policy~~ → **decided
   2026-08-12.**

   - **Inbound terms: inbound = outbound, split by kind.** Code and documentation under MIT;
     **content** — translations, corrections to historical texts, editorial notes — under **CC0
     1.0**. Not one clause but two, because not every contribution here is software: MIT sits
     badly on a translated confession, and CC0 is already the precedent (the Bulgarian 1689). No
     CLA and no DCO sign-off: both add friction a single-maintainer project cannot spend, and a
     CLA only earns its weight if relicensing is possible, which it is not. `contributing.md` also
     now requires provenance with any text contribution, since one without it cannot be accepted
     however good it is.
   - **Issues: enabled, with forms.** A bug report and a content correction. The content form is
     the one that matters here — a silent error in a source is very hard for a maintainer to find
     alone — and `config.yml` routes security reports away from public issues.
   - **Discussions: off.** Two channels are worse than one for a solo maintainer and Issues covers
     the same ground. Enabling later is free; disabling later strands whatever is in them.
   - **Code of conduct: Contributor Covenant 2.1**, adopted verbatim apart from the reporting
     contact, which points at the maintainer's GitHub profile rather than committing a personal
     address. Deliberately *not* the Security tab: private vulnerability reporting is for
     vulnerabilities, and routing conduct reports through it would file them as security advisories.
     The trade is that the profile is the only private channel, which is thin — if conduct reports
     ever actually arrive, a dedicated address is the fix. Adopted because this project touches theology, where a stated standard
     makes closing a thread a policy rather than an argument — and on the plan's own condition,
     that it is only worth having if it is acted on.

   **This also answers the MHC translation project's D4** ("first reader-report destination:
   GitHub issue form with a copy-to-clipboard fallback"). The content-correction form is that
   destination; only the in-app copy-to-clipboard fallback remains, and it belongs to that
   project's M4.

8. ~~Author/committer email rewrite~~ → **decided 2026-08-12: rewrite to
   `hristo@trendafilovi.eu`**, an alias the owner controls and can rotate. It already appears in 27
   commits, and §1.2 requires the employer address to go regardless.

   Measured 2026-08-12 across all reachable commits (234 author entries), replacing the stale
   2026-08-01 figures:

   | Identity | Author | Committer |
   |---|---|---|
   | employer domain — see the external replacement map | 180 | 165 |
   | `hristo@trendafilovi.eu` — the rewrite target | 27 | 27 |
   | personal webmail — external map | 27 | — |
   | `noreply@github.com` (GitHub merge commits) | — | 42 |

   The two addresses being replaced are deliberately not written out. Reproduce the counts with
   `git log --all --format='%ae' | sort | uniq -c`.

   The §5 mailmap maps the first and third to `hristo@trendafilovi.eu` on **both** the author and
   committer sides. `noreply@github.com` is left alone: it is GitHub's own merge identity, not a
   personal address, and rewriting it would misattribute merges to a human who did not make them.

   **Prerequisite — satisfied 2026-08-12.** The address was initially unverified on the GitHub
   account: commit `83bf69d6` resolved to *nobody*, and rewriting in that state would have produced
   a public history with no avatar, no profile link and no contribution graph, fixable only by
   rewriting a second time. The owner added and verified it, and five commits carrying the address
   (`83bf69d6`, `d1370e6c`, `20302cc0`, `3a768d37`, `098f19df`) now resolve to `htrendafilov`.

   Re-check this if the rewrite is delayed: verification can be removed, and the check costs one
   API call against any commit already carrying the address.

   The alternative considered and rejected: `6759163+htrendafilov@users.noreply.github.com`, which
   attributes correctly and never exposes a real address. Rejected because the owner prefers an
   alias they control; the trade is that a real address in public history is scrapable, which an
   alias makes recoverable rather than permanent.

**Still pending:** none — every decision above is recorded and settled.

The §3.3 fetch-at-build implementation is complete, and decision 11 settles the artifact question.
One hard gate remains: proving the candidate `DidacheDynamis` history never contains the former KJV
path or its LFS object. Everything else can be completed as a reviewable cleanup commit before the
destructive release cutover.
