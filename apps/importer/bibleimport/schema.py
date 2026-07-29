"""SQLite schema for the read-only content database (see plan/backend/backend_design.md §2).

Bible tables + FTS are populated in M1. Commentary/dictionary/xref tables were added in M3;
general-book sections are populated in M6. Production continues to open this database read-only.
"""

from __future__ import annotations

import sqlite3

# Increment this whenever an API-visible schema change is made. The API keeps a matching
# CONTENT_SCHEMA_VERSION constant and refuses to serve an incompatible database.
# v2: verse_tokens + strong_lexicon (M8.1 Strong's lexical data).
# v3: diacritic-folded structured search columns on strong_lexicon (M8.4).
# v4: works.ai_context_policy (M9.1 — may a work's text be sent to an external AI service?).
SCHEMA_VERSION = 4

SCHEMA_SQL = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE works (
    id             TEXT PRIMARY KEY,      -- e.g. 'web'
    type           TEXT NOT NULL,         -- bible | commentary | dictionary | xref | book
    language       TEXT NOT NULL,         -- ISO code, e.g. 'en'
    title          TEXT NOT NULL,
    abbrev         TEXT NOT NULL,
    direction      TEXT NOT NULL DEFAULT 'ltr',
    versification  TEXT NOT NULL,         -- e.g. 'kjv'
    license        TEXT NOT NULL,
    attribution    TEXT NOT NULL,
    source_url     TEXT,
    source_version TEXT,
    checksum       TEXT NOT NULL,         -- sha256 of the source artifact
    -- May this work's text be sent to an external AI service? (M9.1)
    --   allowed             — unconditionally, e.g. public domain
    --   allowed_no_training — only to a provider contractually bound not to train on
    --                         or retain it (OpenRouter zdr+data_collection:deny, or a
    --                         paid Gemini tier). Never to a free tier that trains.
    --   prohibited          — never
    --   unknown             — never; treated as prohibited at the point of use
    ai_context_policy TEXT NOT NULL DEFAULT 'unknown'
        CHECK (ai_context_policy IN
            ('allowed','allowed_no_training','prohibited','unknown'))
);

CREATE TABLE books (
    work_id       TEXT NOT NULL REFERENCES works(id),
    osis_code     TEXT NOT NULL,
    name          TEXT NOT NULL,          -- localized display name for this work
    sort_order    INTEGER NOT NULL,
    chapter_count INTEGER NOT NULL,
    PRIMARY KEY (work_id, osis_code)
);

CREATE TABLE verses (
    work_id    TEXT NOT NULL REFERENCES works(id),
    osis_code  TEXT NOT NULL,
    chapter    INTEGER NOT NULL,
    verse      INTEGER NOT NULL,
    nodes_json TEXT NOT NULL,             -- canonical representation (CIR) for this verse
    plain_text TEXT NOT NULL,             -- normalized text for search/lookup
    PRIMARY KEY (work_id, osis_code, chapter, verse)
);
CREATE INDEX idx_verses_chapter ON verses(work_id, osis_code, chapter);

CREATE TABLE headings (
    work_id      TEXT NOT NULL REFERENCES works(id),
    osis_code    TEXT NOT NULL,
    chapter      INTEGER NOT NULL,
    before_verse INTEGER NOT NULL,        -- heading appears immediately before this verse
    kind         TEXT NOT NULL,           -- 'section' | 'title' (psalm superscription)
    text         TEXT NOT NULL
);
CREATE INDEX idx_headings_chapter ON headings(work_id, osis_code, chapter);

-- Populated in M3 (kept here so the schema is stable). entry_id is a stable per-entry key so the
-- search API can order/paginate commentary deterministically even when entries share a reference.
CREATE TABLE commentary_entries (
    entry_id    INTEGER PRIMARY KEY,
    work_id     TEXT NOT NULL REFERENCES works(id),
    osis_code   TEXT NOT NULL,
    chapter     INTEGER NOT NULL,
    verse_start INTEGER,
    verse_end   INTEGER,
    body_json   TEXT NOT NULL
);
CREATE INDEX idx_commentary_ref ON commentary_entries(work_id, osis_code, chapter);

CREATE TABLE dictionary_entries (
    work_id   TEXT NOT NULL REFERENCES works(id),
    headword  TEXT NOT NULL,
    sort_key  TEXT NOT NULL,
    language  TEXT NOT NULL,
    body_json TEXT NOT NULL
);
CREATE INDEX idx_dictionary_sort ON dictionary_entries(work_id, sort_key);

