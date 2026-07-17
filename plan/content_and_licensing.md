# Content & Licensing

Rights status of every text we might ship, and the gate before publishing any of it. Rule (from
[`../AGENTS.md`](../AGENTS.md)): **no Bible/commentary text is published without recorded, sufficient
rights.** We are not lawyers; when a text is copyrighted we get the rights holder's written permission
before shipping, and store that evidence with the work.

## v1 ships (redistributable with recorded terms)

| Work | Type | Language | License | Notes |
|---|---|---|---|---|
| World English Bible (WEB) | Bible | EN | Public domain | Red-letter (words-of-Jesus) capable. Primary EN text. |
| KJV | Bible | EN | Public domain | Fallback EN if red-letter WEB is fiddly. |
| Matthew Henry's Complete Commentary | Commentary | EN | Public domain | CrossWire MHC 2.2 module; exported with official SWORD tools. |
| Easton's Bible Dictionary | Dictionary | EN | Public domain | CrossWire Easton module; exported with official SWORD tools. |
| Treasury of Scripture Knowledge-derived mapping | Cross-refs | — | CC BY 4.0 | CrossReferences.org KJV mapping; explicit attribution stored and shown. |

**v1 is English-only.** The pane system and canonical addressing already support additional
translations, so Bulgarian can be added later with no rework once its rights are cleared.

Production does not republish CCEL's downloadable XML editions: CCEL's policy asks users to contact
them before republishing CCEL works. CrossWire's MHC and Easton module pages explicitly mark their
distributions **Public Domain—Copy Freely**, which is the recorded basis for the committed exports.

## Bulgarian Bible — DEFERRED (rights not yet cleared)

**Preferred target: the ББД (Bulgarian Bible Society) edition** — *"Библия, ревизирано издание"*
© Българско библейско дружество, 2015 (the "РИ ББД" revised edition, the one shipped in YouVersion /
Bible.com, version id 1443). The owner will pursue **written permission from ББД** for use in this app.
This is a copyrighted, licensed text — **not** public domain — so it ships only after a permission/
license agreement is in hand. Everything below is the supporting analysis and fallbacks.

### ББД Revised Edition (preferred) — status & permission path
- **Rights:** © Bulgarian Bible Society 2015. ББД is a United Bible Societies member; on Bible.com the
  text is shown *"used with permission,"* and anything past limited quoting requires explicit written
  permission from ББД. So a full-Bible web reader needs a license.
- **Permission contact:** Bulgarian Bible Society — `biblesociety.bg` (also `bulgarian.bible`). Request
  permission for **non-commercial** display of the full text in a web reading app; ask what delivery/
  attribution terms apply.
- **Likely delivery model (architectural caveat):** UBS/Bible-Society texts are usually licensed via
  the **Digital Bible Library (DBL)** and served through **api.bible** (scripture.api.bible). Such
  licenses often **restrict storing/exporting the full text** and require API-backed delivery,
  attribution, and rate limits. If ББД's terms forbid local full-text storage, that conflicts with our
  "baked read-only SQLite" model **for this one text** — we'd serve the BG Bible via the licensed API
  (or a permitted local cache) while the PD works stay in SQLite. Clarify storage rights when
  requesting permission; record whichever model they permit.

### Other Bulgarian sources (fallbacks / reference)

### CrossWire modules (checked 2026-07-17)
- **BulVeren — "Veren's Contemporary Bible"** (Veren LTD, 2020). License: *"Copyrighted; Permission
  granted to distribute non-commercially in SWORD format."* Copyrighted; the grant is scoped to
  distribution **as a SWORD module**, i.e. to the SWORD app ecosystem. Re-encoding the text and
  serving it over our own HTTP API is **not** "in SWORD format," so this grant does **not** cover our
  use. (A different publisher from ББД; not the preferred text.)
- **BulCarigradNT — "Bulgarian NT 1914, Tsarigrad Edition"** (Youth group, Church of God in Sofia,
  1997; permission via Ventsislav Stoykov). License: *"Copyrighted; Permission to distribute granted
  to CrossWire."* Even narrower — permission granted **to CrossWire specifically** — and it is **New
  Testament only.** Not usable for us.
- **There is no public-domain Bulgarian module on CrossWire.**

### Public-domain fallback (only if ББД permission cannot be obtained)
- **Tsarigrad / Constantinople Bible of 1871** (Slaveykov, Riggs, Long, et al.) — the first modern
  Bulgarian full-Bible translation. Public domain by age (>150 years). The *text* is PD; a specific
  *digital edition* may carry its own editorial copyright, so we'd need a clean PD-sourced digital copy
  (Bulgarian Wikisource, eBible.org, etc.). Archaic language; no words-of-Jesus markup.
- The 1940 Protestant revision and 1925/1926 Orthodox Synodal Bible have **uncertain** copyright status
  — treat as not-clear until verified.

### Options to add Bulgarian later (in preference order)
- **A. ББД Revised Edition 2015 via written permission (PREFERRED).** Owner requests permission/license
  from Bulgarian Bible Society for non-commercial full-text web display; clarify storage vs.
  API-delivery terms; store the agreement as the work's rights evidence. Best (modern, familiar text;
  same as YouVersion).
- **B. Public-domain 1871 Tsarigrad** — fallback if A is refused/unaffordable: source + verify a clean
  PD digital full-Bible text. No permission needed, but archaic language.
- **C. Owner-provided file** — any Bulgarian text the owner holds rights to, with attestation.

**Decision gate:** obtain ББД permission (A) — or fall back to B/C — and record the rights evidence
(and any delivery/storage constraints) before importing/publishing the Bulgarian Bible. Until then it
stays out of the shipped app; v1 ships English-only regardless.
