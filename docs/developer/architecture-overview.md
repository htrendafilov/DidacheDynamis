# Architecture Overview & CIR Model

This document describes the architectural boundaries and the **Canonical Intermediate Representation (CIR)** data model used across `bible_app_bg`.

## System Boundaries & Component Map

```mermaid
graph TD
    subgraph Client Browser [Client-Side Environment]
        SPA[React 18 SPA\napps/web]
        IDB[(IndexedDB\nLocal Notes & Settings)]
        Dropbox[Dropbox API\nApp Folder Sync]
        SPA <--> IDB
        SPA <-->|OAuth PKCE Direct| Dropbox
    end

    subgraph Backend Server [Server Environment]
        API[FastAPI Service\napps/api]
        SQLite[(data/content.sqlite\nSQLite + FTS5)]
        API -->|sqlite3 mode=ro| SQLite
    end

    subgraph Offline Tooling [CLI Build Environment]
        Importer[bibleimport CLI\napps/importer]
        Sources[Source Texts\nUSFX / SWORD / ThML]
        Sources --> Importer
        Importer -->|Builds| SQLite
    end

    SPA <-->|REST API /api/v1| API
```

## Immutable Architecture Principle

1. **Zero Server State**: The production server (`apps/api`) does not accept writes, execute user authentication, or store user session data.
2. **Read-Only SQLite**: The API opens `data/content.sqlite` with `mode=ro` and `PRAGMA query_only = ON`.
3. **Local-First Notes**: All notes, tags, and settings are created, edited, and rendered inside the browser via IndexedDB.

---

## Canonical Intermediate Representation (CIR)

Source Bible formats (USFX, OSIS, ThML, SWORD mod2imp) stop at the `apps/importer` boundary. All scripture and commentary texts are transformed into a canonical JSON AST structure before stored in SQLite.

```mermaid
classDiagram
    class CIRDocument {
        +string work_id
        +string doc_type
        +List~CIRNode~ content
    }
    class CIRNode {
        +string type
        +string text
        +map attributes
        +List~CIRNode~ children
    }
    class VerseNode {
        +string type: verse
        +int number
        +string id
    }
    class WordsOfChristNode {
        +string type: woc
        +string text
    }

    CIRDocument "1" *-- "*" CIRNode
    CIRNode <|-- VerseNode
    CIRNode <|-- WordsOfChristNode
```

### CIR Node Types

| Node Type | Purpose | Example / Attributes |
|---|---|---|
| `book` | Book container | `{ "type": "book", "id": "JHN" }` |
| `chapter` | Chapter container | `{ "type": "chapter", "number": 3 }` |
| `verse` | Verse text container | `{ "type": "verse", "number": 16, "id": "JHN.3.16" }` |
| `woc` | Words of Christ text | `{ "type": "woc", "text": "For God so loved the world..." }` |
| `heading` | Section header | `{ "type": "heading", "level": 2, "text": "The Love of God" }` |
| `poetry` | Poetic line rendering | `{ "type": "poetry", "indent": 1 }` |
