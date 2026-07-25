import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { DictionaryDocumentRef as DictionaryDocumentRefTarget } from "../data/api";

export function DictionaryDocumentRef({
  target,
  onNavigate,
  children,
}: {
  target: DictionaryDocumentRefTarget;
  onNavigate: (target: DictionaryDocumentRefTarget) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="scripture-ref dictionary-ref"
      aria-label={t("dictionary.openEntry", { headword: target.headword })}
      onClick={() => onNavigate(target)}
    >
      {children}
    </button>
  );
}
