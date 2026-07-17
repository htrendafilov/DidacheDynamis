import { useTranslation } from "react-i18next";

import { useBooks } from "../data/hooks";
import { bookName } from "../i18n/bookNames";

export function PassageSelector({
  workId,
  osis,
  chapter,
  onChange,
}: {
  workId: string;
  osis: string;
  chapter: number;
  onChange: (osis: string, chapter: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const books = useBooks(workId);
  const current = books?.find((b) => b.osis === osis);
  const chapterCount = current?.chapter_count ?? 1;

  return (
    <div className="passage-selector">
      <label>
        <span className="sr-only">{t("selector.book")}</span>
        <select
          aria-label={t("selector.book")}
          value={osis}
          onChange={(e) => onChange(e.target.value, 1)}
        >
          {(books ?? []).map((b) => (
            <option key={b.osis} value={b.osis}>
              {bookName(b.osis, i18n.language, b.name)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="sr-only">{t("selector.chapter")}</span>
        <select
          aria-label={t("selector.chapter")}
          value={chapter}
          onChange={(e) => onChange(osis, Number(e.target.value))}
        >
          {Array.from({ length: chapterCount }, (_, i) => i + 1).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
