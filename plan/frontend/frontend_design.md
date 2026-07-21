# Frontend Design (v1)

React + TypeScript + Vite SPA. See [`../00_system_design.md`](../00_system_design.md) and the API in
[`../backend/backend_design.md`](../backend/backend_design.md).

## 1. Libraries

- `react` + `react-router` — app + URL-addressable passages.
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
> **v1 ships English-only.** The Bulgarian Bible source is deferred until rights are cleared
> (see [`../content_and_licensing.md`](../content_and_licensing.md)); the source list is data-driven
> from `/works`, so BG appears automatically once imported — no UI rework.

- **Panes** (`react-resizable-panels`, horizontal split on desktop). Each pane header has:
  - a **source selector** — Bible (EN; BG later) / Commentary / Dictionary / Books / Notes;
  - for Bible/commentary panes, a **passage selector** — book → chapter;
  - a **link/sync** toggle that groups panes to follow the same reference.
- **Mobile:** one active pane + a bottom segmented control to switch source; "3 panes" degrades to
  swipeable tabs.

## 3. Reading settings (global, persisted in `localStorage`)

- **Verse layout:** `per-line` vs `flowing` — a render mode over the same CIR, not two datasets.
- **Words of Christ:** `off` / `bold` / `red` — a class toggled on `wordsOfJesus` nodes.
- Font size, light/dark theme, interface language, sync-scroll on/off.

## 4. Panes behavior

- **Bible pane** — selects WEB or KJV and renders CIR (paragraphs / poetry / headings / verses). Verse numbers are
  interactive → **verse popover**: cross-references (`/xref`), a commentary snippet, "open in
  commentary pane", "add note here".
- **Commentary pane** — Matthew Henry for the current ref; its embedded KJV quotation is visually
  separated from the commentary, while the pane follows any linked Bible by canonical reference.
- **Dictionary pane** — prefix search box + headword list; entry view; internal links between entries.
- **General Book pane** — selects an imported reference/theology book, displays its hierarchical TOC,
  and renders sections with the same Document CIR used by commentary and dictionary entries.
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
- **Search** — modal or dedicated pane; scope chips (which works, which language); results show
  snippet + ref; clicking opens the result in a chosen pane and highlights the verse.

## 5. CIR renderer

`render/CIRRenderer.tsx` maps CIR node types to elements:

| Node | Rendering |
|---|---|
| `heading` | section heading |
| `paragraph` / `poetryLine` | block; `flowing` mode keeps verses inline, `per-line` breaks per verse |
| `verse` | verse-number label/superscript + children |
| `wordsOfJesus` | `<span class="woj">` styled by the words-of-Christ setting |
| `divineName` | small-caps span |
| `emphasis` | `<em>` |
| `text` | text node |
| unknown | rendered as plain text (importer already reported it) |

Verse-per-line vs flowing is a container class + how `verse` boundaries emit line breaks — no second
fetch.

## 6. Internationalization

- `i18n/{en.json,bg.json}` for chrome strings.
- **Book names** come from the API `books` table (each work carries its own names): the BG Bible shows
  Bulgarian names, the EN Bible English names — independent of the chrome language toggle.
- `direction` stored per work for future non-LTR languages (en/bg are both LTR).

## 7. URL / state

- Passages are URL-addressable, e.g. `/read?p1=web:John:3&p2=mh:John:3&p3=notes`, so a layout is
  shareable/bookmarkable.
- Reading settings + last layout persist in `localStorage` and restore on return.
- API responses are fetched with the content `?v=<checksum>` so the browser + Cloudflare cache
  aggressively and a new import busts the cache.

## 8. Layout (files)

```
apps/web/src/
  App.tsx, router.tsx
  panes/{PaneHost,BiblePane,CommentaryPane,DictionaryPane,BookPane,NotesPane}.tsx
  components/{TopBar,PassageSelector,SourceSelector,VersePopover,SearchPanel,ReadingSettings}.tsx
  render/CIRRenderer.tsx
  state/store.ts                # zustand: panes, sync, settings
  data/api.ts                   # typed fetch of /api/v1 (mirrors OpenAPI)
  data/notes.ts                 # Dexie notes + export/import
  i18n/{index.ts,en.json,bg.json}
  styles/                       # theme tokens, woj/red-letter, verse layout
```

## 9. Testing

- Vitest + RTL: CIRRenderer (per-line vs flowing; words-of-Christ off/bold/red), pane source
  switching, notes CRUD/import conflicts/save queue/image safety in IndexedDB, i18n switch,
  book-name localization.
- Playwright (few flows): open EN+BG synced panes; toggle verse layout + red-letter; add a note and
  reopen after reload; search and open a result; click a cross-reference and land on the verse.
- Accessibility: keyboard nav, visible focus, semantic landmarks, contrast, scalable text,
  screen-reader labels — part of acceptance, not polish.
