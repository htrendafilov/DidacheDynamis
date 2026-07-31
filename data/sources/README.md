# data/sources

Committed source texts used by `apps/importer` to build `content.sqlite`. **Only public-domain /
redistributable sources belong here** (owner-provided/licensed texts stay out of git).

| File | Work | License | Source |
|---|---|---|---|
| `engwebp_usfx.zip` | World English Bible (Protestant) | Public domain | https://ebible.org/find/details.php?id=engwebp |
| `KJV.imp.gz` | King James Version (1769), CrossWire 3.1 | CrossWire general public license; module distribution: GPL | https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=KJV |
| `MHC.imp.gz` | Matthew Henry's Complete Commentary | Public domain | CrossWire MHC 2.2 |
| `Easton.raw.imp.gz` | Easton's Bible Dictionary (raw structured export; active importer input) | Public domain | CrossWire Easton module |
| `crossreferences_kjv.tsv` | TSK-derived cross-references | CC BY 4.0 | CrossReferences.org KJV mapping |
| `BaptistConfession1689.imp.gz` | Baptist Confession of Faith of 1689 (unaltered provenance base) | Public domain | CrossWire BaptistConfession1689 1.0.2 |
| `BaptistConfession1689-ed1.imp.gz` | Baptist Confession of Faith of 1689 (active reviewed input) | Public domain | CrossWire 1.0.2 + bible_app_bg editorial revision 1 |
| `BaptistConfession1689_BG.imp.gz` | Баптистка изповед на вярата от 1689 г. (български превод) | CC0 1.0 Universal | Public-domain English revision + bible_app_bg Bulgarian translation |
| `StrongsGreek.imp.gz` | Strong's Greek Dictionary (M8 lexical data) | Public domain | CrossWire StrongsGreek 2.0 |
| `StrongsHebrew.imp.gz` | Strong's Hebrew Dictionary (M8 lexical data) | Public domain | CrossWire StrongsHebrew 1.2 |

**World English Bible attribution (required):** "The World English Bible is in the Public Domain. That
means that it is not copyrighted. However, 'World English Bible' is a Trademark of eBible.org."

These large binaries are stored via **Git LFS** (see the repo `.gitattributes`). After cloning, run
`git lfs install` once and `git lfs pull` to fetch the real files; the Docker build checks out with LFS.

Rebuild the whole database in one step (the Docker build uses exactly this):

```
bibleimport build-all --sources-dir data/sources --out data/content.sqlite
```

The release build imports both reviewed editions of the 1689 Confession: `baptist1689` (English) and
`baptist1689bg` (Bulgarian, CC0).

Or run the stages individually:

```
bibleimport build-web --source data/sources/engwebp_usfx.zip --out data/content.sqlite
bibleimport add-kjv --source data/sources/KJV.imp.gz --out data/content.sqlite
bibleimport add-study --out data/content.sqlite \
  --mhc-source data/sources/MHC.imp.gz \
  --easton-source data/sources/Easton.raw.imp.gz \
  --xref-source data/sources/crossreferences_kjv.tsv
bibleimport add-book --source data/sources/BaptistConfession1689-ed1.imp.gz \
  --out data/content.sqlite
bibleimport add-strongs --out data/content.sqlite \
  --greek-source data/sources/StrongsGreek.imp.gz \
  --hebrew-source data/sources/StrongsHebrew.imp.gz
```

## Study-source provenance

The commentary and dictionary exports come from CrossWire modules whose module pages say
**“Public Domain—Copy Freely”**. They were exported with the official SWORD 1.9.0 utility, not by
parsing SWORD binaries in this repository:

