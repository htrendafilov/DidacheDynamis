# Plan: Open-source release (make the repo public)

**Status:** planned (post-M5). **Goal:** publish `htrendafilov/bible_app_bg` as a public repository
under an open-source license, with no secrets, private infra, or non-redistributable content exposed —
including in git history (a public repo exposes the entire history).

## Audit findings (2026-07-21)

**No committed credentials.** No `.env`, private keys, tokens, or `_auth`/`_password` values in the
working tree or in history. `.gitignore` covers `.env`; deploy secrets live in GitHub Actions secrets
(which stay private even on public repos) and in the operator's local `pass` store.

**Two items in git history that MUST be purged before going public:**
1. **Origin infra** in `plan/deployment/live-runbook.md` — the VM IP `<origin-ip>`, the `deploy` SSH
   user, and app paths (present in the working tree *and* history). Publishing the origin IP defeats
   the Cloudflare hidden-origin / DDoS protection.
2. **Employer's internal Artifactory hostname** — `registry.npmjs.org` in ~366 lines of
   history (the old `package-lock.json`, before it was rewritten to the public npm registry). No
   credentials, but an internal registry URL should not be published.

**No LICENSE file yet.**

## Release checklist (in order)

### 1. Scrub + rewrite history
- Move the live-runbook's real values to placeholders, **or** keep the operational runbook private
  (untracked / separate private note) and publish only the already-scrubbed generic
  `plan/deployment/deployment_design.md`. **Recommended:** keep the runbook private; the public repo
  ships architecture docs only.
- Rewrite history to redact both strings across all commits:
  ```bash
  git filter-repo --replace-text <(printf '%s\n' \
    '<origin-ip>==>REDACTED_HOST' \
    'registry.npmjs.org/repository/cmp-npm-virtual==>registry.npmjs.org' \
    'deploy==>deploy')
  ```
  (Exact rules finalized at execution.) Force-push (solo repo — routine here; third rewrite after the
  LFS migration and lockfile fix). Re-verify LFS objects survive the rewrite.

### 2. Add a LICENSE
- **Recommended: MIT** — simplest, most permissive, ideal for a personal project meant to be freely
  used and learned from. (Alternative: **Apache-2.0** for an explicit patent grant + contribution
  terms; heavier and not needed here.) — **decision pending.**
- The license covers **code only**.

### 3. Clarify content licenses (NOTICE + README)
Add a `NOTICE` (and a README section) stating the MIT license does not cover `data/sources/` content,
which keeps its own licenses:

| Work | License | Public redistribution |
|---|---|---|
| WEB, Matthew Henry, Easton's, **1689 Confession** | Public Domain | ✅ |
| TSK cross-references | CC BY 4.0 | ✅ with attribution (present) |
| **KJV** (`KJV.imp.gz`) | CrossWire module dist. license **GPL** + UK Crown copyright on the text | ⚠ see below |

**KJV decision (pending):** redistributing KJV publicly is universally done and low-risk (PD in the US
and most of the world; GPL permits redistribution), but options are: (a) keep it with an explicit
NOTICE, or (b) drop `KJV.imp.gz` from the public repo and have the build fetch it separately. —
**decision pending.**

### 4. Secret-scan the rewritten history
Run `gitleaks detect` (or `trufflehog`) over the full rewritten history as due diligence before
flipping visibility.

### 5. Polish the public README
The README is already solid. Add: a license badge, a short privacy line ("personal notes are stored
locally in the browser, with optional Dropbox App-Folder sync — the server never sees them"), and a
final check that no private-infra references remain. The Dropbox setup section is fine (the app key is
a public PKCE client id).

### 6. Flip visibility + repo settings
- `gh repo edit htrendafilov/bible_app_bg --visibility public`
- Set description + topics (bible, react, fastapi, sqlite, typescript, self-hosted).
- Decide Issues / Discussions on or off.
- Confirm GitHub Actions secrets are intact (they remain private on public repos).

## Effort
Small — roughly half a day; the history rewrite is the main step. No secret rotation needed (nothing
secret was committed).

## Decisions pending
1. **License:** MIT (recommended) or Apache-2.0.
2. **KJV in the public repo:** keep with NOTICE, or drop and fetch at build.
3. **Live-runbook:** scrub-in-place, or keep private and publish only the generic deployment doc
   (recommended).