CREATE TABLE book_sections (
    work_id    TEXT NOT NULL REFERENCES works(id),
    section_id TEXT NOT NULL,
    parent_id  TEXT,
    sort_order INTEGER NOT NULL,
    level      INTEGER NOT NULL,
    title      TEXT NOT NULL,
    body_json  TEXT NOT NULL,
    PRIMARY KEY (work_id, section_id)
);
CREATE INDEX idx_book_sections_tree ON book_sections(work_id, parent_id, sort_order);

CREATE TABLE xrefs (
    osis_code  TEXT NOT NULL,
    chapter    INTEGER NOT NULL,
    verse      INTEGER NOT NULL,
    target_ref TEXT NOT NULL,
    votes      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_xrefs_ref ON xrefs(osis_code, chapter, verse);

-- M8 Strong's lexical data (plan/search_workspace.md §10.3). verse_tokens holds one row per
-- surface span per ordinal: position is the 0-based span index in document order, ordinal the
-- Nth Strong's number within that span (a span can carry several, e.g. 'created' ->
-- H0853/H1254). Untagged spans (plain text, KJV transChange additions) get exactly one row
-- with ordinal=0 and strong_id NULL, so a verse can be rendered from verse_tokens alone.
-- strong_id/morphology are NULLable for those spans; ids are normalized H/G + 4 digits.
CREATE TABLE verse_tokens (
    work_id      TEXT NOT NULL REFERENCES works(id),
    osis_code    TEXT NOT NULL,
    chapter      INTEGER NOT NULL,
    verse        INTEGER NOT NULL,
    position     INTEGER NOT NULL,
    ordinal      INTEGER NOT NULL,
    surface      TEXT NOT NULL,
    normalized   TEXT NOT NULL,
    strong_id    TEXT,
    morph_scheme TEXT,              -- 'strongMorph' (OT) | 'robinson' (NT) | NULL
    morph_code   TEXT,
    PRIMARY KEY (work_id, osis_code, chapter, verse, position, ordinal)
);
CREATE INDEX idx_verse_tokens_strong
    ON verse_tokens(strong_id, work_id, osis_code, chapter, verse);

CREATE TABLE strong_lexicon (
    strong_id              TEXT PRIMARY KEY,
    language               TEXT NOT NULL,  -- 'grc' | 'hbo'
    lemma                  TEXT NOT NULL,
    transliteration        TEXT,
    pronunciation          TEXT,
    definition_json        TEXT NOT NULL,
    lemma_search           TEXT NOT NULL,  -- case/diacritic-folded; M8.4 structured search
    transliteration_search TEXT,
    definition_search      TEXT NOT NULL
);

-- Full-text search (contentless FTS5 mirroring plain_text / body). UNINDEXED columns carry the
-- locator (for navigation) plus numeric sort keys so the search API can order canonically/by source
-- and paginate deterministically; CAST numeric UNINDEXED columns to INTEGER in ORDER BY (FTS5 stores
-- every column as text). osis/testament/book_order enable book and testament filters without an
-- API-side canon map. dictionary_fts.headword_text and book_fts.title_text are *indexed* extra
-- columns so a headword/title-only term matches and bm25() can weight it above body text.
CREATE VIRTUAL TABLE bible_fts USING fts5(
    text, work_id UNINDEXED, ref UNINDEXED, osis UNINDEXED, testament UNINDEXED,
    book_order UNINDEXED, chapter UNINDEXED, verse UNINDEXED,
    tokenize = 'unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE commentary_fts USING fts5(
    text, work_id UNINDEXED, entry_id UNINDEXED, osis UNINDEXED, testament UNINDEXED,
    book_order UNINDEXED, chapter UNINDEXED, verse_start UNINDEXED,
    tokenize = 'unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE dictionary_fts USING fts5(
    text, headword_text, work_id UNINDEXED, headword UNINDEXED, sort_key UNINDEXED,
    tokenize = 'unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE book_fts USING fts5(
    text, title_text, work_id UNINDEXED, section_id UNINDEXED, sort_order UNINDEXED,
    tokenize = 'unicode61 remove_diacritics 2'
);
"""


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_SQL)
    conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
