# Troubleshooting & Frequently Asked Questions (FAQ)

This guide provides solutions for common user, developer, and deployment issues.

## User FAQ & Troubleshooting

### Q: Why aren't my notes syncing with Dropbox?
- **Hosted reader**: Open **Settings ➔ Dropbox note synchronization**. If the short-lived session
  expired, click **Connect Dropbox** and authorize again. There is no App Key input in the UI.
- **Self-hosted build**: If Settings reports that Dropbox is not configured, rebuild the SPA with
  `VITE_DROPBOX_APP_KEY`. Confirm that the Dropbox app has `files.content.read` and
  `files.content.write` and that the exact redirect URI is registered.

### Q: How do I transfer my notes to a new browser or computer?
- Open a Notes pane and click **Backup (JSON)**. The downloaded file is `bible-notes.json`.
- On your new device or browser, open **Notes ➔ Restore JSON** and select the file.

---

## Developer Troubleshooting

### Q: `bibleimport` command fails with "No such file or directory: data/sources"
- **Solution**: Ensure you run the build command from the root directory of the monorepo:
  ```bash
  bash scripts/fetch-kjv.sh
  bibleimport build-all --sources-dir data/sources --out data/content.sqlite
  ```

### Q: Vite dev server fails to proxy requests to FastAPI
- **Solution**: Make sure the FastAPI server is running on port `8080` before starting Vite:
  ```bash
  . apps/api/.venv/bin/activate
  uvicorn app.main:app --app-dir apps/api --port 8080
  ```

---

## Deployment & Operations Troubleshooting

### Q: `/ready` endpoint returns HTTP 503 Service Unavailable
- **Cause**: Inspect the JSON `status`: `no-content` means the database is missing/empty;
  `invalid-content` means it cannot be queried; `schema-outdated` means it was built by an older
  importer schema.
- **Solution**: Verify the file and permissions. For `schema-outdated`, rebuild with the current
  importer (do not hand-edit the database), then restart the API:
  ```bash
  bash scripts/fetch-kjv.sh
  apps/importer/.venv/bin/bibleimport build-all \
    --sources-dir data/sources \
    --out data/content.sqlite
  ```
  Check systemd logs if readiness is still failing:
  ```bash
  journalctl -u bible-app -n 50 --no-pager
  ```

### Q: Deployment symlink swap leaves broken asset references
- **Cause**: Old SPA JavaScript chunks were purged before active browser tabs loaded them.
- **Solution**: Ensure your deploy script copies existing `assets/` into the new release directory before performing the atomic symlink swap:
  ```bash
  cp -aL web_dist/assets releases/<ts>/web_dist/
  ```
