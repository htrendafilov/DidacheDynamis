# Bible Reading Software — Simple Delivery Plan

> [!CAUTION]
> **Deprecated historical proposal.** This document predates the implemented architecture and is kept
> only as design history. Its Render/PostgreSQL/admin UI/server-import workflow and Milestones 1–6
> were not adopted. The authoritative system and M0–M8 roadmap are
> [`00_system_design.md`](00_system_design.md), the focused design files under `plan/`, and shipped
> behavior in [`../docs/`](../docs/).

> Recommended workflow for a Bible-reading web application with a single-page frontend and a backend API. The goal is to remain simple, agent-friendly, testable, and releasable by one person or a small team.

## 1. Executive recommendation

Use only these core services:

1. **GitHub** — source code, requirements, change requests, pull requests, CI, and releases.
2. **Your local editor plus one coding agent at a time** — Claude, Codex, Pi, KiloCode, or Aider.
3. **Render** — deploy one web service containing the SPA, API, and admin UI, plus PostgreSQL.

Do **not** add Jira, Linear, Notion, a separate product-management system, an agent orchestration framework, Kubernetes, or microservices at the start.

Use one GitHub monorepo. Store:

- Product direction in versioned Markdown files.
- Each requirement/change as a GitHub Issue.
- Each approved implementation plan as a Markdown file in the repository.
- Each implementation in a short-lived branch and pull request.
- Verification in local tests and GitHub Actions.
- Production releases by merging approved pull requests into `main`.

The delivery chain is:

```text
Idea
  → GitHub Issue (requirement + acceptance criteria)
  → requirement clarification by an agent
  → human approval of requirement
  → implementation plan in docs/plans/
  → human approval of plan
  → coding agent on a branch
  → automated + manual verification
  → pull request
  → merge to main
  → automatic production deployment
  → GitHub Release for meaningful versions
```

## 2. Decisions to make before coding

Record these in `docs/product/mvp.md`. Do not let an agent silently decide them.

### Mandatory product decisions

- **Bible translation:** Start by publishing exactly one translation, but design the import boundary for multiple source formats and translation versions. Record source, license, required attribution, and version for every imported work. Do not import or publish copyrighted Bible text without permission.
- **Canon:** Define the initial book set and ordering explicitly, for example the 66-book Protestant canon. Treat support for other canons as a future requirement, not an assumed feature.
- **Accounts:** Recommended MVP: no accounts. Store reading position and preferences in browser storage. Add accounts only when cross-device sync is a proven need.
- **Offline use:** Recommended MVP: basic installable PWA and cached application shell; do not promise full offline Bible access until separately designed and tested.
- **Notes/highlights:** Recommended MVP: omit them. They immediately introduce identity, synchronization, privacy, export, and data-loss requirements.
- **Search:** Recommended MVP: server-side phrase/word search in the selected translation.
- **Devices:** Support current desktop and mobile browsers with responsive design.
- **Accessibility:** Keyboard navigation, visible focus, semantic landmarks, sufficient contrast, scalable text, and screen-reader labels are part of acceptance—not optional polish.

### Suggested MVP

A user can:

1. Open the application without signing in.
2. Choose a book and chapter.
3. Read verses in a clean, responsive view.
4. Move to the previous or next chapter.
5. Search the available translation and open a result in context.
6. Change font size and light/dark theme.
7. Return later to the last-read location on the same device.
8. View translation attribution and application version.

Explicitly out of scope for MVP:

- Simultaneous comparison of multiple translations
- User accounts
- Social features
- Notes and highlighting
- Reading-plan recommendations
- Audio
- AI-generated theological explanations
- Native mobile applications
- End-user module uploads
- Microservices

## 3. Recommended technical architecture

### Stack

- **Frontend:** React, TypeScript, Vite, React Router
- **Backend:** FastAPI, Python, Pydantic, SQLAlchemy, Alembic
- **Database:** PostgreSQL
- **API:** JSON REST under `/api/v1`; FastAPI-generated OpenAPI document is the contract
- **Frontend tests:** Vitest and React Testing Library
- **Backend tests:** pytest
- **End-to-end smoke tests:** Playwright, limited to a few critical journeys
- **Formatting/linting:** ESLint + Prettier for web; Ruff for Python
- **CI:** one GitHub Actions workflow
- **Hosting:** one Render web service (built SPA + FastAPI + server-rendered admin) and Render PostgreSQL

Choose pinned versions when initializing the repository and let dependency-update automation wait until after the MVP. Do not begin with GraphQL, Redux, a monorepo build framework, containers in development, or a custom design system.

### Runtime shape

