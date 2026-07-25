# Frontend Design (v1)

React + TypeScript + Vite SPA. See [`../00_system_design.md`](../00_system_design.md) and the API in
[`../backend/backend_design.md`](../backend/backend_design.md).

## 1. Libraries

- `react` — application UI; a small hash parser handles the two shipped deep-link forms without
  React Router.
- `react-resizable-panels` — the 1–3 pane layout.
- `zustand` — small store for panes / sync / reading settings.
- `react-i18next` — EN/BG interface strings.
- `dexie` — IndexedDB wrapper for local notes.
- `tiptap` — structured, accessible rich-text editing without deprecated browser editing commands.
- Vitest + React Testing Library, Playwright (a few E2E flows).

Kept out of v1: Redux, a component/design-system framework, GraphQL.

## 2. Layout

- **Top bar:** global search, reading-settings menu (including EN/BG interface language),
  add/remove pane (max 3).
> The interface defaults to Bulgarian and can switch to English. The installed content set remains
> English-only: the Bulgarian Bible source is deferred until rights are cleared (see
> [`../content_and_licensing.md`](../content_and_licensing.md)).

- **Panes** (`react-resizable-panels`, horizontal split on desktop). Each pane header has:
  - a **source selector** — Bible (EN; BG later) / Commentary / Dictionary / Books / Notes;
  - for Bible/commentary panes, a **passage selector** — book → chapter.
- **Sync** is one global Settings checkbox: passage changes update every open Bible/commentary pane.
- **Mobile:** one active pane with a keyboard-accessible top tab bar for switching the saved panes.

## 3. Reading settings (global, persisted in `localStorage`)

- **Verse layout:** `per-line` vs `flowing` — a render mode over the same CIR, not two datasets.
- **Words of Christ:** `off` / `bold` / `red` — a class toggled on `wordsOfJesus` nodes.
- Font size, light/dark theme, interface language, pane sync on/off, and a global General Book view
  (`pages` / `scrolling`).

## 4. Panes behavior

- **Bible pane** — selects WEB or KJV and renders CIR (paragraphs / poetry / headings / verses). Verse
  numbers open TSK cross-references (clicking one navigates the same Bible work) and an "add note for
  this verse" action. Commentary snippets/open-in-commentary actions are not shipped.
- **Commentary pane** — Matthew Henry for the current ref; its embedded KJV quotation is visually
  separated from the commentary, while the pane follows any linked Bible by canonical reference.
- **Dictionary pane** — prefix search box + headword list and entry view. Bible citations carry the
  standard scripture pop-up (including chapter-only targets), and internal Easton links navigate to
  the referenced entry in the same pane; details in
  [`easton_dictionary_references.md`](../easton_dictionary_references.md).
- **General Book pane** — selects an imported reference/theology book, displays its hierarchical TOC,
  and renders sections with the same Document CIR used by commentary and dictionary entries. The pane
  header orders source, book, then the show/hide-contents control. The global Settings panel chooses
  section-by-section Previous/Next navigation or continuous scrolling; the mobile TOC opens over the
  text and closes after a selection.
- **Notes pane** — editable notes in **IndexedDB (Dexie)**. Two modes: free notes and passage/verse-
  attached notes (keyed by canonical ref). Edits use independent per-note save queues, and all
  navigation/export paths flush pending changes first. Deletion is recoverable and retained as a
  tombstone for future synchronization. Inline images are restricted to bounded local raster data;
  remote images are removed for privacy. Strict **Export / Import JSON** validation preserves
  divergent records as conflict copies rather than silently overwriting them. The complete notes
  pane is lazy-loaded, keeping TipTap and its extensions out of the initial reader bundle unless a
  saved layout or a user action opens Notes.
- **Dropbox sync (optional)** — the browser uses OAuth code flow with PKCE and short-lived tokens;
  only `files.content.read` / `files.content.write` are requested against an **App Folder** app. A
  revision-guarded `/notes-v1.json` stores notes including deletion tombstones. Three-way merge bases
  distinguish one-sided changes from true conflicts; if both browsers changed a note, the local note
  stays in place and the remote version becomes a clearly titled topic note for manual resolution.
  The Dropbox token lives only in `sessionStorage` and never reaches the Bible Reader API.
