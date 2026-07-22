# Dropbox Cloud Synchronization

Sync your personal notes seamlessly across devices using Dropbox App Folder synchronization.

![Dropbox App Folder Sync Settings](assets/dropbox_sync_illustration.jpg)

## Privacy & Security Model

> [!IMPORTANT]
> The backend server (`apps/api`) **never sees your notes, tokens, or Dropbox credentials**. Synchronization runs 100% client-side directly between your web browser and Dropbox's official API using OAuth 2.0 PKCE.

## Setup Instructions

The hosted reader is already configured with its Dropbox App key. You do not create a Dropbox app or
paste a key into the reader.

1. Open **Settings** and find **Dropbox note synchronization**.
2. Click **Connect Dropbox** and approve access. The app can access only its private App Folder.
3. Click **Sync now** whenever you want an immediate merge. The reader also synchronizes after local
   note changes while connected.

Self-hosters configure their own Scoped/App-Folder Dropbox app at build time; see the repository
[Dropbox setup](../../README.md#dropbox-notes-sync-setup).

## Conflict Resolution

Dropbox contains one app file, `/notes-v1.json`. Synchronization performs a three-way merge. When the
same note changed independently on both devices, the local version remains at its original title and
the remote version becomes a separate topical note named `… (Dropbox conflict: remote edit)` (or
`remote deletion`). Both note records are then written into the same `notes-v1.json`; the Settings
panel reports how many conflict copies were created.
