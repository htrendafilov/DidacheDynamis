"""SQLite schema for the read-only content database (see plan/backend/backend_design.md §2).

Bible tables + FTS are populated in M1. Commentary/dictionary/xref tables are created now
(stable, cheap) but populated later (M3), to avoid schema churn.
"""

from __future__ import annotations

import sqlite3

SCHEMA_SQL = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE works (
    id             TEXT PRIMARY KEY,      -- e.g. 'web'
    type           TEXT NOT NULL,         -- bible | commentary | dictionary | xref
    language       TEXT NOT NULL,         -- ISO code, e.g. 'en'
    title          TEXT NOT NULL,
    abbrev         TEXT NOT NULL,
    direction      TEXT NOT NULL DEFAULT 'ltr',
    versification  TEXT NOT NULL,         -- e.g. 'kjv'
    license        TEXT NOT NULL,
    attribution    TEXT NOT NULL,
    source_url     TEXT,
    source_version TEXT,
    checksum       TEXT NOT NULL          -- sha256 of the source artifact
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

-- Populated in M3 (kept here so the schema is stable):
CREATE TABLE commentary_entries (
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

CREATE TABLE xrefs (
    osis_code  TEXT NOT NULL,
    chapter    INTEGER NOT NULL,
    verse      INTEGER NOT NULL,
    target_ref TEXT NOT NULL,
    votes      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_xrefs_ref ON xrefs(osis_code, chapter, verse);

-- Full-text search (contentless FTS5 mirroring plain_text / body).
CREATE VIRTUAL TABLE bible_fts USING fts5(
    text, work_id UNINDEXED, ref UNINDEXED, tokenize = 'unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE commentary_fts USING fts5(
    text, work_id UNINDEXED, ref UNINDEXED, tokenize = 'unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE dictionary_fts USING fts5(
    text, work_id UNINDEXED, headword UNINDEXED, tokenize = 'unicode61 remove_diacritics 2'
);
"""


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_SQL)
