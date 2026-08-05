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
- ~~remote branches. Eleven merged topic branches are still advertised in addition to `main`; delete
  obsolete branches before the rewrite and ensure no stale branch can reintroduce old history;~~
  **Done 2026-08-05.** Only `main` remains, locally and on the remote. The last five were checked
  against `main` by content rather than by commit SHA — every one had landed through a squash, so
  none of their commits was an ancestor of `main` and a SHA test would have called them all
  unmerged. Each added line was confirmed present in `main` or deliberately superseded (schema
  version 3 → 4, the three-value `ai_context_policy` union → four, `m9.0b-bulgarian-benchmark.md`
  split into `m9.0b-1`/`m9.0b-2`, and a `.gitignore` comment rewritten by this very cleanup). Their
  tip SHAs are recorded in the release issue in case anything needs recovering before gc;
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

After removing the tracked KJV export, no other committed source-data file is presently a safe stale
deletion other than `.gitkeep`:

- eight committed active compressed/TSV inputs are consumed by `bibleimport build-all`; the ninth
  (`KJV.imp.gz`) is generated locally by the checksum-pinned CrossWire fetch step;
- the original English 1689 export is the immutable provenance base for the reviewed edition;
- the uncompressed Bulgarian 1689 IMP drives the revision, SWORD-package, and benchmark scripts;
- the JSON metadata and correction record provide required rights/provenance evidence.

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
   runtime image; `deploy.yml` pushes the image to GHCR, whose visibility §7.5 sets deliberately.
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
5. Update `docs/developer/contributing.md` with the selected inbound contribution terms — **still
   blocked on decision 9**; the terms have to be chosen before they can be written down. ~~Add root
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
  `plan/interactive_chat_plan.md` — plus `.github/workflows/deploy.yml`'s runbook pointer in its
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
  "Contributing and security" section linking `docs/developer/contributing.md` and `SECURITY.md`,
  and the two `docs/extra/` guides to the documentation list. The chat status line was already
  accurate — it records M9.1–M9.3d as shipped and states the feature is build-time gated and off in
  production — so it was left alone. The contribution *terms* behind that link remain blocked on
  decision 9; the link itself is not.
- ~~Document the optional browser-direct OpenRouter assistant in user/developer privacy docs before
  it is enabled in any public build: what leaves the browser, key storage, context selection,
  provider terms, local history, and the content `ai_context_policy` gate.~~ **Done** in
  `docs/extra/security-and-privacy.md`, which had no mention of the assistant at all. Covers all
  six points, states that the API server is not in the request path and that the CSP `connect-src`
  is what enforces it, and is explicit that privacy routing and the account-logging confirmation
  constrain what the app *sends* rather than proving what the provider *does*. Re-check it whenever
  the request body, the stored credentials, or `connect-src` change.
- Refresh `docs/extra/security-and-privacy.md` and `docs/extra/content-and-licensing.md` against the
  final source set and NOTICE.
- Add issue/PR templates if Issues remain enabled. Decide whether Discussions will be enabled.
- ~~Sweep links and references after deletions and the private-runbook move.~~ **Done 2026-08-05 —
  nothing to fix.** All 169 relative markdown links across 63 files resolve, and all 89 repo-path
  references inside source files point at something that exists. Every surviving mention of a
  removed file (`render.yaml`, `uptime.yml`, the six PR #30 deletions, the two chat proposals, the
  live runbook) is a deliberate record of the removal — the "Removed" table here, `plan/deployment/
  README.md` explaining the private runbook, `monitoring-and-alerts.md` noting the retired workflow,
  and `interactive_chat_plan.md` §Appendix B listing what was carried over — not a dangling pointer.
  Re-run before the §6 gate, since the rewrite moves files again.

### 4.3 Stale deployment choices

- `render.yaml` describes an M0-era free-tier route and contains comments that no longer match the
  implemented service. **Resolved 2026-08-01: delete it.** The README's Render-specific wording was
  already scrubbed in PR #30; no other references remain.
- **Resolved 2026-08-02:** delete `.github/workflows/uptime.yml`; UptimeRobot is the sole uptime
  monitor and must probe `/ready`. This avoids duplicate alerts and recurring Actions runs.
- Decide whether to keep the manual GHCR deploy workflow. If kept, remove references to the private
  runbook and verify least-privilege permissions and fork-PR workflow approval settings.

### 4.4 App rename to DidacheDynamis

The public app is named **DidacheDynamis** (decided 2026-08-01). The rename lands in the sanitized
tree before the first push, not in the private repo's day-to-day history:

- README/docs product name, repository description/topics, and the `NOTICE`/attribution lines.
- **README badges.** The CI badge added 2026-08-05 hard-codes
  `github.com/htrendafilov/bible_app_bg/actions/workflows/ci.yml`; it renders as "no status" from
  the new repository until repointed. Include both badge URLs in the rename pass.
