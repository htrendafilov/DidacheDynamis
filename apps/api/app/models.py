"""Pydantic response models (mirror the CIR; drive the frontend's typed API client)."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field


class RunLemma(BaseModel):
    """One Strong's annotation on a verse run (plan/search_workspace.md §10.4).

    Named `lemma` — never `strong`/`strongs` — so it cannot be confused with the
    DocumentRun.strong (bold) typography flag. `s`/`m` are present only when the
    source tags morphology for this id.
    """

    id: str  # normalized Strong's id, e.g. "H1254"
    s: str | None = None  # morphology scheme: 'strongMorph' (OT) | 'robinson' (NT)
    m: str | None = None  # morphology code, e.g. "TH8804"


class Run(BaseModel):
    t: str
    wj: bool = False  # words of Jesus (red-letter)
    # Optional word-level lexical data (M8): present only for works whose source
    # carries Strong's annotations (today: KJV). The passage route serializes with
    # response_model_exclude_none so works without it stay byte-identical.
    lemma: list[RunLemma] | None = None


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
    ai_context_policy: str = "unknown"


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
    # NULL for a chapter introduction, which belongs to the chapter rather than to any verse.
    # Typed int made `int(r["verse_start"])` in the provider raise TypeError the moment
    # introductions were imported — a 500 on any query whose match fell inside one.
    #
    # Required-but-nullable, not defaulted: a default makes the field optional in the generated
    # OpenAPI schema, while apps/web/src/data/api.ts declares both as always present. The server
    # does always send them, so the schema should say so — the looser contract was an artefact
    # of the default, not a decision.
    verse_start: int | None
    is_chapter_introduction: bool
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


class StrongMorphology(BaseModel):
    scheme: str
    code: str


class StrongsEntryHit(BaseModel):
    kind: Literal["strongs_entry"] = "strongs_entry"
    work_id: str  # lexicon work (strongsgreek | strongshebrew)
    title: str
    snippet: str
    strong_id: str
    language: str | None
    lemma: str | None
    transliteration: str | None
    occurrence_count: int
    verse_count: int


class StrongsOccurrenceHit(BaseModel):
    kind: Literal["strongs_occurrence"] = "strongs_occurrence"
    work_id: str  # annotated Bible work
    title: str
    snippet: str
    strong_id: str
    osis: str
    chapter: int
    verse: int
    ref: str
    surfaces: list[str]
    occurrence_count: int
    morphology: list[StrongMorphology]


SearchHit = Annotated[
    BibleHit | CommentaryHit | DictionaryHit | BookHit | StrongsEntryHit | StrongsOccurrenceHit,
    Field(discriminator="kind"),
]


class SearchGroup(BaseModel):
    type: str  # content type: bible | commentary | dictionary | book | strongs
    total: int
    offset: int
    limit: int
    has_more: bool
    hits: list[SearchHit]


class SearchResponse(BaseModel):
    query: str
    refine: str | None = None
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


class StrongEntry(BaseModel):
    """One Strong's lexicon entry (M8.2). `work_id` identifies the lexicon work
    (strongsgreek | strongshebrew) so clients can cite its attribution from /works."""

    strong_id: str
    language: str  # 'grc' | 'hbo'
    work_id: str
    lemma: str
    transliteration: str | None
    pronunciation: str | None
    definition: str
    see: list[str]  # cross-referenced Strong's ids, normalized


class StrongSource(BaseModel):
    work_id: str


class StrongOccurrenceResponse(BaseModel):
    strong_id: str
    total: int  # verse rows
    occurrence_total: int
    offset: int
    limit: int
    has_more: bool
    available_works: list[str]
    hits: list[StrongsOccurrenceHit]


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
