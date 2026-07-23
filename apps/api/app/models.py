"""Pydantic response models (mirror the CIR; drive the frontend's typed API client)."""

from __future__ import annotations

from pydantic import BaseModel


class Run(BaseModel):
    t: str
    wj: bool = False  # words of Jesus (red-letter)


class Line(BaseModel):
    kind: str  # 'p' | 'q'
    level: int
    para_start: bool
    runs: list[Run]


class Verse(BaseModel):
    verse: int
    lines: list[Line]


class Heading(BaseModel):
    before_verse: int
    kind: str  # 'section' | 'title'
    text: str


class Passage(BaseModel):
    work_id: str
    osis: str
    chapter: int
    verses: list[Verse]
    headings: list[Heading]


class Work(BaseModel):
    id: str
    type: str
    language: str
    title: str
    abbrev: str
    direction: str
    versification: str
    license: str
    attribution: str
    source_url: str | None = None
    source_version: str | None = None


class Book(BaseModel):
    osis: str
    name: str
    order: int
    chapter_count: int


# Unified search envelope (M7.1: Bible only). Each hit is a discriminated union on `kind` with the
# common fields kind/work_id/title/snippet; kind-specific locator fields follow. New content types
# (commentary, dictionary, book, strongs) are added as new hit models + groups in M7.2 without
# changing the Bible hit JSON, so the client contract does not migrate twice.
class SearchHit(BaseModel):
    kind: str = "bible"
    work_id: str
    title: str  # display label, e.g. "John 3:16" (client may re-localize the book name)
    snippet: str
    osis: str
    chapter: int
    verse: int
    ref: str


class SearchGroup(BaseModel):
    type: str  # content type, e.g. "bible"
    total: int
    offset: int
    limit: int
    has_more: bool
    hits: list[SearchHit]


class SearchResponse(BaseModel):
    query: str
    sort: str  # "relevance" | "canonical"
    total: int
    groups: list[SearchGroup]


class BookSearchHit(BaseModel):
    work_id: str
    section_id: str
    title: str
    snippet: str


class BookSearchResult(BaseModel):
    query: str
    limit: int
    offset: int
    hits: list[BookSearchHit]


class Meta(BaseModel):
    content_version: str | None
    works: int


class DocumentRun(BaseModel):
    t: str
    emphasis: bool = False
    strong: bool = False
    superscript: bool = False
    ref: str | None = None  # canonical scripture target (e.g. "John.3.16" or "John.3.1-19")


class DocumentBlock(BaseModel):
    kind: str  # 'heading' | 'paragraph' | 'quotation'
    text: str
    runs: list[DocumentRun] | None = None


class Document(BaseModel):
    blocks: list[DocumentBlock]


class CommentaryEntry(BaseModel):
    verse_start: int | None
    verse_end: int | None
    body: Document


class CommentaryPassage(BaseModel):
    work_id: str
    osis: str
    chapter: int
    entries: list[CommentaryEntry]


class DictionaryHeadword(BaseModel):
    headword: str


class DictionaryEntry(BaseModel):
    work_id: str
    headword: str
    body: Document


class GeneralBookSection(BaseModel):
    section_id: str
    title: str
    level: int
    body: Document
    children: list[GeneralBookSection]


class GeneralBook(BaseModel):
    work_id: str
    sections: list[GeneralBookSection]


class CrossReference(BaseModel):
    target_ref: str
    target_osis: str
    target_chapter: int
    target_verse: int
    votes: int
    preview: str | None


class CrossReferences(BaseModel):
    osis: str
    chapter: int
    verse: int
    source_work_id: str
    references: list[CrossReference]
