# M7 Search Workspace and M8 Strong's Search

Status: **M7.1–M7.5 delivered; M8.1 delivered — sources and licensing resolved 2026-07-27 (§10.1); M8.2–M8.4 proposed**
Last reviewed: 2026-07-27

This document records the delivered unified search foundation/workspace and proposes its remaining
filtering, history/refinement, and Strong's extensions. M7.1/M7.2 expose commentary, dictionary, and
General Book indexes, true totals, stable 50-result pagination, type tabs/counts, work/testament
filters, and relevance/canonical ordering. M7.3 delivers the persistent docked/full-screen workspace.
M7.4 adds granular book filters, a mobile filter sheet, filter/refinement chips, local recent/pinned
history, and server-side refinement with full state restoration. M7.5 completes keyboard/focus
behavior, live announcements, mobile Back to results, cross-provider test coverage, translation
parity, and documentation.

See also:

- [`frontend/frontend_design.md`](frontend/frontend_design.md)
- [`backend/backend_design.md`](backend/backend_design.md)
- [`general_books.md`](general_books.md)
- [`content_and_licensing.md`](content_and_licensing.md)

## 1. Why search needs a redesign

The original UI sent separate Bible/General Book requests, capped apparent results at 20, and did not
query commentary/dictionary FTS. M7.1/M7.2 fixed that correctness foundation. The remaining redesign
is about a persistent workflow, finer scopes, history, refinement, and future lexical search.

The redesign must provide:

1. Bible, commentary, dictionary, and General Book search.
2. Filters by content type, individual work/translation, testament, and Bible book.
3. Local search history and saved searches.
4. Server-side refinement within the complete result set.
5. True result totals and stable pagination.
6. Relevance and canonical/source ordering.
7. A clean future path for Strong's numbers, lemmas, and morphology.

## 2. Product decision: a Search Workspace

Search should be a **persistent tool workspace**, not an ordinary content pane and not the current
temporary overlay.

### Desktop

- Open a resizable drawer docked to the right of the 1–3 reading panes.
- Do not consume one of the three reading-pane slots.
- Keep the query, filters, loaded pages, selection, and scroll position while reading results.
- Clicking a result opens or reuses the correct Bible, commentary, dictionary, or book pane without
  closing the drawer.
- Allow collapsing the workspace to a narrow Search button and restoring it unchanged.

Concept mockup:

![Desktop Search Workspace concept](assets/search/search-workspace-desktop.png)

### Mobile

- Present Search as a full-screen view rather than a cramped drawer.
- Filters open in a bottom sheet.
- Opening a result switches to its reader pane.
- A clear **Back to results** action restores the complete search state and scroll position.

Concept mockup:

![Mobile Search Workspace concept](assets/search/search-workspace-mobile.png)

The mockups communicate information hierarchy and interaction, not final typography, colors, icons,
or exact copy. Implementation should continue using the application's existing tokens and controls.

## 3. Search controls

The sticky header contains:

- Primary query input.
- Search/submit button.
- Search-history button.
- Filters button with an active-filter count.
- Close/collapse action.

After the first successful query, show a second field named **Refine these results**. Its terms are
combined with the original query using `AND`. Refinement must run on the server against the complete
matching corpus; filtering only the hits currently loaded in the browser would produce incorrect
results.

Active refinements and filters appear as individually removable chips. Include a **Clear filters**
action that retains the query, and a separate **Clear search** action.

## 4. Scope model

Filters are hierarchical so the common cases remain quick while advanced choices stay available.

### 4.1 Content type

- Bible
- Commentary
- Dictionary
- Books
- Strong's (M8, displayed only when indexed lexical works exist)

### 4.2 Work/source

Populate the list from `/api/v1/works`; never hard-code installed source IDs in React. Examples for
the present data set are WEB, KJV, Matthew Henry, Easton's, and the 1689 Baptist Confession.

The user can select one or several works. Selecting a content type limits the work list to compatible
works. A one-click **Current source** scope should use the active reader pane's work.

### 4.3 Canonical range

Applicable to Bible verses and reference-bound commentary:

- Entire Bible
- Old Testament
- New Testament
- Selected books
- Current book

