import sqlite3
from pathlib import Path

import pytest

from bibleimport.pipeline import (
    AlignmentExpectation,
    BibleSpec,
    LexicalSentinel,
    append_bible,
    append_strongs,
    build_bible,
    source_sha256,
)
from bibleimport.schema import SCHEMA_VERSION

FIXTURE = Path(__file__).parent / "fixtures" / "mini_usfx.xml"
FIXTURES = Path(__file__).parent / "fixtures"

SPEC = BibleSpec(
    work_id="test",
    title="Test Bible",
    abbrev="TB",
    language="en",
    versification="kjv",
    license="Public Domain",
    attribution="test attribution",
    ai_context_policy="allowed",
)


def build(tmp_path) -> Path:
    out = tmp_path / "content.sqlite"
    diag = build_bible(FIXTURE, SPEC, out, fmt="usfx")
    assert diag.ok, diag.errors
    return out


def test_build_writes_work_and_verses(tmp_path):
    db = build(tmp_path)
    c = sqlite3.connect(db)
    work = c.execute("SELECT id,type,title,license,attribution,checksum FROM works").fetchone()
    assert work[0] == "test" and work[1] == "bible"
    assert work[5] and len(work[5]) == 64  # sha256 hex
    assert c.execute("SELECT count(*) FROM verses").fetchone()[0] == 2
    assert c.execute("SELECT count(*) FROM books").fetchone()[0] == 2
    assert c.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION


def test_build_writes_ai_context_policy(tmp_path):
    db = build(tmp_path)
    c = sqlite3.connect(db)
    rows = c.execute("SELECT ai_context_policy FROM works").fetchall()
    assert rows and all(row[0] in ("allowed", "prohibited", "unknown") for row in rows)


def test_ai_context_policy_rejects_invalid_values(tmp_path):
    db = build(tmp_path)
    c = sqlite3.connect(db)
    with pytest.raises(sqlite3.IntegrityError):
        c.execute(
            "INSERT INTO works(id,type,language,title,abbrev,direction,versification,"
            "license,attribution,checksum,ai_context_policy) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            ("bad", "bible", "en", "Bad", "B", "ltr", "kjv", "t", "t", "0" * 64, "maybe"),
        )


def test_build_populates_fts(tmp_path):
    db = build(tmp_path)
    c = sqlite3.connect(db)
    rows = c.execute("SELECT ref FROM bible_fts WHERE bible_fts MATCH 'shepherd'").fetchall()
    assert ("Ps.23.1",) in rows


def test_headings_written(tmp_path):
    db = build(tmp_path)
    c = sqlite3.connect(db)
    row = c.execute("SELECT kind,text FROM headings WHERE osis_code='Ps' AND chapter=23").fetchone()
    assert row == ("title", "A Psalm by David.")


def test_build_is_deterministic(tmp_path):
    db1 = build(tmp_path / "a")
    db2 = build(tmp_path / "b")
    c1 = sqlite3.connect(db1)
    c2 = sqlite3.connect(db2)
    v1 = c1.execute("SELECT nodes_json FROM verses ORDER BY osis_code,chapter,verse").fetchall()
    v2 = c2.execute("SELECT nodes_json FROM verses ORDER BY osis_code,chapter,verse").fetchall()
    assert v1 == v2


def test_append_bible_adds_a_second_read_only_work(tmp_path):
    db = build(tmp_path)
    kjv_source = Path(__file__).parent / "fixtures" / "mini_kjv.imp"
    kjv_spec = BibleSpec(
        work_id="kjv",
        title="King James Version",
        abbrev="KJV",
        language="en",
        versification="kjv",
        license="GPL",
        attribution="CrossWire KJV test fixture",
        ai_context_policy="allowed",
        expected_alignment=AlignmentExpectation(
            base_work_id="test",
            base_checksum=source_sha256(FIXTURE),
            source_checksum=source_sha256(kjv_source),
            missing_in_other=frozenset({("Ps", 23, 1)}),
            missing_in_base=frozenset({("Gen", 1, 1), ("1John", 1, 1), ("Rev", 1, 1)}),
        ),
    )
    diag = append_bible(kjv_source, kjv_spec, db)
    assert diag.ok
    assert diag.alignment
    assert diag.alignment["unexpected"] == {
        "missing_in_other": [],
        "missing_in_base": [],
    }
    assert any("expected versification" in warning for warning in diag.warnings)
    conn = sqlite3.connect(db)
    assert conn.execute("SELECT count(*) FROM works WHERE type='bible'").fetchone()[0] == 2
    text = conn.execute(
        "SELECT plain_text FROM verses WHERE work_id='kjv' AND osis_code='John'"
    ).fetchone()[0]
    assert text == "For God so loved the world."


