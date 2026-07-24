import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";

import { SourceSelector } from "../components/SourceSelector";
import { WorkFooter } from "../components/WorkFooter";
import type { GeneralBookSection } from "../data/api";
import { useGeneralBook, useWorks } from "../data/hooks";
import { DocumentRenderer } from "../render/DocumentRenderer";
import { MOBILE_MEDIA_QUERY } from "../responsive";
import { useStore, type Pane } from "../state/store";

function flatten(sections: GeneralBookSection[]): GeneralBookSection[] {
  return sections.flatMap((section) => [section, ...flatten(section.children)]);
}

function TableOfContents({
  sections,
  selected,
  onSelect,
}: {
  sections: GeneralBookSection[];
  selected: string | undefined;
  onSelect: (sectionId: string) => void;
}) {
  return (
    <ul className="book-toc-list">
      {sections.map((section) => (
        <li key={section.section_id}>
          <button
            type="button"
            className={section.section_id === selected ? "active" : ""}
            aria-current={section.section_id === selected ? "page" : undefined}
            onClick={() => onSelect(section.section_id)}
          >
            {section.title}
          </button>
          {section.children.length > 0 && (
            <TableOfContents
              sections={section.children}
              selected={selected}
              onSelect={onSelect}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

export function BookPane({ pane }: { pane: Pane }) {
  const { t } = useTranslation();
  const changePaneType = useStore((state) => state.changePaneType);
  const updatePane = useStore((state) => state.updatePane);
  const settings = useStore((state) => state.settings);
  const works = useWorks();
  const bookWorks = works?.filter((work) => work.type === "book") ?? [];
  const work = bookWorks.find((item) => item.id === pane.workId);
  const { loading, error, data } = useGeneralBook(pane.workId);
  const sections = data ? flatten(data.sections) : [];
  const readableSections = sections.filter((section) => section.body.blocks.length > 0);
  const selected =
    readableSections.find((section) => section.section_id === pane.sectionId) ??
    readableSections[0];
  const selectedIndex = selected
    ? readableSections.findIndex((section) => section.section_id === selected.section_id)
    : -1;
  const tocOpen = pane.bookTocOpen ?? true;
  const mode = settings.bookMode ?? "paged";
  const tocId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const sectionElements = useRef(new Map<string, HTMLElement>());
  const spiedSection = useRef<string | undefined>(undefined);

  const selectSection = (sectionId: string) => {
    const section = sections.find((item) => item.section_id === sectionId);
    const target =
      section?.body.blocks.length
        ? section
        : section
          ? flatten(section.children).find((item) => item.body.blocks.length > 0)
          : undefined;
    if (!target) return;
    updatePane(pane.id, { sectionId: target.section_id });
    if (mode === "scroll") {
      requestAnimationFrame(() =>
        sectionElements.current.get(target.section_id)?.scrollIntoView?.({
          behavior: "smooth",
          block: "start",
        }),
      );
    } else {
      contentRef.current?.scrollTo?.({ top: 0, behavior: "smooth" });
    }
    if (window.matchMedia?.(MOBILE_MEDIA_QUERY).matches) {
      updatePane(pane.id, { bookTocOpen: false });
    }
  };

  const turnPage = (offset: number) => {
    const target = readableSections[selectedIndex + offset];
    if (target) selectSection(target.section_id);
  };

  // Scroll-spy: in scroll mode, keep the TOC highlight (pane.sectionId) in sync with the section
  // nearest the top of the viewport as the reader scrolls. Recomputes on a rAF, and only writes to
  // the store on a section boundary, so it does not thrash persisted state while scrolling.
  useEffect(() => {
    if (mode !== "scroll" || !data) return;
    const root = contentRef.current;
    if (!root) return;
    const ordered = flatten(data.sections).filter(
      (section) => section.body.blocks.length > 0,
    );
    let frame = 0;
    const computeActive = () => {
      frame = 0;
      const line = root.getBoundingClientRect().top + root.clientHeight * 0.25;
      let activeId: string | undefined;
      for (const section of ordered) {
        const element = sectionElements.current.get(section.section_id);
        if (!element) continue;
        if (element.getBoundingClientRect().top <= line) activeId = section.section_id;
        else break;
      }
      if (activeId && activeId !== spiedSection.current) {
        spiedSection.current = activeId;
        updatePane(pane.id, { sectionId: activeId });
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(computeActive);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    computeActive();
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [mode, data, pane.id, updatePane]);

  // Keep the store's section id in sync with the section actually shown, so a freshly opened book
  // pane is immediately shareable (deep link) and a reload restores the same place. Runs only when
  // the current id is missing or no longer valid (e.g. after switching books).
  useEffect(() => {
    if (!data || !selected) return;
    const valid = readableSections.some((section) => section.section_id === pane.sectionId);
    if (!valid) updatePane(pane.id, { sectionId: selected.section_id });
  }, [data, selected, readableSections, pane.sectionId, pane.id, updatePane]);

  return (
    <div className="pane book-pane">
      <div className="pane-header">
        <SourceSelector type={pane.type} onChange={(type) => changePaneType(pane.id, type)} />
        {bookWorks.length > 0 && (
          <label className="book-work-select">
            <span className="sr-only">{t("book.select")}</span>
            <select
              aria-label={t("book.select")}
              value={pane.workId}
              onChange={(event) =>
                updatePane(pane.id, { workId: event.target.value, sectionId: undefined })
              }
            >
              {bookWorks.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          className="book-toc-toggle"
          aria-expanded={tocOpen}
          aria-controls={tocId}
          onClick={() => updatePane(pane.id, { bookTocOpen: !tocOpen })}
        >
          ☰ {t(tocOpen ? "book.hideContents" : "book.showContents")}
        </button>
      </div>
      <div className={`book-layout ${tocOpen ? "" : "toc-hidden"}`}>
        {tocOpen && (
          <button
            type="button"
            className="book-toc-scrim"
            aria-label={t("book.closeContents")}
            onClick={() => updatePane(pane.id, { bookTocOpen: false })}
          />
        )}
        <nav id={tocId} className="book-toc" aria-label={t("book.contents")} hidden={!tocOpen}>
          {data && (
            <TableOfContents
              sections={data.sections}
              selected={selected?.section_id}
              onSelect={selectSection}
            />
          )}
        </nav>
        <div
          className={`pane-body book-content book-content-${mode}`}
          ref={contentRef}
        >
          {loading && <p className="muted">{t("reader.loading")}</p>}
          {error && <p className="muted">{t("book.error")}</p>}
          {data && !selected && <p className="muted">{t("book.empty")}</p>}
          {mode === "paged" && selected && (
            <>
              <article className="book-page">
                {selected.body.blocks[0]?.kind !== "heading" && <h3>{selected.title}</h3>}
                <DocumentRenderer document={selected.body} />
              </article>
              <nav className="book-page-nav" aria-label={t("book.pageNavigation")}>
                <button
                  type="button"
                  disabled={selectedIndex <= 0}
                  onClick={() => turnPage(-1)}
                >
                  ← {t("book.previous")}
                </button>
                <span>
                  {t("book.pageCount", {
                    current: selectedIndex + 1,
                    total: readableSections.length,
                  })}
                </span>
                <button
                  type="button"
                  disabled={selectedIndex >= readableSections.length - 1}
                  onClick={() => turnPage(1)}
                >
                  {t("book.next")} →
                </button>
              </nav>
            </>
          )}
          {mode === "scroll" &&
            readableSections.map((section) => (
              <article
                className="book-scroll-section"
                key={section.section_id}
                ref={(element) => {
                  if (element) sectionElements.current.set(section.section_id, element);
                  else sectionElements.current.delete(section.section_id);
                }}
              >
                {section.body.blocks[0]?.kind !== "heading" && <h3>{section.title}</h3>}
                <DocumentRenderer document={section.body} />
              </article>
            ))}
        </div>
      </div>
      {work && <WorkFooter work={work} />}
    </div>
  );
}
