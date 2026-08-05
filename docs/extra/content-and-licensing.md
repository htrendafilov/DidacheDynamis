# Content Provenance & Licensing Matrix

Every shipped work has recorded provenance and redistribution terms. The detailed audit and the gate
for future Bulgarian content live in [`plan/content_and_licensing.md`](../../plan/content_and_licensing.md).

The authoritative attribution record is the repository-root [`NOTICE`](../../NOTICE): per work, the
rights holder, license, required attribution wording, and modification status, for the built
artifacts as well as the repository. Full license texts are in
[`LICENSES/`](../../LICENSES/README.md). The table below is the summary view.

## Content Rights Matrix

| Work / Module | Primary Language | Legal License | Redistribution Rights | Notes / Attribution |
|---|---|---|---|---|
| **World English Bible (WEB)** | English | Public Domain | ✅ Unrestricted | Modern English translation based on ASV |
| **Matthew Henry Commentary** | English | Public Domain | ✅ Unrestricted | Formatting & structure parsed from public domain source |
| **Easton's Bible Dictionary** | English | Public Domain | ✅ Unrestricted | 1897 edition biblical dictionary |
| **1689 London Baptist Confession** | English | Public Domain | ✅ Unrestricted | Historical reformed Baptist confession |
| **Баптистка изповед на вярата от 1689 г.** | Bulgarian | CC0 1.0 Universal | ✅ Unrestricted | Reviewed Bulgarian translation and editorial revision |
| **TSK Cross-References** | English | CC BY 4.0 | ✅ Permitted with attribution | Treasury of Scripture Knowledge cross-references |
| **King James Version (KJV)** | English | CrossWire Dist. License / UK Crown Copyright | ⚠️ GPL Module License — **open** | Official module fetched from CrossWire during the build; no KJV text is committed. The build still compiles it into `content.sqlite` and the container image, so redistribution is not avoided — an owner decision is required before publication (`plan/going_public.md` decision 11) |
| **Bulgarian Bible** | Bulgarian | **Not cleared** | ❌ Not shipped | Deferred until written permission or a verified public-domain source is obtained |

## Rules for New Content Submissions

1. **No Unlicensed Texts**: No Bible translation, commentary, or dictionary may be committed without a recorded license audit line and source attribution.
2. **Strict Versification Rules**: When adding a new translation, `bibleimport` validates versification mapping against canonical reference versification. It reports mismatches and **never** silently renumbers verses.