def test_append_bible_with_exact_alignment_needs_no_allow_list(tmp_path):
    db = build(tmp_path)
    source = tmp_path / "matching.imp"
    source.write_text(
        "$$$Psalms 23:1\nThe LORD is my shepherd.\n$$$John 3:16\nFor God so loved the world.\n",
        encoding="utf-8",
    )
    diag = append_bible(
        source,
        BibleSpec(
            work_id="matching",
            title="Matching Bible",
            abbrev="MB",
            language="en",
            versification="kjv",
            license="test",
            attribution="test",
            ai_context_policy="allowed",
        ),
        db,
    )
    assert diag.ok
    assert diag.alignment
    assert diag.alignment["actual"] == {
        "missing_in_other": [],
        "missing_in_base": [],
    }


def test_unexpected_alignment_blocks_append_without_changing_database(tmp_path):
    db = build(tmp_path)
    before = (
        sqlite3.connect(db).execute("SELECT id,type,checksum FROM works ORDER BY id").fetchall()
    )
    diag = append_bible(
        Path(__file__).parent / "fixtures" / "mini_kjv.imp",
        BibleSpec(
            work_id="blocked",
            title="Blocked Bible",
            abbrev="BB",
            language="en",
            versification="kjv",
            license="test",
            attribution="test",
            ai_context_policy="allowed",
        ),
        db,
    )

    assert not diag.ok
    assert any("unexpected versification" in error for error in diag.errors)
    after_conn = sqlite3.connect(db)
    assert after_conn.execute("SELECT id,type,checksum FROM works ORDER BY id").fetchall() == before
    assert (
        after_conn.execute("SELECT count(*) FROM verses WHERE work_id='blocked'").fetchone()[0] == 0
    )


def test_lexical_sentinel_blocks_an_untagged_bible(tmp_path):
    db = build(tmp_path)
    diag = append_bible(
        FIXTURES / "mini_kjv.imp",
        BibleSpec(
            work_id="untagged",
            title="Untagged Bible",
            abbrev="UB",
            language="en",
            versification="kjv",
            license="test",
            attribution="test",
            ai_context_policy="allowed",
            lexical_sentinel=LexicalSentinel(
                osis="Gen",
                chapter=1,
                verse=1,
                tagged_spans=6,
                strong_ids=7,
            ),
        ),
        db,
    )

    assert not diag.ok
    assert diag.errors == [
        "lexical sentinel mismatch for Gen.1.1: expected 6 tagged spans/7 Strong's ids, found 0/0"
    ]
    conn = sqlite3.connect(db)
    assert conn.execute("SELECT count(*) FROM works WHERE id='untagged'").fetchone()[0] == 0


def _append_kjv_strongs(db: Path):
    source = FIXTURES / "mini_kjv_strongs.imp"
    spec = BibleSpec(
        work_id="kjv",
        title="King James Version",
        abbrev="KJV",
        language="en",
        versification="kjv",
        license="GPL",
        attribution="CrossWire KJV Strong's test fixture",
        ai_context_policy="allowed",
        expected_alignment=AlignmentExpectation(
            base_work_id="test",
            base_checksum=source_sha256(FIXTURE),
            source_checksum=source_sha256(source),
            missing_in_other=frozenset({("Ps", 23, 1)}),
            missing_in_base=frozenset({("Gen", 1, 1), ("Gen", 1, 2), ("John", 1, 1)}),
        ),
    )
    diag = append_bible(source, spec, db)
    assert diag.ok, diag.errors
    return diag


