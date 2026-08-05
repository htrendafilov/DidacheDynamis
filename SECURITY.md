# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub's [private vulnerability
reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability):
go to the **Security** tab of this repository and choose **Report a vulnerability**. That opens a
private advisory visible only to the maintainer, and it keeps the report, the discussion, and the
eventual fix in one place.

Helpful things to include, as far as you have them:

- what an attacker can do, not only what looks wrong;
- the affected version, commit, or URL;
- steps to reproduce, or a proof of concept;
- whether the issue is already public anywhere.

If the **Report a vulnerability** option is not offered, private reporting is not enabled yet. In
that case open a normal issue saying only that you have a security report and would like a private
channel — no details, no proof of concept — and you will be given one.

## What to expect

This is a single-maintainer project. There is no guaranteed response time: reports are read and
answered as soon as I get to them, which is usually days but can be longer.

If you have had no reply after 30 days, consider that agreement to disclose publicly. If you have a
different deadline in mind, say so in your report and I will work to it.

There is no bug-bounty programme and no payment for reports. Reporters are credited on the advisory
unless they ask not to be.

## Supported versions

Only the current `main` branch and the currently deployed site are supported. There are no
long-term support branches, and fixes are not backported to older tags.

## Scope

In scope:

- the API service in `apps/api` and the SPA in `apps/web`;
- the importer in `apps/importer`, including parsing of untrusted source files;
- the deployment configuration in `deploy/` and the workflows in `.github/workflows/`;
- the deployed site.

Out of scope:

- vulnerabilities in third-party services this project talks to — report those to the service.
  That includes Dropbox and any AI provider you connect. Note that the AI assistant sends requests
  **directly from your browser to the provider using your own API key**; the project's server is not
  in that path. See [Security & Local-First Privacy](docs/extra/security-and-privacy.md);
- the content of the imported texts themselves (translation, transcription, or doctrinal
  objections). Those are content issues, not vulnerabilities — open a normal issue;
- findings that depend on an attacker already controlling the user's browser profile or device. The
  local-first design deliberately stores notes, assistant history, and short-lived tokens in browser
  storage, which is documented rather than treated as a defect;
- missing hardening with no demonstrated impact (for example a header-only report from an automated
  scanner) — unless you can show what it enables.

## What this project stores

There are no user accounts and no server-side user data. Notes, assistant conversations, reading
preferences, and access tokens live in the browser. The API server serves read-only content from a
SQLite database. The threat model and every storage location are documented in
[Security & Local-First Privacy](docs/extra/security-and-privacy.md).
