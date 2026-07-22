# Security & Local-First Privacy Model

`bible_app_bg` is engineered with a **local-first, privacy-by-design architecture**.

## Security Model Overview

```mermaid
flowchart TD
    subgraph Browser Client (Local-First)
        NotesData[(Personal Notes\nIndexedDB)]
        DropboxToken[Short-Lived Dropbox Token\nsessionStorage]
        UI[React SPA]

        UI <--> NotesData
        UI <-->|Direct HTTPS| DropboxAPI[Dropbox Cloud API]
    end

    subgraph Backend Server (Zero User Data)
        FastAPI[FastAPI Service\napps/api]
        SQLite[(content.sqlite\nRead-Only Bible DB)]

        FastAPI --> SQLite
    end

    UI -->|GET Read-Only Passages| FastAPI
    
    style NotesData fill:#2d5a27,stroke:#333,stroke-width:2px;
    style DropboxToken fill:#2d5a27,stroke:#333,stroke-width:2px;
    style FastAPI fill:#1f2937,stroke:#333,stroke-width:2px;
```

## Privacy Guarantees

1. **Zero User Account Data on Server**: The backend API has no database tables for user accounts, credentials, access tokens, or notes.
2. **Local Browser Storage**: Notes and verse anchors live in IndexedDB. Pane layout and reading
   preferences live in `localStorage`. These browser stores are local to the site profile but are not
   application-level encrypted; anyone with access to the browser profile may be able to read them.
3. **Direct Cloud Sync**: Dropbox synchronization uses OAuth 2.0 PKCE. Tokens and note contents travel directly between your browser and Dropbox servers. The `bible_app_bg` API server never sees or handles your Dropbox token.

## Application Security Measures

- **Content Security Policy (CSP)**: Strict script-src and connect-src rules enforce that network connections only go to the app origin and Dropbox API endpoints.
- **Short-Lived OAuth Session**: The Dropbox access token is kept in `sessionStorage`, not persisted in
  IndexedDB or sent to the Bible API. Like all browser storage, it is readable by JavaScript running
  on the origin, so XSS prevention and the CSP remain important controls.
- **Untrusted File Parsing**: Source file parsers in `apps/importer` disable XML DTD processing and external entity loading (preventing XXE attacks).
- **Sanitized Rich-Text Rendering**: Personal notes rich-text content is sanitized before rendering to eliminate Cross-Site Scripting (XSS) risks.