def test_append_bible_writes_verse_tokens(tmp_path):
    db = build(tmp_path)
    diag = _append_kjv_strongs(db)
    assert diag.stats["verse_tokens"] > 0
    assert diag.stats["strong_ids"] > 0
    assert diag.stats["multi_strong_spans"] > 0
    conn = sqlite3.connect(db)
    # The WEB work carries no lexical data.
    assert conn.execute("SELECT count(*) FROM verse_tokens WHERE work_id='test'").fetchone()[0] == 0
    rows = conn.execute(
        "SELECT position,ordinal,surface,strong_id,morph_scheme,morph_code "
        "FROM verse_tokens WHERE work_id='kjv' AND osis_code='Gen' AND chapter=1 AND verse=1 "
        "ORDER BY position,ordinal"
    ).fetchall()
    created = [row for row in rows if row[2] == "created"]
    assert [(row[1], row[3], row[4], row[5]) for row in created] == [
        (0, "H0853", None, None),
        (1, "H1254", None, None),
    ]
    assert created[0][0] == created[1][0]  # one span, two Strong's ids
    # Gen 1:2's italicised transChange word survives as an untagged span (the verse's
    # other 'was' is a tagged span and must not match).
    supplied = conn.execute(
        "SELECT surface,strong_id,ordinal FROM verse_tokens "
        "WHERE work_id='kjv' AND osis_code='Gen' AND chapter=1 AND verse=2 "
        "AND surface LIKE '%was%' AND strong_id IS NULL"
    ).fetchall()
    assert supplied == [(" was ", None, 0)]
    # John 1:1 'the Word' resolves G3588/G3056 with robinson morphology per ordinal.
    word = conn.execute(
        "SELECT position,ordinal,strong_id,morph_scheme,morph_code FROM verse_tokens "
        "WHERE work_id='kjv' AND osis_code='John' AND chapter=1 AND verse=1 "
        "AND surface='the Word' ORDER BY position,ordinal"
    ).fetchall()
    first_span = word[:2]
    assert first_span[0][0] == first_span[1][0]  # same span, two ids
    assert [(row[1], row[2], row[3], row[4]) for row in first_span] == [
        (0, "G3588", "robinson", "T-NSM"),
        (1, "G3056", "robinson", "N-NSM"),
    ]
    # The CIR of the same verse carries the normalized lemma list.
    nodes = conn.execute(
        "SELECT nodes_json FROM verses WHERE work_id='kjv' AND osis_code='Gen' "
        "AND chapter=1 AND verse=1"
    ).fetchone()[0]
    assert '"H7225"' in nodes and '"lemma"' in nodes


def test_append_strongs_writes_lexicon_and_works(tmp_path):
    db = build(tmp_path)
    stats, diags = append_strongs(
        db,
        greek_source=FIXTURES / "mini_strongs_greek.imp",
        hebrew_source=FIXTURES / "mini_strongs_hebrew.imp",
        expected_greek_entries=2,
        expected_greek_sequence_gaps=None,
        expected_greek_cjk_annotations=None,
        expected_greek_anomalies=None,
        expected_hebrew_entries=3,
        expected_hebrew_cleanups=0,
    )
    assert stats == {"strongs_greek_entries": 2, "strongs_hebrew_entries": 3}
    assert diags["greek"]["skipped_stubs"] == 1
    assert diags["hebrew"]["spurious_sequences_removed"] == 0
    conn = sqlite3.connect(db)
    works = conn.execute(
        "SELECT id,type,license FROM works WHERE type='lexicon' ORDER BY id"
    ).fetchall()
    assert works == [
        ("strongsgreek", "lexicon", "Public Domain"),
        ("strongshebrew", "lexicon", "Public Domain"),
    ]
    alpha = conn.execute(
        "SELECT language,lemma,transliteration,pronunciation,definition_json,"
        "lemma_search,transliteration_search,definition_search "
        "FROM strong_lexicon WHERE strong_id='G0001'"
    ).fetchone()
    assert alpha[:4] == ("grc", "ἄλφα", "a", "al'-fah")
    assert "G0427" in alpha[4]
    assert alpha[5:7] == ("αλφα", "a")
    assert "first letter of the alphabet" in alpha[7]
    ab = conn.execute(
        "SELECT language,lemma,transliteration FROM strong_lexicon WHERE strong_id='H0001'"
    ).fetchone()
    assert ab == ("hbo", "'ab", None)
    # Token ids join to lexicon entries on the normalized form (M8.1 exit criterion).
    resolved = conn.execute(
        "SELECT count(*) FROM verse_tokens t JOIN strong_lexicon l "
        "ON t.strong_id = l.strong_id WHERE t.work_id='kjv'"
    ).fetchone()[0]
    assert resolved == 0  # mini fixtures share no ids; the join shape is exercised below


def test_token_lexicon_join_on_normalized_ids(tmp_path):
    db = build(tmp_path)
    _append_kjv_strongs(db)
    conn = sqlite3.connect(db)
    conn.execute(
        "INSERT INTO strong_lexicon"
        "(strong_id,language,lemma,transliteration,pronunciation,definition_json,"
        "lemma_search,transliteration_search,definition_search) "
        "VALUES('H7225','hbo','re-shiyth',NULL,'ray-sheeth',"
        "'{\"text\": \"beginning\"}','re-shiyth',NULL,'beginning')"
    )
    joined = conn.execute(
        "SELECT t.surface,l.lemma FROM verse_tokens t JOIN strong_lexicon l "
        "ON t.strong_id=l.strong_id "
        "WHERE t.work_id='kjv' AND t.osis_code='Gen' AND t.chapter=1 AND t.verse=1"
    ).fetchall()
    assert joined == [("In the beginning", "re-shiyth")]
