import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

interface BuildVersion {
  buildId?: unknown;
}

interface UpdateNoticeProps {
  onReload?: () => void;
}

export function UpdateNotice({
  onReload = () => window.location.reload(),
}: UpdateNoticeProps) {
  const { t } = useTranslation();
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    let active = true;

    const check = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch("/version.json", {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        });
        if (!response.ok) return;
        const version = (await response.json()) as BuildVersion;
        if (
          active &&
          typeof version.buildId === "string" &&
          version.buildId !== __APP_BUILD_ID__
        ) {
          setUpdateAvailable(true);
        }
      } catch {
        // An update check must never interfere with reading or offline use.
      }
    };

    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") void check();
    };

    void check();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", checkWhenVisible);
    const interval = window.setInterval(() => void check(), CHECK_INTERVAL_MS);

    return () => {
      active = false;
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", checkWhenVisible);
      window.clearInterval(interval);
    };
  }, []);

  if (!updateAvailable) return null;

  return (
    <aside className="update-notice" role="status" aria-live="polite">
      <span>{t("update.available")}</span>
      <button type="button" onClick={onReload}>
        {t("update.reload")}
      </button>
    </aside>
  );
}
