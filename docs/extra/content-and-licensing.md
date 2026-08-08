# Content Provenance & Licensing Matrix

The invariant is one-way: **every work the application serves must appear below and in `NOTICE`**.
The reverse does not hold — the table also records works deliberately *not* shipped, so that a
decision not to ship is visible rather than silent. The detailed audit and the gate
for future Bulgarian content live in [`plan/content_and_licensing.md`](../../plan/content_and_licensing.md).

The authoritative attribution record is the repository-root [`NOTICE`](../../NOTICE): per work, the
rights holder, license, required attribution wording, and modification status, for the built
artifacts as well as the repository. Full license texts are in
[`LICENSES/`](../../LICENSES/README.md). The table below is the summary view.

## Content Rights Matrix

| Work / Module | Primary Language | Legal License | Redistribution Rights | Notes / Attribution |
|---|---|---|---|---|
| **World English Bible (WEB)** | English | Public Domain | ✅ Unrestricted | Modern English translation based on ASV. The text is public domain, but "World English Bible" is a **trademark** of eBible.org, so the name may not be used to label a modified text; eBible's required attribution wording is reproduced verbatim in `NOTICE` and in the app |
| **Matthew Henry Commentary** | English | Public Domain | ✅ Unrestricted | Formatting & structure parsed from public domain source |
| **Easton's Bible Dictionary** | English | Public Domain | ✅ Unrestricted | 1897 edition biblical dictionary |
| **1689 London Baptist Confession** | English | Public Domain | ✅ Unrestricted | Historical reformed Baptist confession. **Modified**: the shipped text is editorial revision 1, with 67 documented corrections to transcription omissions, Scripture-reference/OSIS errors and markup defects, verified against the historical 1677 text; no doctrinal or stylistic modernization. Full record in `data/sources/BaptistConfession1689-ed1.info.json` |
| **Баптистка изповед на вярата от 1689 г.** | Bulgarian | CC0 1.0 Universal | ✅ Unrestricted | Reviewed Bulgarian translation and editorial revision |
| **TSK Cross-References** | English | CC BY 4.0 | ✅ Permitted with attribution | Treasury of Scripture Knowledge cross-references, used unmodified. CC BY 4.0 asks that the creator, a licence notice, a licence URI and a modification indication accompany redistribution; all four are carried in the work's `attribution` field, so they travel inside `content.sqlite` and the container image and are shown in the app. `NOTICE` and `LICENSES/` also ship in the image |
| **Strong's Greek Dictionary** | English / Greek | Public Domain | ✅ Unrestricted | James Strong, *Exhaustive Concordance* (1890); CrossWire StrongsGreek 2.0. Text unmodified — 52 entries carry upstream Chinese editorial annotations, imported verbatim |
| **Strong's Hebrew Dictionary** | English / Hebrew | Public Domain | ✅ Unrestricted | Same 1890 derivation; CrossWire StrongsHebrew 1.2. Seven spurious `&Š` sequences from the 1996 e-text are removed at import, with the count asserted so an upstream change fails the build |
| **King James Version (KJV)** | English | CrossWire grant (any purpose) / UK Crown Copyright | ✅ Permitted, with attribution | Official module fetched from CrossWire during the build; no KJV text is committed, but the build compiles it into `content.sqlite` and the container image. CrossWire grants use of the KJV2003 text for any purpose; Crown rights are UK-territorial. Decided 2026-08-06 — `plan/going_public.md` decision 11, `NOTICE` §3 |
| **Bulgarian Bible** | Bulgarian | **Not cleared** | ❌ Not shipped | Deferred until written permission or a verified public-domain source is obtained |

## Rules for New Content Submissions

1. **No Unlicensed Texts**: No Bible translation, commentary, or dictionary may be committed without a recorded license audit line and source attribution.
2. **Strict Versification Rules**: When adding a new translation, `bibleimport` validates versification mapping against canonical reference versification. It reports mismatches and **never** silently renumbers verses.
