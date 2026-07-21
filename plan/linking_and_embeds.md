# Plan: deep links, scripture pop-ups, and external embeds

**Status:** planned (after General Books — pop-ups appear in commentary/book content).
Three related features that build on each other: (1) shareable deep links, (2) in-app scripture
reference pop-ups, (3) the same pop-ups embeddable on external sites (e.g. a blog).

## 1. Deep links (URL-addressable content)
Open any content directly from a URL, and keep the URL in sync as the user navigates so links are
shareable/bookmarkable. React Router is already in the stack.

- **Scheme (proposal):** a compact, canonical form per content type, e.g.
  - Bible verse/passage: `/b/web/John/3/16` or `/b/web/John/3/16-19`
  - Commentary: `/c/mhc/John/3` (optionally `/16`)
  - Dictionary word: `/d/easton/Grace`
  - Book section: `/k/1689/ch1`
  - Multi-pane layout (shareable workspace): query form `?p1=b:web:John:3&p2=c:mhc:John:3`.
- **On load:** parse the URL → configure the store's panes (`apps/web/src/state/store.ts`).
- **On navigation:** pane/passage changes push URL state (replace vs push chosen to keep history sane).
- Reuses existing passage/commentary/dictionary/book APIs; mostly a frontend routing layer +
  a canonical ref parser/serializer (share with the embed widget in §3).

## 2. In-app scripture reference pop-ups
When commentary / book / dictionary content cites a passage (e.g. "John 3:1-19"), make it interactive:
on hover/focus/tap show a pop-up with the Bible text, plus — if the passage is long — a truncated
preview and a link to **open it in the current Bible pane**.

- **Reference resolution (two layers):**
  1. **Structured (preferred):** enhance the importer to emit `ref` inline CIR nodes with a canonical
     target where the source has them — Matthew Henry / OSIS commentaries carry `<reference
     osisRef="John.3.1-John.3.19">`. Today `formats/study.py::_document` flattens to text only; extend
     it to preserve references as `ref` nodes (target = canonical osisRef).
  2. **Fallback linkifier:** a client-side scripture-reference regex over rendered text for sources
     without structured refs. Handles common English/Bulgarian citation formats + book-name aliases
     (reuse the importer's `_BOOK_ALIASES` idea on the client).
- **Pop-up component:** reuse the existing **verse cross-reference popover** pattern
  (`BiblePane` + `.verse-tools` + `useCrossReferences`) — a `<ScriptureRef>` that fetches the passage
  and renders it via the existing CIR renderer. Long passages show a preview + "open in Bible pane".
- **API:** add a **verse-range** passage fetch (today `/passage/{osis}/{chapter}` is per-chapter; add
  `?verses=1-19` or a dedicated range endpoint). Small addition to `apps/api/app/routers/passages.py`.
- Accessibility: pop-ups open on hover **and** keyboard focus, dismiss on Escape, and are not
  hover-only (touch = tap to open).

## 3. Embeddable pop-ups on external sites (blog)
Ship a tiny standalone widget so the same scripture pop-ups + "open on bible.trendafilovi.net" links
work on the user's blog.

- **Embed script:** a self-contained, dependency-free `embed.js` served from
  `bible.trendafilovi.net/embed.js`. On an external page it either (a) scans for marked spans
  (`<span data-bible-ref="John.3.16">…</span>`) or (b) auto-linkifies scripture references, then
  attaches the hover/tap pop-up (fetching passage text from our API) and a deep link (§1) to open the
  full passage in the app.
- **CORS:** the read-only public API must allow cross-origin GETs. Add permissive CORS
  (`Access-Control-Allow-Origin: *`) to the **read** endpoints only — safe, since it serves public
  domain content and has no writes/auth. Verify interaction with Cloudflare caching (Vary/CORS headers).
- **Self-contained UI:** the widget renders its own minimal pop-up (no React), styled to be
  unobtrusive and theme-neutral; content is our already-sanitized text.
- **Security/perf:** read-only public data; keep `embed.js` tiny and cache it hard at the edge. No
  tokens, no user data.

## Ordering & reuse
1. **Deep links (§1)** first — the canonical ref parser/serializer is the shared foundation.
2. **In-app pop-ups (§2)** — importer `ref` nodes + verse-range API + reuse the cross-reference popover.
3. **Embed widget (§3)** — reuses §1 links + §2 pop-up behavior in a standalone script + API CORS.

## Open questions
- Final URL scheme (path vs query; how to encode multi-pane layouts) — pick before building §1.
- Which citation formats/languages the fallback linkifier must handle (English + Bulgarian book names).
- Embed distribution: a `<script>` include vs. a copy-paste snippet; versioning of `embed.js`.
