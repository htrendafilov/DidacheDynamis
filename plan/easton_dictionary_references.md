# Plan: structured references in Easton's Bible Dictionary

**Status:** shipped. `build-all` imports the raw structured export
`data/sources/Easton.raw.imp.gz`; the stripped `Easton.imp.gz` is retired. All 24,779
reference elements are classified in the build diagnostics (see
`content.sqlite.diagnostics.json`): 23,109 Bible refs linked (354 chapter-only, 74 via
full-chapter ranges, 42 single-chapter-book citations), 914 deterministically corrected,
3 unsupported (`1Macc`), 66 unreconciled plain text; 617 Easton links resolve, 1 ambiguous
(`SALMON`) and 69 missing stay plain text.

## Goal

Preserve both structured link types already present in the CrossWire Easton module:

1. `<ref osisRef="Bible:…">` becomes the existing scripture-reference control: hover/focus/tap opens
   a WEB passage preview, and the action opens the passage in a Bible pane.
2. `<ref target="Easton:…">` becomes an internal dictionary link that opens the referenced headword
   in the same Dictionary pane.

The source-format logic remains in the offline importer. The API continues to serve Document CIR;
the browser never parses SWORD/OSIS markup.

## Verified source inventory

The raw export was produced twice with the official installed SWORD `mod2imp` utility and was
byte-for-byte identical:

```bash
mod2imp Easton > Easton.raw.imp
gzip -n -9 -c Easton.raw.imp > Easton.raw.imp.gz
```

- Raw IMP SHA-256: `9aaa5a3f7ecc7042bc1985f51f836f2464001bd7fd24713a7404179dfd7e70bb`
- Deterministic gzip SHA-256:
  `2b7d1d211c0ea532c47afce170edb7c31e8097f502e15ca343eca5e2aaa059c5`
- 3,963 well-formed `<entryFree>` documents; no XML parse failures.
- 24,092 `Bible:` references:
  - 23,734 canonical 66-book verse/range targets accepted by the current reference model.
  - 355 canonical chapter-only targets, which the current `ScriptureRef` parser does not yet accept.
  - 3 `1Macc` targets. The app ships a Protestant 66-book canon and no 1 Maccabees text, so these
    remain plain text with a diagnostic unless a future, explicit canon/content decision adds it.
- 687 `Easton:` references:
  - 617 resolve to exactly one module entry key.
  - 1 resolves to the ambiguous duplicate key `SALMON`.
  - 69 do not resolve to an exported key (source typos/missing aliases such as `CHIRST`, `OF`, and
    `THORNS`).
- The module has 3,961 unique keys/headwords but 3,963 entries: `KADESH` and `SALMON` each have two
  genuinely different definitions.

### Source-target integrity caveat

Structured does not always mean correct. The module assigns incorrect `Gen` targets to many
shorthand labels. For example, after `Rev. 1:8`, visible labels `11`, `21:6`, and `22:13` carry
`Bible:Gen…` targets even though their textual context clearly continues Revelation. A conservative
paragraph-context audit flags approximately 922 of the 5,774 numeric shorthand references as
candidate target mismatches.

The importer must therefore validate the supplied target against the visible label and local
citation context. It must not blindly copy the raw target or silently “repair” it.

## CIR/API contract

Keep the shipped scripture field unchanged:

```json
{"t": "John 3:16", "ref": "John.3.16"}
```

Add one optional, typed internal dictionary target:

```json
{
  "t": "MOSES",
  "dictionary_ref": {
    "work_id": "easton",
    "entry_key": "MOSES",
    "headword": "Moses"
  }
}
```

- Add `DictionaryDocumentRef` and `DocumentRun.dictionary_ref` to the Pydantic and TypeScript
  contracts.
- `ref` and `dictionary_ref` are mutually exclusive. Import validation rejects a run containing
  both.
- No SQL schema change is required: both values live in the existing `body_json`. The content
  version/checksum still changes, so the API must restart after the rebuilt DB is swapped.
- Preserve the source entry key while also carrying its resolved display headword. This keeps the
  source relationship auditable and lets the current headword API load a uniquely resolved entry.

## Importer design

### 1. Safe raw-entry parser

- Add a raw Easton adapter path in `formats/study.py` (or a focused
  `formats/sword_dictionary.py`) using `defusedxml`.
- Enforce the existing expanded-size limit and reject DTDs/entities/external resources.
- Parse each IMP record as one `<entryFree>` document; take the display headword from `n`/`title`.
- Preserve paragraphs and existing inline formatting as Document CIR runs.
- Build the complete module-key → entries index before resolving internal references.

### 2. Bible references

- Strip the `Bible:` work prefix, then normalize only supported canonical targets.
- Extend the reference model and `ScriptureRef` to accept `Book.chapter` in addition to
  `Book.chapter.verse[-end]`. A chapter-only pop-up calls the existing passage endpoint for a
  bounded opening window (`verses=1-6`) rather than the whole chapter — the pop-up fires on hover
  and Psalm 119 is 176 verses — and marks the preview as truncated when the window comes back full.
