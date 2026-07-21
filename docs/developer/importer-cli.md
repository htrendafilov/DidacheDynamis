# Importer CLI (`apps/importer`)

The `bibleimport` CLI tool in `apps/importer/` processes source texts (USFX XML, SWORD `mod2imp` files, ThML, study dictionaries) and compiles them into a single SQLite database (`content.sqlite`).

## Import Pipeline Workflow

```mermaid
flowchart LR
    subgraph Source Formats
        USFX[USFX XML\n(WEB Bible)]
        SWORD[SWORD Mod2Imp\n(KJV Bible & 1689 Confession)]
        Study[Text / JSON Files\n(Commentaries & Dictionaries)]
    end

    subgraph Format Adapters
        USFXAdapter[formats/usfx.py]
        SWORDAdapter[formats/sword_bible.py\nformats/genbook.py]
        StudyAdapter[formats/study.py]
    end

    subgraph Core Pipeline
        CIR[pipeline.py\nCIR Transformation]
        Validate[validation.py\nVersification Check]
        Compiler[cli.py\nSQLite + FTS5 Compiler]
    end

    USFX --> USFXAdapter
    SWORD --> SWORDAdapter
    Study --> StudyAdapter

    USFXAdapter --> CIR
    SWORDAdapter --> CIR
    StudyAdapter --> CIR

    CIR --> Validate
    Validate --> Compiler
    Compiler --> DB[(data/content.sqlite)]
```

## Import CLI Commands

```bash
# Build complete database from sources directory
bibleimport build-all --sources-dir data/sources --out data/content.sqlite

# Validate versification alignment between translations
bibleimport validate-versification --source data/sources/web.xml

# Inspect built content database summary
bibleimport info data/content.sqlite
```

## Security & Parsing Constraints

To ensure build safety when importing untrusted source files:
- **XML Security**: DTD and external network entity resolution are strictly disabled in XML parsers.
- **Versification Safety**: Versification alignment issues between translations are reported as explicit warnings—the importer **never** silently renumbers verses.
- **Resource Limits**: Entropy checks and file size limits prevent ZipBomb / XML Bomb attacks.
