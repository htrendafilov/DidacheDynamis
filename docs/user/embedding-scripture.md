# Embedding Scripture Pop-ups on Another Site

`bible.trendafilovi.net` ships a tiny, dependency-free `embed.js` you can add to an external site (for
example a blog) so scripture references become interactive: hover, focus, or tap one to see the passage
text, with a link to open the chapter in the reader.

## Quick start

Mark each reference with `data-bible-ref` (a canonical OSIS target — book code, chapter, verse), then
include the script once near the end of the page:

```html
<p>
  As it is written in <span data-bible-ref="John.3.16">John 3:16</span>, and again in
  <span data-bible-ref="Rom.5.8">Romans 5:8</span>.
</p>

<script src="https://bible.trendafilovi.net/embed.js" defer></script>
```

- The span's own text is what readers see and what titles the pop-up — write it however you like.
- `data-bible-ref` uses OSIS book codes and dotted numbers: `John.3.16`, a range `John.3.1-19`, or a
  numbered book `1Cor.13.4-7`. Unrecognized values are left as plain text.
- The passage preview comes from the public-domain **World English Bible**. To use another installed
  Bible for one reference, add `data-bible-work="kjv"`; to change the default for the whole page, put
  `data-work="kjv"` on the `<script>` tag.

## What it does

- Fetches the cited verses from the read-only public API (no cookies, tokens, or user data).
- Shows a small, theme-neutral pop-up on hover / keyboard focus / tap, dismissible with Escape.
- Inserts passage text with `textContent` only (never raw HTML), so it cannot inject markup.
- Adds an **"Open on bible.trendafilovi.net"** link that opens the chapter in the reader
  (`/#/b/<work>/<book>/<chapter>`).

## Notes

- **Content Security Policy:** if your site sets a CSP, allow the script and its API calls, e.g.
  `script-src https://bible.trendafilovi.net; connect-src https://bible.trendafilovi.net`.
- **Self-hosting / testing:** `embed.js` targets whatever origin it is served from, so it also works
  from a staging copy. A live demo page is served at `/embed-demo.html`.
- The script is cached at the Cloudflare edge; a hard refresh picks up updates.
