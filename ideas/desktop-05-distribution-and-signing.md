# Cross-cutting — Distribution & Code Signing

Applies to propositions 1–3 (PWA skips all of this). Unsigned desktop apps get scary
warnings on macOS and Windows; budget money and lead time for certificates.

## macOS

- **Gatekeeper/notarization is mandatory** for downloads outside the App Store:
  - Apple Developer Program: **$99/year**.
  - Sign the `.app` with a Developer ID Application certificate, then `xcrun notarytool
    submit` and staple the ticket. CI: store cert in GitHub Actions secrets as a base64
    `.p12` + notarytool API key (`APPLE_ID`/team ID or App Store Connect API key).
  - Universal2: build arm64 + x86_64 and `lipo` (PyInstaller), or Tauri's
    `--target universal-apple-darwin`.
- Distribution: **DMG** (drag-to-Applications) is the expectation; `create-dmg` or
  Tauri/electron-builder generate one.
- Mac App Store is possible but adds sandboxing work (localhost sidecar and Dropbox
  OAuth flows need entitlement review) — skip for v1.

## Windows

- **SmartScreen** will flag unsigned/new apps ("Windows protected your PC").
- Options:
  1. **EV code-signing certificate** (~$300–500/yr, hardware token or cloud HSM e.g.
     Azure Trusted Signing ~$10/mo) — instant SmartScreen reputation.
  2. **OV certificate** — reputation builds over weeks of downloads; users see warnings
     early on.
  3. Ship unsigned first, sign later — acceptable for a small beta, bad for launch.
- Azure Trusted Signing is currently the cheapest low-friction path for OSS/small teams.
- Installer: NSIS (Tauri/electron-builder default) or MSIX (store-adjacent, requires
  signing too).

## Linux

No signing gate; the cost is **format fragmentation**:

| Format | Pros | Cons |
|---|---|---|
| **AppImage** | One file, runs anywhere, no install | No auto-update story (AppImageUpdate exists but rare) |
| **.deb / .rpm** | Native for Debian/Fedora users | Two formats, repo hosting, dependency on WebKitGTK versions |
| **Flatpak (Flathub)** | Sandboxed, store discovery, updates | WebKitGTK bundled in runtime; build manifest maintenance |
| **Snap** | Ubuntu store, auto-updates | Canonical-specific, slow startup, confinement quirks with localhost sidecar |

Pragmatic v1: **AppImage + .deb**. Flatpak later if users ask.

## Update channels (all OSes)

- Tauri: `tauri-plugin-updater` + signed manifests on GitHub Releases.
- Electron: `electron-updater` + GitHub Releases provider.
- pywebview: no built-in — simplest honest option is an in-app "new version available"
  banner polling a `version.json` on the site, linking to the download page (the M5
  `UpdateNotice` component pattern already exists for the SPA).
- Keep the existing **versioned-release + rollback** discipline from the server
  (`scripts/release.sh` + symlink swap) — the desktop analogue is: never auto-delete the
  previous DB until the new one is verified (see `desktop-06`).

## CI sketch (GitHub Actions)

```
matrix: [macos-14 (arm64), macos-13 (x86_64), windows-latest, ubuntu-22.04]
steps:
  1. build SPA (npm ci && npm run build)
  2. freeze API sidecar (PyInstaller)            # props 1–3
  3. package shell (pyinstaller spec / tauri-action / electron-builder)
  4. sign + notarize (mac), sign (win)
  5. upload artifacts to GitHub Release (draft)
  6. publish update manifest (tauri/electron)
```

The existing `ci.yml`/`deploy.yml` workflows are the template; this becomes a new
`desktop-release.yml` triggered on tags.
