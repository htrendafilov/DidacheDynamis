import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { BibleVersionSelector } from "../components/BibleVersionSelector";
import { PassageSelector } from "../components/PassageSelector";
import { SourceSelector } from "../components/SourceSelector";
import { WorkFooter } from "../components/WorkFooter";
import { useBooks, useCrossReferences, usePassage, useWorks } from "../data/hooks";
import { ensurePassageNote } from "../data/notes";
import { bookName } from "../i18n/bookNames";
import { CIRRenderer } from "../render/CIRRenderer";
import { useStore, type Pane } from "../state/store";

export function BiblePane({ pane }: { pane: Pane }) {
  const { t, i18n } = useTranslation();
  const settings = useStore((s) => s.settings);
  const changePaneType = useStore((s) => s.changePaneType);
  const updatePane = useStore((s) => s.updatePane);
  const goToRef = useStore((s) => s.goToRef);
  const requestOpenNote = useStore((s) => s.requestOpenNote);
  const clearFocusVerse = useStore((s) => s.clearFocusVerse);
  const [selectedVerse, setSelectedVerse] = useState<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const books = useBooks(pane.workId);
  const works = useWorks();
  const work = works?.find((w) => w.id === pane.workId);
  const { loading, error, data } = usePassage(pane.workId, pane.osis, pane.chapter);
  const xrefs = useCrossReferences(pane.osis, pane.chapter, selectedVerse, pane.workId);

  const { prev, next } = useMemo(() => {
    if (!books) return { prev: null, next: null };
    const idx = books.findIndex((b) => b.osis === pane.osis);
    const book = books[idx];
    if (!book) return { prev: null, next: null };
    const next =
      pane.chapter < book.chapter_count
        ? { osis: pane.osis, chapter: pane.chapter + 1 }
        : idx + 1 < books.length
          ? { osis: books[idx + 1].osis, chapter: 1 }
          : null;
    const prev =
      pane.chapter > 1
        ? { osis: pane.osis, chapter: pane.chapter - 1 }
        : idx - 1 >= 0
          ? { osis: books[idx - 1].osis, chapter: books[idx - 1].chapter_count }
          : null;
    return { prev, next };
  }, [books, pane.osis, pane.chapter]);

  const change = (osis: string, chapter: number) => goToRef(osis, chapter, pane.id);

  // Scroll to and briefly flash a verse requested from search (pane.focusVerse), once the passage
  // has rendered. The flash timeout is intentionally not tied to effect cleanup: clearing the store
  // flag re-runs this effect, and a cleanup would cancel the pending un-flash.
  useEffect(() => {
    const target = pane.focusVerse;
    if (!target || !data) return;
    // usePassage clears stale data in an effect, so the render immediately after a pane navigation
    // can still contain the previous passage. Do not consume the target until the response and DOM
    // belong to the passage requested by the pane.
    if (
      data.work_id !== pane.workId ||
      data.osis !== pane.osis ||
      data.chapter !== pane.chapter
    ) {
      return;
    }
    const element = bodyRef.current?.querySelector<HTMLElement>(`[data-verse="${target}"]`);
    clearFocusVerse(pane.id);
    if (!element) return;
    element.scrollIntoView?.({ behavior: "smooth", block: "center" });
    element.classList.add("verse-flash");
    window.setTimeout(() => element.classList.remove("verse-flash"), 1600);
  }, [
    pane.focusVerse,
    pane.workId,
    pane.osis,
    pane.chapter,
    data,
    pane.id,
    clearFocusVerse,
  ]);

  return (
    <div className="pane bible-pane">
      <div className="pane-header">
        <SourceSelector type={pane.type} onChange={(type) => changePaneType(pane.id, type)} />
        <BibleVersionSelector
          works={works}
          workId={pane.workId}
          onChange={(workId) => updatePane(pane.id, { workId })}
        />
        <PassageSelector
          workId={pane.workId}
          osis={pane.osis}
          chapter={pane.chapter}
          onChange={change}
        />
        <div className="nav-buttons">
          <button
            type="button"
            disabled={!prev}
            onClick={() => prev && change(prev.osis, prev.chapter)}
            aria-label="previous chapter"
          >
            ‹
          </button>
          <button
            type="button"
            disabled={!next}
            onClick={() => next && change(next.osis, next.chapter)}
            aria-label="next chapter"
          >
            ›
          </button>
        </div>
      </div>

      <div className="pane-body" ref={bodyRef}>
        {loading && <p className="muted">{t("reader.loading")}</p>}
        {error && <p className="muted">{t("reader.error")}</p>}
        {data && (
          <CIRRenderer
            verses={data.verses}
            headings={data.headings}
            layout={settings.verseLayout}
            wordsOfChrist={settings.wordsOfChrist}
            onVerseClick={(verse) => setSelectedVerse((current) => (current === verse ? null : verse))}
          />
        )}
        {selectedVerse !== null && (
          <aside className="verse-tools" aria-label={t("xref.title")}>
            <div className="verse-tools-header">
              <strong>
                {t("xref.title")}: {bookName(pane.osis, i18n.language, pane.osis)} {pane.chapter}:
                {selectedVerse}
              </strong>
              <button type="button" onClick={() => setSelectedVerse(null)} aria-label={t("xref.close")}>
                ✕
              </button>
            </div>
            <button
              type="button"
              onClick={async () => {
                const title = `${bookName(pane.osis, i18n.language, pane.osis)} ${pane.chapter}:${selectedVerse}`;
                const noteId = await ensurePassageNote(
                  pane.osis,
                  pane.chapter,
                  title,
                  selectedVerse,
                );
                requestOpenNote(noteId, pane.osis, pane.chapter);
              }}
            >
              {t("notes.addForVerse")}
            </button>
            {xrefs === null && <p className="muted">{t("reader.loading")}</p>}
            {xrefs?.references.length === 0 && <p className="muted">{t("xref.none")}</p>}
            {xrefs && xrefs.references.length > 0 && (
              <ul className="xref-list">
                {xrefs.references.map((reference) => {
                  const versePart = reference.target_ref.split(".").slice(2).join(".");
                  return (
                    <li key={reference.target_ref}>
                      <button
                        type="button"
                        onClick={() => {
                          goToRef(reference.target_osis, reference.target_chapter, pane.id);
                          setSelectedVerse(null);
                        }}
                      >
                        <span className="result-ref">
                          {bookName(
                            reference.target_osis,
                            i18n.language,
                            reference.target_osis,
                          )}{" "}
                          {reference.target_chapter}:{versePart}
                        </span>
                        {reference.preview && (
                          <span className="xref-preview">{reference.preview}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>
        )}
      </div>

      {work && <WorkFooter work={work} books={books} />}
    </div>
  );
}