The importer already defines the current Protestant 66-book canonical order. Add explicit canon-group
metadata there and carry it into the database/API instead of repeating an `order <= 39` rule in the
frontend. Supporting another canon later requires an explicit canon profile and is a separate product
decision.

Canonical filters do not silently apply to dictionary or General Book documents. When a user chooses
one while incompatible content types are selected, the UI must explain which groups it affects or
offer to restrict the search to Bible and commentary.

### 4.4 Language

The API accepts `languages=`, but the UI deliberately does not expose it while every installed content
work is English. Add the control only after licensed Bulgarian/multilingual content is installed.

## 5. Results experience

### 5.1 Groups and counts

Show content tabs/counts such as:

```text
All 1,318 | Bible 947 | Commentary 312 | Dictionary 18 | Books 41
```

The **All** view shows a small initial selection from each group. It does not interleave raw BM25
scores from short Bible verses and long commentary documents because those scores are not directly
comparable. Selecting one group switches to its full paginated result list.

Each result includes:

- Content-type icon and accessible text label.
- Canonical reference, dictionary headword, or General Book breadcrumb.
- Work abbreviation.
- Highlighted and safely rendered excerpt.
- An action appropriate to the result type.

| Result kind | Navigation |
|---|---|
| Bible verse | Open/reuse a Bible pane at the exact verse and translation |
| Commentary entry | Open/reuse a commentary pane at its canonical reference |
| Dictionary entry | Open/reuse a dictionary pane at its headword |
| General Book section | Open/reuse a book pane at its section |
| Strong's occurrence | Open an annotated Bible pane and lexical details |

If several panes are compatible targets, use the active compatible pane first. A result overflow menu
may offer **Open in pane…**; ordinary clicks should remain one-step actions.

### 5.2 Complete results and pagination

Complete search means every match is reachable, not that thousands of rows are placed in the DOM.

- Fetch 50 hits for the selected group initially.
- Display `1–50 of 947` and a clear **Load 50 more** action.
- Return `total`, `offset`, `limit`, and `has_more` from the API. `total` is a second full `MATCH`
  count per group (FTS5 has no free total); cheap at this corpus size (~31k verses, smaller study
  sets), but a conscious cost — and it participates in the existing ETag/Cloudflare caching.
- Use deterministic secondary sort keys so consecutive pages never duplicate or omit hits.
- Preserve loaded pages and scroll position while opening a result.
- Consider list virtualization only after measuring; it is not required for the first 50–200 rows.

### 5.3 Ordering

Offer two top-level choices:

- **Relevance** — FTS5 `bm25()` within each result type, with a stable locator tie-breaker.
- **Source order** — the natural order for the selected result type.

Source order means:

| Type | Order |
|---|---|
| Bible | Canonical book, chapter, verse, work |
| Commentary | Canonical book, chapter, verse range, entry ID |
| Dictionary | Headword alphabetically |
| General Book | Work and hierarchical section order |

In the All view, results remain grouped by type and the selected order applies within each group.
Dictionary headwords and General Book section titles should carry more relevance weight than body
text.

### 5.4 Schema prerequisites for ordering, pagination, and weighting

**Delivered in M7.1/M7.2.** The details below explain why that release required one importer/schema
revision and full content rebuild; they are no longer outstanding prerequisites.

Canonical ordering and stable pagination are **not** a pure API/UI change — they require importer and
schema work, because the current FTS tables cannot support them as built:

- **Bible canonical order needs sortable numeric columns.** `bible_fts` stores the locator as a single
  string column (`ref UNINDEXED`), and it is a standalone contentless table, so there is no rowid join
  back to `verses`. A string `ref` cannot be ordered canonically in SQL (`Gen.1.10` sorts before
  `Gen.1.2`, and there is no book order). Add `book_order`, `chapter`, and `verse` as `UNINDEXED`
  columns to `bible_fts` (or rebuild it as an external-content FTS over `verses`) so the provider can
  `ORDER BY book_order, chapter, verse, work_id` with `LIMIT/OFFSET`. This is the sort key that also
  makes pagination deterministic.
- **Weighted headword/title needs indexed columns.** `dictionary_fts.headword` and
  `book_fts.section_id` are `UNINDEXED` (locators, not searchable), and `dictionary_fts.text` is only
  the entry body. So today a term that appears only in a headword or a section title cannot match, and
  `bm25()` cannot up-weight it. Fold the headword/title into an indexed FTS column (or add a dedicated
  indexed column) so both matching and `bm25()` column weighting work.
