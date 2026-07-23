def test_security_headers(client):
    h = client.get("/api/v1/meta").headers
    csp = h.get("Content-Security-Policy", "")
    assert "default-src 'self'" in csp
    assert "script-src 'self'" in csp
    assert "api.dropboxapi.com" in csp  # sync allowed
    assert h.get("X-Content-Type-Options") == "nosniff"


def test_api_allows_cross_origin_reads_but_not_the_spa(client):
    # The embed widget fetches the API cross-origin; public read-only data -> allow any origin.
    assert client.get("/api/v1/meta").headers.get("Access-Control-Allow-Origin") == "*"
    # HTML/SPA responses must not be made cross-origin readable.
    assert "Access-Control-Allow-Origin" not in client.get("/health").headers


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_health_allows_head(client):
    # uptime monitors default to HEAD; it must not 405
    assert client.head("/health").status_code == 200
    assert client.head("/ready").status_code == 200


def test_ready_has_content(client):
    r = client.get("/ready")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ready"
    assert body["content_version"]


def test_ready_503_when_no_content(client, monkeypatch):
    monkeypatch.setattr("app.routers.health.content_version", lambda: None)
    r = client.get("/ready")
    assert r.status_code == 503
    assert r.json()["status"] == "no-content"


def test_meta(client):
    body = client.get("/api/v1/meta").json()
    assert body["works"] == 5
    assert body["content_version"]


def test_works_lists_web_with_attribution(client):
    works = client.get("/api/v1/works").json()
    assert len(works) == 5
    w = next(work for work in works if work["id"] == "web")
    assert w["id"] == "web" and w["type"] == "bible"
    assert w["license"] == "Public Domain"
    assert "public domain" in w["attribution"].lower()
    assert w["source_url"] == "https://ebible.org/"
    assert w["source_version"] == "test fixture"

    commentary = next(work for work in works if work["id"] == "mhc")
    dictionary = next(work for work in works if work["id"] == "easton")
    assert commentary["license"] == "Public Domain"
    assert dictionary["license"] == "Public Domain"
    assert commentary["source_url"]
    assert dictionary["source_url"]


def test_general_books_list_and_tree(client):
    books = client.get("/api/v1/books").json()
    assert [(book["id"], book["type"]) for book in books] == [("baptist1689", "book")]
    assert books[0]["license"] == "Public Domain"

    response = client.get("/api/v1/book/baptist1689")
    assert response.status_code == 200
    book = response.json()
    assert book["work_id"] == "baptist1689"
    chapter_one = book["sections"][0]
    assert chapter_one["section_id"] == "chapter-1-scripture"
    assert [child["section_id"] for child in chapter_one["children"]] == [
        "chapter-1-scripture.1",
        "chapter-1-scripture.2",
    ]
    assert "Holy Scripture" in chapter_one["children"][0]["body"]["blocks"][1]["text"]


def test_general_book_unknown_work_404(client):
    assert client.get("/api/v1/book/nope").status_code == 404


def test_books(client):
    books = client.get("/api/v1/works/web/books").json()
    codes = {b["osis"] for b in books}
    assert codes == {"Ps", "John"}
    john = next(b for b in books if b["osis"] == "John")
    assert john["chapter_count"] == 3


def test_books_unknown_work_404(client):
    assert client.get("/api/v1/works/nope/books").status_code == 404


def test_passage_returns_red_letter(client):
    p = client.get("/api/v1/works/web/passage/John/3").json()
    assert p["osis"] == "John" and p["chapter"] == 3
    v16 = next(v for v in p["verses"] if v["verse"] == 16)
    runs = [r for ln in v16["lines"] for r in ln["runs"]]
    assert any(r.get("wj") for r in runs)


def test_passage_poetry_and_heading(client):
    p = client.get("/api/v1/works/web/passage/Ps/23").json()
    v1 = next(v for v in p["verses"] if v["verse"] == 1)
    assert [ln["kind"] for ln in v1["lines"]] == ["q", "q"]
    assert any(h["kind"] == "title" for h in p["headings"])


def test_passage_404(client):
    assert client.get("/api/v1/works/web/passage/John/99").status_code == 404


def test_passage_verse_range(client):
    full = client.get("/api/v1/works/web/passage/John/3").json()
    assert {v["verse"] for v in full["verses"]} == {16}
    one = client.get("/api/v1/works/web/passage/John/3", params={"verses": "16"}).json()
    assert [v["verse"] for v in one["verses"]] == [16]
    # A range that selects no existing verse is a 404, not an empty 200.
    assert client.get(
        "/api/v1/works/web/passage/John/3", params={"verses": "20-30"}
    ).status_code == 404


def test_passage_verse_range_rejects_bad_input(client):
    for bad in ("0", "abc", "5-1", "-3"):
        r = client.get("/api/v1/works/web/passage/John/3", params={"verses": bad})
        assert r.status_code == 400, bad


def _group(res: dict, type_: str) -> dict:
    return next(g for g in res["groups"] if g["type"] == type_)


def _bible_group(res: dict) -> dict:
    return _group(res, "bible")


def test_search(client):
    res = client.get("/api/v1/search", params={"q": "shepherd"}).json()
    assert res["sort"] == "relevance"
    hit = next(h for h in _bible_group(res)["hits"] if h["ref"] == "Ps.23.1")
    assert hit["kind"] == "bible" and hit["title"] == "Ps 23:1"
    assert "<b>" in hit["snippet"]
    assert hit["osis"] == "Ps" and hit["chapter"] == 23 and hit["verse"] == 1


