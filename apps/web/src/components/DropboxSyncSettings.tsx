import { useTranslation } from "react-i18next";

import { useDropboxSync } from "../sync/dropboxState";

export function DropboxSyncSettings() {
  const { t, i18n } = useTranslation();
  const configured = useDropboxSync((state) => state.configured);
  const connected = useDropboxSync((state) => state.connected);
  const phase = useDropboxSync((state) => state.phase);
  const error = useDropboxSync((state) => state.error);
  const lastSyncAt = useDropboxSync((state) => state.lastSyncAt);
  const conflicts = useDropboxSync((state) => state.conflicts);
  const connect = useDropboxSync((state) => state.connect);
  const syncNow = useDropboxSync((state) => state.syncNow);
  const disconnect = useDropboxSync((state) => state.disconnect);
  const clearConflicts = useDropboxSync((state) => state.clearConflicts);
  const busy = phase === "authenticating" || phase === "syncing";

  return (
    <section className="dropbox-settings" aria-labelledby="dropbox-sync-heading">
      <h3 id="dropbox-sync-heading">{t("dropbox.title")}</h3>
      <p className="muted">{t("dropbox.description")}</p>
      {!configured ? (
        <p role="status" className="sync-message warning">{t("dropbox.notConfigured")}</p>
      ) : connected ? (
        <div className="dropbox-actions">
          <button type="button" disabled={busy} onClick={() => void syncNow()}>
            {phase === "syncing" ? t("dropbox.syncing") : t("dropbox.syncNow")}
          </button>
          <button type="button" disabled={busy} onClick={disconnect}>
            {t("dropbox.disconnect")}
          </button>
        </div>
      ) : (
        <button type="button" disabled={busy} onClick={() => void connect()}>
          {phase === "authenticating" ? t("dropbox.connecting") : t("dropbox.connect")}
        </button>
      )}
      {connected && <p className="sync-message">{t("dropbox.connected")}</p>}
      {lastSyncAt !== null && (
        <p className="sync-message">
          {t("dropbox.lastSync", { time: new Date(lastSyncAt).toLocaleString(i18n.language) })}
        </p>
      )}
      {conflicts > 0 && (
        <div role="status" className="sync-message warning conflict-notice">
          <span>{t("dropbox.conflicts", { count: conflicts })}</span>
          <button type="button" className="link-button" onClick={clearConflicts}>
            {t("dropbox.dismiss")}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="sync-message error">
          {t(`dropbox.error.${error}`)}
        </p>
      )}
      <p className="sync-privacy">{t("dropbox.privacy")}</p>
    </section>
  );
}
