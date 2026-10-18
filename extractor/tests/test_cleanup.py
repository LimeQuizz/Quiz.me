from app.pipeline.cleanup import (
    clean_lines,
    clean_sections,
    collapse_blank_lines,
    dehyphenate,
    find_repeated_lines,
    is_page_number,
    join_wrapped_lines,
    normalize_bullet,
    normalize_text,
    strip_lines_with_signatures,
)
from app.pipeline.types import Section


def test_normalize_text_expands_ligatures_and_quotes() -> None:
    assert normalize_text("deﬁnition “quoted”") == 'definition "quoted"'


def test_normalize_text_drops_soft_hyphen_and_squeezes_spaces() -> None:
    assert normalize_text("  co­operate  now\t ") == "cooperate now"


def test_normalize_bullet_variants() -> None:
    for glyph in ["•", "▪", "◦", "*", "-", "–", "o", ""]:
        assert normalize_bullet(f"{glyph} Item") == "- Item"
    assert normalize_bullet("-5 degrees") == "-5 degrees"
    assert normalize_bullet("Ordinary line") == "Ordinary line"
    assert normalize_bullet("• ") == ""


def test_is_page_number() -> None:
    for line in ["3", "Page 3", "page 3 of 10", "- 12 -", "4/20", "(7)", "Slide 2"]:
        assert is_page_number(line), line
    for line in ["3 apples", "Chapter 3: Cells", "", "1. What?"]:
        assert not is_page_number(line), line


def test_dehyphenate_joins_split_words() -> None:
    assert dehyphenate(["the exam-", "ple shows"]) == ["the example shows"]
    assert dehyphenate(["well-", "Known"]) == ["well-", "Known"]
    assert dehyphenate(["a long hyph-", "en-", "ated word"]) == ["a long hyphenated word"]


def test_join_wrapped_lines() -> None:
    lines = ["Photosynthesis is the process by which", "plants make food.", "Next sentence"]
    assert join_wrapped_lines(lines) == [
        "Photosynthesis is the process by which plants make food.",
        "Next sentence",
    ]


def test_join_wrapped_lines_keeps_structure() -> None:
    lines = ["Question one has no period", "a) an option", "Ends with colon:", "lowercase"]
    assert join_wrapped_lines(lines) == lines
    assert join_wrapped_lines(["Ends here.", "lowercase start"]) == [
        "Ends here.",
        "lowercase start",
    ]


def test_collapse_blank_lines() -> None:
    assert collapse_blank_lines(["", "a", "", "", "b", ""]) == ["a", "", "b"]


def test_find_and_strip_repeated_headers_and_footers() -> None:
    pages = [
        ["ACME Biology 101", "Body text one", "more text", "Confidential - page 1"],
        ["ACME Biology 101", "Body text two", "Confidential - page 2"],
        ["ACME Biology 101", "Body text three", "Confidential - page 3"],
    ]
    sigs = find_repeated_lines(pages)
    assert "acme biology #" in sigs
    assert "confidential - page #" in sigs
    assert strip_lines_with_signatures(pages[0], sigs) == ["Body text one", "more text"]


def test_find_repeated_lines_needs_three_pages() -> None:
    assert find_repeated_lines([["Header", "x"], ["Header", "y"]]) == set()


def test_clean_lines_pipeline() -> None:
    raw = ["• Mito-", "chondria make energy", "", "", "12", "Next"]
    assert clean_lines(raw) == ["- Mitochondria make energy", "", "Next"]


def test_clean_sections_keeps_metadata() -> None:
    bodies = ["Alpha text", "Beta text", "Gamma text"]
    sections = [
        Section(ref=f"page {i}", lines=["Header", body, "Footer"])
        for i, body in enumerate(bodies, start=1)
    ]
    sections[0].ocr = True
    out = clean_sections(sections)
    assert [s.lines for s in out] == [["Alpha text"], ["Beta text"], ["Gamma text"]]
    assert out[0].ocr
    assert out[0].ref == "page 1"