```text
Browser
  │
  └── HTTPS to one Render Web Service
        ├── `/` built React SPA
        ├── `/api/v1/*` FastAPI JSON API
        ├── `/admin/*` server-rendered admin interface
        ├── `/var/data/imports` restricted import staging area
        └── PostgreSQL
```

Run one application instance initially. Keep all schema changes in Alembic migrations. The frontend must never connect directly to PostgreSQL. The only deliberate local state is a restricted import staging directory on a Render persistent disk; PostgreSQL remains the source of truth for published content and import-job state.

### Why a backend is justified

The backend owns:

- Bible text import and validation
- Passage retrieval
- Search
- Stable canonical identifiers for books, chapters, and verses
- Future synchronization if accounts are later added

If the application remains entirely read-only and single-translation, a static data bundle could be simpler. Nevertheless, the proposed backend is reasonable because the stated target is SPA → backend and search/data validation benefit from server ownership.

### CrossWire and other import formats

Treat **source format** as an adapter concern and never let it leak into the reading API or reader UI.

The CrossWire documentation makes an important distinction:

- A **SWORD module** is an implementation storage format. CrossWire explicitly recommends using the SWORD API or JSword rather than directly parsing module files because the storage representation is not a stable documented contract.
- CrossWire currently lists OSIS, TEI, ThML, and plain text as supported markup for module creation.
- Its tools also cover IMP, Verse-Per-Line (VPL), OSIS, TEI, and ThML; it maintains conversion paths involving USFM and legacy formats.
- These formats represent different work types. TEI is commonly relevant to lexicons/dictionaries; IMP can represent Bibles, commentaries, lexicons, dictionaries, devotionals, or general books. “CrossWire format support” must therefore not mean blindly accepting every module category as a Bible translation.

Sources:

- [CrossWire File Formats](https://wiki.crosswire.org/File_Formats)
- [CrossWire Module Development](https://wiki.crosswire.org/DevTools:Modules)

#### Recommended support order

Support Bible translations only at first:

1. **OSIS Bible XML** — first native adapter and reference implementation.
2. **SWORD Bible module** — use the official SWORD API/tools in a subprocess; do not reverse-engineer its binary/index files.
3. **USFM Bible project** — add after an architectural spike selects and tests a maintained parser against representative projects.
4. **VPL/plain text** — only with an explicit mapping profile for book names, references, encoding, and verse boundaries.
5. **ThML/IMP** — later, only for clearly identified Bible works and only when real source material requires them.
6. **TEI, commentaries, dictionaries, lexicons, devotionals, and general books** — separate future product capabilities, not part of the Bible-translation importer.

“Support CrossWire” should initially mean **ingest supported Bible modules safely and preserve their useful semantics**, not “implement every format named on the wiki.”

#### Adapter boundary

Create one stable importer protocol:

```python
class BibleFormatAdapter(Protocol):
    format_id: str

    def probe(self, source: ImportSource) -> ProbeResult: ...
    def analyze(self, source: ImportSource) -> ImportAnalysis: ...
    def parse(self, source: ImportSource) -> Iterable[CanonicalChapter]: ...
```

Each adapter is responsible for:

- Detecting its format without trusting the filename alone
- Reading source metadata and declared work type
- Rejecting unsupported work types
- Converting source references and markup into the canonical model
- Reporting unsupported or lossy constructs
- Producing deterministic output
- Never writing directly to published tables

Suggested code layout:

```text
apps/api/app/importers/
├── protocol.py
├── registry.py
├── pipeline.py
├── canonical.py
├── validation.py
├── publishing.py
├── security.py
└── formats/
    ├── osis.py
    ├── sword.py
    ├── usfm.py
    └── vpl.py
```

Adding a format should normally require a new adapter, adapter fixtures/tests, and registry entry—not changes to passage APIs or the reader.

#### Canonical intermediate representation

Do not normalize imported content straight into plain verse strings; that would discard paragraphs, poetry, headings, notes, cross-references, and source fidelity. Also do not store source-specific OSIS/USFM/SWORD markup as the reader contract.

Use a constrained canonical intermediate representation (CIR):

- Work metadata: stable ID, title, abbreviation, language, direction, publisher, source, source version, rights statement, attribution, and versification
- Canon/book metadata: canonical book ID, source book ID, display name, order, chapter count
- Chapter document: ordered block nodes such as heading, paragraph, poetry group/line, and verse
- Inline nodes: text, emphasis, divine name, words of Jesus, note, and cross-reference
- Verse index: canonical reference and normalized plain text used for search and direct lookup
- Import diagnostics: warnings, errors, unsupported constructs, and lossy conversions

Persist chapter document content as validated JSONB and maintain a separate verse-search table. The public API returns the canonical representation, never raw source XML or unsafe HTML.

The first renderer may support only heading, paragraph, poetry, verse, text, and emphasis. The importer must report, rather than silently discard, unsupported nodes.

#### Versification and canon

Do not assume every source maps cleanly to one 66-book/KJV-style scheme.

- Record each work’s declared versification.
- Use stable internal canonical book identifiers, while preserving source identifiers.
- Validate duplicate, missing, reordered, and out-of-range references.
- Never silently renumber verses.
- If the reader cannot support a work’s canon or versification, allow analysis but block publication with an actionable diagnostic.
- Treat verse bridges, split verses, additions, and omitted verses as explicit modeled/tested cases.

#### Import lifecycle

Use a two-phase workflow so a bad import cannot replace live text:

```text
Upload
  → detect/extract safely
  → analyze metadata and rights
  → parse into temporary import version
  → validate and produce report
  → admin reviews samples/warnings
  → explicit publish
  → atomic activation of new immutable version
```

Import-job states:

```text
uploaded → analyzing → needs_review → publishing → published
                    ↘ failed       ↘ rejected
```

Rules:

- Published translation versions are immutable.
- Re-import creates a new version; it never mutates live rows in place.
- Publication switches the active version atomically in PostgreSQL.
- Failure leaves the previously active version untouched.
- Rollback means reactivating the preceding valid version.
- The same source checksum plus adapter version must be idempotent.
- Every job records uploader, timestamps, checksum, detected format, adapter version, source metadata, diagnostics, counts, and publication action.

#### Upload and archive security

Import files are untrusted, even when uploaded by an administrator.

- Allowlist accepted extensions only as a convenience; detect by content.
- Set compressed and uncompressed size limits.
- Limit archive file count, path depth, and compression ratio.
- Reject absolute paths, `..` traversal, links, devices, and nested archive bombs.
- Parse XML with network access, DTDs, and external entities disabled.
- Run SWORD/converter tools as non-root subprocesses with timeout, memory/CPU limits, a clean environment, and no shell interpolation.
- Never render imported HTML directly. Convert to the canonical node allowlist and escape output.
- Keep upload staging outside public static directories.
- Delete rejected/stale artifacts according to a documented retention policy.
- Record a SHA-256 checksum and an audit event.

### Minimal administration interface

The public reader remains a React SPA. Keep the initial admin interface server-rendered under `/admin` using FastAPI templates and simple forms. This avoids building a second SPA state layer for a very small number of administrative screens.

Use GitHub OAuth for administrator login because GitHub is already part of the workflow. Allow access only to an explicit list of immutable GitHub account IDs stored in configuration. Store server-side session records in PostgreSQL and send only an opaque session ID in a secure, HTTP-only, SameSite cookie. Add CSRF protection to state-changing forms. Authorization must be enforced in backend handlers, never only by hiding UI controls.

Initial admin screens:

1. **Imports list** — status, work, format, uploader, created time, counts, warnings, and active version.
2. **New import** — upload artifact, optional format override, and source URL/notes.
3. **Import analysis** — detected format/work type, metadata, canon/versification, counts, diagnostics, and representative passage samples.
4. **Rights and attribution** — required rights status, license/permission evidence reference, copyright text, attribution, and source URL. Publication is blocked until completed.
5. **Publish confirmation** — exact version to activate, changes from current version, warnings requiring acknowledgement, and rollback target.
6. **Translation versions** — active/inactive versions and safe rollback action.
7. **Audit log** — upload, analysis, rejection, publication, rollback, and deletion events.

Do not build general user management, role editing, a visual text editor, or arbitrary database CRUD. The admin UI is a safe workflow around imports, not a generic control panel.

#### Minimal import execution model

For the first release:

- Run one Render application instance.
- Store uploaded artifacts in a restricted persistent-disk directory.
- Store import-job state and diagnostics in PostgreSQL.
- Process one import at a time in the application process, with a database advisory lock so duplicate execution cannot occur.
- Resume or mark interrupted jobs safely on startup.
- Schedule heavy imports during low-use periods and expose progress in the admin UI.

This avoids Redis, Celery, S3, and a separate worker. Accept the explicit limitation that imports and the public API share one process. Add an object store and separate worker only when measured import duration/resource use harms reader availability or horizontal scaling becomes necessary.

## 4. Repository in GitHub

Create one private repository initially, for example:

```text
bible-reading-software
```

Switch it to public only after reviewing translation licensing, secrets, documentation, and commit history.

### Monorepo layout

```text
bible-reading-software/
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── feature.yml
│   │   ├── change.yml
│   │   └── bug.yml
│   ├── workflows/
│   │   └── ci.yml
│   └── pull_request_template.md
├── apps/
│   ├── web/
│   │   ├── src/
│   │   ├── tests/
│   │   └── package.json
│   └── api/
│       ├── app/
│       │   ├── admin/
│       │   └── importers/
│       ├── migrations/
│       ├── scripts/
│       ├── templates/admin/
│       ├── tests/
│       └── pyproject.toml
├── data/
│   ├── README.md
│   └── sources/
├── docs/
│   ├── product/
│   │   ├── vision.md
│   │   └── mvp.md
│   ├── decisions/
│   ├── plans/
│   ├── verification/
│   └── operations/
│       ├── deployment.md
│       └── rollback.md
├── scripts/
│   ├── check.sh
│   └── dev.sh
├── AGENTS.md
├── CLAUDE.md
├── CONTRIBUTING.md
├── README.md
├── render.yaml
└── .env.example
```

### Canonical documents

- `docs/product/vision.md` — stable purpose, audience, principles, and non-goals.
- `docs/product/mvp.md` — current product scope and cross-cutting acceptance criteria.
- GitHub Issue — canonical record for one requested feature, change, or bug.
- `docs/plans/<issue-number>-<slug>.md` — approved technical plan for that issue.
- Pull request — implementation discussion, evidence, and final review.
- `docs/decisions/NNNN-<decision>.md` — only for decisions with lasting architectural consequences.
- `AGENTS.md` — repository-wide rules that every coding agent must follow.

Avoid duplicating the same requirement across several documents. Product documents define the baseline; an Issue defines one change to that baseline. Update the baseline in the same PR when the change is released.

## 5. Where requirements and changes are defined

### Use GitHub Issues as the work queue

Create one Issue per independently releasable outcome. Do not create Issues such as “build frontend” or “improve UX.” Describe user-visible behavior.

Use three Issue types only:

- **Feature** — new user-visible behavior
- **Change** — change to existing behavior or technical policy
- **Bug** — actual behavior differs from documented/expected behavior

Suggested labels:

```text
type:feature
type:change
type:bug
status:needs-clarification
status:ready-for-plan
status:planned
status:in-progress
status:verification
priority:now
priority:next
priority:later
```

Do not use story points initially. Keep a single GitHub Project board optional; Issues with labels are sufficient until prioritization becomes painful.

### Feature/change requirement template

```markdown
## User problem
Who has what problem? Why does it matter?

## Desired outcome
What observable outcome should change?

## User story
As a [specific user], I want [capability], so that [benefit].

## Scope
- Included:
- Included:

## Out of scope
- Excluded:
- Excluded:

## Acceptance criteria
- [ ] Given ..., when ..., then ...
- [ ] Given ..., when ..., then ...
- [ ] Error/empty/loading behavior is defined.
- [ ] Mobile, keyboard, and accessibility behavior is defined.

## Data/content implications
Bible translation, canon, attribution, privacy, migration, retention, or import implications.

## Constraints
Performance, security, browser support, compatibility, or deadline constraints.

## Open questions
- [ ] Question requiring a human product decision

## Verification notes
How a reviewer can prove the outcome works.
```

### Definition of Ready

An Issue may move to `status:ready-for-plan` only when:

- The user problem and desired outcome are clear.
- Scope and out-of-scope are explicit.
- Acceptance criteria are observable and testable.
- Loading, empty, invalid, and error states are addressed when relevant.
- Licensing/content implications are addressed.
- No unresolved question can materially change the design.
- The requirement does not prescribe implementation unless there is a real constraint.

## 6. Agent-assisted requirement clarification

Agents should improve requirements, not invent product decisions.

### Requirement-refinement prompt

Use this prompt with any capable agent:

```text
Act as a product analyst. Read:
1. docs/product/vision.md
2. docs/product/mvp.md
3. GitHub Issue #<N>

Your job is to make the requirement smaller, clearer, and testable before any coding.

Return:
- Ambiguities and missing decisions
- Simplest version that solves the stated user problem
- Suggested scope and explicit non-goals
- Acceptance criteria in Given/When/Then form
- Edge cases: loading, empty, invalid input, errors, mobile, keyboard, accessibility
- Bible-content licensing/canon/attribution implications
- Risks or dependencies
- Questions only a human can decide

Do not design the implementation. Do not expand the feature. Prefer removing scope.
```

Paste the useful result back into the Issue, edit it for correctness, and make the human product owner approve it. Do not start planning while product questions remain open.

## 7. Requirement → plan workflow

After an Issue is Ready, create a planning branch:

```bash
git switch main
git pull --ff-only
git switch -c plan/<issue-number>-<short-slug>
```

Ask an agent to inspect the repository and write:

```text
docs/plans/<issue-number>-<short-slug>.md
```

### Planning prompt

```text
Act as a senior engineer planning GitHub Issue #<N>.

Read, in order:
- AGENTS.md
- docs/product/vision.md
- docs/product/mvp.md
- the complete Issue #<N>, including acceptance criteria
- relevant implementation and test files

Produce docs/plans/<N>-<slug>.md. Do not write production code.

The plan must include:
1. Goal and non-goals
2. Assumptions linked to the Issue
3. Current behavior and relevant code paths
4. Minimal design and data/API changes
5. Exact files to create or modify
6. Small sequential tasks
7. Tests to write before implementation for each behavior
8. Exact verification commands
9. Manual acceptance checks mapped one-to-one to Issue criteria
10. Migration, deployment, observability, and rollback notes
11. Risks and unresolved decisions

Apply KISS, YAGNI, and backward compatibility. Reuse existing patterns. Do not add a dependency unless the plan explains why existing code cannot solve the need.
```

### Plan review gate

A human reviews the plan before code begins. Check:

- Every acceptance criterion maps to at least one test or manual check.
- Every planned change is needed for an acceptance criterion.
- Exact files and interfaces are identified.
- The API contract is explicit when changed.
- Database migration and rollback are explicit when changed.
- The plan does not introduce speculative abstractions.
- Tasks are small enough that an agent can complete and verify them independently.
- No unresolved decision is hidden as an assumption.

Commit the plan and open a small plan-only PR, or include it as the first commit in the implementation PR. For risky or multi-day work, prefer a plan-only PR. For small work, approving the committed plan before subsequent coding is enough.

## 8. Plan → agentic coding workflow

### Keep agent operation intentionally simple

- Use **one primary implementation agent** for a branch.
- Optionally use a **different agent for review** after implementation.
- Do not have several agents edit the same worktree concurrently.
- Do not ask an agent to “build Issue #N” without an approved plan.
- Give every agent the same context: `AGENTS.md`, Issue, and plan.
- Make small commits after coherent tasks.
- Never let agents commit secrets or modify requirements to make tests pass.

### Branch and pull request

```bash
git switch main
git pull --ff-only
git switch -c feat/<issue-number>-<short-slug>
```

Naming:

```text
feat/42-search-verses
fix/57-next-chapter-boundary
change/63-translation-attribution
```

### Implementation prompt usable with Claude, Codex, Pi, KiloCode, or Aider

```text
Implement GitHub Issue #<N> by following docs/plans/<N>-<slug>.md.

First read AGENTS.md, the Issue, the full plan, and all referenced files.
Work through the plan sequentially.

Rules:
- Do not change the approved requirement or expand scope.
- Use test-first development: add a failing test, observe failure, make the minimal change, observe pass.
- Reuse existing patterns and dependencies.
- Keep frontend and API contract changes synchronized.
- Run focused tests after each task and the full repository check before finishing.
- Stop and report if the requirement conflicts with the codebase, the plan is unsafe, licensing is unclear, or a product decision is missing.
- Do not bypass tests, weaken assertions, hide errors, or commit secrets.
- Update the plan checkboxes as tasks finish.
- Make small conventional commits.

At the end, return:
- Files changed
- Acceptance criterion → evidence mapping
- Commands run and results
- Remaining risks or manual checks
```

### Agent-neutral repository instructions

Put the canonical rules in `AGENTS.md`. Keep `CLAUDE.md` tiny:

```markdown
# Claude repository instructions

Read and follow `AGENTS.md` as the canonical repository instructions.
```

For tools that do not automatically read `AGENTS.md`, explicitly add it to context or configure their read/context option. Do not maintain five separate instruction files; they will drift.

`AGENTS.md` should define:

- Product and architecture summary
- Exact install, development, lint, test, build, and database commands
- Directory ownership and dependency boundaries
- Coding and testing conventions
- API compatibility rules
- Bible-content licensing/data rules
- Security and secret-handling rules
- Required pre-PR command: `./scripts/check.sh`
- A rule to stop on missing product decisions rather than guessing

## 9. Verification workflow

Use three layers. More tooling is unnecessary initially.

### Layer 1: Local focused verification

During development, run only the relevant tests after each small change. Before pushing, run one canonical command:

```bash
./scripts/check.sh
```

It should run, in a deterministic order:

1. Backend format/lint
2. Backend unit/integration tests
3. Frontend format/lint/type-check
4. Frontend unit/component tests
5. Frontend production build
6. A check that database migrations are valid

### Layer 2: GitHub Actions

Run the same `./scripts/check.sh` on every pull request and push to `main`. Avoid duplicating command logic in CI YAML.

Initially use one CI workflow and one required check named `ci`. Split it only if runtime becomes a real problem.

Recommended branch policy for `main`:

- Pull request required
- `ci` must pass
- Conversations must be resolved
- Branch must be up to date before merge
- Squash merge only
- Direct pushes disabled

For a solo repository, formal reviewer approval can remain optional, but the PR and passing check should still be mandatory.

### Layer 3: Acceptance verification

The PR description must map each Issue criterion to evidence:

```markdown
## Acceptance evidence
- AC1 — automated: `apps/api/tests/test_passages.py::test_get_chapter`
- AC2 — automated: `apps/web/src/...test.tsx`
- AC3 — manual: preview URL, mobile viewport, steps and observed result
```

Run a small Playwright smoke suite for only critical flows:

- Open default passage
- Navigate to next chapter
- Search and open a result
- Reload and restore last-read position

Do not try to replace all component/API tests with end-to-end tests.

### Independent agent review

After code is complete, optionally ask a different agent:

```text
Review this branch against GitHub Issue #<N>, docs/plans/<N>-<slug>.md, and AGENTS.md.

Review in this order:
1. Requirement compliance: missing, extra, or incorrectly interpreted behavior
2. Correctness and edge cases
3. Security, privacy, and Bible-content licensing implications
4. Test quality and acceptance-criterion coverage
5. Simplicity: unnecessary abstractions, dependencies, or scope
6. Deployment and rollback risk

Inspect the diff and relevant surrounding code. Run appropriate verification commands.
Return findings ordered by severity with file and line references. Do not praise or summarize until findings are complete. Do not edit code unless explicitly asked.
```

Treat the second agent as a reviewer, not an authority. Verify its findings before changing code.

### Definition of Done

A change is Done only when:

- Issue acceptance criteria are satisfied.
- Plan tasks are complete or intentionally removed with explanation.
- Tests were added at the appropriate level.
- `./scripts/check.sh` passes locally and in GitHub Actions.
- Manual checks are recorded in the PR.
- Accessibility was checked for changed UI.
- Relevant product/API/operations documentation is updated.
- Database migrations were tested when applicable.
- No secrets, copyrighted unapproved content, debug flags, or temporary workarounds are present.
- The PR is merged and production smoke checks pass.

## 10. Pull request and release workflow

### Pull request template

```markdown
## Requirement
Closes #<issue>

## Approved plan
`docs/plans/<issue>-<slug>.md`

## What changed
- ...

## What did not change
- ...

## Acceptance evidence
- AC1 — test/manual evidence
- AC2 — test/manual evidence

## Verification
- [ ] `./scripts/check.sh`
- [ ] Preview/manual checks completed
- [ ] Accessibility checked for changed UI
- [ ] Migration tested, or not applicable
- [ ] Documentation updated, or not applicable

## Deployment and rollback
- Deployment notes:
- Rollback notes:

## Risks/follow-ups
- ...
```

### Release policy

Keep release mechanics simple:

- Every merge to `main` deploys automatically to production after CI passes.
- Render previews or a manually selected local environment are used before merge.
- Use squash merges so each Issue becomes one clear commit on `main`.
- Create a GitHub Release for user-visible milestones, not for every tiny merge.
- Use semantic versions pragmatically:
  - `0.x.y` before a stable public release
  - patch: fixes
  - minor: backward-compatible features
  - major: breaking public API/data behavior after `1.0.0`
- Generate release notes from merged pull requests, then edit them into user-facing language.

Example milestone:

```bash
git switch main
git pull --ff-only
git tag -a v0.1.0 -m "First usable Bible reader"
git push origin v0.1.0
gh release create v0.1.0 --title "v0.1.0" --generate-notes
```

## 11. Where to deploy

### Recommended: Render

Use one Render workspace with:

- `app` — one web service that builds the React SPA, serves its static assets, exposes FastAPI under `/api/v1`, and serves the admin interface under `/admin`
- `imports` — a persistent disk mounted only on `app`, used as a restricted staging area rather than as the published-content database
- `db` — managed PostgreSQL containing published content, immutable translation versions, import jobs, diagnostics, and audit events

Describe infrastructure in a root `render.yaml` so deployment configuration is versioned. Keep secrets in Render environment variables, never in GitHub or the repository.

Suggested environments:

- **Local** — developer machine
- **Production** — automatic deployment from `main`

Do not add a permanent staging environment at first. Pull-request previews plus local testing are enough. Add staging only when database migrations, multiple contributors, or release coordination make it necessary.

### Deployment requirements

- SPA routes must fall back to `index.html`, except `/api/*` and `/admin/*`.
- The SPA uses same-origin `/api/v1`; no production CORS configuration is needed.
- Database URL is server-only.
- API exposes `/health` and `/ready` endpoints.
- Migrations run as an explicit pre-deploy/release command, not opportunistically on every API process start.
- Import staging is not publicly served and has size/retention limits.
- Production import is idempotent, versioned, reviewed, and atomically published.
- GitHub OAuth client secrets, session secret, and administrator allowlist are Render environment variables.
- Logs go to standard output without personal data or secrets.
- Render service IDs, environment variables, custom-domain steps, and rollback steps are documented in `docs/operations/deployment.md`.

### Rollback

Document and rehearse:

1. Roll back the frontend/backend to the preceding known-good deployment.
2. Prefer backward-compatible, additive database migrations.
3. Use expand/migrate/contract for destructive schema changes.
4. Back up the database before destructive data migrations.
5. Never claim application rollback also reverses an already-applied destructive migration.

## 12. Initial GitHub setup

After authenticating `gh`:

```bash
gh repo create bible-reading-software \
  --private \
  --description "A simple, accessible Bible reading web application" \
  --clone

cd bible-reading-software
gh repo edit --enable-issues=true --enable-wiki=false --enable-projects=false
```

Recommended repository settings after the first CI workflow exists:

- Default branch: `main`
- Issues: enabled
- Wiki: disabled
- Discussions: disabled initially
- Squash merge: enabled
- Merge commits: disabled
- Rebase merge: optional/disabled for simplicity
- Delete head branches automatically: enabled
- Dependabot: defer until initial dependency set stabilizes, then enable monthly updates

Protect `main` after the `ci` check exists. Do not configure a required check before its workflow has run at least once.

## 13. First implementation sequence

Do not start with end-user authentication. Admin authentication is introduced only when the import workflow needs it. Build vertical slices that produce a safe content pipeline and then a usable reader.

### Milestone 0 — Product and repository foundation

1. Write `docs/product/vision.md`.
2. Write and approve `docs/product/mvp.md`.
3. Select representative OSIS and SWORD Bible fixtures with known redistribution/test rights and record license/attribution.
4. Create repository structure and `AGENTS.md`.
5. Add development scripts and one CI workflow.
6. Create an empty deployable SPA/API in one web service and add `/health` and `/ready` endpoints.
7. Configure Render production deployment.

Exit criterion: a minimal SPA and healthy API are deployed, CI is green, and no Bible content has been published without verified rights.

### Milestone 1 — Canonical content and OSIS import

1. Write an ADR for the canonical intermediate representation and translation versioning.
2. Define work types, canonical book identifiers, versification policy, and supported markup nodes.
3. Add schema/migrations for works, immutable versions, chapter documents, verse search rows, import jobs, diagnostics, and audit events.
4. Define the adapter protocol and registry.
5. Build safe artifact handling and OSIS content detection.
6. Build the streaming OSIS Bible adapter test-first.
7. Build structural, reference, count, encoding, and unsupported-markup validation.
8. Build idempotent analysis and atomic publish/rollback services.
9. Add a CLI import path first so the domain pipeline can be tested independently of HTTP/admin UI.

Exit criterion: a known OSIS Bible can be analyzed, validated, published as an immutable version, queried from PostgreSQL, and rolled back without an admin UI.

### Milestone 2 — Admin import workflow and SWORD spike

1. Add GitHub OAuth administrator authentication and allowlist authorization.
2. Add import list, upload, analysis, rights/attribution, publish, versions/rollback, and audit screens.
3. Add upload/archive/XML security tests and interrupted-job recovery.
4. Test the complete OSIS import workflow through the admin interface.
5. Run an architectural spike using official SWORD API/tools against representative compressed/uncompressed Bible modules.
6. Record exact supported packaging, required system packages, metadata behavior, versification behavior, markup fidelity, performance, and failure modes.
7. Implement the SWORD adapter only after the spike proves the deployment approach.

Exit criterion: an authorized administrator can safely publish an OSIS Bible, and the SWORD path is either working with official tooling or documented as a blocked decision with evidence.

### Milestone 3 — Read one chapter

1. Add `GET /api/v1/translations` with active versions and attribution.
2. Add `GET /api/v1/translations/{translation}/books`.
3. Add `GET /api/v1/translations/{translation}/passages/{book}/{chapter}` returning canonical nodes.
4. Build the safe canonical-node renderer.
5. Build chapter reader UI with loading, empty, and error states.
6. Render paragraphs, headings, poetry, verses, text, and emphasis.
7. Display required rights/attribution information.

Exit criterion: a user can open and read any published chapter on mobile and desktop without the reader knowing whether the source was OSIS or SWORD.

### Milestone 4 — Navigation and reading continuity

1. Book/chapter selector.
2. Previous/next chapter behavior across book boundaries.
3. URL-addressable passage routes.
4. Browser-local last-read position.
5. Font-size and theme settings.
6. Keyboard and screen-reader verification.

Exit criterion: normal reading is comfortable and resumable on one device.

### Milestone 5 — Search

1. Define search syntax and limits.
2. Add indexed server-side search.
3. Add paginated search API.
4. Build search UI and no-results/error states.
5. Open a result in chapter context.
6. Add performance and abuse limits.

Exit criterion: a user can find a verse and return to reading.

### Milestone 6 — Public beta hardening

1. Critical Playwright smoke tests.
2. Basic structured logs and error monitoring only if production feedback requires it.
3. Backup/restore and rollback rehearsal.
4. Accessibility audit of critical journeys.
5. Security headers, dependency audit, rate limits, and content attribution review.
6. Create `v0.1.0` GitHub Release.

## 14. Rules that preserve simplicity

1. **One repository.** Split only after independently deployable ownership becomes a real need.
2. **One backend service.** No microservices.
3. **One production database.** Use PostgreSQL job state/advisory locking; no Redis or queue until measured load requires it.
4. **One source of truth per artifact.** Issue for requirement, plan file for implementation, PR for evidence.
5. **One primary agent per branch.** A second agent may review, not co-edit.
6. **One verification entry point.** `./scripts/check.sh` locally and in CI.
7. **No new dependency without a concrete need.** Prefer standard library and existing dependencies.
8. **No speculative user accounts.** Browser storage first.
9. **No feature without explicit non-goals.** Scope reduction is a success.
10. **No merge without evidence.** Green tests alone do not prove UX acceptance.
11. **No Bible content without recorded rights and attribution.**
12. **No agent guesses on product, theology, canon, licensing, privacy, or destructive migration decisions.**
13. **Source formats stop at the adapter boundary.** Reader APIs expose only the canonical model.
14. **Never parse SWORD storage files directly.** Use the official API/tools.
15. **Never publish directly from upload.** Analyze, validate, review, then atomically activate an immutable version.

## 15. Minimal weekly operating routine

### Choose work

- Keep at most one Issue `status:in-progress` per developer.
- Pick the smallest `priority:now` Issue that is Ready.
- Finish or intentionally close it before starting another.

### Refine

- Let an agent critique and simplify the Issue.
- Human decides open product questions.
- Mark `status:ready-for-plan`.

### Plan

- Agent inspects code and writes the plan.
- Human reviews scope, interfaces, tests, migration, and rollback.
- Mark `status:planned`.

### Implement

- Create a short-lived branch.
- Primary agent follows the approved plan test-first.
- Keep commits small and run focused checks.

### Verify

- Run `./scripts/check.sh`.
- Optionally have another agent review the diff.
- Open PR with acceptance evidence.
- CI and manual checks pass.

### Release

- Squash merge to `main`.
- Render deploys automatically.
- Run production smoke checks.
- Close the Issue automatically from the PR.
- For a milestone, tag and publish a GitHub Release.

## 16. Final recommendation summary

Use:

- **GitHub Issues** for requirements and changes
- **Markdown in the repository** for product baseline, plans, decisions, and operations
- **One GitHub monorepo** for SPA, API, data-import tooling, tests, and deployment configuration
- **Any one coding agent at a time**, guided by the same `AGENTS.md`, Issue, and approved plan
- **GitHub Actions** for one canonical CI check
- **Render** for one SPA/API/admin web service, one restricted import-staging disk, and PostgreSQL
- **Format adapters** for OSIS first, SWORD through official APIs/tools second, and USFM only after a parser spike
- **A canonical content model** so reader APIs do not depend on source formats
- **A review-before-publish admin workflow** with immutable translation versions and atomic activation/rollback
- **Pull requests** as the verification and release gate
- **Automatic production deployment from `main`**
- **GitHub Releases** for meaningful user-visible milestones

The two human approval points that should never be delegated are:

1. **Is this the correct and sufficiently small requirement?**
2. **Is this implementation plan safe, complete, and no larger than necessary?**

Agents can perform most of the clarification, analysis, planning, coding, testing, and review around those decisions. The human remains responsible for product intent, licensing, theology-sensitive behavior, privacy choices, and release acceptance. An agent may extract rights metadata and flag risks, but only an authorized human may attest that distribution rights are sufficient and publish a translation.
