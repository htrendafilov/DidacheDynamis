def test_security_headers(client):
    h = client.get("/api/v1/meta").headers
    csp = h.get("Content-Security-Policy", "")
    assert "default-src 'self'" in csp
    assert "script-src 'self'" in csp
    assert "api.dropboxapi.com" in csp  # sync allowed
    assert h.get("X-Content-Type-Options") == "nosniff"


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


def test_search(client):
    res = client.get("/api/v1/search", params={"q": "shepherd"}).json()
    refs = {h["ref"] for h in res["hits"]}
    assert "Ps.23.1" in refs
    hit = next(h for h in res["hits"] if h["ref"] == "Ps.23.1")
    assert "<b>" in hit["snippet"]
    assert hit["osis"] == "Ps" and hit["chapter"] == 23 and hit["verse"] == 1


def test_search_work_filter(client):
    res = client.get("/api/v1/search", params={"q": "loved", "works": "web"}).json()
    assert any(h["osis"] == "John" for h in res["hits"])
    res2 = client.get("/api/v1/search", params={"q": "loved", "works": "nonexistent"}).json()
    assert res2["hits"] == []


def test_search_books(client):
    res = client.get("/api/v1/search/books", params={"q": "sufficient"}).json()
    assert res["hits"], res
    hit = res["hits"][0]
    assert hit["work_id"] == "baptist1689"
    assert hit["section_id"] == "chapter-1-scripture.1"
    assert hit["title"] == "Chapter 1. Scripture › 1"  # breadcrumb, not the bare leaf key
    assert "<b>" in hit["snippet"]


def test_search_books_work_filter(client):
    res = client.get(
        "/api/v1/search/books", params={"q": "counsel", "works": "nonexistent"}
    ).json()
    assert res["hits"] == []
    res2 = client.get(
        "/api/v1/search/books", params={"q": "counsel", "works": "baptist1689"}
    ).json()
    assert any(h["section_id"] == "chapter-1-scripture.2" for h in res2["hits"])


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
