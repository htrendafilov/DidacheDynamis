/*!
 * bible.trendafilovi.net embeddable scripture pop-ups.
 *
 * Usage on an external page:
 *   <span data-bible-ref="John.3.16">John 3:16</span>
 *   <span data-bible-ref="Num.12">Numbers 12</span>
 *   <script src="https://bible.trendafilovi.net/embed.js" defer></script>
 *
 * Dependency-free and self-contained. It marks up every [data-bible-ref], and on hover / focus / tap
 * shows the passage text (fetched from the read-only public API) plus a link to open the chapter in
 * the app. No cookies, no tokens, no user data; passage text is inserted with textContent only.
 *
 * The API and app base default to wherever this script was loaded from; override on the <script> tag
 * with data-api / data-app, and the default Bible with data-work (per element: data-bible-work).
 */
(function () {
  "use strict";
  if (window.__bibleEmbedLoaded) return;
  window.__bibleEmbedLoaded = true;

  var script = document.currentScript;
  var origin = script && script.src ? new URL(script.src).origin : window.location.origin;
  var API_BASE = (script && script.getAttribute("data-api")) || origin;
  var APP_BASE = (script && script.getAttribute("data-app")) || origin;
  var DEFAULT_WORK = (script && script.getAttribute("data-work")) || "web";
  // Same reference grammar the app itself accepts: Book.chapter.verse[-end], or Book.chapter for a
  // whole-chapter citation. Keeping the two in step means a reference copied out of the reader
  // works verbatim in data-bible-ref.
  var REF = /^([A-Za-z0-9]+)\.(\d+)(?:\.(\d+)(?:-(\d+))?)?$/;
  // A chapter-only citation previews the opening verses instead of pulling the whole chapter
  // (Psalm 119 is 176 verses) — this fires on hover, on someone else's page.
  var CHAPTER_PREVIEW_VERSES = 6;

  function parseRef(value) {
    var m = REF.exec(value || "");
    if (!m) return null;
    var chapter = +m[2];
    if (chapter < 1) return null;
    // start === null marks a chapter-only ref; never fabricate verse 1.
    if (!m[3]) return { osis: m[1], chapter: chapter, start: null, end: null };
    var start = +m[3];
    var end = m[4] ? +m[4] : start;
    if (start < 1 || end < start) return null;
    return { osis: m[1], chapter: chapter, start: start, end: end };
  }

  function passageText(passage) {
    return (passage.verses || [])
      .map(function (verse) {
        var text = (verse.lines || [])
          .map(function (line) {
            return (line.runs || [])
              .map(function (run) {
                return run.t;
              })
              .join("");
          })
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        return verse.verse + " " + text;
      })
      .join(" ")
      .trim();
  }

  // One shared pop-up, reused for whichever reference is active.
  var pop = null;
  var titleEl, bodyEl, linkEl;
  var closeTimer = null;
  var cache = {};

  function ensurePopover() {
    if (pop) {
      // A host page that replaces document.body (SPA route change, htmx/turbo swap) detaches the
      // pop-up; re-attach the existing node rather than leaving the widget permanently silent.
      if (!pop.isConnected) document.body.appendChild(pop);
      return;
    }
    var style = document.createElement("style");
    style.textContent =
      ".bible-embed-ref{color:#1d4ed8;cursor:pointer;text-decoration:underline dotted;text-underline-offset:2px}" +
      ".bible-embed-pop{position:absolute;z-index:2147483000;max-width:22rem;padding:.6rem .7rem;" +
      "background:#fff;color:#1c1917;border:1px solid #e7e5e4;border-radius:6px;" +
      "box-shadow:0 6px 24px rgba(0,0,0,.18);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;" +
      "text-align:left}" +
      ".bible-embed-pop[hidden]{display:none}" +
      ".bible-embed-pop b{color:#1d4ed8}" +
      ".bible-embed-pop a{display:inline-block;margin-top:.4rem;color:#1d4ed8}";
    document.head.appendChild(style);

    pop = document.createElement("div");
    pop.className = "bible-embed-pop";
    pop.setAttribute("role", "group");
    pop.hidden = true;
    titleEl = document.createElement("b");
    bodyEl = document.createElement("div");
    linkEl = document.createElement("a");
    linkEl.textContent = "Open on " + new URL(APP_BASE).host;
    pop.appendChild(titleEl);
    pop.appendChild(bodyEl);
    pop.appendChild(linkEl);
    document.body.appendChild(pop);

    pop.addEventListener("mouseenter", cancelClose);
    pop.addEventListener("mouseleave", scheduleClose);
  }

  function cancelClose() {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  }

  function scheduleClose() {
    cancelClose();
    closeTimer = setTimeout(close, 150);
  }

  function close() {
    cancelClose();
    if (pop) pop.hidden = true;
  }

  function position(el) {
    var rect = el.getBoundingClientRect();
    pop.style.top = rect.bottom + window.scrollY + 4 + "px";
    pop.style.left = rect.left + window.scrollX + "px";
  }

  function open(el, ref, work) {
    ensurePopover();
    cancelClose();
    position(el);
    var fallbackTitle = ref.osis + " " + ref.chapter + (ref.start === null ? "" : ":" + ref.start);
    titleEl.textContent = (el.textContent || "").trim() || fallbackTitle;
    var range =
      ref.start === null
        ? "1-" + CHAPTER_PREVIEW_VERSES
        : ref.start === ref.end
          ? "" + ref.start
          : ref.start + "-" + ref.end;
    linkEl.href = APP_BASE.replace(/\/$/, "") + "/#/b/" + encodeURIComponent(work) + "/" + encodeURIComponent(ref.osis) + "/" + ref.chapter;
    pop.hidden = false;

    var key = work + "/" + ref.osis + "/" + ref.chapter + "/" + range;
    // Claim the pop-up before any early return: a cached hit that left this stale let an
    // older in-flight fetch write its text under the newer reference's title.
    titleEl.dataset.key = key;
    if (cache[key] !== undefined) {
      bodyEl.textContent = cache[key];
      return;
    }
    bodyEl.textContent = "Loading…";
    var url = API_BASE.replace(/\/$/, "") + "/api/v1/works/" + encodeURIComponent(work) +
      "/passage/" + encodeURIComponent(ref.osis) + "/" + ref.chapter + "?verses=" + range;
    fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error("http " + r.status);
        return r.json();
      })
      .then(function (passage) {
        var text = passageText(passage);
        // A full window came back, so the chapter continues past what was fetched.
        if (ref.start === null && (passage.verses || []).length >= CHAPTER_PREVIEW_VERSES) {
          text += " …";
        }
        cache[key] = text;
        // Only update if this reference is still the one showing.
        if (!pop.hidden && titleEl.dataset.key === key) bodyEl.textContent = text;
      })
      .catch(function () {
        if (!pop.hidden && titleEl.dataset.key === key) bodyEl.textContent = "Could not load this passage.";
      });
  }

  function attach(el) {
    if (el.__bibleEmbed) return;
    var ref = parseRef(el.getAttribute("data-bible-ref"));
    if (!ref) return; // leave unrecognized refs as plain text
    el.__bibleEmbed = true;
    var work = el.getAttribute("data-bible-work") || DEFAULT_WORK;
    el.classList.add("bible-embed-ref");
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");

    el.addEventListener("mouseenter", function () {
      open(el, ref, work);
    });
    el.addEventListener("mouseleave", scheduleClose);
    el.addEventListener("focus", function () {
      open(el, ref, work);
    });
    el.addEventListener("blur", scheduleClose);
    el.addEventListener("click", function () {
      if (!pop || pop.hidden) open(el, ref, work);
      else close();
    });
    el.addEventListener("keydown", function (event) {
      if (event.key === "Escape") close();
      else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open(el, ref, work);
      }
    });
  }

  function enhance(root) {
    var nodes = (root || document).querySelectorAll("[data-bible-ref]");
    for (var i = 0; i < nodes.length; i++) attach(nodes[i]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      enhance(document);
    });
  } else {
    enhance(document);
  }

  window.BibleEmbed = { enhance: enhance, parseRef: parseRef, passageText: passageText };
})();