- Validate each target against its visible label:
  - Explicit book/chapter/verse labels must agree with the raw target.
  - Chapter/verse shorthand inherits only the last unambiguous book in the same paragraph.
  - Verse-only shorthand inherits only the last unambiguous book and chapter in the same paragraph.
  - A context-derived correction is used only when deterministic. Record the raw and derived targets
    in diagnostics; never correct silently.
  - If the label, raw target, and context cannot be reconciled, preserve the visible text without a
    link and emit a diagnostic.
- Keep the three `1Macc` references as visible plain text plus `unsupported_book` diagnostics.

### 3. Internal Easton references

- Split `target="Easton:MOSES"` into module id and exact source entry key.
- Resolve only keys that map to exactly one entry; emit a typed `dictionary_ref` run.
- Leave the one ambiguous and 69 unresolved targets as plain text and emit separate
  `ambiguous_dictionary_target` / `missing_dictionary_target` diagnostics.
- Do not guess aliases or silently pick the first homonym. A later dictionary-disambiguation feature
  can make `KADESH`/`SALMON` targetable without losing a definition.

### 4. Diagnostics and publication gate

Add summary counts to `build-all` diagnostics:

- raw entries parsed;
- Bible refs linked, chapter-only, deterministically corrected, unsupported, and unresolved;
- Easton refs linked, ambiguous, and missing;
- duplicate entry keys.

The import fails on malformed XML, unsafe constructs, a count regression from 3,963 entries, or an
unclassified reference. Known unsupported/ambiguous cases remain warnings with exact source keys.

## Frontend behavior

### Bible links

No Dictionary-pane special case is needed. `DictionaryPane` already uses `DocumentRenderer`, which
renders `run.ref` through the shipped `ScriptureRef` component. Extend that component only for
chapter-only targets.

### Internal dictionary links

- Add a small `DictionaryDocumentRef` button component with normal link styling and keyboard focus.
- Give `DocumentRenderer` an optional `onDictionaryNavigate(target)` callback.
- `DictionaryPane` supplies the callback and updates that same pane's `workId`/`headword`; its existing
  effect seeds the prefix list and loads the entry.
- Commentary and General Book renderers omit the callback, so a future cross-work dictionary link
  requires an explicit product decision instead of silently opening an arbitrary pane.
- Initial scope is direct navigation, not a dictionary-definition hover preview. A Back action/history
  stack can be a separate UX enhancement.

## Tests

### Importer

- Raw fixture with one Bible ref, one chapter-only ref, one valid `Easton:` ref, one missing target,
  inline formatting, and malicious XML.
- Shorthand correction fixtures, including the real `Rev. 1:8,11; 21:6; 22:13` pattern.
- Explicit mismatch, ambiguous duplicate, unsupported `1Macc`, and unresolved-target diagnostics.
- Full-source audit asserting 3,963 entries and classification of all 24,779 reference elements.

### API

- A dictionary response carries both `ref` and `dictionary_ref` runs through Pydantic unchanged.
- Chapter-only Bible references remain valid response data.

### Frontend

- `DocumentRenderer` renders scripture and dictionary reference controls without nesting buttons.
- Hover/focus/tap on a Dictionary-pane Bible citation shows the passage.
- Clicking `MOSES` opens the Moses entry in the same pane.
- Unsupported, ambiguous, and unresolved targets remain readable plain text.
- Add one Playwright flow for each link type.

## Delivery sequence

1. Implement the raw adapter, reference validation, CIR/API types, UI navigation, and tests while the
   stripped source remains active.
2. Run the full raw-source audit and review every diagnostic category/count.
3. Change `SOURCE_FILES["easton"]` to `Easton.raw.imp.gz`; remove the stripped source only after a
   successful production-shaped `build-all`.
4. Rebuild `content.sqlite`, run API/Playwright checks, and inspect representative entries (`A`,
   `Aaron`, `Atonement`, `Kadesh`, `Salmon`).
5. Back up production, atomically swap the rebuilt DB, restart the API so its content version/ETags
   update, then deploy the SPA.
6. Update `linking_and_embeds.md`, frontend/backend design status, importer docs, and the live runbook
   from “planned” to “shipped.”

## Acceptance criteria

- Dictionary Bible references have the same accessible hover/focus/tap pop-up as commentary/books.
- Chapter-only citations work without pretending they are verse 1.
- Deterministically repaired shorthand never links to the module's incorrect `Gen` placeholder.
- All 24,092 Bible refs and 687 Easton refs are classified in diagnostics; none disappear silently.
- All 617 uniquely resolvable Easton links navigate correctly in the same pane.
- The 3 unsupported Bible refs, 1 ambiguous Easton ref, and 69 unresolved Easton refs remain readable
  and are reported rather than guessed.
- All 3,963 dictionary definitions remain available and searchable.