- **Commentary needs a stable entry ID.** `commentary_entries` has no primary key; the `commentary_fts`
  locator is `osis.chapter[.verse_start]`, which is not guaranteed unique. Add a stable `entry_id` to
  the table and carry it in the FTS locator so navigation is unambiguous and pagination cannot drift
  when two entries share a reference.

All three ride a **single `content.sqlite` rebuild** through the importer — batch them into one schema
revision and one rebuild/redeploy rather than three. Production stays read-only; nothing here changes
the runtime's read path other than the columns it can order and filter by.

## 6. Search history

Search history is delivered and remains local to the browser in the versioned `localStorage` record
`bible-search-v1`.

- Keep the most recent 50 distinct searches.
- Store the query, refinements, scopes, ordering, and timestamp.
- Deduplicate identical effective searches and move a repeated search to the top.
- Allow rerun, pin/save, delete one, and clear all.
- Show recent and pinned searches when the main input is empty.
- Do not include history in Dropbox note synchronization in M7. Search activity is separate,
  potentially sensitive data and needs an explicit future opt-in before cross-device syncing.

The application may log normal API request URLs at the proxy/origin today. Privacy documentation
should continue to avoid implying that search queries are local-only.

## 7. Unified public API

Replace the frontend's separate Bible and General Book calls with one query contract:

```http
GET /api/v1/search
    ?q=earth
    &refine=created
    &types=bible,commentary
    &works=web,mhc
    &canon=nt
    &books=John,Rom
    &languages=en
    &sort=canonical
    &limit=50
    &offset=0
```

All shown refinement/filter/order/pagination parameters are implemented. `q` and `refine` are each
tokenized safely and combined with `AND` in the server-side FTS query, so refinement operates over the
complete matching corpus rather than the currently loaded page.

Comma-separated values match the current `works` convention. Validate every enum/identifier and cap
query, refinement, list, limit, and offset sizes. All SQL values remain parameterized; the FTS query
builder continues quoting normalized tokens rather than accepting arbitrary FTS syntax.

Suggested response:

```json
{
  "query": "earth",
  "refine": "created",
  "sort": "canonical",
  "total": 42,
  "groups": [
    {
      "type": "bible",
      "total": 31,
      "offset": 0,
      "limit": 50,
      "has_more": false,
      "hits": []
    },
    {
      "type": "commentary",
      "total": 11,
      "offset": 0,
      "limit": 50,
      "has_more": false,
      "hits": []
    }
  ]
}
```

Each hit is a discriminated union with common fields (`kind`, `work_id`, `title`, `snippet`) and a
typed locator for a verse, commentary entry, headword, or section. Initial All queries can return a
small per-group preview; loading more requests one `types=` value and paginates that group.

M7.1 shipped the grouped envelope with a Bible group; M7.2 added commentary, dictionary, and books
without breaking the TypeScript contract. The old flat response and separate `/search/books` client
path are no longer the application contract.

## 8. Backend search providers

Keep the source-specific FTS tables and place a normalized provider layer above them:

```text
SearchService
├── BibleSearchProvider          -> bible_fts
├── CommentarySearchProvider     -> commentary_fts
├── DictionarySearchProvider     -> dictionary_fts
├── GeneralBookSearchProvider    -> book_fts
└── StrongsSearchProvider        -> verse_tokens / strong_lexicon (M8)
```

Each provider implements count, facet, page, and hit-normalization operations for the filters it
supports. This avoids pretending that heterogeneous documents have identical ranking semantics and
provides a clean Strong's extension without moving format-specific logic into the API.

Required importer/schema work (all of it rides one `content.sqlite` rebuild — see §5.4):

1. Add sortable `book_order`/`chapter`/`verse` columns to `bible_fts` (or make it external-content over
   `verses`) so canonical order and deterministic pagination are possible in SQL (§5.4).
2. Give commentary entries a stable `entry_id` and include it in `commentary_fts` locators (§5.4).
3. Index dictionary headwords as weighted searchable text as well as entry bodies (§5.4).
4. Index General Book titles/breadcrumbs as weighted text as well as section bodies (§5.4).
5. Add explicit canon-group (testament) metadata to the canonical book definition (`books.py` today has
   `usfm/osis/order/name_en` only) and carry it into database-facing metadata, instead of an
   `order <= 39` rule in the frontend.