```bash
SWORD_PATH=/path/to/unpacked/modules mod2imp KJV | gzip -9 > KJV.imp.gz
SWORD_PATH=/path/to/unpacked/modules mod2imp MHC | gzip -9 > MHC.imp.gz
SWORD_PATH=/path/to/unpacked/modules mod2imp Easton | gzip -n -9 > Easton.raw.imp.gz
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
  - raw IMP SHA-256:
    `9aaa5a3f7ecc7042bc1985f51f836f2464001bd7fd24713a7404179dfd7e70bb`
  - committed deterministic raw gzip SHA-256:
    `2b7d1d211c0ea532c47afce170edb7c31e8097f502e15ca343eca5e2aaa059c5`
  - raw export validation: 3,963 valid `<entryFree>` documents, 24,092
    `<ref osisRef="Bible:…">` references, and 687 `<ref target="Easton:…">` references.
  - the raw export is the active input; its structured references ship as scripture links and
    internal dictionary links ([`../../plan/easton_dictionary_references.md`](../../plan/easton_dictionary_references.md)).
    The former stripped `mod2imp Easton -s` export was retired once the raw adapter shipped.
- Cross-references: https://github.com/CrossReferences-org/bible-cross-references at source blob
  `47ed2af489e1212e057bc073e1844d382804aac2`, licensed CC BY 4.0.
  - committed TSV SHA-256: `0da9d809096e5b650f5c960e68000e580c9f4582beafe673ea1190e2e0105b9f`
- Baptist Confession 1689 module:
  https://www.crosswire.org/ftpmirror/pub/sword/raw/mods.d/baptistconfession1689.conf
  - CrossWire metadata records `RawGenBook`, version 1.0.2, and
    `DistributionLicense=Public Domain`.
  - downloaded raw ZIP SHA-256: `d6210b1114ea1a6fcd3336524813c08ca3ad57c761814246b15fa278eb8fc98a`
  - committed unaltered raw-OSIS export SHA-256:
    `b59db23d63355091d4ffc976334bbd514b2ef4545c303b7aba5e6d7e527b4c7b`
  - the original export remains unchanged as the provenance base. The importer uses
    `BaptistConfession1689-ed1.imp.gz`, generated deterministically from it by
    [`../../scripts/build_baptist_confession_1689_ed1.py`](../../scripts/build_baptist_confession_1689_ed1.py).
  - revision 1 repairs 67 documented transcription omissions, Scripture-reference/OSIS errors, and
    markup defects. It retains the module's existing modernized spelling and punctuation and does
    not intentionally modernize doctrine or style.
  - the complete editorial policy, verification sources, before/after correction list, and checksums
    are in
    [`BaptistConfession1689-ed1.info.json`](BaptistConfession1689-ed1.info.json).
  - reviewed deterministic gzip SHA-256:
    `0d952252aa798e4cd1c024ad70fa76f99b7a76310c803c05adc142a8568263fd`
  - verify or rebuild with:
    `python3 scripts/build_baptist_confession_1689_ed1.py --check` or
    `python3 scripts/build_baptist_confession_1689_ed1.py`.
- Bulgarian translation:
  - the Bulgarian translation and its editorial changes are released under
    [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/);
  - the rights declaration, source chain, checksums, and SWORD package metadata are recorded in
    [`BaptistConfession1689_BG.info.json`](BaptistConfession1689_BG.info.json);
  - the complete editorial record is
    [`BaptistConfession1689_BG.corrections.md`](BaptistConfession1689_BG.corrections.md);
  - rebuild the deterministic IMP gzip with
    `python3 scripts/revise_baptist_confession_1689_bg.py`;
  - build the installable Eloquent/SWORD package with
    `python3 scripts/build_baptist_confession_1689_bg_sword.py`.
- Strong's Greek Dictionary module:
  https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=StrongsGreek
  - CrossWire metadata records version 2.0 and `Public Domain`; the text derives from James
    Strong, *Exhaustive Concordance of the Bible* (1890), public domain by age.
  - exported with the official SWORD 1.9.0 utility (raw, no `-s`):
    `SWORD_PATH=<modules> mod2imp StrongsGreek | gzip -n -9 > StrongsGreek.imp.gz`
  - committed export SHA-256: `5d79ff282bf2cc1f1d2ed144ae1546a484b7f903c4111071b0f17626543e9031`
  - TEI `<entryFree>` records keyed by bare 5-digit numbers (`00001` -> `G0001`).
  - import validation: 5,742 records = 1 front-matter + 252 `@@@@` placeholder stubs +
    5,488 entries + `G0251` (keyed with a definition but no lemma — recorded anomaly, not
    imported). 135 numbers have no key at all (module holes; 30 of them are tagged in the
    KJV, e.g. `G3778` — no entry exists to import). 52 entries carry Chinese editorial
    annotations from the upstream e-text; imported verbatim and counted in diagnostics.
- Strong's Hebrew Dictionary module:
  https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=StrongsHebrew
  - CrossWire metadata records version 1.2 and `Public Domain — Copy Freely`; same 1890
    Strong derivation.
  - exported with the official SWORD 1.9.0 utility (raw, no `-s`):
    `SWORD_PATH=<modules> mod2imp StrongsHebrew | gzip -n -9 > StrongsHebrew.imp.gz`
  - committed export SHA-256: `0e6d2570054f011e517298302c212f4eee4be27a27c12df31ec13e3c5ae10532`
  - plain-text records (no TEI), CP1252 bytes; the module is transliteration-only (no Hebrew
    script), so `strong_lexicon.transliteration` stays NULL for Hebrew entries.
  - import validation: 8,674 entries, contiguous keys; the 1996 e-text's seven spurious
    `&Š` (0x8A) sequences are removed with the count asserted in the build (a module update
    that changes the count fails the import for review); `H8483`'s first line misprints its
    own number as 8383 — the module key is authoritative and the entry is imported as `H8483`
    with the mismatch recorded.

The imported `works` records carry the same license and attribution. CCEL ThML remains supported by
the adapter and test fixtures, but production uses CrossWire's explicitly redistributable editions.
