# data/sources

Committed source texts used by `apps/importer` to build `content.sqlite`. **Only public-domain /
redistributable sources belong here** (owner-provided/licensed texts stay out of git).

| File | Work | License | Source |
|---|---|---|---|
| `engwebp_usfx.zip` | World English Bible (Protestant) | Public domain | https://ebible.org/find/details.php?id=engwebp |
| `KJV.imp.gz` | King James Version (1769), CrossWire 3.1 | CrossWire general public license; module distribution: GPL | https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=KJV |
| `MHC.imp.gz` | Matthew Henry's Complete Commentary | Public domain | CrossWire MHC 2.2 |
| `Easton.imp.gz` | Easton's Bible Dictionary | Public domain | CrossWire Easton module |
| `crossreferences_kjv.tsv` | TSK-derived cross-references | CC BY 4.0 | CrossReferences.org KJV mapping |
| `BaptistConfession1689.imp.gz` | Baptist Confession of Faith of 1689 | Public domain | CrossWire BaptistConfession1689 1.0.2 |

**World English Bible attribution (required):** "The World English Bible is in the Public Domain. That
means that it is not copyrighted. However, 'World English Bible' is a Trademark of eBible.org."

These large binaries are stored via **Git LFS** (see the repo `.gitattributes`). After cloning, run
`git lfs install` once and `git lfs pull` to fetch the real files; the Docker build checks out with LFS.

Rebuild the whole database in one step (the Docker build uses exactly this):

```
bibleimport build-all --sources-dir data/sources --out data/content.sqlite
```

Or run the stages individually:

```
bibleimport build-web --source data/sources/engwebp_usfx.zip --out data/content.sqlite
bibleimport add-kjv --source data/sources/KJV.imp.gz --out data/content.sqlite
bibleimport add-study --out data/content.sqlite \
  --mhc-source data/sources/MHC.imp.gz \
  --easton-source data/sources/Easton.imp.gz \
  --xref-source data/sources/crossreferences_kjv.tsv
```

## Study-source provenance

The commentary and dictionary exports come from CrossWire modules whose module pages say
**“Public Domain—Copy Freely”**. They were exported with the official SWORD 1.9.0 utility, not by
parsing SWORD binaries in this repository:

```bash
SWORD_PATH=/path/to/unpacked/modules mod2imp KJV | gzip -9 > KJV.imp.gz
SWORD_PATH=/path/to/unpacked/modules mod2imp MHC | gzip -9 > MHC.imp.gz
SWORD_PATH=/path/to/unpacked/modules mod2imp Easton -s | gzip -9 > Easton.imp.gz
SWORD_PATH=/path/to/unpacked/modules mod2imp BaptistConfession1689 \
  | gzip -n -9 > BaptistConfession1689.imp.gz
```

- KJV module:
  - CrossWire grants a general public license to use the KJV2003 Project text for any purpose and
    lists the module distribution license as GPL; its page also records Crown of England rights in
    the base text. The app reproduces these terms in its attribution dialog.
  - raw module SHA-256: `873815aa4b4123025616d1f41eae75f412111275f4c3884e36f92d4f46dcba1d`
  - committed raw-OSIS export SHA-256: `6155ed9188d3a1fcfb5e535c8f17bd72cda75c00f8828aa58e34ce213825610c`
- MHC module: https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=MHC
  - raw module SHA-256: `6bcb936873ca144e317805e5c1677940fd86e2403f7c14517752e44f25c8882b`
  - committed raw-OSIS export SHA-256: `3238c932ece1ced9c4f824e6a293e3caf5c528cd369e4d3cbdeb41e089af61e0`
- Easton module: https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=Easton
  - raw module SHA-256: `f6dd054554764e2e97d5d189a697eb26039054578a9ccf98ce668ab810341c6e`
  - committed export SHA-256: `953dbd99c4c3fe29516bb7dbf19283fae43ce263acf29ae3be839c887815ca77`
- Cross-references: https://github.com/CrossReferences-org/bible-cross-references at source blob
  `47ed2af489e1212e057bc073e1844d382804aac2`, licensed CC BY 4.0.
  - committed TSV SHA-256: `0da9d809096e5b650f5c960e68000e580c9f4582beafe673ea1190e2e0105b9f`
- Baptist Confession 1689 module:
  https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=BaptistConfession1689
  - CrossWire metadata records `RawGenBook`, version 1.0.2, and `Public Domain`.
  - downloaded raw ZIP SHA-256: `d6210b1114ea1a6fcd3336524813c08ca3ad57c761814246b15fa278eb8fc98a`
  - committed raw-OSIS export SHA-256: `b59db23d63355091d4ffc976334bbd514b2ef4545c303b7aba5e6d7e527b4c7b`

The imported `works` records carry the same license and attribution. CCEL ThML remains supported by
the adapter and test fixtures, but production uses CrossWire's explicitly redistributable editions.