6. Rebuild `content.sqlite` offline through the importer; production remains read-only.

Tokenizer note: all FTS tables use `unicode61 remove_diacritics 2`, which is correct for English but
lossy for Greek/Hebrew accents and Hebrew niqqud. This does not affect M8 lexical search — Strong's
lemma/transliteration search runs against the structured `strong_lexicon`/`verse_tokens` tables (§10),
not FTS — but revisit the tokenizer when the Bulgarian Bible and any Greek/Hebrew display text land.

## 9. Frontend state and navigation

Create a dedicated search store or slice rather than putting transient results into pane state:

```ts
interface SearchState {
  open: boolean;
  mode: "docked" | "fullscreen";
  query: string;
  refinements: string[];
  scope: SearchScope;
  sort: "relevance" | "canonical";
  selectedGroup: SearchKind | "all";
  groups: SearchGroupState[];
  selectedHitId: string | null;
  scrollOffsets: Record<string, number>;
}
```

Persist history and pinned searches, but keep current results in memory. A content-version change
invalidates result pages while preserving harmless query/history state. Add generic navigation actions
such as `openSearchHit(hit, preferredPaneId?)` rather than embedding pane-selection rules inside the
Search component.

## 10. M8 Strong's-ready design

Strong's is structured lexical data and must not be inserted as ordinary free text into `bible_fts`.
Introduce it only after selecting sources whose licenses permit import, redistribution, and public web
display.

### 10.1 Sources — resolved 2026-07-27

The licensing gate above is **closed**, and no new Bible source is required.

**The KJV we already import carries complete Strong's data.** `data/sources/KJV.imp.gz` (CrossWire
KJV 3.1, already committed and already licensed for our use) tags every one of its 31,102 verses with
word-level Strong's numbers and morphology. The current adapter reads the text out of those tags and
**discards the attributes** — `_collect_text` in `apps/importer/bibleimport/formats/sword_bible.py`
skips only `note` and `title`, so `<w>` contributes its text and its `lemma`/`morph` are dropped on
the floor. M8 is therefore a parser and schema change against a source already in the repository, not
an acquisition project.

**Two public-domain lexicons supply the definitions:**

