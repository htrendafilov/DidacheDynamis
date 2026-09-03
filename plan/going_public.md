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
  ~~tip SHAs are recorded in the release issue in case anything needs recovering before gc.~~
  **False when written, fixed 2026-08-18.** No release issue existed — this repository had exactly
  two issues, #6 and #15, neither of them that. The tips were recorded nowhere, so the safety net
  this sentence describes was never in place. The record now exists as **issue #54**, and it
  supersedes the problem rather than patching it: it lists every `refs/pull/*` head, so no partial
  branch list can go missing again.

  **Repeated 2026-08-17 — and this is a recurring step, not a one-off.** Ten more branches had
  accumulated and all ten are now deleted locally and on the remote, leaving only `main` again.
  The set is **the branches origin still advertised**, which is not the same as a PR range and was
  mis-stated as "PRs #43–#52" in the first draft of this entry: it is **PRs #41–#45 and #48–#52**.
  #46 and #47 are absent because their branches had already been deleted — their heads are
  `f8e4165` and `2762c86`, recoverable only through `refs/pull`, not from this list.

  | PR | branch | tip |
  |----|--------|-----|
  | #41 | `chore/rename-deploy-workflow` | `935c0a0` |
  | #42 | `docs/assistant-alpha` | `e405440` |
  | #43 | `docs/refresh-extra-docs` | `716394a` |
  | #44 | `docs/github-side-audit` | `b56521a` |
  | #45 | `docs/mhc-corpus-prerequisite` | `051e08e` |
  | #48 | `docs/decision-9-contribution-policy` | `67376ef` |
  | #49 | `docs/plan-corrections-post-m1` | `751fb3f` |
  | #50 | `feat/4.4-rename-didachedynamis` | `d13807f` |
  | #51 | `docs/5b-disposition-decisions` | `722a388` |
  | #52 | `fix/chat-markdown-nesting` | `b5ea350` |

  **Re-run this immediately before §5** rather than trusting this entry — the rewrite processes
  every ref it finds, so a branch merged after this date is old history the sanitization would
  carry forward.

  **Deleting the branch is necessary and not sufficient — `refs/pull/*` still reaches the
  commit.** `docs/5b-disposition-decisions` (`722a388`) held `3ec5165`, the commit whose §6 table
  quoted the scanner false positive verbatim. PR #51 was **squash-merged**, so it never reached
  `main`. The branch is now gone. GitHub nevertheless still advertises
  `refs/pull/51/head` at `722a388`, from which `3ec5165` is reachable — verified 2026-08-18 with
  `git ls-remote origin 'refs/pull/51/*'`, and a fresh `git clone --mirror` from GitHub pulls
  **every `refs/pull/*` origin advertises** along with the branches. Treat that as a shape, not a
  number: the count moves with every PR. `/head` exists for each PR ever opened and `/merge` only
  while one is open, so the same repository read three times gives three answers — **51 heads / 0
  merge** at the step-1 inventory (issue #54, nothing open), 52 total during PR #53, and 52 heads
  + 1 merge while PR #55 was open. Any figure here is only meaningful with its date and its
  heads-versus-merge split.

  So the 10 → 9 drop recorded earlier is real but **local-only**: it describes a checkout that
  never fetches pull refs. Measured on the two candidate §5 inputs, neither is clean, and they are
  not dirty in the same way:

  | mirror source | carries | `gitleaks git` |
  |---|---|---|
  | `git clone --mirror .` (local) | `refs/stash` → `.ua/`, 3.0 MB | **9** (3 sentinels + 6 stash) |
  | `git clone --mirror` from GitHub | `refs/pull/*` → `3ec5165` | **4** (3 sentinels + 1 pull ref) |

  The GitHub mirror carries no stash, which is what §5 step 2 was written for and that part holds.
  It simply solves one trap by walking into another. §5 must strip **both** `refs/pull/*` and
  `refs/stash` before `git-filter-repo` runs;
- **GHCR package — the one item path 2 does *not* neutralise.** Package visibility is managed
  separately from repository visibility, so a private repo does not imply a private package. An
  image **was published and may still exist**: run `30153760051` (2026-07-25) shows `Build and push
  image` succeeding before the run failed at `Deploy to VM`, so `ghcr.io/htrendafilov/bible_app_bg`
  received a full `content.sqlite` — every imported text, including the KJV (decision 11) — under
  the pre-rename name. ~~Whether it is *still* there, and whether it is public, is **not established**:
  the audit token lacked `read:packages`, and an unauthenticated pull returns 401 either way, which
  cannot distinguish a private package from a deleted one. Before §7, check with a `read:packages`
  token and then delete it or confirm it is private.~~ Note the two historical runs are both marked *failure* while one of them
  published successfully — the misleading signal §4.3 has since fixed by splitting the jobs.

  **Settled 2026-08-18: it existed, it was private, and it is now deleted.** The check needed a
  `read:packages` scope the audit token never had — `gh auth refresh -h github.com -s
  read:packages,delete:packages` rather than a new stored credential. Result: the package was
  present and **`visibility: private`**, so the KJV-bearing image was never publicly pullable and
  no exposure ever occurred. Deleted anyway, because *private today* is a weaker guarantee than
  *absent*: package visibility is a control separate from the repository's, it is the one this
  entry exists to flag, and once attention moves to `DidacheDynamis` nobody is watching this
  toggle. Nothing depended on it — one version, from a run that failed at deploy, orphaned by the
  rename since §4.4 repoints publishing at `ghcr.io/htrendafilov/didachedynamis`.

  Recorded because deletion is reversible for 30 days and after that this is the only trace:
  package `bible_app_bg`, version `1065714616`, digest
  `sha256:3193ea6a69422bc31f6d3ac760c3ca33134d2278affab056f7418b5b1b733dd3`, tags `latest` and
  `fd29f0305ca47f8c541a4cf8b4e05c537eba0eb0`, created `2026-07-25T10:03:15Z`. Verified gone: the
  account reports **0 container packages** and a direct fetch returns 404.

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
  §5 `git-filter-repo` invocation, and it must be re-checked at §6 rather than assumed. The
  directory is untracked today, so if nothing is committed into it the removal is a no-op — the
  cheapest way to honour this decision. Do not read that as a guarantee: it was untracked on
  2026-08-10 when this was written, and PR #46 tracked a file inside it anyway. The one exception is
  the M1 corpus baseline, which the owner decided to publish (§5b a) and which now lives outside
  this directory at `plan/mhc_english_baseline.md`, so this stays a whole-directory removal with
  nothing to carve out.

### 2.3 Source-data disposition

After removing the tracked KJV export, no other committed source-data file is presently a safe stale
deletion other than `.gitkeep`:

- eight committed active compressed/TSV inputs are consumed by `bibleimport build-all`; the ninth
  (`KJV.imp.gz`) is generated locally by the checksum-pinned CrossWire fetch step;
- the original English 1689 export is the immutable provenance base for the reviewed edition;
- the uncompressed Bulgarian 1689 IMP drives the revision, SWORD-package, and benchmark scripts;
- the JSON metadata and correction record provide required rights/provenance evidence.

A later addition will change these numbers: the Bulgarian translation project adds an LFS rule for
`data/sources/mhc_bg/books/*.jsonl.gz`, and the translated book packages that follow land as new
LFS objects. The rule alone costs nothing — no objects exist until that project's M5/M6
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

**Done — verified against the tree 2026-08-13.** The items below were completed across PR #30/#31
but were never struck through here, so this section read as outstanding work for a week.

- ~~Untrack `plan/deployment/live-runbook.md`, add it to `.gitignore`, and add a short tracked
  `plan/deployment/README.md` explaining that the live operator runbook is intentionally private.~~
  Verified: the path is untracked and matched by `.gitignore:51`, and the tracked README exists.
- ~~Replace the real operator account/path in `docs/deployment/hosting-options.md` and
  `docs/deployment/backups-and-rollback.md` with portable examples.~~ Verified: the operator account
  and home path appear nowhere in tracked `docs/`, `plan/` or `README.md`.
- ~~Remove public links to the private runbook from **all five referrers**~~ (verified 2026-08-01;
  `docs/deployment/index.md` was listed here earlier but is not a referrer):
  `docs/deployment/hosting-options.md`, `docs/deployment/monitoring-and-alerts.md`,
  `plan/deployment/deployment_design.md` (3 mentions), `plan/chat/m9.1-licence-metadata.md`,
  `plan/interactive_chat_plan.md` — plus `.github/workflows/publish-image.yml`'s runbook pointer in its
  header comment. Where the surrounding procedure is generic, repoint to
  `docs/deployment/backups-and-rollback.md` (which documents the same atomic DB replacement and
  restart ordering). Verified 2026-08-13: the only surviving mentions of `live-runbook` are
  `.gitignore` and `plan/deployment/README.md`, both of which are supposed to name it.
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

Two independent causes, both in `apps/importer/bibleimport/formats/study.py` and both diagnosed
before the repair:

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

**M1 landed (PR #46), verified in the artifact 2026-08-13, and confirmed live in production
2026-08-15** (build `fe7217f`): all 66 books served, coverage reporting 5,355 units with no empty
book, per-book counts identical to the local rebuild, chapter introductions returning
`verse_start: null`, and a search whose only matches fall inside introductions returning **200**
rather than the `int(NULL)` 500. M2's coverage endpoint is live. `NOTICE`'s "None to the text" is
now true of what actually ships, closing the gap recorded below.

The original build-time verification, 2026-08-13, rebuilt `content.sqlite` from `data/sources/` and
queried it rather than re-reading the code:

| | Before | After |
|---|---|---|
| Schema `user_version` | 4 | **5** |
| MHC distinct books | 48 | **66** |
| MHC entries | 3,479 | **5,355** |
| Chapter introductions | 0 | **1,106** |
| `fatal_unmatched` | — | **0** |

Key accounting balances exactly: 5,355 imported + 151 scaffolding = 5,506 raw keys. All eighteen
previously-absent books are populated (Rev 76, 1 Sam 132, 2 Chr 118 … 3 John 4).

**A green build was not the same as a fixed site, and for two days it was not.** On 2026-08-13,
with M1 and M2 both merged, `didachedynamis.com` still returned `entries: []` for Rev, 2 Sam and
1 Cor and 404 for M2's coverage endpoint: the VM was running the pre-M1 corpus and pre-M2 code, so
`NOTICE`'s "None to the text" was false on the live site while every test passed. The release on
2026-08-15 closed it. Keep the distinction in §6: the MHC gate item is satisfied by the
**deployment**, not by the build, and only a probe against the running site can tell them apart.

**M2 and M3 are not prerequisites**, but M3 is not as invisible as it first looks. M2 bumps the
content schema and adds `entry_id` to the API — ordinary product work with no bearing on licensing,
privacy or history, and with no users to migrate.

M3 is *not* merely gitignored scaffolding: only its `data/mhc_bg_work/` workspace and caches are
ignored. It also commits **`scripts/mhc_bg/`** tooling, the benchmark manifest, rubric, frozen
prompt, `model_snapshot.json`, blinded scores and results under `plan/mhc_translation/bench/v1/`,
the `.gitattributes` LFS rule (§2.3) and the `.gitignore` entry. The split matters here: the bench
artifacts sit inside the path §2.2 excludes and are removed by §5, but **`scripts/mhc_bg/` does
not** — it would ship publicly like any other tooling. That is acceptable (it is the owner's own
MIT-licensed code), but it should be a decision rather than a surprise.

**Decided 2026-08-15 (§5b c): M3 runs *after* the flip.** `scripts/mhc_bg/` therefore becomes public
when it is written, as an ordinary commit, rather than appearing in the initial public tree. Two
reasons. The flip's scope stays minimal, and §5/§6 are the steps where a mistake is expensive and
hard to undo — adding a whole milestone in front of them buys nothing. And M3 spends real money on
the bake-off; there is no reason to couple that spend to the release schedule. Nothing about this
blocks M3 starting whenever the owner wants it, since no owner decision gates M3 tooling (D1 gates
committing translated text, which M3 keeps in the gitignored workspace).

**D1 is not triggered yet but will be.** That project gates the Bulgarian translation's licence on
"any public release". No translated text exists, so nothing blocks this flip. When `mhcbg` ships it
needs a `NOTICE` entry and a rights-matrix row, and
`test_every_shipped_work_is_declared_in_notice_and_the_rights_matrix` will fail until it has both —
which is the intended behaviour, not an obstacle.

### 4.3 Stale deployment choices

- ~~`render.yaml` describes an M0-era free-tier route and contains comments that no longer match the
  implemented service. **Resolved 2026-08-01: delete it.**~~ **Deleted — verified absent
  2026-08-13.** The README's Render-specific wording was already scrubbed in PR #30; no other
  references remain.
- ~~**Resolved 2026-08-02:** delete `.github/workflows/uptime.yml`; UptimeRobot is the sole uptime
  monitor and must probe `/ready`.~~ **Deleted — verified absent 2026-08-13.** This avoids duplicate
  alerts and recurring Actions runs.
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

The public app is named **DidacheDynamis** (decided 2026-08-01).

**Done 2026-08-14 (owner instruction), on `main` rather than in the sanitized tree.** This section
originally said the rename "lands in the sanitized tree before the first push, not in the private
repo's day-to-day history". It landed early instead, which is harmless — §5 rewrites this history
anyway, and the URLs now point where they will need to point. The trade is deliberate: the badge and
the `.github/` links are broken *now*, in a private repository only the owner reads, instead of
broken *after* the flip, in a public one with real reporters. Three of this section's own claims
turned out to be wrong when the work was actually done; they are corrected below.

- ~~README/docs product name, repository description/topics, and the `NOTICE`/attribution lines.~~
  Done for README, `CONTRIBUTING.md`, and the user/developer/deployment/extra docs. **The
  `NOTICE`/attribution lines were deliberately *not* renamed** — see the provenance carve-out below.
  Repository description/topics belong to the new repository and are set at §7.
- ~~**Hard-coded repository URLs.** Six of them~~ — **five, and the MIT badge was never one of
  them.** It is `[![License: MIT](…shields.io…)](LICENSE)`: the image is external and the link is
  relative to the repository root, which is exactly where a README relative link resolves. The real
  five are the CI badge (two occurrences of the same URL) and the four in `.github/`, and every one
  of those four is **absolute deliberately and must stay absolute**: `ISSUE_TEMPLATE/config.yml`'s
  security `contact_links.url`, because GitHub drops a `contact_links` entry it cannot resolve and
  the option then vanishes from the chooser with no error at all; and the `CONTRIBUTING.md` /
  `SECURITY.md` links in `PULL_REQUEST_TEMPLATE.md`, `ISSUE_TEMPLATE/content-correction.yml` and
  `ISSUE_TEMPLATE/bug-report.yml`, because templates are rendered into issue and pull-request
  bodies, where a relative link resolves against that item's URL rather than the repository root.
  All five now point at `htrendafilov/DidacheDynamis`.
- ~~GHCR image path becomes `ghcr.io/htrendafilov/didachedynamis` in `publish-image.yml` and
  Compose.~~ **`publish-image.yml` never hard-coded the path — but it did need an edit, for a
  reason the rename creates.** It built `IMAGE: ghcr.io/${{ github.repository }}`, and
  `github.repository` **preserves case**, so on `htrendafilov/DidacheDynamis` it yields
  `ghcr.io/htrendafilov/DidacheDynamis`, which Docker rejects outright: *"invalid tag: repository
  name must be lowercase"*. The first publish after the flip would have failed. Nothing was wrong
  while the repository was `bible_app_bg` — that name is already lowercase, so the rename is what
  arms the bug, and no test or local build would show it beforehand. The image name is now resolved
  in a step as `ghcr.io/${GITHUB_REPOSITORY,,}`, which also makes it match
  `deploy/docker-compose.yml`. `deploy/docker-compose.yml` and `plan/deployment/deployment_design.md`
  carried the literal path and are updated. The package itself is created by the first push from the
  new repo.
- **Provenance carve-out — `bible_app_bg` deliberately survives in the record.** `NOTICE`, the
  `source_version`/`attribution` constants in `apps/importer/bibleimport/cli.py`,
  `data/sources/*.info.json` (including the edition id `bible_app_bg-ed1`),
  `data/sources/README.md` and the SWORD module `.conf` builder all name it inside **dated edition
  identifiers** such as "CrossWire BaptistConfession1689 1.0.2 + bible_app_bg editorial revision 1
  (2026-07-29)". Those are historical facts about which edition was published under which name.
  Rewriting them would assert that a 2026-07-29 edition was issued under a name adopted in August,
  and would edit files §2.3 keeps precisely *as* rights and provenance evidence. `NOTICE` now
  carries a short paragraph explaining the former name instead. The one exception is `cli.py`'s
  `source_url`, which is a **locator, not an identifier**: it points at a file whose old path 404s
  after the flip, so it was repointed.
- **Not renamed:** the Cloudflare tunnel, and the code identifiers below (package names, i18n
  strings, SPA title). **The user-visible product name stays too — confirmed by the owner
  2026-08-17: the SPA title `Bible Reader` and the Bulgarian `app.title` "Библия" are not
  renamed.** This was raised as an open question because it is the one place the old name is
  read by users rather than by tooling, so leaving it was a decision to make rather than an
  omission to inherit. DidacheDynamis is therefore the name of the *project and repository*;
  what a reader sees at the top of the page describes what the app is.
  `bible.trendafilovi.net` is no longer the public domain. Verified live
  2026-08-14: `https://bible.trendafilovi.net/read` → **301** to `didachedynamis.com/read`,
  `didachedynamis.com/read` → **200**, and the `/embed.js` carve-out still **serves 200 rather than
  redirecting**, which is the one thing a blanket redirect would have broken. The checklist below is
  *not* fully ticked off — several items are done in reality but never struck through, so read it as
  a live list, not a finished one.
  An earlier version of this bullet also credited "the Caddy vhost", which has not been in this
  app's request path since the tunnel cutover; requests reach the origin through `cloudflared`.

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
8. ~~**If mail is ever put on a DidacheDynamis domain** (Proton, as with the existing domains): keep
   the three DKIM records **DNS-only (grey cloud)** — Cloudflare will otherwise proxy the CNAMEs and
   DKIM resolves to the proxy instead of Proton, so signing fails silently — and do **not** enable
   Cloudflare Email Routing on that zone, since it inserts its own MX records and fights Proton's.~~
   **Done 2026-08-17 — and both warnings were right.** Mail is on the domain: `conduct@` is live as
   a Proton Pass alias, the three DKIM CNAMEs were created unproxied, and Email Routing was never
   enabled. Full record, including two traps this item did not anticipate, at §7.6.
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
- ~~Code identifiers (`apps/*` package names, i18n strings, SPA title) can be renamed incrementally
  post-release; only user-visible branding blocks publication.~~ **Superseded 2026-08-17.** The
  user-visible part is not deferred work, it is *settled*: the SPA title and the i18n `app.title`
  keep their current names by owner decision (above), so there is no pending branding rename to
  block publication. What remains genuinely optional-and-later is the rest — `apps/*` package
  names and other internal identifiers, none of which a reader sees.
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

1. ~~Freeze pushes;~~ merge/close open PRs; delete obsolete remote branches; record all branch/tag/PR
   refs, LFS objects, and the current default-branch SHA. Record `git for-each-ref` in full rather
   than branches and tags alone, so anything under `refs/` that is neither (notably `refs/stash`,
   see step 2) is on the inventory instead of being discovered later.

   **Done 2026-08-18. The inventory is [issue #54](https://github.com/htrendafilov/bible_app_bg/issues/54)**,
   not a file in the tree: §5 rewrites every SHA it records, so a tracked copy would go through the
   rewrite that invalidates it and would publish under §5b (d). Issues sit outside git history.
   State captured: `main` at `fddfb1a`, **51 `refs/pull/*` heads, 0 tags**, `refs/stash` at
   `606d8e9` (untracked-files commit `9b19245`), and 11 LFS paths / 12 OIDs across all history.

   **"Freeze pushes" is not available on this repository and does not need to be.** Branch
   protection and rulesets both return `403 Upgrade to GitHub Pro or make this repository public`
   — they are paid/public-only features. Rather than upgrade, check what the freeze would exclude:
   **1 collaborator** (the owner), **0 deploy keys**, and no workflow that pushes back (`ci.yml`
   runs *on* push and never writes). There is no third party to lock out.

   **The untouched mirror from step 2 is the real freeze.** Once it exists, a later push cannot
   corrupt anything — it only makes the backup stale, which re-running this inventory detects. The
   exposure window is the interval between step 1 and step 2, with one person holding push rights.
   Archiving the repository read-only is genuinely available on this plan and is this repo's end
   state anyway (§0, path 2), but it blocks the §5b/§6/§7 records that still have to land here, so
   it belongs at §7 rather than in this step.
2. Make two backups: an untouched private mirror and a separate disposable mirror for rewriting.
   Never run the rewrite in the day-to-day checkout.

   **Neither clone source is clean, and they are dirty in different ways.** Whichever is used, the
   disposable mirror must have **both** `refs/stash` and `refs/pull/*` stripped before
   `git-filter-repo` runs. An earlier draft of this step said only "clone from `origin`, not from a
   local working copy", which fixes the first trap by walking into the second.

   *Cloning locally carries the stash.* Verified 2026-08-15: this checkout carries one stash entry
   (`bg-pr-unrelated-wip`) whose untracked-files commit `9b19245a` holds **74 `.ua/` files,
   3.0 MB** of local agent working data. `git clone --mirror .` copies it — `--mirror` maps
   `refs/*` to `refs/*` and `refs/stash` is under `refs/` — and `git-filter-repo` rewrites every
   ref it finds, so the stash would be carried through the sanitization rather than stripped by it.
   Nothing here is exposed today; the exposure would be created by the backup step.

   *Cloning from GitHub carries the pull refs.* Verified 2026-08-18: `git ls-remote origin` shows
   no `refs/stash` — so that half of the old advice holds — but it **does** advertise
   `refs/pull/*`, and a fresh `git clone --mirror` from GitHub pulls **all of them** — 51 heads at
   the step-1 snapshot, more by the time this is read. Those refs
   reach commits no branch does: `refs/pull/51/head` is still `722a388`, from which `3ec5165` (the
   verbatim `dropbox-api-token` false positive) is reachable even though PR #51 was squash-merged
   and its branch deleted (§1.4). `gitleaks git` over that mirror returns **4**, including that
   commit. Merging, squashing and deleting branches does not retire a pull ref; only GitHub can,
   and §5 step 5 already records that `refs/pull/*` is read-only and rejects pushes.

   Strip them explicitly after cloning and before rewriting — do not assume `--mirror` gave you
   only branches and tags:

   ```
   git for-each-ref --format='delete %(refname)' refs/pull refs/stash | git update-ref --stdin
   git reflog expire --expire=now --all && git gc --prune=now
   ```

   **Rehearsed 2026-08-18 at `~/mydev/bible_app_bg_rewrite/` (outside the working tree). The recipe
   works, measured rather than assumed:**

   | mirror | heads | `refs/pull` | LFS objects | size | `gitleaks git` |
   |---|---|---|---|---|---|
   | `backup-mirror.git` (untouched) | 2 | **51** | 12 | 50 MB | — keeps everything, including `3ec5165` |
   | `rewrite-mirror.git` (stripped) | 2 | **0** | 12 | 50 MB | **3** |

   Before the strip the disposable mirror scanned **4**; after it, **3** — and `git cat-file -e
   3ec5165` reports the object *gone*, not merely unreferenced, so deleting the refs and running
   `gc --prune=now` genuinely removes it. `git fsck` is clean. The three survivors are the
   deliberate fake OpenRouter sentinels in the chat tests, i.e. exactly the known noise §6 says to
   allowlist and nothing else.

   **A `--mirror` clone fetches no LFS objects.** The backup was 7.1 MB and looked complete; the
   real content is 43 MB and arrived only after an explicit `git lfs fetch --all`. Without that
   step the "backup" is a full ref graph in which every source file is a pointer to data that was
   never copied — a failure that stays invisible until the moment it is needed. Run
   `git lfs fetch --all` against **both** mirrors and check `find <mirror>/lfs/objects -type f`
   returns the OID count from step 1, not a clone's exit status.

   **Strip the disposable mirror only.** The untouched backup is supposed to retain `refs/pull/*`
   and the commits being removed — that is what makes it the record rather than a second copy of
   the sanitized result.

   **Re-take both mirrors immediately before step 3.** A mirror is a point-in-time snapshot, and
   the one taken here is already stale: it holds **2 heads** where step 1's inventory recorded 1,
   because a plan commit was pushed between the two steps. Harmless in itself, and a working
   demonstration of why "freeze pushes" is in step 1 — but it means what exists now proves the
   procedure, and is not the final rewrite input.

   **`git log --all` is not sufficient evidence that a path is absent — but not for the reason an
   earlier draft of this step gave.** That draft said `--all` "reads neither `refs/stash` nor
   `refs/pull/*`". That is simply false: `--all` walks every ref under `refs/`, both namespaces
   included, whenever they exist locally. Measured 2026-08-18 — in this checkout `git log --all`
   lists the stash's untracked-files commit `9b19245`, and in a GitHub mirror it lists `3ec5165`.

   The two real reasons, which matter because they call for different countermeasures:

   - **Path-limited log applies history simplification.** `git log --all -- .ua/` returns
     **0 commits** while `git log --all --full-history -- .ua/` returns **2**. The commits are
     right there on a walked ref; simplification hides them. Any "is this path gone?" check must
     pass `--full-history`, or it reports clean on history that is not.
   - **A day-to-day checkout never fetched `refs/pull/*` in the first place.** `--all` cannot walk
     what was never fetched, so a local scan is silent about the whole `refs/pull/*` namespace —
     51 refs at the step-1 snapshot — that a mirror clone will happily bring along. The gap is in
     what is present locally, not in what `--all` covers.

   `.ua/` and `.claude/` are gitignored and return 0 commits under a path-limited `--all`, which is
   exactly what a clean result looks like — and the 3 MB is there the whole time. Enumerate with
   `git for-each-ref`, check both namespaces explicitly, and use `--full-history` for any
   path-absence claim.
3. Use `git-filter-repo` 2.47+ with sensitive-data removal mode:

   **Inputs prepared and verified 2026-08-22**, in `~/mydev/bible_app_bg_rewrite/` alongside the
   mirrors — outside the repository, mode `600`, never committed (§1.2).

   *`replacements.txt` — 11 rules.* (**9 when first built; two more were added during step 4 —
   see the finding recorded there.**) Every rule was checked against history and none is dead: the
   operator home path (4 blob-change commits), four password-store entry names (2 each), the origin
   IP (6), the operator username (10 blobs **and 1 commit message**), and the former employer npm
   registry host (4 — a single historical `apps/web/package-lock.json` blob, `82eef888b2`, with 366
   `resolved` entries). A sweep for uncovered public IPv4s and `/home/` paths found nothing beyond
   `/opt/bible-app`, itself a generic value from an earlier scrub, included as optional cosmetic
   harmonisation. **Rule order is load-bearing:** `/home/<operator>` must precede the bare username
   rule, or the compound resolves to `/opt/bible-app` instead of `/opt/bible-app`.

   **Two properties of the expressions file, both verified against `git-filter-repo` 2.47.0 rather
   than assumed, and both capable of silently ruining the run:**

   - **`--replace-text` edits blob contents only. Commit and tag messages need `--replace-message`,
     which takes the same file.** Pass `replacements.txt` to *both* options. This is not academic
     here: one rule matches a commit **message** (`bba5c42`, the decision-8 commit) and nothing
     else, so with `--replace-text` alone that occurrence survives the entire rewrite. Tested on a
     scratch repository — with only `--replace-text`, the blob was rewritten and the message
     containing the same string was left untouched.
   - **`#` is not a comment in this file.** `get_replace_text()` skips only *empty* lines; it has
     no comment handling, unlike `get_paths_from_file()` immediately below it in the same source.
     Every `#` line is therefore a live literal rule whose replacement defaults to `***REMOVED***`.
     The first version of `replacements.txt` carried 11 annotation lines and so loaded **20 rules,
     not 9** — and a scratch test confirms the failure is real rather than merely untidy: a `#`
     line matching text in a blob replaced it with `***REMOVED***`. Annotations now live in a
     sidecar `replacements.NOTES.md` that is never passed to the tool, and the rule count is
     verified by calling `FilteringOptions.get_replace_text()` directly rather than by counting
     lines — **11 literals, 0 regexes, no `#`-prefixed rules** at the state that was actually run
     (9 at first authoring). Re-run that check after any edit to the file: the count is the one
     number here that a human eye gets wrong, because comments look like they do not count. The mailmap parser is unaffected — it strips comments explicitly, and
     that too was checked by running it.

   Note also that
   HEAD is already clean of all three principal values — every occurrence is history-only, which is
   the case for the rewrite in one sentence: nothing is wrong with the repository you see, and
   everything is wrong with the one you would publish.

   *`mailmap` — 2 lines.* History carries only **4 distinct addresses across 514 author+committer
   slots**, with a consistent display name, so no name normalisation is needed. Verified without
   rewriting anything, via `git -c mailmap.file=… log --use-mailmap`: 4 addresses collapse to
   **2**, the target takes **464 slots** (378 employer + 54 already-correct + 32 Yahoo), and
   `noreply@github.com` keeps its **50** — deliberately unmapped, since rewriting it would
   attribute merge commits to a human who did not make them.

   *Decision 8 re-confirmed.* A commit already authored with the target address resolves through
   the API to `author.login: htrendafilov`, so the rewritten history will attribute to the owner's
   account rather than to nobody. This is the check that decides whether the rewrite has to be done
   once or twice.

   - remove every historical path of the live runbook;
   - remove every historical `data/sources/KJV.imp.gz` path and its LFS object so the new repository
     never receives the KJV export, even during its private verification phase;
   - remove every historical `plan/mhc_translation/` path (§2.2 — the translation project's planning
     history stays out of the public tree; only its finished result is intended to reach it).
     **Two passes, rename first** (§5b b). The directory is untracked in the working tree, but it
     appears in **five commits reachable from `main`** (§5b lists them; a sixth, `10200df`, is
     reachable only through `refs/pull/51/head` and is therefore absent once step 2's strip has
     run). Count it with `git log --full-history main -- plan/mhc_translation/` — **without
     `--full-history` the merge commit disappears**, which is exactly how the superseded
     four-commit figure was produced. `git-filter-repo` rewrites history rather than `HEAD`.
     So first rewrite the historical path of the one file ever tracked there —
     `--path-rename plan/mhc_translation/08_english_baseline.md:plan/mhc_english_baseline.md` —
     which preserves the M1 measurement history the baseline's credibility rests on. Only then
     remove `plan/mhc_translation/`, which by that point is genuinely empty in history. Removing it
     in a single pass would keep the file and delete the commits that produced it. Re-check before
     running that nothing tracked has reappeared under the directory;
   - replace the origin, operator/path, and internal-registry strings using a replacement file stored
     outside the repository, passed to **both `--replace-text` and `--replace-message`** — the
     first rewrites blob contents, the second commit and tag messages, and at least one value here
     occurs only in a message;
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

   **Run 2026-08-23 against `main` `18b0e9f`; rewritten head `375b799`, 253 → 247 commits (six lost
   their only content). Nothing pushed. The inspection earned its place — it caught two defects the
   rewrite reported no error for.**

   **(i) `--mailmap` rewrites commit *metadata* only.** An old address occurring in *file content*
   or a *commit message* is untouched by it — and the addresses were deliberately kept out of
   `replacements.txt` because §1.2 assigns them to the mailmap. Between the two mechanisms the
   address surface was uncovered. The first run left the employer address in **one commit message**
   and in **two historical `plan/going_public.md` blobs**, where an example mailmap block and a
   statistics table quoted it literally. HEAD was clean — the §1.2 fix of 2026-08-11 removed it
   there — which is exactly the trap §6 already names: fixing at `HEAD` does not remove history,
   and only §5 does. Except §5, as written, did not. **Both old addresses are now explicit rules in
   `replacements.txt`, placed *before* the bare-username rule** — without that ordering the
   username rule rewrote only the address's local part, mangling it into a plausible-looking
   address instead of removing it.

   **(ii) Removing an LFS *pointer* does not remove the LFS *object*.** After the path removal the
   mirror still held **12 stored objects against 11 referenced** — the KJV blob `6155ed9188…`,
   3.8 MB, orphaned but physically present, exactly the artefact §5 step 3 says to remove. It would
   not have been pushed by a normal `git lfs push` (nothing references it), but a wholesale copy of
   the mirror carries it, and the step asks for its removal rather than its unreachability.
   `git lfs prune` **does** clear it in a bare mirror with no remote — verified, contrary to the
   expectation that it would be retained — leaving 11 stored against 11 referenced. **Verify by
   counting stored versus referenced objects, not by trusting the path removal.**

   Post-fix state, all re-run from a fresh clone: **11/11 replacement rules clean in blobs *and*
   messages; 0 blobs and 0 message lines containing either old domain; 443 target + 51 GitHub
   `noreply` identity slots across 2 distinct addresses; the three removed paths at 0 commits each;
   `crossreferences_kjv.tsv` retained** (it matches `*kjv*` and is not the KJV); **LFS 10 paths /
   11 OIDs with the KJV absent; `git fsck` clean; `gitleaks` 3 — the known chat-test sentinels and
   nothing else; one ref, `refs/heads/main`.** `plan/mhc_english_baseline.md` carries **5 commits**
   of history rather than appearing fully formed, which is §5b (b) working as intended.
5. ~~Push the complete rewritten mirror only after approval.~~ **Done 2026-08-23.** Pushed to
   `htrendafilov/DidacheDynamis` at `08f94a4` — 248 commits, `refs/heads/main` only, no tags, no
   `refs/pull/*`, no `refs/stash`. The 11 LFS objects (40 MB) were pushed explicitly with
   `git lfs push --all`: a `--mirror` clone fetches no LFS objects, so they do not follow the refs
   and a mirror that looks complete can still be a repository of dangling pointers.

   The `refs/pull/*` warning stands and is now visible from the other side. `DidacheDynamis` grew
   its own `refs/pull/1/head` when PR #1 was **opened** (2026-08-30), not when it merged: GitHub
   creates the ref at open, so an unmerged PR already produces the problem — `refs/pull/3/head`
   and `refs/pull/4/head` exist while those PRs are still open, alongside their `/merge` refs. Pull
   refs are created by GitHub, are unreachable from any branch, are never deleted, and are fetched
   in full by `git clone --mirror`, so the ref-set-dependent counting problem this document records
   for the archive applies to the new repository from its **first PR**, not its first merge.
6. If retaining the current GitHub repository, follow the GitHub Support procedure for affected PR
   refs/caches when eligible. If Support will not purge the non-credential metadata, return to the
   release-strategy decision rather than claiming full removal.
7. Delete or rebase every other clone/worktree. Never merge an old branch into rewritten history.

### 5b. Disposition decisions — RESOLVED 2026-08-15 (owner)

Three dispositions were being made by whatever the filter command happened to do rather than on
purpose. All three are now settled, and all three were settled the same way: **publish, and make the
tree match the decision instead of relying on the rewrite to enforce it.**

**(a) The M1 corpus baseline publishes.** `08_english_baseline.md` has been **moved out of
`plan/mhc_translation/` to `plan/mhc_english_baseline.md`**, which is the point of the decision, not
a detail of it: §5's removal of `plan/mhc_translation/` can now stay a blunt, whole-directory
command with nothing to carve out. It was reviewed before the move and contains only English
public-domain corpus measurements — per-book entry, block, run, word and token counts, the corpus
totals, and the quotation-heuristic audit. No Bulgarian text, no vendor pricing, no model selection,
no cost projection. Publishing it is what lets a reader check §4.2b's completeness claim and
`NOTICE`'s "None to the text" rather than take them on trust, and
`apps/importer/tests/test_study.py` cites it by path in a checksum-failure message — that path is
updated, and the file's one reference to the unpublished master plan is rewritten so it stands
alone.

**(b) `plan/mhc_translation/` is untracked in the working tree again — but that is not the same as
the removal being a no-op, and the distinction matters.** `git-filter-repo` rewrites *history*, not
`HEAD`. The directory appears in **five historical commits** — re-measured 2026-08-18 during §5
step 1; the earlier list of four was taken before PR #51 merged and is stale in both directions.
The only file ever tracked under it is the baseline itself, confirmed by enumerating every tree
that ever existed below the directory rather than by reading the log:

```
ebe7a79 docs(5b): settle disposition decisions, move the M1 baseline out (#51)
3fc375b Merge pull request #46 from htrendafilov/feat/m1-mhc-corpus-repair
f8e4165 docs(m1): record M1 as done, mapped clause by clause to the tests
fb7c81e fix(m1): classify by coordinates, not length; correct the quotation figure
dd94b09 feat(m1): tests, quotation measurement, and the repaired corpus baseline
```

Two corrections in that list, both the kind that only surface when the command is actually run.
`10200df` was the pre-squash commit on `docs/5b-disposition-decisions`; PR #51 was squash-merged, so
what is on `main` is `ebe7a79` and `10200df` is reachable only through `refs/pull/51/head`. And the
**merge commit `3fc375b` was never listed at all** — a merge that carries the path is as much part
of the rewrite input as the commits it joins.

So a plain `--path plan/mhc_translation/ --invert-paths` would strip the baseline's own history while
keeping the file. The public repository would show `plan/mhc_english_baseline.md` appearing
fully-formed at the move commit with no trace of the measurement that produced it — a document whose
entire value is being checkable, published in the one shape that makes it look fabricated. The three
M1 commits survive, since they carry tests and the audit script too; only the baseline blob would be
cut out of them.

**Therefore §5 runs this as two passes, rename first:** rewrite the historical path
`plan/mhc_translation/08_english_baseline.md` → `plan/mhc_english_baseline.md` across all history,
*then* remove `plan/mhc_translation/`. After the rename the directory really is empty in history, so
the removal becomes the genuine no-op the earlier draft assumed it already was, and the baseline
keeps the commits that made it evidence.

Keep the removal in the invocation either way. The directory was untracked before too, and stayed
that way right up until PR #46 quietly tracked a file inside it.

**(c) M3 runs after the flip; `scripts/mhc_bg/` becomes public when it is written.** No pre-flip
milestone, and nothing to remember on flip day. §4.2b raised this because the tooling sits *outside*
the excluded path and would ship publicly as ordinary MIT code — which is accepted, just not on day
one. The flip's scope stays as small as possible, which matters because §5 and §6 are the steps
where mistakes are expensive and hard to reverse.

**(d) This file publishes.** **Update 2026-09-02: the published copy is now the authoritative one.**
The archive's copy stops at the rewrite. Everything after it — §5 step 5, the executed §6 gate, the
§7 completions — is recorded here on `DidacheDynamis`, because a public record of how a repository
was sanitized is worth very little if it describes the process as still pending. The archive keeps
the pre-flip history; this copy keeps the outcome. The two diverge deliberately from `08f94a4`.

`plan/going_public.md` never stated its own disposition and is tracked,
so it was shipping by default. Now deliberate: it is a public record of how the repository was
sanitized, which is worth more than the little it discloses. No private *values* remain in it (§1.2
compliance fixed 2026-08-11) — it names categories and procedures, not secrets. Its two citations of
the unpublished `07_master_plan.md` are rewritten as plain prose, since a public document citing one
nobody can read is the same broken pointer the baseline decision exists to avoid.

## 6. Verification gate

All of these must pass before visibility changes:

- a secret scanner over every rewritten ref, with findings reviewed rather than merely counting a
  zero exit code. **Baseline established 2026-08-15** with `gitleaks` 8.30.1 over 203 commits:
  **9 findings, all reviewed, none a real credential.** (As of 2026-08-15, before the rewrite and
  before the allowlist, scanning the archive's `main` reported 9 — this is a historical baseline,
  not the present `DidacheDynamis` count, which is 0 with `.gitleaks.toml` and was 3 without it;
  see the note after the table about a 10th that exists only on the PR branch that wrote this
  section.)

  | # | Rule | What it actually is |
  |---|---|---|
  | 1–3 | `generic-api-key` | `sk-or-v1-TESTSENTINEL…` / `sk-or-v1-E2ESENTINEL…` in `ChatPanel.test.tsx`, `ChatPanel.injectionCorpus.test.tsx`, `e2e-chat/chat.spec.ts` — deliberately fake sentinels whose whole job is to prove a key never leaves the browser |
  | 4–9 | `dropbox-api-token` | false positives inside the stashed `.ua/` files on a JSON value that concatenates a test filename, a colon, and a class name (entropy 3.46) — a source reference, not a token. **Deliberately paraphrased rather than quoted:** an earlier draft of this table pasted the literal string, which made the rule fire on this very file and turned a 9-finding baseline into a 10-finding one. A document describing a scanner false positive must not reproduce it |

  Two consequences rather than a clean bill of health. The sentinels are shaped like real OpenRouter
  keys, so GitHub's own secret scanning will flag them on the public repository forever; allowlist
  them **before** the flip so §6's scan is meaningfully clean and a genuine leak cannot hide inside
  known noise. **Use a path/regex rule in `.gitleaks.toml`, not `.gitleaksignore`.** A
  `.gitleaksignore` entry is a fingerprint of the form `<commit>:<path>:<rule>:<line>`, and §5
  rewrites every commit SHA — so an allowlist built before the rewrite silently stops matching
  after it, which is the worst possible failure for a suppression file: it does not error, it just
  stops suppressing, and the first post-flip scan comes back dirty for reasons nobody remembers.
  Build it after §5 or key it on path and pattern rather than commit.

  **Landed 2026-08-31 as `.gitleaks.toml` on `DidacheDynamis` (PR #1)**, keyed on path and pattern
  as this paragraph requires: 3 findings before, 0 after, and no `.gitleaksignore` fingerprints to
  go stale.

  **A trap worth recording, because the first version of the file shipped with it.** A *global*
  `[[allowlists]]` block carrying `paths` is not evaluated per finding. In `gitleaks dir` it is
  applied as a whole-file skip **before** any finding is considered, so `condition = "AND"` never
  gates anything and a genuine key committed to one of those test files is suppressed along with
  the sentinels. `gitleaks git` does not behave that way — it keeps evaluating findings inside
  allowlisted paths. Measured on 8.30.1 against the real history plus two injected fixtures, a
  non-sentinel key in an allowlisted file and a sentinel-shaped key outside those paths:

  | config | `gitleaks git` | `gitleaks dir` |
  |---|---|---|
  | no config | 5 | 5 |
  | global allowlist, no `targetRules` | 2 | **1** |
  | `targetRules = ["generic-api-key"]` | 2 | 2 |

  The fix is `targetRules`, which attaches the allowlist to the rule rather than to the scan. The
  process lesson is larger than the config: **the first verification passed honestly and proved
  nothing**, because it exercised one scan mode and the hole was in the other. A suppression rule
  is only verified once it has been made to *fail* — an allowlist that has never been shown to
  still report something is indistinguishable from a blind spot, and both look like a zero.

  **A scanner baseline is a statement about history, not about the working tree.** An earlier draft
  of the table above quoted the false-positive string verbatim, which made the rule fire on this
  file and took the count to 10. Rewording it at `HEAD` did *not* restore 9: `gitleaks git` walks
  commits, and the commit that introduced the literal still contains it. That commit
  (`3ec5165` on `docs/5b-disposition-decisions`) is not on `main`, so the outcome depends on how
  that PR is merged — **squash-merge keeps the literal out of `main` entirely and the baseline
  stays 9; an ordinary merge commit carries it in permanently** and the allowlist must then cover
  `plan/going_public.md` for `dropbox-api-token` forever. Worth stating plainly because it
  generalises: between now and the flip, anything committed and later "fixed" is still in history,
  and only §5 removes it. And findings 4–9 only appeared because
  `gitleaks git` reads `refs/stash` — see §5 step 2; the scan found the stash before the ref audit
  did.

  **More precisely: it is a statement about the refs the scanner could see, and that number is not
  portable.** PR #51 was squash-merged and its branch deleted, so the local checkout now reports
  the expected 9. The same history scanned from a GitHub mirror reports **4** — no stash, but
  `refs/pull/51/head` still reaches `3ec5165` (§1.4, §5 step 2). Neither number is wrong and
  neither is the baseline on its own. **State the ref set alongside any count**, and run the §6
  scan against the *rewritten mirror that will actually be pushed*, after `refs/pull/*` and
  `refs/stash` have been stripped — the count from a day-to-day checkout says nothing about what
  ships;
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
- **Gate executed against the pushed candidate, 2026-08-23 to 08-31:**

  | check | result |
  |---|---|
  | secret scan over every rewritten ref | 3 findings, all known chat-test sentinels; 0 unexplained |
  | decision 8 addresses | 0 commits carry the employer or Yahoo address; 100/100 sampled resolve to `htrendafilov` |
  | replacement-map values | all 11 absent from tree, history **and** commit messages |
  | removed paths | `data/sources/KJV.imp.gz` and `plan/mhc_translation/` absent from all history |
  | LFS | 11/11 objects upload-verified and resolving to real content in a fresh clone |
  | `ci.yml` on the **new** repository | run `32662863897` green; 638 log lines reviewed, no value hits |
  | anonymous-access rehearsal | **done 2026-09-03**, after the flip — see below |
  | GitHub secret scanning | **enabled 2026-09-03**, with push protection; 0 alerts |

  The last two could only be completed after the visibility change, which is a property of the plan
  rather than an oversight: rehearsing anonymous access requires anonymous access to exist. Both are
  now closed.

  **Anonymous rehearsal, 2026-09-03.** Run with no credentials and no git config at all
  (`GIT_TERMINAL_PROMPT=0`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_SYSTEM=/dev/null`), because a
  rehearsal that quietly uses the operator's own credential helper proves nothing about what a
  stranger sees: clone succeeded at `15aab3c`; `git lfs pull` fetched **all 9 LFS files as real
  content, not pointers**; `data/sources/KJV.imp.gz` absent from every ref; the source tarball
  downloaded anonymously at 4.1 MB.

  **Secret scanning found 0 alerts, and the reason matters more than the number.** §6 predicted the
  three `sk-or-v1-…SENTINEL` keys would alert forever and need dismissing. They do not:
  `secret_scanning_non_provider_patterns` is **off by default**, so GitHub matches only partner
  provider patterns and OpenRouter is not one. `.gitleaks.toml` remains the thing that keeps the
  local scan clean; GitHub's scanner never reads it. Turning non-provider patterns on would be more
  thorough and would immediately raise those three as false positives — a deliberate trade, not a
  default to drift into.

- MHC corpus repair landed and verified (§4.2b): 66 books present, the source's 5,506 keys fully
  accounted for, and `NOTICE`'s "None to the text" true of what actually ships. Verified against a
  rebuilt DB on 2026-08-13; **re-verify against the deployed API**, not the build — as of that date
  production still served the 48-book corpus, so a green build proved nothing about the site;
- the **new** repository's own workflow runs reviewed, not this archive's. Pushing the mirror
  triggers `ci.yml`, and those logs are public after the flip — check them for anything the runner
  echoed, or keep Actions disabled on `DidacheDynamis` until the tree is verified (§1.4);
- ~~decision 11 answered and recorded: whether the KJV ships inside the published
  `content.sqlite` and GHCR image, or is excluded from the distributed artifacts.~~ **Answered
  2026-08-06 — it ships (§8).** What remains verifiable here: `LICENSES/GPL-2.0.txt` is present,
  `NOTICE` §3 carries the CrossWire attribution, and the app's attribution UI still shows the KJV
  terms in the built artifact.

## 7. Publication and post-flip checks

The target repository **`htrendafilov/DidacheDynamis`** was created 2026-08-01 and held **private**
deliberately, so the §6 gate ran before anything was publicly reachable.

**It went public on 2026-09-03**, at `cb3a610`, after a final pre-flight: gitleaks clean in both
`git` and `dir` modes, only `hristo@trendafilovi.eu` and `noreply@github.com` across all history,
the removed paths absent, and no open PRs. Protection was created in the same session (item 3).
What follows is what the flip actually did, kept in the past tense on purpose — a plan that
describes a completed process in the future tense is the failure this document has hit more than
once.

1. Temporarily restrict writes during the cutover.
2. ~~Push the verified sanitized mirror to `DidacheDynamis`; set description and topics.~~
   **Refs pushed 2026-08-23** (CI run `32662863897`); **description and topics set 2026-08-30.**
   11 topics set (`bible`, `bible-reader`, `bulgarian`,
   `sword-project`, `react`, `typescript`, `fastapi`, `python`, `sqlite`, `fts5`, `self-hosted`).
3. ~~Immediately restore branch/ruleset protection.~~ **Done 2026-09-03, in the same session as
   the flip.** Ruleset `22153211` on `~DEFAULT_BRANCH`, active and verified enforcing: `deletion`,
   `non_fast_forward`, `pull_request` (0 required approvals — a solo maintainer cannot approve their
   own PR, so requiring one would deadlock), and `required_status_checks` on `check`. Repository
   admin has `bypass_mode: always`, so a stuck required check can never lock the owner out.

   **"Restore" was the wrong word and it hid something.** Nothing was disabled by the visibility
   change, because nothing existed: the rulesets endpoint returned
   `403 Upgrade to GitHub Pro or make this repository public` for the entire private life of both
   repositories. This was first-time protection, and the window it closes is real — between the
   flip and the ruleset there is a public, unprotected repository.
4. ~~Configure public-fork Actions approval, read-only default `GITHUB_TOKEN`, Dependabot, secret
   scanning/push protection, and code scanning.~~ **Done 2026-09-03.** Secret scanning and push
   protection on; Dependabot alerts and security updates on; fork-PR approval tightened from
   GitHub's default `first_time_contributors` to **`all_external_contributors`**, so a returning
   outside contributor cannot run workflows unreviewed either. `GITHUB_TOKEN` was already
   `read`-only and unable to approve pull requests.

   **Dependabot found 11 vulnerabilities within minutes** — 4 auto-dismissed (`brace-expansion`),
   7 fixed (4 high, 3 moderate), all in `apps/web/package-lock.json`. They predated the flip; going public
   only made them visible, to us and to everyone else. The open alert count is now 0. One was not a version bump: `@tiptap/core` 3.30 changed `setContent`'s second argument
   from an `emitUpdate` boolean to an options object, and preserving `emitUpdate: false` is what
   keeps *opening* a note from firing `onUpdate` and marking it dirty.
5. ~~Set repository features to match decision 9.~~ **Done 2026-08-30/09-01.** Issues on;
   Discussions, Wiki and Projects off. The **`content`** label was created 2026-09-01 and
   `content-correction.yml` repointed at it (PR #2) — **label first, form second**, because GitHub
   drops a label an issue form names but the repository lacks and does so silently: the issue files
   unlabelled with nothing in the UI to say why. Landing the form change first would have opened a
   window of unlabelled content reports. Labels do not travel with a tree, so this could not be
   inherited from the archive or carried by the mirror push.

   Original wording, for the record: set repository features to match decision 9: **Issues on**,
   **Discussions off**, Wiki and Projects off. The issue forms ship in the tree and appear automatically once Issues are on;
   `CODE_OF_CONDUCT.md` and `CONTRIBUTING.md` are picked up by GitHub's community profile.
   Create the **`content`** label and point `content-correction.yml` at it — labels do not travel
   with the tree, and GitHub drops a label a form names but the repository does not have, silently.
   The form ships pointing at `documentation`, which exists, so it degrades rather than breaks.
6. ~~**Create the `conduct@didachedynamis.com` alias before Issues are enabled.**~~
   **Done and verified end-to-end 2026-08-17 — this item is closed.**
   `CODE_OF_CONDUCT.md` tells reporters not to raise conduct concerns publicly and names that
   address as the private route. A GitHub profile is not a channel — profiles carry no private
   messaging, and this one publishes no contact — so without the alias the document forbids the
   only route it leaves open. Same failure as SECURITY.md pointing at a Security tab that did not
   exist (§7.6): the document is only true once the channel does.

   **Mechanism: a Proton Pass alias on the domain**, not a Cloudflare Email Routing forward. DNS
   stays at Cloudflare; mail does not. The zone now carries `mx1`/`mx2.alias.proton.me`,
   `v=spf1 include:alias.proton.me ~all`, three `*._domainkey` CNAMEs to `alias.proton.me`
   (**unproxied** — Cloudflare defaults new CNAMEs to the orange cloud, which returns its own IPs
   instead of the target and breaks DKIM lookups), and `_dmarc` at
   `v=DMARC1; p=quarantine; pct=100; adkim=s; aspf=s`. The site's apex/`www` tunnel records are
   untouched.

   **Two traps worth recording.** First, Proton validates the DMARC record by **string equality,
   not by parsing it**: a valid, spec-legal `rua=` tag appended to their recommended value made the
   dashboard report the domain as misconfigured. Their published string is the only string that
   verifies. Second, `dkim02`/`dkim03` publish no key — they are empty rotation slots Proton
   pre-provisions so it can rotate without touching DNS again. Any external DKIM checker will call
   them missing; only the `dkim` selector signs.

   **Verified against Gmail rather than declared done**, because a channel a published document
   forbids public alternatives to is exactly the wrong thing to assume works. Inbound reached the
   inbox, not spam; the reply went out as `From: conduct@didachedynamis.com` with no trace of the
   maintainer's mailbox; and Gmail returned `dkim=pass header.i=@didachedynamis.com`,
   `spf=pass`, `dmarc=pass (p=QUARANTINE dis=NONE)`. **Both** mechanisms align under `s` strict:
   SimpleLogin sets the return-path at the alias's own domain (`sl.…@didachedynamis.com`) rather
   than at theirs, and sends from an IP inside the `/28` that `alias.proton.me` publishes — so
   `aspf=s` aligns, which is not what forwarding usually does to SPF.

   The CoC's "can be rotated if it is abused" holds and needs no edit: a Pass alias can be
   **disabled**, which stops delivery while keeping the address reserved so nobody else can claim
   it — a strictly better answer than deleting a forward and leaving the published address to
   bounce.
7. ~~**Enable private vulnerability reporting** (Settings → Code security).~~ **Done 2026-09-03;
   `enabled: true`.** `SECURITY.md`'s "Report a vulnerability" button now exists. `SECURITY.md` sends
   reporters to the Security tab's "Report a vulnerability" button, and that button does not exist
   until this is switched on — GitHub offers the feature for **public repositories only**, so it
   cannot be enabled on `bible_app_bg` in advance and must be done here, right after the flip.
   Until then `SECURITY.md`'s fallback (open an issue asking for a private channel, no details)
   is the only route. There is no automation to add: `repository_advisory` is not an event that can
   trigger a workflow, and reading unpublished advisories over the API needs a token with
   `repository_advisories:read`, which is not worth storing as a secret in a public repository.
   GitHub already notifies maintainers on submission and confirms receipt to the reporter.
8. ~~Deliberately set GHCR package visibility and source linkage; do not assume it follows the
   repo.~~ **Done 2026-09-03.** `publish-image.yml` was dispatched by hand for the first time
   (`deploy_to_vm` left off; the rollout job skipped, which is a success rather than a failure).
   `ghcr.io/htrendafilov/didachedynamis` now exists at `latest` and `4b22ef7…` — 11 layers,
   156.5 MB — and is **public**, which is the intended end state under decision 11 since the KJV
   ships inside `content.sqlite` and the image.

   **Confirmed by an anonymous pull, not by reading the API field.** A fresh unauthenticated GHCR
   token fetched the manifest; the field says what GitHub believes, the anonymous fetch says what a
   stranger actually gets. Note *how* it became public: GitHub's default, not a choice — which is
   exactly this item's point. A private repository would have produced the same default silently.

   **The run also exercised a trap the rename armed.** `github.repository` preserves case, so on
   `htrendafilov/DidacheDynamis` the untreated name is `ghcr.io/htrendafilov/DidacheDynamis`, which
   Docker rejects outright. The `${GITHUB_REPOSITORY,,}` lowercasing step handles it and produced
   `ghcr.io/htrendafilov/didachedynamis` — but that step had never executed before, because
   `bible_app_bg` was already lowercase and could not have exposed it. It is now tested rather than
   assumed.

   **What the image is for, recorded because it is easy to misread:** the container path is
   Option 2 in `docs/deployment/hosting-options.md`, for other people and other hosts. Production
   remains Option 1 — native systemd + gunicorn, released with the operator's local
   `scripts/release.sh` — and this publish never touched it. The four VM secrets
   (`VM_HOST`/`VM_USER`/`SSH_DEPLOY_KEY`/`DEPLOY_DIR`) still do not exist, so the rollout could not
   run even if requested.
   ~~Also settle the **old** `ghcr.io/htrendafilov/bible_app_bg` package: an image holding a full
   `content.sqlite` was pushed to it on 2026-07-25 and may still be there (§1.4 — current state
   unverified, needs `read:packages`). Check, then delete it or confirm it is private. It is not
   covered by the repository staying private.~~ **Done 2026-08-18: it was private throughout and
   is now deleted — §1.4 carries the digest and tags in case the 30-day restore window is ever
   needed.**
9. ~~Recreate the `DROPBOX_APP_KEY` Actions secret on the new repository.~~ **Done 2026-08-30
   (owner).** Repo-level secret, no environments configured and no `environment:` on the job, so it
   resolves where `publish-image.yml` reads it. The **value** cannot be verified through the API —
   secrets are write-only — but it need not be: `VITE_` means Vite inlines it into the client
   bundle, so it ships to every browser and can be read back from the deployed site and compared.
   The two failure modes differ and neither is loud. An **empty or missing** secret makes
   `isDropboxConfigured()` false, and `DropboxSyncSettings` replaces the Connect button with the
   `dropbox.notConfigured` warning — the section stays, so this is at least visible to anyone who
   opens settings. A **mistyped but non-empty** value returns true, so the UI looks entirely
   normal and the failure surfaces only when a user clicks Connect and OAuth is rejected at
   Dropbox's end. Only the second case needs the bundle comparison; the first announces itself.

   Original wording, for the record: recreate the `DROPBOX_APP_KEY` Actions secret — secrets do not transfer,
   and `publish-image.yml` builds the SPA with it, so without it a published image would ship a
   build whose Dropbox sync cannot authenticate.
10. Verify Actions secrets still exist, workflow permissions are minimal, and untrusted fork PRs do
    not receive secrets or write tokens.
11. ~~Check README badges, community profile, LICENSE/NOTICE rendering, LFS download, release
    build, and the live site.~~ **Done 2026-09-03.** Community profile **100%** (code of conduct,
    contributing, licence, PR template, readme); MIT badge resolves; LFS and the source archive
    verified anonymously under §6 above. The deployed site was checked the same day and matches
    `main`: the SPA carries build id `cb3a610`, and `content.sqlite` had been rebuilt, so the
    Strong's pronunciation fix is live and MHC serves all 66 books — the §4.2b claim is now true of
    production and not merely of a build, which is the distinction that made it worth re-checking.
12. Watch Actions/LFS usage and security alerts during the first week. **Open — started
    2026-09-03.** Two things worth watching specifically rather than generally: the GHCR package in
    item 8, which does not exist yet; and CI stability now that `vite.config.ts`'s `retry: 2` has
    been removed. That retry was added for a `ChatPanel` stall whose cause — real Dexie writes
    inside the assertion path — has since been removed by mocking chat history in those tests. The
    stall was never reproducible locally, so only green CI over the coming days actually tests the
    claim; keeping the retry would have masked the answer.

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
    301 to it. `bible.trendafilovi.net` **301**s to it. It was deliberately a 302 at first, so the
    cutover stayed reversible while it proved itself, and was **promoted to 301 after the cutover at
    the owner's instruction**. The redirect rule lives in Cloudflare, not in this repository, so the
    promotion date is not recoverable from git; what is recorded here is the observation:
    `https://bible.trendafilovi.net/read` returned **301** to `didachedynamis.com/read` when checked
    on 2026-08-14. This is no longer a launch gate.

    `/embed.js` and `/api/*` are **excluded from that redirect** and still
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
     contact, which ~~points at the maintainer's GitHub profile rather than committing a personal
     address~~ is a dedicated alias — see the rider below. Deliberately *not* the Security tab:
     private vulnerability reporting is for
     vulnerabilities, and routing conduct reports through it would file them as security advisories.
     ~~The trade is that the profile is the only private channel, which is thin — if conduct reports
     ever actually arrive, a dedicated address is the fix.~~ Adopted because this project touches theology, where a stated standard
     makes closing a thread a policy rather than an argument — and on the plan's own condition,
     that it is only worth having if it is acted on.

     **Rider, 2026-08-17: the dedicated address exists, and the GitHub profile is no longer the
     private route.** `CODE_OF_CONDUCT.md` names `conduct@didachedynamis.com`, live and verified
     end-to-end (§7.6). The original wording anticipated a dedicated address only "if conduct
     reports ever actually arrive" — that was the wrong trigger. A reporting channel has to exist
     *before* the first report, because the document forbids the public alternative, so the thin
     period would have fallen entirely on whoever needed it first. Committing a *personal* address
     is still avoided: the alias is what is published, and it can be disabled without exposing the
     mailbox behind it.

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

12. **The Strong's Greek pronunciation contamination stays; the importer's share of it is fixed.**
    RESOLVED 2026-09-02 (owner). Archive issue #15 is **not** re-filed on `DidacheDynamis` and
    stays archive-only.

    The two halves are different problems. The Chinese editorial text in 52 `<pron>` elements is
    upstream CrossWire data, kept verbatim — which is precisely what makes `NOTICE`'s "None to the
    text" true, and what a partial cleanup would have falsified. The **brace damage was ours**:
    `.strip("{}")` trims only the ends of a string, so the 88 multi-form entries came out with
    interior braces intact and one delimiter missing. Fixed 2026-09-02: the 5,398 single-form
    values are byte-identical, exactly the 88 change, all four pinned regression assertions still
    pass, and the CJK count is still 52 so the disclosure holds. Of the 88, 68 carry more than one
    brace pair, 19 carry a single pair, and `G1640` has one open and two closes; three source
    values are unbalanced in total, so any fix that tries to *pair* braces rather than remove them
    has to cope with a source that does not pair them.

    **The code half squash-merged to `main` on 2026-09-02 as `e5c32441` (PR #3).** `main` no longer
    extracts with `.strip("{}")`, so a rebuilt `content.sqlite` no longer ships the 88 mangled
    values — only the deploy of that rebuild is outstanding. The policy half — keep the 52 CJK
    values verbatim, do not re-file archive issue #15, do not swap the source — was settled
    independently of it.

    **Replacing the source was investigated and does not solve it.** Both candidates are CJK-free,
    and neither carries Strong's phonetic pronunciation at all:

    | source | licence | entries | pronunciation |
    |---|---|---|---|
    | CrossWire StrongsGreek 2.0 (current) | Public Domain | 5,488 | yes — 52 contaminated |
    | `openscriptures/strongs` | **none declared**; last push 2021-07 | 5,523 | **no such field** |
    | STEPBible TBESG | CC BY 4.0 asserted in README, no detectable LICENSE | 11,035 | transliteration only |

    `openscriptures/strongs` ships `derivation`/`strongs_def`/`kjv_def`/`translit`/`lemma` and no
    phonetic field. TBESG gives `ho`, `akōn`, `Alpha` — transliterations, not Strong's respellings;
    `al'-fah` and `ak'-ohn` appear nowhere in it. **Swapping either one in would not clean the
    pronunciation, it would delete the feature.** TBESG changes more besides: Abbott-Smith
    definitions rather than Strong's 1890, an extended-Strongs ID space including LXX and variants,
    and CC BY 4.0 would attach an attribution obligation to content that is currently unrestricted
    — a rights downgrade for a project whose content is otherwise PD or CrossWire-licensed.

    What stays genuinely available: targeted overrides for the 52 IDs keeping the public-domain
    text, or an upstream fix at CrossWire. Both are content work, not a data-file substitution. The
    importer pins this exact module with four constants and two SHA-256s, so any swap fails loudly
    by design rather than drifting in unnoticed.

**Still pending:** none — every decision above is recorded and settled.

The §3.3 fetch-at-build implementation is complete, and decision 11 settles the artifact question.
~~One hard gate remains: proving the candidate `DidacheDynamis` history never contains the former
KJV path or its LFS object.~~ **Cleared before the 2026-08-23 push.** The path is absent from all history and
`git lfs prune` removed the orphaned 3.8 MB KJV object from the rewritten mirror — contrary to the
expectation that a pruned-but-stored object would be retained, which is why it was checked by
counting stored objects against referenced ones (12 stored, 11 referenced) rather than by trusting
the removal.

**The flip is done — 2026-09-03 — and everything it gated is closed.** Protection, private
vulnerability reporting, secret scanning with push protection, Dependabot, fork-PR approval, the
anonymous rehearsal and the community-profile checks all landed the same day (§6, §7). The window
this section warned about — public and unprotected — was real and was closed in the same session,
which is the only reason it stayed a footnote rather than an incident.

**Every §7 item is now closed.** The last of them, GHCR package visibility, was settled on
2026-09-03 by publishing the first image deliberately rather than waiting for one to appear as a
side effect (§7.8). Only the week-one watch (§7.12) stays open, and it is observation rather than
work: Actions and LFS usage, and whether CI holds now that `vite.config.ts`'s `retry: 2` is gone.

This paragraph is itself the fourth instance of the pattern below. It previously said the package
"does not exist until the first image publishes" — true when written, false thirteen minutes later
when the image published. A plan that records current state has to be edited on the same pass as
the state it records, or it becomes the most confident wrong document in the repository.

Worth recording as the closing note, because it recurred at every stage: each defect this plan
caught was a tool covering less surface than its name implied — `--replace-text` not touching commit
messages, `--mailmap` not touching content, path removal not touching LFS storage, `--mirror` not
fetching LFS objects, a global gitleaks allowlist skipping whole files in one scan mode but not the
other, and GitHub's secret scanning not matching non-partner patterns at all. The habit that caught
them was the same every time: make the check fail on purpose before trusting it to pass.
