import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Book, Work } from "../data/api";
import { bookName } from "../i18n/bookNames";

type InfoTab = "about" | "books" | "copyright" | "source";

interface WorkFooterProps {
  work: Work;
  books?: Book[] | null;
}

export function WorkFooter({ work, books }: WorkFooterProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<InfoTab>("about");
  const titleId = useId();
  const hasBookList = books !== undefined;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const tabs: { id: InfoTab; label: string }[] = [
    { id: "about", label: t("workInfo.about") },
    ...(hasBookList ? [{ id: "books" as const, label: t("workInfo.bookList") }] : []),
    { id: "copyright", label: t("workInfo.copyright") },
    { id: "source", label: t("workInfo.publisher") },
  ];

  return (
    <>
      <div className="pane-footer">
        <span>{work.attribution}</span>
        <button
          type="button"
          className="work-info-open"
          aria-haspopup="dialog"
          onClick={() => {
            setTab("about");
            setOpen(true);
          }}
        >
          ⓘ {t("workInfo.open")}
        </button>
      </div>

      {open && (
        <div
          className="work-info-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            className="work-info-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
          >
            <header className="work-info-header">
              <div>
                <span className="work-info-kicker">{t(`workInfo.type.${work.type}`)}</span>
                <h2 id={titleId}>{work.title}</h2>
              </div>
              <button
                type="button"
                className="work-info-close"
                aria-label={t("workInfo.close")}
                onClick={() => setOpen(false)}
              >
                ✕
              </button>
            </header>

            <nav className="work-info-tabs" aria-label={t("workInfo.tabs")}>
              {tabs.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={tab === item.id ? "active" : ""}
                  aria-pressed={tab === item.id}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </nav>

            <div className="work-info-body">
              {tab === "about" && (
                <>
                  <h3>{t("workInfo.aboutTitle", { title: work.title })}</h3>
                  <dl className="work-info-facts">
                    <div>
                      <dt>{t("workInfo.abbreviation")}</dt>
                      <dd>{work.abbrev}</dd>
                    </div>
                    <div>
                      <dt>{t("workInfo.type")}</dt>
                      <dd>{t(`workInfo.type.${work.type}`)}</dd>
                    </div>
                    <div>
                      <dt>{t("workInfo.language")}</dt>
                      <dd>{t(`workInfo.language.${work.language}`)}</dd>
                    </div>
                    <div>
                      <dt>{t("workInfo.versification")}</dt>
                      <dd>{work.versification.toUpperCase()}</dd>
                    </div>
                    {work.source_version && (
                      <div>
                        <dt>{t("workInfo.edition")}</dt>
                        <dd>{work.source_version}</dd>
                      </div>
                    )}
                  </dl>
                </>
              )}

              {tab === "books" && (
                <>
                  <h3>{t("workInfo.bookList")}</h3>
                  {!books && <p className="muted">{t("reader.loading")}</p>}
                  {books && (
                    <ol className="work-info-book-list">
                      {books.map((book) => (
                        <li key={book.osis}>
                          <span>{bookName(book.osis, i18n.language, book.name)}</span>
                          <small>
                            {t("workInfo.chapters", { count: book.chapter_count })}
                          </small>
                        </li>
                      ))}
                    </ol>
                  )}
                </>
              )}

              {tab === "copyright" && (
                <>
                  <h3>{t("workInfo.copyright")}</h3>
                  <p className="work-info-license">{work.license}</p>
                  <p>{work.attribution}</p>
                </>
              )}

              {tab === "source" && (
                <>
                  <h3>{t("workInfo.publisher")}</h3>
                  {work.source_version && (
                    <p>
                      <strong>{t("workInfo.edition")}:</strong> {work.source_version}
                    </p>
                  )}
                  {work.source_url ? (
                    <p>
                      <a href={work.source_url} target="_blank" rel="noreferrer">
                        {t("workInfo.source")}
                      </a>
                    </p>
                  ) : (
                    <p className="muted">{t("workInfo.noSource")}</p>
                  )}
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