| Module | Version | Distribution licence |
|---|---|---|
| [`StrongsGreek`](https://crosswire.org/sword/modules/ModInfo.jsp?modName=StrongsGreek) | 2.0 | Public Domain |
| [`StrongsHebrew`](https://crosswire.org/sword/modules/ModInfo.jsp?modName=StrongsHebrew) | 1.2 | Public Domain — "Copy Freely" |

Both derive from James Strong, *Exhaustive Concordance of the Bible* (1890) — public domain by age,
independent of the module packaging. They fit the existing content policy (every shipped work is PD or
CrossWire-licensed) with no new rights question, and they need no owner decision gate.

Export them the same way as the other CrossWire modules, into `data/sources/` under Git LFS, and
record them in `plan/content_and_licensing.md` and `data/sources/README.md`:

```bash
SWORD_PATH=/path/to/unpacked/modules mod2imp StrongsGreek  | gzip -n -9 > StrongsGreek.imp.gz
SWORD_PATH=/path/to/unpacked/modules mod2imp StrongsHebrew | gzip -n -9 > StrongsHebrew.imp.gz
```

Use the **raw** export (no `-s`), as the Easton work established: the stripped form discards the
structured markup that makes the entries worth importing.

### 10.2 What the KJV markup actually looks like

Four properties of the real data invalidate the naive reading of the schema below. Verified against
the committed source:

```text
OT  <w lemma="strong:H07225">In the beginning</w>
    <w lemma="strong:H0853 strong:H01254" morph="strongMorph:TH8804">created</w>
NT  <w lemma="strong:G1722 lemma.TR:εν" morph="robinson:PREP" src="1">In</w>
    <w lemma="strong:G3588 strong:G3056" morph="robinson:T-NSM robinson:N-NSM" src="4 5">the Word</w>
```

1. **A surface span can carry more than one Strong's number.** "created" maps to `H0853 H01254`;
   "the Word" maps to `G3588 G3056`. A single `strong_id` column per position cannot represent this —
   see the revised primary key in §10.3. This is the single most likely thing to be discovered late.
2. **Identifier padding is inconsistent between testaments.** The OT zero-pads to five characters
   (`H07225`), the NT does not (`G1722`). Hebrew runs to H8674 and Greek to G5624, so four digits
   suffice for both. Normalize on *both* sides — verse tokens and lexicon keys — before any join; a
   mismatch produces silent empty lookups rather than an error. **Verified at import (2026-07-27):**
   the lexicon modules key entries as bare five-digit numbers with no letter prefix (`00001` →
   `G0001`), so the canonical form is letter + four digits (`H0001`/`G0001`). Verification also
   found: letter-suffixed keys (`00031A`) exist only as `@@@@` placeholder stubs and are skipped;
   the Greek module has 135 key holes (30 of them tagged by the KJV, e.g. `G3778`) plus one keyed
   but lemma-less entry (`G0251`) — recorded in build diagnostics; 52 Greek entries carry upstream
   Chinese editorial annotations, imported verbatim; the Hebrew module is CP1252 plain text with
   seven spurious `&Š` bytes (removed, count asserted) and one misprinted entry number (`H8483`,
   imported under its authoritative module key).
3. **The two testaments use different morphology systems.** OT is `strongMorph:TH8804`, NT is
   `robinson:PREP`. Store the scheme alongside the code (`strongMorph` / `robinson`) instead of
   flattening both into one opaque string, or the reader cannot label what it is showing.
4. **KJV italicised words carry no Strong's at all.** `<transChange type="added">was</transChange>`
   marks words the translators supplied. These are legitimately untagged; the schema must allow a
   surface span with no lexical entry rather than treating it as a parse failure.

A bonus the NT provides for free: `lemma.TR:εν` is the actual Greek lemma, inline. That means Greek
lemma display does not depend on the lexicon module at all, and gives a cross-check against it.

### 10.3 Data model

```sql
CREATE TABLE verse_tokens (
    work_id     TEXT NOT NULL,
    osis_code   TEXT NOT NULL,
    chapter     INTEGER NOT NULL,
    verse       INTEGER NOT NULL,
    position    INTEGER NOT NULL,  -- surface span index within the verse
    ordinal     INTEGER NOT NULL,  -- Nth Strong's within that span, 0-based
    surface     TEXT NOT NULL,
    normalized  TEXT NOT NULL,
    strong_id   TEXT,              -- NULL for untagged spans (KJV transChange)
    morph_scheme TEXT,             -- 'strongMorph' (OT) | 'robinson' (NT)
    morph_code  TEXT,
    PRIMARY KEY (work_id, osis_code, chapter, verse, position, ordinal)
);

CREATE INDEX idx_verse_tokens_strong
    ON verse_tokens(strong_id, work_id, osis_code, chapter, verse);

CREATE TABLE strong_lexicon (
    strong_id       TEXT PRIMARY KEY,
    language        TEXT NOT NULL,
    lemma           TEXT NOT NULL,
    transliteration TEXT,
    pronunciation   TEXT,
    definition_json TEXT NOT NULL
);
```

`position` is the surface span, `ordinal` disambiguates the multiple Strong's numbers a span can
carry (§10.2, item 1). An untagged span gets exactly one row with `ordinal = 0` and `strong_id` NULL,
so "every surface span appears in this table" stays true and the reader can render a verse from
`verse_tokens` alone.

Normalize identifiers to a single canonical form — `H0001` / `G0001` unless the lexicon modules turn
out to use something else (§10.2, item 2) — and apply it to both tables at import.

### 10.4 CIR and API impact

The current SWORD Bible adapter reduces verse fragments to display text plus words-of-Jesus flags. To
support Strong's, it must preserve word-level OSIS `<w lemma="strong:…">` and morphology attributes in
the canonical representation while also populating `verse_tokens`. The reader then highlights the
translated surface word and opens the lexicon entry. The runtime still reads imported SQLite data; it
does not parse SWORD modules directly.

The verse `Run` is currently `{t, wj}` (`apps/api/app/models.py`, `apps/web/src/data/api.ts`). Strong's
adds an optional lexical field to it.

> **Naming hazard.** `DocumentRun` — the commentary/dictionary run type — already has a boolean field
> named **`strong`**, meaning bold (HTML `<strong>`). Do not name the new field `strong` or `strongs`
> on either run type. Use `lemma` (carrying the normalized ids and morphology), so a reader of the
> code cannot confuse typography with lexicography.

Because the field is optional and absent unless the work has lexical data, this is an additive API
change: existing clients ignore it, and works without Strong's are unaffected.

### 10.5 Reader integration — Strong's toggle in the Bible pane

Strong's display is **off by default** and lives in the existing reading-settings group beside
`verseLayout` and `wordsOfChrist`, persisted in the same zustand `Settings` slice:

```text
settings.strongs = "off" | "on"
```

Behaviour when on:

- Tagged surface spans get a subtle affordance (dotted underline, matching the `scripture-ref`
  convention rather than inventing a third one) and open a lexicon popover on hover/focus/tap.
- The popover shows the normalized id, lemma, transliteration, morphology (labelled with its scheme),
  and the short definition, with an action to open the full entry in a Dictionary pane — the same
  shape as the Easton scripture pop-up, so there is one interaction language for reference lookups.
- Untagged spans (`transChange` additions, punctuation) render exactly as they do today.

Constraints this must not break — all are shipped behaviour with tests:

- **Composition with existing rendering.** Words-of-Christ colouring and Strong's underlining apply to
  the same runs and must compose; verse layout (`per-line` and `flowing`) must both work.
- **`data-verse` anchors** in `CIRRenderer` drive the search-result scroll-and-flash. Splitting runs
  into word spans must not move or duplicate them.
- **Copy/paste must stay clean.** A reader copying a verse should get the verse text, not a word
  salad with interleaved markup or ids.
- **Rendering cost.** John 1:1 alone has ~15 tagged spans; a long chapter has several hundred to over
  a thousand. Render spans as plain elements with one delegated handler per pane — not one React
  component with its own handlers per word — and measure a worst-case chapter (Psalm 119) before
  shipping.
- **Accessibility.** Keyboard-reachable, and the M7.5 focus behaviour must not regress. With the
  toggle off, the DOM should be unchanged from today.

### 10.6 Search integration

`StrongsSearchProvider` (§8) joins `verse_tokens` to `strong_lexicon` and supports:

- Exact Strong number.
- Hebrew/Greek lemma — for Greek, cross-checked against the inline `lemma.TR` in the KJV source.
- Transliteration.
- English gloss.
- Morphology, filtered by scheme so an OT `strongMorph` code cannot be matched against an NT
  `robinson` one.
- Combined text and lexical constraints, for example `earth` within verses tagged `G1093`.

Strong's results are gated on lexical works being present, per §4 — the tab stays hidden otherwise.

### 10.7 Delivery notes

- Adding `verse_tokens` and `strong_lexicon` bumps `SCHEMA_VERSION`. The deploy is the standard
  ordered one: rebuild `content.sqlite` to a temporary path, atomically rename, restart the API, then
  deploy the SPA. Restarting first returns `503 schema-outdated` on every `/api/v1` request.
- The KJV rebuild reparses an already-committed source, so the diff to verify is `verse_tokens` row
  counts per book, not new content. Gate the build on a token count for a known verse (Gen 1:1 has
  six spans and seven Strong's numbers) the way the Easton import gates on its entry count.
- Documentation touchpoints: `plan/content_and_licensing.md` (two new PD works),
  `data/sources/README.md` (export commands + checksums), `docs/user/search-and-lookup.md` (the
  reader toggle), `docs/developer/api-service.md` (the new run field).
- `plan/interactive_chat_plan.md` §11 treats M8 as its lexical upgrade hook — when this ships, the
  assistant's `lookup_strongs` tool and its "original-language data unavailable" disclaimer both
  become live work.

## 11. Delivery milestones

### M7.1 — Correctness and completeness (Bible) — DELIVERED 2026-07-23

Includes the one schema change Bible ordering depends on — it is **not** an API/UI-only step (§5.4).
Shipped: `bible_fts` sort columns + importer, grouped `/search` envelope with `total`/`has_more`,
`sort=relevance|canonical` with a stable canonical tie-breaker, 50-result pages, and the overlay UI's
count + Load more + sort toggle (EN/BG). Requires a `content.sqlite` rebuild before deploy (the API now
orders by the new columns). Regression tests cover canonical order and pagination completeness.

- Add sortable `book_order`/`chapter`/`verse` columns to `bible_fts` and rebuild `content.sqlite`.
- Introduce the **final grouped `/search` envelope** (§7) with a single `bible` group carrying `total`,
  `offset`, `limit`, and `has_more` — do not ship an interim flat shape.
- Add relevance and canonical ordering for Bible, with a stable locator tie-breaker so pages never
  duplicate or omit hits.
- 50-result pages; show `1–50 of N` and Load more in the current overlay UI.
- Migrate `apps/web/src/data/api.ts` and `SearchPanel` to the grouped envelope.
- Make Genesis 1:1 reachable for `earth`; add regression tests for canonical ordering and
  pagination stability (no duplicate/omitted hits across pages).

### M7.2 — Unified cross-content engine — DELIVERED 2026-07-23

Requires a `content.sqlite` rebuild (batched schema changes, §5.4/§8). Shipped:

- Batched schema/importer changes in one rebuild: commentary `entry_id`; indexed+weighted dictionary
  `headword_text` and book `title_text`; `osis`/`testament`/`book_order` on `bible_fts` and
  `commentary_fts`; `testament` canon-group metadata from `books.py` (`OT_MAX_ORDER`).
- Provider layer (`app/search_providers.py`): Bible/Commentary/Dictionary/GeneralBook providers with
  count + page + hit normalization; `bm25()` weights the headword/title columns above body.
- Unified `/search` returns `groups[]` for all four types (multi-type = per-group preview; single
  `types=` = paginated). Filters: `types`, `works`, `canon` (testament), `books`, `languages`.
- `/search/books` retired; the web client uses the unified endpoint with group tabs/counts, testament
  + sort + source filters, per-type navigation (`openPassage`/`openCommentary`/`openDictionary`/
  `openBookSection`), and Load-more pagination. EN/BG strings added.
- Deferred after M7.2: the full docked/full-screen UI to M7.3 and the granular book picker to M7.4
  (the API already accepts `books=`).

### M7.3 — Search Workspace UI — DELIVERED 2026-07-25

Shipped:
- The overlay is replaced by a **Search Workspace** (`components/SearchDrawer.tsx`): a resizable drawer
  docked to the right of the reading panes on desktop, and a full-screen view on mobile. Drawer width is
  persisted (`settings.searchWidth`) and pointer-drag resizable within `[320, 680]`px.
- The workspace **stays mounted while collapsed** (display:none), so the query, filters, results, and
  scroll survive collapse/restore. On desktop it **stays open while results are read**; on mobile it
  closes to reveal the opened pane.
- Opening a **Bible result scrolls to and briefly flashes the exact verse** (`data-verse` anchors in
  `CIRRenderer`, `pane.focusVerse` + `.verse-flash`); commentary/dictionary/book navigate as before.
- Reuses the shipped group tabs/counts, testament/work filters, and relevance/canonical ordering.
- The granular book picker, mobile filter sheet, and removable chips deferred here shipped in M7.4.

### M7.4 — History and refinement — DELIVERED 2026-07-25

Shipped:

- Granular localized Bible-book picker wired to the shipped API `books=` filter.
- Individually removable testament, source, and book chips plus **Clear filters**.
- Dedicated mobile filter bottom sheet with an active-filter count and Escape/scrim dismissal.
- Versioned local recent/pinned history with effective-search deduplication and pin, delete, and clear
  controls. Search history remains outside Dropbox note sync.
- Server-side `refine=` terms combined with the main query over the complete FTS corpus.
- History reruns restore query, refinement, work/book/testament filters, ordering, and selected group.
- React/API/Playwright coverage for filtering, refinement, history persistence/restoration, chips, and
  the mobile flow.

### M7.5 — Accessibility, tests, and documentation — DELIVERED 2026-07-25

Shipped:

- Roving keyboard tabs; pointer/keyboard drawer resizing; visible focus; a focus-managed mobile
  filter dialog; and retained result focus when returning from a mobile reader pane.
- Polite screen-reader announcements for loading, totals, appended pages, and failures, with visible
  recoverable error feedback.
- Explicit mobile **Back to results**, preserving the mounted query, filters, selected tab, loaded
  pages, scroll position, and last result focus.
- EN/BG parity coverage for every `search.*` UI string.
- API coverage across every provider for work/language/canonical filters, both order modes, stable
  pagination, multi-type previews, and input caps; React and Playwright coverage for the M7.4/M7.5
  interactions and populated accessibility states.
- Updated user, frontend, API, and privacy documentation.

### M8 — Strong's

Source and licensing are **resolved** (§10.1): the committed KJV already carries complete Strong's
and morphology, and the two lexicon modules are public domain. No acquisition step and no owner
decision gate remain.

**M8.1 — importer and data model — DELIVERED 2026-07-27**

Shipped:
- `StrongsGreek` / `StrongsHebrew` exported raw (no `-s`) to `data/sources/` and recorded in
  `plan/content_and_licensing.md` and `data/sources/README.md` with checksums and source limits.
- The SWORD Bible adapter preserves `<w lemma=… morph=…>`: tagged spans become unmerged CIR runs
  carrying a normalized `lemma` list (`id`, plus `s`/`m` when morphology is tagged), and every
  surface span — including untagged `transChange` words and empty untranslated `<w/>` spans —
  lands in `verse_tokens` keyed `(position, ordinal)` (§10.3). Ids normalize to letter + four
  digits on both sides (§10.2, item 2).
- `strong_lexicon` populated from both modules (5,488 Greek + 8,674 Hebrew entries); lexicon
  works registered as `type="lexicon"` with license/attribution; `SCHEMA_VERSION` 2.
- Build diagnostics assert entry counts, the Hebrew e-text cleanups, the Greek key holes, the
  lemma-less `G0251`, and the upstream CJK annotations.
- Exit verified on a rebuilt `content.sqlite`: Gen 1:1 and John 1:1 resolve every tagged span to
  the expected lexicon entries, untagged `transChange` words survive as untagged rows, and works
  without lexical data (WEB) are byte-identical with zero token rows.

**M8.2 — API surface.** Optional `lemma` field on the verse `Run` (never `strong` — §10.4); lexicon
lookup endpoint; `/ready` unchanged. Exit: passage responses carry lexical data for KJV and are
byte-identical for works without it.

**M8.3 — reader toggle.** `settings.strongs` off by default, lexicon popover, Dictionary-pane
hand-off, EN/BG strings with the usual parity test. Exit: with the toggle off the rendered DOM is
unchanged from today; with it on, Psalm 119 renders within budget and M7.5 focus behaviour and
`data-verse` anchors both still pass.

**M8.4 — search.** `StrongsSearchProvider`, Strong's search mode, lexical result cards, and combined
text+lexical queries (§10.6).

## 12. Acceptance scenarios

M7 is complete when all of the following pass:

1. Searching `earth` reports the full Bible result count; canonical ordering begins with Genesis 1:1,
   and every page is reachable without duplicates or gaps.
2. Choosing KJV returns no WEB hits.
3. Choosing New Testament returns no Old Testament Bible/commentary hits.
4. Choosing Genesis returns only Genesis Bible/commentary hits.
5. A known Matthew Henry phrase produces a commentary result and opens the correct reference.
6. A dictionary headword and a word found only in its definition both find the same entry.
7. A General Book title/body match opens the correct section.
8. Refining a result set searches all matching rows, not merely loaded rows.
9. Search history survives reload, deduplicates entries, restores filters, and can be cleared.
10. Desktop result navigation leaves Search open; mobile Back to results restores position.
11. All new controls pass keyboard and automated accessibility checks.

## 13. Effort and sequencing

M7.1 is a high-value correctness change, roughly two to three focused development days — a touch more
than an API/UI-only fix because it includes the `bible_fts` sort-column schema change, a
`content.sqlite` rebuild/redeploy, and adopting the grouped envelope (§5.4, §11). The full M7
provider/API/UI/history redesign is a moderate refactor, approximately another working week depending
on final interaction polish. M8 is a separate importer and data-model project; allow roughly one to two
weeks after the lexical source and license are approved.

Do not combine M7 and M8 into one release. Ship the general search architecture first, measure it,
then add lexical data through the provider extension point.
