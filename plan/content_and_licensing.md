# Content & Licensing

Rights status of every text we might ship, and the gate before publishing any of it. Rule (from
[`../AGENTS.md`](../AGENTS.md)): **no Bible/commentary text is published without recorded, sufficient
rights.** We are not lawyers; when a text is copyrighted we get the rights holder's written permission
before shipping, and store that evidence with the work.

## v1 ships (all public domain)

| Work | Type | Language | License | Notes |
|---|---|---|---|---|
| World English Bible (WEB) | Bible | EN | Public domain | Red-letter (words-of-Jesus) capable. Primary EN text. |
| KJV | Bible | EN | Public domain | Fallback EN if red-letter WEB is fiddly. |
| Matthew Henry's Complete Commentary | Commentary | EN | Public domain | CCEL source (ThML). |
| Easton's Bible Dictionary | Dictionary | EN | Public domain | |
| Treasury of Scripture Knowledge (TSK) | Cross-refs | — | Public domain | Translation-independent. |

**v1 is English-only.** The pane system and canonical addressing already support additional
translations, so Bulgarian can be added later with no rework once its rights are cleared.

## Bulgarian Bible — DEFERRED (rights not yet cleared)

We want a Bulgarian Bible but do not yet have one we can legally serve from a custom web app. Findings:

### CrossWire modules (checked 2026-07-17)
- **BulVeren — "Veren's Contemporary Bible"** (Veren LTD, 2020). License: *"Copyrighted; Permission
  granted to distribute non-commercially in SWORD format."* Copyrighted; the grant is scoped to
  distribution **as a SWORD module**, i.e. to the SWORD app ecosystem. Re-encoding the text and
  serving it over our own HTTP API is **not** "in SWORD format," so this grant does **not** cover our
  use. Modern, readable text — worth pursuing via permission (option A below).
- **BulCarigradNT — "Bulgarian NT 1914, Tsarigrad Edition"** (Youth group, Church of God in Sofia,
  1997; permission via Ventsislav Stoykov). License: *"Copyrighted; Permission to distribute granted
  to CrossWire."* Even narrower — permission granted **to CrossWire specifically** — and it is **New
  Testament only.** Not usable for us.
- **There is no public-domain Bulgarian module on CrossWire.**

### The public-domain route
- **Tsarigrad / Constantinople Bible of 1871** (Slaveykov, Riggs, Long, et al.) — the first modern
  Bulgarian full-Bible translation. Public domain by age (>150 years). The *text* is PD; a specific
  *digital edition* may carry its own editorial copyright, so we need a clean PD-sourced digital copy.
  Sources to verify: Bulgarian Wikisource, eBible.org, other open Bible repositories. Language is
  archaic vs. Veren's contemporary text.
- The 1940 Protestant revision and 1925/1926 Orthodox Synodal Bible have **uncertain** copyright
  status — treat as not-clear until verified.

### Options to add Bulgarian later
- **A. Permission for BulVeren** — ask Veren LTD (via the CDL Project / CrossWire) for written
  permission to serve their text non-commercially via a web application. Best modern-language outcome;
  store the permission as the work's rights evidence.
- **B. Public-domain 1871 Tsarigrad** — source and verify a clean digital full-Bible text; no
  permission needed, but archaic language and no words-of-Jesus markup (red-letter toggle would render
  plain for this text).
- **C. Owner-provided file** — any Bulgarian text the owner holds rights to, with attestation.

**Decision gate:** pick A, B, or C and record the rights evidence before importing/publishing the
Bulgarian Bible. Until then, it stays out of the shipped app.
