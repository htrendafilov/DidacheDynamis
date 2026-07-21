# Content Provenance & Licensing Matrix

All scripture, commentary, dictionary, and confession texts in `bible_app_bg` strictly comply with intellectual property and redistribution rights.

## Content Rights Matrix

| Work / Module | Primary Language | Legal License | Redistribution Rights | Notes / Attribution |
|---|---|---|---|---|
| **World English Bible (WEB)** | English | Public Domain | ✅ Unrestricted | Modern English translation based on ASV |
| **Matthew Henry Commentary** | English | Public Domain | ✅ Unrestricted | Formatting & structure parsed from public domain source |
| **Easton's Bible Dictionary** | English | Public Domain | ✅ Unrestricted | 1897 edition biblical dictionary |
| **1689 London Baptist Confession** | English | Public Domain | ✅ Unrestricted | Historical reformed Baptist confession |
| **TSK Cross-References** | English | CC BY 4.0 | ✅ Permitted with attribution | Treasury of Scripture Knowledge cross-references |
| **King James Version (KJV)** | English | CrossWire Dist. License / UK Crown Copyright | ⚠️ GPL Module License | Source module: `KJV.imp.gz` |
| **Bulgarian Bible** | Bulgarian | Rights Attested by Owner | ✅ Owner-provided | Bulgarian scripture text rights cleared with owner |

## Rules for New Content Submissions

1. **No Unlicensed Texts**: No Bible translation, commentary, or dictionary may be committed without a recorded license audit line and source attribution.
2. **Strict Versification Rules**: When adding a new translation, `bibleimport` validates versification mapping against canonical reference versification. It reports mismatches and **never** silently renumbers verses.
