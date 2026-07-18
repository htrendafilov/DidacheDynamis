from pathlib import Path

from bibleimport.formats.sword_bible import load_sword_bible

FIXTURE = Path(__file__).parent / "fixtures" / "mini_kjv.imp"


def test_sword_bible_maps_refs_text_red_letter_and_headings():
    books, verses, headings = load_sword_bible(FIXTURE)
    assert {book.osis for book in books} == {"Gen", "John", "1John", "Rev"}
    assert {(verse.osis, verse.chapter, verse.verse) for verse in verses} == {
        ("Gen", 1, 1),
        ("John", 3, 16),
        ("1John", 1, 1),
        ("Rev", 1, 1),
    }
    genesis = next(verse for verse in verses if verse.osis == "Gen")
    john = next(verse for verse in verses if verse.osis == "John")
    assert "hidden note" not in genesis.plain_text
    assert genesis.cir["lines"][0]["para_start"] is True
    assert all(run.get("wj") for run in john.cir["lines"][0]["runs"])
    assert headings[0].text == "The Revelation"
