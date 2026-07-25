"""Pydantic response models (mirror the CIR; drive the frontend's typed API client)."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field


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


# Unified search envelope. Each hit is a discriminated union on `kind` with the common fields
# kind/work_id/title/snippet plus a kind-specific locator. The Bible hit JSON is unchanged from M7.1,
# so adding the other content types here is additive for the client.
class BibleHit(BaseModel):
    kind: Literal["bible"] = "bible"
    work_id: str
    title: str  # display label, e.g. "John 3:16" (client may re-localize the book name)
    snippet: str
    osis: str
    chapter: int
    verse: int
    ref: str


class CommentaryHit(BaseModel):
    kind: Literal["commentary"] = "commentary"
    work_id: str
    title: str
    snippet: str
    osis: str
    chapter: int
    verse_start: int
    entry_id: int


class DictionaryHit(BaseModel):
    kind: Literal["dictionary"] = "dictionary"
    work_id: str
    title: str  # headword
    snippet: str
    headword: str


class BookHit(BaseModel):
    kind: Literal["book"] = "book"
    work_id: str
    title: str  # section breadcrumb
    snippet: str
    section_id: str


SearchHit = Annotated[
    BibleHit | CommentaryHit | DictionaryHit | BookHit,
    Field(discriminator="kind"),
]


class SearchGroup(BaseModel):
    type: str  # content type: bible | commentary | dictionary | book
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


class Meta(BaseModel):
    content_version: str | None
    works: int


class DictionaryDocumentRef(BaseModel):
    work_id: str
    entry_key: str  # source module key (auditable; enables a future disambiguation lookup)
    headword: str  # resolved display headword the current entry API can load


class DocumentRun(BaseModel):
    t: str
    emphasis: bool = False
    strong: bool = False
    superscript: bool = False
    ref: str | None = None  # canonical scripture target (e.g. "John.3.16" or "John.3.1-19")
    # Internal dictionary target; mutually exclusive with ref (import-validated).
    dictionary_ref: DictionaryDocumentRef | None = None


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
