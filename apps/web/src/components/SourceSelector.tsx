import { useTranslation } from "react-i18next";

import type { PaneSourceType } from "../state/store";

const TYPES: PaneSourceType[] = ["bible", "commentary", "dictionary", "notes"];
const ENABLED: PaneSourceType[] = ["bible", "commentary", "dictionary"];

export function SourceSelector({
  type,
  onChange,
}: {
  type: PaneSourceType;
  onChange: (type: PaneSourceType) => void;
}) {
  const { t } = useTranslation();
  return (
    <label className="source-selector">
      <span className="sr-only">{t("pane.source")}</span>
      <select
        aria-label={t("pane.source")}
        value={type}
        onChange={(e) => onChange(e.target.value as PaneSourceType)}
      >
        {TYPES.map((ty) => (
          <option key={ty} value={ty} disabled={!ENABLED.includes(ty)}>
            {t(`source.${ty}`)}
            {ENABLED.includes(ty) ? "" : ` (${t("source.soon")})`}
          </option>
        ))}
      </select>
    </label>
  );
}