- **Search (M7.1–M7.5)** — a persistent resizable desktop workspace / full-screen mobile view with
  grouped tabs and true counts for Bible, commentary, dictionary, and books; work, testament, and
  localized book filters; relevance/canonical ordering; stable 50-result pagination; server-side
  refinement; removable chips; and versioned local recent/pinned history that restores the complete
  query scope. Clicking opens/reuses the appropriate pane and exact Bible result verse. Keyboard
  tabs/resizing, live result announcements, focus-managed mobile filters, and Back to results keep
  the workflow accessible without losing position.

## 5. CIR renderer

`render/CIRRenderer.tsx` maps Bible line/run CIR to elements:

| CIR field | Rendering |
|---|---|
| separate heading rows | section/Psalm heading before a verse |
| line `kind: p` / `q` | prose or level-indented poetry |
| line `para_start` | flowing paragraph boundary |
| verse row | verse-number button/superscript + lines |
| run `wj: true` | `<span class="woj">` styled by the words-of-Christ setting |
| run `t` | text |

Verse-per-line vs flowing is a container class + how `verse` boundaries emit line breaks — no second
fetch. Commentary/dictionary/book blocks use `DocumentRenderer`, including structured scripture
reference runs rendered by `ScriptureRef`.

## 6. Internationalization

- `i18n/{en.json,bg.json}` for chrome strings.
- Canonical OSIS book names come from `i18n/bookNames.ts` and follow the interface language. API names
  are fallbacks; switching to Bulgarian changes labels even though WEB/KJV text remains English.
- `direction` stored per work for future non-LTR languages (en/bg are both LTR).

## 7. URL / state

- Shipped hashes are `#/b/<work>/<osis>/<chapter>` for a validated Bible chapter and
  `#/book/<work>/<section>` for a General Book section. Commentary/dictionary/exact-verse and
  multi-pane workspace serialization are explicitly deferred in `linking_and_embeds.md`.
- Reading settings + last layout persist in `localStorage` and restore on return.
- API responses revalidate with an ETag on every use, so a new code or content deployment cannot leave
  stale JSON in the browser. Vite's fingerprinted `/assets/*` files remain immutable and long-lived.
- Every SPA build emits an uncached `/version.json`. The running app checks it on startup, periodically,
  and when the tab regains focus; if a newer build exists it offers a user-controlled reload so an
  editor is never interrupted.

## 8. Layout (files)

```
apps/web/src/
  App.tsx, responsive.ts
  panes/{PaneHost,BiblePane,CommentaryPane,DictionaryPane,BookPane,NotesPane}.tsx
  components/{TopBar,PassageSelector,SourceSelector,ScriptureRef,SearchPanel,ReadingSettings}.tsx
  render/{CIRRenderer,DocumentRenderer}.tsx
  state/{store,deeplink}.ts     # zustand state + shipped hash parsing
  data/api.ts                   # typed fetch of /api/v1 (mirrors OpenAPI)
  data/notes.ts                 # Dexie notes + export/import
  i18n/{index.ts,en.json,bg.json}
  styles/                       # theme tokens, woj/red-letter, verse layout
```

## 9. Testing

- Vitest + RTL: CIRRenderer (per-line vs flowing; words-of-Christ off/bold/red), pane source
  switching, notes CRUD/import conflicts/save queue/image safety in IndexedDB, i18n switch,
  book-name localization.
- Playwright (manual full-stack workflow): toggle verse layout/red-letter; persist a note; search and
  open a result; click a cross-reference and verify its destination; validate Bible hashes; exercise
  General Books/mobile TOC and axe accessibility.
- Accessibility: keyboard nav, visible focus, semantic landmarks, contrast, scalable text,
  screen-reader labels — part of acceptance, not polish.