- GHCR image path becomes `ghcr.io/htrendafilov/didachedynamis` in `deploy.yml` and Compose (the
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
2. **Keep the old host alive as a redirect, do not retire it.** `embed.js` is the reason:
   third-party sites load `https://bible.trendafilovi.net/embed.js` and, per
   `docs/user/embedding-scripture.md`, allowlist that exact host in *their* CSP. Retiring the old
   domain breaks every existing embed on sites you do not control and cannot fix. Publicly shared
   deep links (`#/b/…`, `#/book/…`) have the same problem, though a redirect handles those.

**Infrastructure.**

3. Register the domain (Cloudflare Registrar — decision 10) and create its Cloudflare zone.
4. Add the new public hostname to the Cloudflare Tunnel ingress; keep the old hostname routed until
   the redirect is in place.
5. Add the new vhost to the Caddy config on the VM — `deploy/Caddyfile.snippet` hard-codes
   `bible.trendafilovi.net` and is the template for it.
6. Repoint the UptimeRobot monitor at `https://<new-domain>/ready` (§4.3: it must probe `/ready`,
   not `/`, so database failures are caught and not just process liveness).
7. Set the GitHub repository Website field and social preview to the new domain.

**Tracked references — 16 files at the 2026-08-06 audit** (`git grep -l bible\.trendafilovi\.net`).

8. Update: `README.md` (header line and the Dropbox redirect-URI example),
   `apps/web/public/embed.js` (header comment and usage example),
   `apps/web/src/state/deeplink.ts` (comment), `deploy/Caddyfile.snippet`,
   `docs/deployment/index.md`, `docs/deployment/monitoring-and-alerts.md`,
   `docs/user/embedding-scripture.md` (four mentions, including the CSP guidance quoted to
   embedders), `ideas/desktop-04-pwa.md`, `plan/00_system_design.md` (two mentions),
   `plan/linking_and_embeds.md`, and this file.
9. **Two that are not prose and will misbehave rather than merely read wrong:**
   - `scripts/capture_real_docs_screenshots.js` — `LIVE_URL` points at the live site, so
     re-captured user-guide screenshots would keep showing the old domain in the address bar;
   - `scripts/bench_measure_tokens.py` — sends `HTTP-Referer: https://bible.trendafilovi.net` to
     OpenRouter, which is how the account attributes benchmark spend.
10. **Leave alone — dated evidence, not configuration.** `plan/chat/m9.0-findings.md` and
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
  private runbook and `data/sources/KJV.imp.gz` paths, `.env` files, key formats, tokens, and
  unusually high-entropy strings;
- `git fsck`, changed-ref review, current-tree diff review, and before/after `git lfs ls-files`;
- `scripts/check.sh` on the candidate public tree;
- fresh clone with no local config → `git lfs pull` → `bibleimport build-all` → API/SPA smoke test;
- Markdown-link check and a manual pass through README, docs, license/attribution, and screenshots;
- anonymous-access rehearsal against the candidate remote, including source archives and LFS;
- audit of PRs/issues, Actions logs/artifacts, packages, deployments, variables, and repository
  settings; record the result in the release issue;
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
5. **Enable private vulnerability reporting** (Settings → Code security). `SECURITY.md` sends
   reporters to the Security tab's "Report a vulnerability" button, and that button does not exist
   until this is switched on — GitHub offers the feature for **public repositories only**, so it
   cannot be enabled on `bible_app_bg` in advance and must be done here, right after the flip.
   Until then `SECURITY.md`'s fallback (open an issue asking for a private channel, no details)
   is the only route. There is no automation to add: `repository_advisory` is not an event that can
   trigger a workflow, and reading unpublished advisories over the API needs a token with
   `repository_advisories:read`, which is not worth storing as a secret in a public repository.
   GitHub already notifies maintainers on submission and confirms receipt to the reporter.
6. Deliberately set GHCR package visibility and source linkage; do not assume it follows the repo.
7. Verify Actions secrets still exist, workflow permissions are minimal, and untrusted fork PRs do
   not receive secrets or write tokens.
8. Check README badges, community profile, LICENSE/NOTICE rendering, LFS download, release build, and
   the live site from an anonymous browser.
9. Watch Actions/LFS usage and security alerts during the first week.

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

**Still pending:**

8. Author/committer email rewrite (due before the §5 pass; with a clean repo the sanitized history
   is the only public history, so rewriting to the personal address is cheap to do in the same pass).
9. Issues, Discussions, contribution terms, and code-of-conduct policy (due at §7).
10. Public domain — **direction decided 2026-08-06: rebrand.** The site moves off
    `bible.trendafilovi.net` to a DidacheDynamis domain. The domain itself is **not yet bought**,
    so this stays pending until the name is registered and the §4.4 cutover checklist is run.

    Checked 2026-08-06 against the registries (Verisign for `.com`, PIR for `.org`, not a generic
    whois client — a generic client answers from IANA about the *TLD* and looks like a match):
    **`didachedynamis.com` and `didachedynamis.org` were both unregistered**, with no nameservers.
    Re-check immediately before buying; availability is a snapshot, not a reservation.

    Registrar direction: **Cloudflare Registrar**, which sells at registry cost with no markup and
    includes WHOIS redaction, and which puts registrar, DNS, and the Tunnel in one account. Its one
    constraint — domains registered there must use Cloudflare nameservers and cannot be pointed
    elsewhere while they stay there — costs nothing here, because DNS already runs on Cloudflare.
    Buy it at the registrar it should live at: a newly registered domain **cannot be transferred to
    another registrar for 60 days** (ICANN), which would otherwise span the whole release window.

    Migrating `trendafilovi.net` off its current Bulgarian registrar is a **separate** job. Do not
    couple it to this release.

The §3.3 fetch-at-build implementation is complete, and decision 11 settles the artifact question.
One hard gate remains: proving the candidate `DidacheDynamis` history never contains the former KJV
path or its LFS object. Everything else can be completed as a reviewable cleanup commit before the
destructive release cutover.
