def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_ready_has_content(client):
    body = client.get("/ready").json()
    assert body["status"] == "ready"
    assert body["content_version"]


def test_meta(client):
    body = client.get("/api/v1/meta").json()
    assert body["works"] == 1
    assert body["content_version"]


def test_works_lists_web_with_attribution(client):
    works = client.get("/api/v1/works").json()
    assert len(works) == 1
    w = works[0]
    assert w["id"] == "web" and w["type"] == "bible"
    assert w["license"] == "Public Domain"
    assert "public domain" in w["attribution"].lower()


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


def test_cache_headers_and_304(client):
    r = client.get("/api/v1/works/web/passage/John/3")
    assert r.headers.get("Cache-Control", "").startswith("public")
    etag = r.headers.get("ETag")
    assert etag
    r2 = client.get("/api/v1/works/web/passage/John/3", headers={"If-None-Match": etag})
    assert r2.status_code == 304
