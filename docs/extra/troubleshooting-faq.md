# Troubleshooting & Frequently Asked Questions (FAQ)

This guide provides solutions for common user, developer, and deployment issues.

## User FAQ & Troubleshooting

### Q: Why aren't my notes syncing with Dropbox?
- **Solution**: Open **Settings ➔ Dropbox Sync**. Verify your App Key is entered correctly and your connection status shows **Connected**. If your session has expired, click **Reconnect**.
- Ensure your Dropbox App has permissions `files.content.read` and `files.content.write` enabled in the Dropbox Developer Console.

### Q: How do I transfer my notes to a new browser or computer?
- Open **Notes ➔ Backup JSON**. Download your notes file (`notes-backup.json`).
- On your new device or browser, open **Notes ➔ Restore JSON** and select the file.

---

## Developer Troubleshooting

### Q: `bibleimport` command fails with "No such file or directory: data/sources"
- **Solution**: Ensure you run the build command from the root directory of the monorepo:
  ```bash
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
- **Cause**: The API server cannot locate or query `data/content.sqlite`.
- **Solution**: Verify `data/content.sqlite` exists and has read permissions. Check systemd logs:
  ```bash
  journalctl -u bible-app -n 50 --no-pager
  ```

### Q: Deployment symlink swap leaves broken asset references
- **Cause**: Old SPA JavaScript chunks were purged before active browser tabs loaded them.
- **Solution**: Ensure your deploy script copies existing `assets/` into the new release directory before performing the atomic symlink swap:
  ```bash
  cp -aL web_dist/assets releases/<ts>/web_dist/
  ```
