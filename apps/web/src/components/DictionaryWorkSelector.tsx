import { useTranslation } from "react-i18next";

import type { Work } from "../data/api";

// The Dictionary pane hosts two kinds of work under one pane type (M8.3): Easton's
// (type="dictionary") and the Strong's lexicons (type="lexicon"). SourceSelector only
// switches pane type, so without this there is no way back to Easton once a pane is
// showing a lexicon entry (or vice versa) — mirrors BibleVersionSelector's pattern for
// switching translations within a Bible pane.
export function DictionaryWorkSelector({
  works,
  workId,
  onChange,
}: {
  works: Work[] | null;
  workId: string;
  onChange: (workId: string) => void;
}) {
  const { t } = useTranslation();
  const dictionaries = works?.filter((w) => w.type === "dictionary" || w.type === "lexicon") ?? [];
  if (dictionaries.length < 2) return null;
  return (
    <label>
      <span className="sr-only">{t("selector.dictionary")}</span>
      <select
        aria-label={t("selector.dictionary")}
        value={workId}
        onChange={(event) => onChange(event.target.value)}
      >
        {dictionaries.map((w) => (
          <option value={w.id} key={w.id}>
            {w.abbrev}
          </option>
        ))}
      </select>
    </label>
  );
}
