# Security & Local-First Privacy Model

`bible_app_bg` is engineered with a **local-first, privacy-by-design architecture**.

## Security Model Overview

```mermaid
flowchart TD
    subgraph Browser Client (Local-First)
        NotesData[(Personal Notes\nIndexedDB)]
        ChatData[(Assistant History\nIndexedDB, not synced)]
        DropboxToken[Short-Lived Dropbox Token\nsessionStorage]
        ProviderKey[Your Provider API Key\nsessionStorage, tab lifetime]
        UI[React SPA]

        UI <--> NotesData
        UI <--> ChatData
        UI <-->|Direct HTTPS| DropboxAPI[Dropbox Cloud API]
    end

    subgraph Backend Server (Zero User Data)
        FastAPI[FastAPI Service\napps/api]
        SQLite[(content.sqlite\nRead-Only Bible DB)]

        FastAPI --> SQLite
    end

    UI -->|GET Read-Only Content & Search| FastAPI
    UI -->|Opt-in, direct HTTPS: question +\nsources you ticked, billed to your key| Provider[AI Provider\nOpenRouter]

    style NotesData fill:#2d5a27,stroke:#333,stroke-width:2px;
    style ChatData fill:#2d5a27,stroke:#333,stroke-width:2px;
    style DropboxToken fill:#2d5a27,stroke:#333,stroke-width:2px;
    style ProviderKey fill:#2d5a27,stroke:#333,stroke-width:2px;
    style FastAPI fill:#1f2937,stroke:#333,stroke-width:2px;
    style Provider fill:#7c2d12,stroke:#333,stroke-width:2px;
```

## Privacy Guarantees

1. **Zero User Account Data on Server**: The backend API has no database tables for user accounts, credentials, access tokens, or notes.
2. **Local Browser Storage**: Notes and verse anchors live in IndexedDB. Pane layout and reading
   preferences live in `localStorage`. These browser stores are local to the site profile but are not
   application-level encrypted; anyone with access to the browser profile may be able to read them.
   Recent and pinned search state (query, refinement, filters, order, and selected result type) is
   also stored unencrypted in `localStorage` under `bible-search-v1`. It can be cleared from Search
   history and is deliberately excluded from Dropbox note synchronization.
3. **Direct Cloud Sync**: Dropbox synchronization uses OAuth 2.0 PKCE. Tokens and note contents travel directly between your browser and Dropbox servers. The `bible_app_bg` API server never sees or handles your Dropbox token.

## Application Security Measures

- **Content Security Policy (CSP)**: Strict script-src and connect-src rules enforce that network connections only go to the app origin and Dropbox API endpoints.
- **Short-Lived OAuth Session**: The Dropbox access token is kept in `sessionStorage`, not persisted in
  IndexedDB or sent to the Bible API. Like all browser storage, it is readable by JavaScript running
  on the origin, so XSS prevention and the CSP remain important controls.
- **Untrusted File Parsing**: Source file parsers in `apps/importer` disable XML DTD/external entities,
  bound compressed and expanded bytes, reject excessive ZIP entry counts/compression ratios, and
  avoid shell interpolation. This applies even to owner-supplied content.
- **Sanitized Rich-Text Rendering**: Personal notes rich-text content is sanitized before rendering to eliminate Cross-Site Scripting (XSS) risks.

## Search privacy

Search is not local-only. The browser sends `q`, `refine`, and selected filters to the same-origin
read-only API as GET query parameters. Those URLs may appear in browser history and ordinary
Cloudflare, proxy, or origin request logs according to their retention settings. The application
does not create a server-side search-history database, but users should still avoid placing private
information in search queries.

## Assistant privacy (optional AI study assistant)

The assistant is **off unless the build enables it** (`VITE_CHAT_ENABLED=true`) *and* you supply
your own provider API key. There is no shared or project-provided key: with no key, nothing about
the assistant reaches any third party.

This is the one feature that sends your data to a company other than the site operator, so it is
described here in full.

### What leaves the browser, and to whom

Requests go **directly from your browser to the provider** — currently OpenRouter
(`https://openrouter.ai/api/v1`). The `bible_app_bg` API server is not in that path: it never sees
your key, your questions, the passages you attached, or the answers. The Content-Security-Policy
`connect-src` is the enforcement, not just the intent — it lists exactly `'self'`, the two Dropbox
API hosts, and `https://openrouter.ai`, so the page cannot post your conversation anywhere else.

Each turn sends:

- your question, and earlier turns of the same conversation that still fit the model's context
  window (older ones are dropped, and the app tells you how many);
- the **sources you ticked** in the context strip — Bible passages, commentary, dictionary and
  Strong's entries, cross-references, and any personal notes you selected — as excerpted text;
- a system prompt instructing the model to answer only from those sources;
- a `X-Title: Bible Reader` header identifying the application to the provider.

Nothing else is attached implicitly. The context strip lists every source before you send, with a
token estimate, and states what was left out and why.

**Personal notes are opt-in and never default-on.** A note is only attached if you tick it, and the
picker warns that notes may contain personal information. A note you attach is sent to the provider
like any other source.

### Your API key

The key lives in `sessionStorage` for the lifetime of that browser tab, and nowhere else — never
`localStorage`, never IndexedDB, never a URL, never an export, never a log, and never sent to the
`bible_app_bg` server. Closing the tab or pressing Disconnect removes it. Because it is readable by
JavaScript on the origin, the CSP and XSS controls above apply to it as they do to the Dropbox
token. Billing for every request is against **your** provider account.

### Provider terms are between you and the provider

Your key means your provider account's terms, privacy policy, and retention settings govern what
happens to the text after it leaves the browser — see [OpenRouter's
terms](https://openrouter.ai/terms). This application cannot see or change your account settings.

Two controls narrow this, and neither is a guarantee the app can verify:

- **Privacy routing** (a toggle in the model picker) adds `provider: { zdr: true, data_collection:
  "deny" }` to the request, asking the provider to route only to zero-data-retention providers and
  to refuse data collection.
- **The account-logging confirmation** is *your* assertion that you have turned off OpenRouter's own
  optional input/output logging and training use. That account state is not exposed by the API, so
  the app has to take your word for it. It is stored in `sessionStorage` and cleared on Disconnect.

Content licensed `allowed_no_training` is only eligible when **both** hold. That is a gate on what
this app will send, not a claim about what the provider does.

### The content licence gate

Not every text may be sent to a model. Each work carries an `ai_context_policy`
(`allowed`, `allowed_no_training`, `prohibited`, `unknown`), and the picker disables sources whose
policy forbids it, with the reason shown. Sources blocked this way are reported in the pre-send
summary rather than silently dropped. See
[Content Provenance & Licensing](content-and-licensing.md) and [`NOTICE`](../../NOTICE).

### Conversation history

Conversations are stored locally in their own IndexedDB database (`bible-chat`: threads, messages,
and a per-answer source manifest), capped at 200 threads and roughly 20 MB. Like notes, this store
is local to the browser profile and **not** application-level encrypted, so anyone with access to
the profile can read it. It is **not** synchronised to Dropbox and never reaches the
`bible_app_bg` server. Deleting a thread deletes it locally; it does not reach into whatever the
provider retained.

For models that produce hidden reasoning, only the **token count** is stored — never the reasoning
text.
