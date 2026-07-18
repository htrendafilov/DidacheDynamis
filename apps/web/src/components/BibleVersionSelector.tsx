import { useTranslation } from "react-i18next";

import type { Work } from "../data/api";

export function BibleVersionSelector({
  works,
  workId,
  onChange,
}: {
  works: Work[] | null;
  workId: string;
  onChange: (workId: string) => void;
}) {
  const { t } = useTranslation();
  const bibles = works?.filter((work) => work.type === "bible") ?? [];
  return (
    <label>
      <span className="sr-only">{t("selector.version")}</span>
      <select
        aria-label={t("selector.version")}
        value={workId}
        onChange={(event) => onChange(event.target.value)}
      >
        {bibles.map((work) => (
          <option value={work.id} key={work.id}>
            {work.abbrev}
          </option>
        ))}
      </select>
    </label>
  );
}
