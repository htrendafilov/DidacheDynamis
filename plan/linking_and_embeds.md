# Plan: deep links, scripture pop-ups, and external embeds

**Status:** planned (after General Books — pop-ups appear in commentary/book content).
Three related features that build on each other: (1) shareable deep links, (2) in-app scripture
reference pop-ups, (3) the same pop-ups embeddable on external sites (e.g. a blog).

## 1. Deep links (URL-addressable content)
Open any content directly from a URL, and keep the URL in sync as the user navigates so links are
shareable/bookmarkable. **Routing is not wired up yet** — the app uses the zustand pane store with no
router; deep links will add either `react-router` (a new dependency) or a small hand-rolled
parse/serialize layer over `history` + the store.

- **Scheme (proposal):** a compact, canonical form per content type, e.g.
  - Bible verse/passage: `/b/web/John/3/16` or `/b/web/John/3/16-19`
  - Commentary: `/c/mhc/John/3` (optionally `/16`)
  - Dictionary word: `/d/easton/Grace`
  - Book section: `/k/1689/ch1`
  - Multi-pane layout (shareable workspace): query form `?p1=b:web:John:3&p2=c:mhc:John:3`.
- **On load:** parse the URL → configure the store's panes (`apps/web/src/state/store.ts`).
- **On navigation:** pane/passage changes push URL state (replace vs push chosen to keep history sane).
- **Validate** parsed input: cap pane count (1–3), allow only known work IDs, and range-check
  book/chapter/verse against `/works`+`/books` before applying — reject/clamp bad links, don't crash.
- **Preserve the Dropbox OAuth callback:** `App` already reads `?code`/`?state` (`state` starts `dbx-`)
  on load for the PKCE flow (`dropboxAuth.ts` strips them after). The deep-link parser must run
  *alongside* that — ignore/pass through OAuth params and not clobber them, or Dropbox connect breaks.
- Reuses existing passage/commentary/dictionary/book APIs; mostly a frontend routing layer +
  a canonical ref parser/serializer (share with the embed widget in §3).

## 2. In-app scripture reference pop-ups
When commentary / book / dictionary content cites a passage (e.g. "John 3:1-19"), make it interactive:
on hover/focus/tap show a pop-up with the Bible text, plus — if the passage is long — a truncated
preview and a link to **open it in the current Bible pane**.

- **Reference resolution (two layers):**
  1. **Structured (preferred): DONE.** `<reference osisRef>` tags are preserved as a `ref` run
     (`{t, …, ref}`) through both study (`_sword_osis_document`, for Matthew Henry OSIS) and General
     Books (`genbook.py`, for the 1689 proof texts — 1150 refs). `books.normalize_osis_ref` validates
     the book and collapses cross-chapter ranges to the start verse; the Pydantic + TS models carry
     `ref`; `DocumentRenderer` renders it as `<ScriptureRef>`. (Verified end-to-end: 0 scripture
     osisRefs in the 1689 failed to normalize.)
  2. **Fallback linkifier (remaining):** a client-side scripture-reference regex over rendered text for
     sources without structured refs. Handles common English/Bulgarian citation formats + book-name
     aliases (reuse the importer's `_BOOK_ALIASES` idea on the client). Not yet built — the shipped
     works all carry structured refs, so this is only needed for future plain-text sources.
- **Pop-up component: DONE.** `components/ScriptureRef.tsx` fetches the passage (verse-range API, from
  the public-domain `web` Bible) and shows a preview + "Open in Bible pane". Long passages truncate.
- **API: DONE.** `/works/{id}/passage/{osis}/{chapter}` accepts `?verses=16` or `?verses=1-19`.
- Accessibility: **DONE** — the trigger is a real `<button>`; the pop-up opens on hover **and**
  keyboard focus, dismisses on Escape and on blur, and taps toggle it (not hover-only).

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