def test_search_all_content_types_are_grouped(client):
    res = client.get("/api/v1/search", params={"q": "the"}).json()
    assert {g["type"] for g in res["groups"]} == {"bible", "commentary", "dictionary", "book"}
    assert _bible_group(res)["total"] == 2  # Ps 23:1 + John 3:16


def test_search_work_filter(client):
    res = client.get(
        "/api/v1/search", params={"q": "loved", "works": "web", "types": "bible"}
    ).json()
    assert any(h["osis"] == "John" for h in _bible_group(res)["hits"])
    res2 = client.get(
        "/api/v1/search", params={"q": "loved", "works": "nonexistent", "types": "bible"}
    ).json()
    assert _bible_group(res2)["hits"] == [] and _bible_group(res2)["total"] == 0


def test_search_canonical_order_reaches_every_hit(client):
    # "the" matches both Psalm 23:1 and John 3:16; canonical order must put Psalms (book 19)
    # before John (book 43) — the fixture stand-in for "Genesis 1:1 is reachable for 'earth'".
    res = client.get(
        "/api/v1/search", params={"q": "the", "sort": "canonical", "types": "bible"}
    ).json()
    group = _bible_group(res)
    assert group["total"] == 2
    assert [h["ref"] for h in group["hits"]] == ["Ps.23.1", "John.3.16"]


def test_search_pagination_is_stable_and_complete(client):
    # Page size 1: each page yields one hit in canonical order, no duplicate or gap, has_more flips.
    common = {"q": "the", "sort": "canonical", "types": "bible", "limit": 1}
    page1 = _bible_group(client.get("/api/v1/search", params={**common, "offset": 0}).json())
    assert page1["total"] == 2 and page1["has_more"] is True
    assert [h["ref"] for h in page1["hits"]] == ["Ps.23.1"]
    page2 = _bible_group(client.get("/api/v1/search", params={**common, "offset": 1}).json())
    assert page2["has_more"] is False
    assert [h["ref"] for h in page2["hits"]] == ["John.3.16"]


def test_search_testament_and_book_filters(client):
    nt = _bible_group(
        client.get("/api/v1/search", params={"q": "the", "types": "bible", "canon": "nt"}).json()
    )
    assert [h["ref"] for h in nt["hits"]] == ["John.3.16"]  # no OT Psalms
    ot = _bible_group(
        client.get("/api/v1/search", params={"q": "the", "types": "bible", "canon": "ot"}).json()
    )
    assert [h["ref"] for h in ot["hits"]] == ["Ps.23.1"]
    only_john = _bible_group(
        client.get("/api/v1/search", params={"q": "the", "types": "bible", "books": "John"}).json()
    )
    assert [h["ref"] for h in only_john["hits"]] == ["John.3.16"]


def test_search_commentary(client):
    res = client.get("/api/v1/search", params={"q": "love", "types": "commentary"}).json()
    hit = _group(res, "commentary")["hits"][0]
    assert hit["kind"] == "commentary" and hit["work_id"] == "mhc"
    assert (hit["osis"], hit["chapter"], hit["verse_start"]) == ("John", 3, 16)
    assert hit["title"] == "John 3:16" and isinstance(hit["entry_id"], int)


def test_search_dictionary_matches_headword_and_body(client):
    # A headword-only term (not in the definition) and a body-only term both find the same entry.
    by_headword = client.get(
        "/api/v1/search", params={"q": "shepherd", "types": "dictionary"}
    ).json()
    by_body = client.get("/api/v1/search", params={"q": "flock", "types": "dictionary"}).json()
    for res in (by_headword, by_body):
        hit = _group(res, "dictionary")["hits"][0]
        assert hit["kind"] == "dictionary" and hit["headword"] == "Shepherd"


def test_search_book_type(client):
    res = client.get("/api/v1/search", params={"q": "sufficient", "types": "book"}).json()
    hit = _group(res, "book")["hits"][0]
    assert hit["kind"] == "book" and hit["section_id"] == "chapter-1-scripture.1"
    assert hit["title"] == "Chapter 1. Scripture › 1"  # breadcrumb


def test_search_rejects_unknown_type(client):
    assert client.get("/api/v1/search", params={"q": "x", "types": "bogus"}).status_code == 400


def test_cache_headers_and_304(client):
    r = client.get("/api/v1/works/web/passage/John/3")
    assert r.headers.get("Cache-Control", "").startswith("public")
    etag = r.headers.get("ETag")
    assert etag
    r2 = client.get("/api/v1/works/web/passage/John/3", headers={"If-None-Match": etag})
    assert r2.status_code == 304


def test_commentary_can_be_filtered_to_a_verse(client):
    body = client.get("/api/v1/commentary/mhc/John/3", params={"verse": 16}).json()
    assert body["entries"][0]["verse_start"] == 16
    text = " ".join(block["text"] for block in body["entries"][0]["body"]["blocks"])
    assert "love of God" in text
    assert "For God so loved" not in text


def test_dictionary_prefix_and_entry(client):
    words = client.get(
        "/api/v1/dictionary/easton/entries", params={"prefix": "shep"}
    ).json()
    assert words == [{"headword": "Shepherd"}]
    entry = client.get("/api/v1/dictionary/easton/entry/Shepherd").json()
    assert entry["body"]["blocks"][0]["text"] == "One who tends a flock."


def test_cross_references_include_normalized_target_and_preview(client):
    body = client.get("/api/v1/xref/John/3/16").json()
    rom = next(ref for ref in body["references"] if ref["target_ref"] == "Rom.5.8")
    assert rom["votes"] == 2
    assert rom["target_osis"] == "Rom"
    assert rom["preview"] is None  # the tiny fixture has no Romans text
