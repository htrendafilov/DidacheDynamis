# Plan: Going public — release as **DidacheDynamis**

**Status:** in execution. **Audit snapshot:** 2026-08-01, `main` at `3206aba` plus the `cleanup`
branch (merged as PR #30, `cc25716`). **Goal:** publish the project without exposing credentials,
private infrastructure details, non-redistributable content, or misleading historical plans.

**Decisions recorded 2026-08-01 (owner-approved):** clean-public-repo strategy (§0 path 2);
code license **MIT**; **KJV dropped** from the public source set (fetched at build instead);
live runbook stays **private/untracked**; `render.yaml` **deleted**; `uv.lock` **ignored**.
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
| Commit author address at the employer domain | 152 of 193 reachable commits in the 2026-08-01 all-ref audit | Optional identity rewrite; decide before the same rewrite pass. Current commits also use 27 personal-domain and 14 Yahoo-address identities. |

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

Audit or remove before the flip:

- 27 pull requests and 2 issues, including bodies, comments, reviews, attachments, and referenced
  commit SHAs;
- 293 workflow runs at the audit snapshot; delete any run whose logs reveal private paths, hostnames,
  runner details, or other operator metadata;
- 2 retained Docker build-record artifacts (about 45 KiB total); delete if they have no release value;
- repository variables, environments, deployments, release assets, wiki pages, projects, webhooks,
  and GitHub Pages configuration;
- remote branches. Eleven merged topic branches are still advertised in addition to `main`; delete
  obsolete branches before the rewrite and ensure no stale branch can reintroduce old history;
- GHCR package contents and visibility, which are managed separately from repository visibility.

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

### 2.3 Source-data disposition

No committed source-data file is presently a safe stale deletion other than `.gitkeep`:

- the nine active compressed/TSV inputs are consumed by `bibleimport build-all`;
- the original English 1689 export is the immutable provenance base for the reviewed edition;
- the uncompressed Bulgarian 1689 IMP drives the revision, SWORD-package, and benchmark scripts;
- the JSON metadata and correction record provide required rights/provenance evidence.

The source directory is about 28 MiB and ten inputs use Git LFS. Public forks and downloads count
against the repository owner's LFS bandwidth, so set a budget/alert and reconsider release assets or
external immutable source hosting if usage grows. GitHub's current
[LFS billing documentation](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-git-large-file-storage/upgrading-git-large-file-storage)
records a 10 GiB monthly bandwidth allowance for GitHub Free/Pro and charges downloads to the owner.

## 3. Licensing and public-project files

**Resolved 2026-08-01:** code license is **MIT**; **KJV is dropped** from the public source/build
set (option "remove" in item 3 below).

1. Add a root code `LICENSE` (**MIT**). State explicitly that it covers code and original
   documentation, not third-party content.
2. Add `NOTICE` plus a `LICENSES/README.md` (and full applicable license texts) that maps every file
   in `data/sources/` to its source, version, rights holder, redistribution terms, attribution, and
   modification status. Keep this aligned with `data/sources/README.md` and imported `works` rows.
3. **KJV (resolved): remove `KJV.imp.gz` from the public source set and fetch it from CrossWire at
   build time** (pinned URL + checksum), rather than redistributing it in-repo. CrossWire's current
   module page records Crown rights on the base text, broad use of the KJV2003 project text, and a
   `GPL` module-distribution label; removal sidesteps the redistribution question entirely.
   Implementation workstream: `apps/importer` `SOURCE_FILES`/CLI source acquisition,
   `data/sources/README.md` table, Docker/CI build path, and the in-app "KJV" attribution strings.
   See the [official CrossWire module record](https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=KJV).
4. Preserve the WEB trademark wording and TSK CC BY 4.0 attribution in both repository and UI.
5. Update `docs/developer/contributing.md` with the selected inbound contribution terms. Add root
   `SECURITY.md`; add a code of conduct only if the maintainer is prepared to enforce it.

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
  `plan/interactive_chat_plan.md` — plus `.github/workflows/deploy.yml`'s runbook pointer in its
  header comment. Where the surrounding procedure is generic, repoint to
  `docs/deployment/backups-and-rollback.md` (which documents the same atomic DB replacement and
  restart ordering).
- Keep the private runbook in an encrypted/operator-controlled location outside this checkout and
  verify that its recovery procedure is documented there.

### 4.2 Public-facing docs

- Finish the README transition: code/content license links, build status, public contribution link,
  privacy summary, and accurate production/chat feature status.
- Document the optional browser-direct OpenRouter assistant in user/developer privacy docs before it
  is enabled in any public build: what leaves the browser, key storage, context selection, provider
  terms, local history, and the content `ai_context_policy` gate.
- Refresh `docs/extra/security-and-privacy.md` and `docs/extra/content-and-licensing.md` against the
  final source set and NOTICE.
- Add issue/PR templates if Issues remain enabled. Decide whether Discussions will be enabled.
- Sweep links and references after deletions and the private-runbook move.

### 4.3 Stale deployment choices

- `render.yaml` describes an M0-era free-tier route and contains comments that no longer match the
  implemented service. **Resolved 2026-08-01: delete it.** The README's Render-specific wording was
  already scrubbed in PR #30; no other references remain.
- Once public, update the uptime workflow comment: public-repository Actions minutes are not the
  reason for its current 90-minute cadence. Keep the cadence only if it is operationally desired.
- Decide whether to keep the manual GHCR deploy workflow. If kept, remove references to the private
  runbook and verify least-privilege permissions and fork-PR workflow approval settings.

### 4.4 App rename to DidacheDynamis

The public app is named **DidacheDynamis** (decided 2026-08-01). The rename lands in the sanitized
tree before the first push, not in the private repo's day-to-day history:

- README/docs product name, repository description/topics, and the `NOTICE`/attribution lines.
- GHCR image path becomes `ghcr.io/htrendafilov/didachedynamis` in `deploy.yml` and Compose (the
  package itself is created by the first push from the new repo).
- **Not renamed by default:** the public domain `bible.trendafilovi.net`, the Cloudflare tunnel, and
  the Caddy vhost keep working regardless of the repo name — changing the domain is a separate
  owner decision with DNS/tunnel/UptimeRobot consequences.
- Code identifiers (`apps/*` package names, i18n strings, SPA title) can be renamed incrementally
  post-release; only user-visible branding blocks publication.
- **Logo (selected 2026-08-01):** a geometric lighthouse mark — dark-navy interlocking triangles
  forming the tower, white light beams fanning left and right, flanked by cyan accent dots with red
  centers, on a light-gray field. The owner has the source image; it lands in the sanitized tree as
  the favicon/app icon (under `apps/web/public/`) and is set as the GitHub social preview at §7.
  Record the logo's license/attribution alongside `NOTICE` if it was not created by the owner.

## 5. History rewrite procedure

This section applies only to a release path that publishes rewritten history.

1. Freeze pushes; merge/close open PRs; delete obsolete remote branches; record all branch/tag/PR
   refs, LFS objects, and the current default-branch SHA.
2. Make two backups: an untouched private mirror and a separate disposable mirror for rewriting.
   Never run the rewrite in the day-to-day checkout.
3. Use `git-filter-repo` 2.47+ with sensitive-data removal mode:
   - remove every historical path of the live runbook;
   - replace the origin, operator/path, and internal-registry strings using a replacement file stored
     outside the repository;
   - optionally rewrite author/committer addresses in the same pass;
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
- exact history searches for the external replacement-map values, employer author address if chosen,
  private runbook paths, `.env` files, key formats, tokens, and unusually high-entropy strings;
- `git fsck`, changed-ref review, current-tree diff review, and before/after `git lfs ls-files`;
- `scripts/check.sh` on the candidate public tree;
- fresh clone with no local config → `git lfs pull` → `bibleimport build-all` → API/SPA smoke test;
- Markdown-link check and a manual pass through README, docs, license/attribution, and screenshots;
- anonymous-access rehearsal against the candidate remote, including source archives and LFS;
- audit of PRs/issues, Actions logs/artifacts, packages, deployments, variables, and repository
  settings; record the result in the release issue.

## 7. Publication and post-flip checks

The target repository **`htrendafilov/DidacheDynamis`** already exists (created 2026-08-01,
**private** — deliberately, so the §6 gate runs before anything is publicly reachable).

1. Temporarily restrict writes during the cutover.
2. Push the verified sanitized mirror to `DidacheDynamis`; set description and topics.
3. Immediately restore branch/ruleset protection because GitHub disables push rulesets on a
   private-to-public visibility change.
4. Configure public-fork Actions approval, read-only default `GITHUB_TOKEN`, Dependabot, secret
   scanning/push protection, and code scanning as appropriate.
5. Deliberately set GHCR package visibility and source linkage; do not assume it follows the repo.
6. Verify Actions secrets still exist, workflow permissions are minimal, and untrusted fork PRs do
   not receive secrets or write tokens.
7. Check README badges, community profile, LICENSE/NOTICE rendering, LFS download, release build, and
   the live site from an anonymous browser.
8. Watch Actions/LFS usage and security alerts during the first week.

## 8. Decisions

**Resolved 2026-08-01:**

1. ~~Existing repository rewrite vs clean public repository~~ → **clean public repository**
   (`htrendafilov/DidacheDynamis`).
2. ~~Code license~~ → **MIT**.
3. ~~KJV~~ → **removed** from the public source/build; fetched from CrossWire at build time (§3.3).
4. ~~Live runbook~~ → **private/untracked** (§4.1).
5. ~~`render.yaml`~~ → **deleted** (§4.3).
6. ~~`uv.lock`~~ → **ignored** (§1.3).

**Still pending:**

7. Author/committer email rewrite (due before the §5 pass; with a clean repo the sanitized history
   is the only public history, so rewriting to the personal address is cheap to do in the same pass).
8. Issues, Discussions, contribution terms, and code-of-conduct policy (due at §7).
9. Public domain: keep `bible.trendafilovi.net` or rebrand with the app name (§4.4).

The content-licensing implementation (§3.3 KJV fetch-at-build) is a hard gate. Everything else can
be completed as a reviewable cleanup commit before the destructive release cutover.
