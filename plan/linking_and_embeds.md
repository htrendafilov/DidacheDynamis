# Plan: deep links, scripture pop-ups, and external embeds

**Status:** partially delivered. Bible-chapter and General Book section hashes, structured in-app
pop-ups for commentary/General Books/dictionary, internal Easton headword links, external `embed.js`,
and API CORS are shipped. Easton reference details live in
[`easton_dictionary_references.md`](easton_dictionary_references.md). Exact-verse/commentary/dictionary
deep links and multi-pane workspace serialization are explicitly deferred until after the remaining
M7/M8 work.
Three related features that build on each other: (1) shareable deep links, (2) in-app scripture
reference pop-ups, (3) the same pop-ups embeddable on external sites (e.g. a blog).

## 1. Deep links (URL-addressable content)
The shipped implementation is a small hand-written parser in `state/deeplink.ts`; React Router is not
installed.

- **Bible chapter (shipped):** `#/b/<work>/<osis>/<chapter>`, for example `#/b/web/Matt/2`. On load and
  `hashchange`, the app validates the work against `/works` and book/chapter against `/books`. A bad
  target is removed and produces a visible localized error.
- **General Book section (shipped):** `#/book/<work>/<section>`. The active section is mirrored with
  `history.replaceState`, so scroll-spy updates do not pollute browser history.
- **Deferred:** exact verse/range, commentary, dictionary, and complete 1–3-pane workspace URLs.
  This is a deliberate post-M8 product/design item, not an undocumented promise. It must define pane
  count/target validation and push-vs-replace history semantics before implementation.
- **Preserve the Dropbox OAuth callback:** `App` already reads `?code`/`?state` (`state` starts `dbx-`)
  on load for the PKCE flow (`dropboxAuth.ts` strips them after). Hash links run alongside those query
  parameters and do not clobber them.

## 2. In-app scripture reference pop-ups
When commentary / book / dictionary content cites a passage (e.g. "John 3:1-19"), make it interactive:
on hover/focus/tap show a pop-up with the Bible text, plus — if the passage is long — a truncated
preview and a link to **open it in the current Bible pane**.

- **Reference resolution (two layers):**
  1. **Structured (preferred): DONE for commentary/General Books.** `<reference osisRef>` tags are preserved as a `ref` run
     (`{t, …, ref}`) through both study (`_sword_osis_document`, for Matthew Henry OSIS) and General
     Books (`genbook.py`, for the 1689 proof texts — 1150 refs). `books.normalize_osis_ref` validates
     the book and collapses cross-chapter ranges to the start verse; the Pydantic + TS models carry
     `ref`; `DocumentRenderer` renders it as `<ScriptureRef>`. (Verified end-to-end: 0 scripture
     osisRefs in the 1689 failed to normalize.)
     Easton is also DONE: the raw export's 24,092 `Bible:` refs are label- and context-validated
     (including 355 chapter-only targets) and its 687 `Easton:` refs resolve by exact entry key
     into `dictionary_ref` runs; see
     [`easton_dictionary_references.md`](easton_dictionary_references.md).
  2. **Fallback linkifier (remaining):** a client-side scripture-reference regex over rendered text for
     genuinely plain-text future sources. Handles common English/Bulgarian citation formats +
     book-name aliases. It is not the Easton solution: Easton's structured raw source should be
     normalized once at the importer boundary.
- **Pop-up component: DONE.** `components/ScriptureRef.tsx` fetches the passage (verse-range API, from
  the public-domain `web` Bible) and shows a preview + "Open in Bible pane". Long passages truncate.
- **API: DONE.** `/works/{id}/passage/{osis}/{chapter}` accepts `?verses=16` or `?verses=1-19`.
- Accessibility: **DONE** — the trigger is a real `<button>`; the pop-up opens on hover **and**
  keyboard focus, dismisses on Escape and on blur, and taps toggle it (not hover-only).

## 3. Embeddable pop-ups on external sites (blog)
Ship a tiny standalone widget so the same scripture pop-ups + "open on bible.trendafilovi.net" links
work on the user's blog.

- **Embed script: DONE.** `apps/web/public/embed.js` — self-contained, dependency-free, served at
  `/embed.js`. It scans for marked spans (`<span data-bible-ref="John.3.16">…</span>`), attaches the
  hover/focus/tap pop-up (fetching passage text from our API), and adds a Bible deep link
  (`/#/b/<work>/<osis>/<chapter>`) to open the passage in the app. It targets whatever origin served
  it (overridable via `data-api` / `data-app` / `data-work`). Its reference grammar deliberately
  matches the in-app parser, chapter-only targets (`Num.12`) included, so a reference copied out of
  the reader works verbatim in `data-bible-ref`; a chapter-only pop-up previews a bounded opening
  window rather than the whole chapter. The **auto-linkify** fallback (option b)
  is not built — the marked-span form is explicit and unambiguous; add it only if wanted.
- **CORS: DONE.** `Access-Control-Allow-Origin: *` is set on `/api/v1` responses only (not the SPA
  HTML). A literal `*` (never an echoed Origin) stays cacheable at the Cloudflare edge with no `Vary`;
  simple GETs need no preflight.
- **Self-contained UI: DONE.** The widget injects one small `<style>` and reuses a single pop-up; it
  is theme-neutral and inserts passage text with `textContent` only (no HTML).
- **Security/perf:** read-only public data; no tokens/user data. `embed.js` is ~6.8 KB and uses
  `no-cache, must-revalidate`, so its stable URL receives updates without a hard refresh
  (`/embed-demo.html` and `docs/user/embedding-scripture.md` document usage). Future hardening:
  Subresource Integrity once the URL is versioned.

## Ordering & reuse
1. **Bible/book hashes (§1): DONE.**
2. **In-app structured pop-ups (§2): DONE.**
3. **Embed widget + API CORS (§3): DONE.**
4. **Deferred linking remainder:** exact verse/range, commentary/dictionary, and multi-pane workspace
   after M8; no route format is reserved yet.

## Open questions
- Final scheme for the deferred multi-pane/commentary/dictionary forms.
- Which citation formats/languages the fallback linkifier must handle (English + Bulgarian book names).
- Embed distribution: a `<script>` include vs. a copy-paste snippet; versioning of `embed.js`.
