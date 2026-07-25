# Search, Navigation & Cross-References

The app provides fast passage lookup, high-speed Full-Text Search (FTS5), and Treasury of Scripture Knowledge (TSK) cross-references.

![Bible full-text search results](assets/search_and_lookup_illustration.jpg)

## Quick Passage Navigation

- **Book & Chapter Selectors**: Use the selectors in a Bible or Commentary pane header to open a
  chapter (for example, *Genesis 1* or *Matthew 5*).
- **Previous / Next Chapter**: Bible panes have arrow buttons beside the chapter selector. They also
  cross book boundaries. Commentary panes follow synchronized passage changes but do not have their
  own arrow buttons. There are currently no chapter keyboard shortcuts or direct verse-range selector.
- **Shareable Bible chapter**: use `/#/b/<work>/<OSIS-book>/<chapter>`, for example
  `/#/b/web/Matt/2`. The app validates the work, book, and chapter before opening it.

## Full-Text Search (FTS)

Open **Search** from the top bar to reveal the **Search Workspace** — a drawer docked to the right of
your panes on the desktop (drag its left edge to resize), or a full-screen view on a phone. Enter one
or more words and submit. Results are grouped with tabs and true counts for Bible, Commentary,
Dictionary, and Books. You can:

- select one or more installed sources;
- limit Bible/commentary results to the Old or New Testament;
- order by relevance or canonical/source order; and
- load results in stable 50-result pages until all matches are reachable.

Clicking a result opens the appropriate pane and source. On the desktop the workspace **stays open** so
you can open several results in a row; opening a **Bible result scrolls to and briefly highlights the
exact verse**. Collapsing the workspace and reopening it keeps your query, filters, and results. On a
phone, opening a result closes the full-screen search to reveal the pane.

Selecting individual Bible books, quoted-phrase syntax, search history, and refinement within a result
set remain planned (M7.4).

## Cross-References & Dictionary Lookups

- **Cross-References**: Click a verse number to open its TSK-derived references with inline WEB/KJV
  previews; click a result to navigate there.
- **Easton's Dictionary**: Open a Dictionary pane, filter the headword list, and select an entry.
  Bible citations inside an entry open the standard passage pop-up, and references to other
  headwords open that entry in the same pane.
  Automatic lookup from highlighted Bible words is not implemented.

### Known limitation: repeated headwords

Easton's source module defines two separate entries under each of **Kadesh** and **Salmon**. The
headword list shows each name once, and opening it always shows the **first** of the two
definitions; the second is currently unreachable from the reader. Full-text search indexes both, so
a search result whose snippet comes from the second definition still opens the first entry. Nothing
is lost from the database — picking between same-name entries is planned work, not a data problem.
