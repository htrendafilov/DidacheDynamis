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


class Book(BaseModel):
    osis: str
    name: str
    order: int
    chapter_count: int


class SearchHit(BaseModel):
    work_id: str
    ref: str
    osis: str
    chapter: int
    verse: int
    snippet: str


class SearchResult(BaseModel):
    query: str
    limit: int
    offset: int
    hits: list[SearchHit]


class Meta(BaseModel):
    content_version: str | None
    works: int
