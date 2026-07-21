import { useTranslation } from "react-i18next";

import { SourceSelector } from "../components/SourceSelector";
import { WorkFooter } from "../components/WorkFooter";
import type { GeneralBookSection } from "../data/api";
import { useGeneralBook, useWorks } from "../data/hooks";
import { DocumentRenderer } from "../render/DocumentRenderer";
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
  const works = useWorks();
  const bookWorks = works?.filter((work) => work.type === "book") ?? [];
  const work = bookWorks.find((item) => item.id === pane.workId);
  const { loading, error, data } = useGeneralBook(pane.workId);
  const sections = data ? flatten(data.sections) : [];
  const selected =
    sections.find((section) => section.section_id === pane.sectionId) ?? sections[0];

  return (
    <div className="pane book-pane">
      <div className="pane-header">
        <SourceSelector type={pane.type} onChange={(type) => changePaneType(pane.id, type)} />
        {bookWorks.length > 0 && (
          <label>
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
      </div>
      <div className="book-layout">
        <nav className="book-toc" aria-label={t("book.contents")}>
          {data && (
            <TableOfContents
              sections={data.sections}
              selected={selected?.section_id}
              onSelect={(sectionId) => updatePane(pane.id, { sectionId })}
            />
          )}
        </nav>
        <div className="pane-body book-content">
          {loading && <p className="muted">{t("reader.loading")}</p>}
          {error && <p className="muted">{t("book.error")}</p>}
          {data && !selected && <p className="muted">{t("book.empty")}</p>}
          {selected && (
            <article>
              {selected.body.blocks[0]?.kind !== "heading" && <h3>{selected.title}</h3>}
              <DocumentRenderer document={selected.body} />
            </article>
          )}
        </div>
      </div>
      {work && <WorkFooter work={work} />}
    </div>
  );
}
