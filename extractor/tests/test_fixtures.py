"""End-to-end pipeline tests over the generated sample files.

Each test asserts cards that visibly should come out of the fixture. See
scripts/make_fixtures.py for the exact fixture content.
"""

from pathlib import Path

import pytest

from app.pipeline.errors import EncryptedFileError, MacroEnabledError, UnsupportedFileError
from app.pipeline.run import PipelineResult, run_pipeline
from app.pipeline.types import CardType

FIXTURES = Path(__file__).parent / "fixtures"


def cards_by_front(result: PipelineResult) -> dict[str, tuple[str, str, str]]:
    return {c.front: (c.back, c.detector, c.source_ref) for c in result.cards}


@pytest.fixture(scope="module")
def worksheet() -> PipelineResult:
    return run_pipeline(FIXTURES / "qa_worksheet.pdf")


def test_worksheet_cards(worksheet: PipelineResult) -> None:
    got = cards_by_front(worksheet)
    assert got["What is the capital of France?"] == ("Paris", "labeled_pair", "page 1")
    assert got["Who wrote the play Hamlet?"] == ("William Shakespeare", "labeled_pair", "page 1")
    assert got["What is the chemical symbol for gold?"] == ("Au", "numbered_question", "page 1")
    assert got["Why do we have seasons on Earth?"][0] == (
        "Because the Earth's axis is tilted relative to its orbit around the Sun."
    )
    assert got["Which planet is known as the Red Planet?"][:2] == ("Mars", "multiple_choice")
    assert got["Which gas do plants absorb from the air?"][0] == "Carbon dioxide"
    assert got["What is the largest ocean on Earth?"][0] == "The Pacific Ocean"
    assert got["The powerhouse of the cell is the _____."][:2] == ("mitochondria", "fill_blank")
    assert got["Water is made of hydrogen and _____."][0] == "oxygen"
    assert len(worksheet.cards) == 9


def test_worksheet_strips_header_footer_and_answer_key(worksheet: PipelineResult) -> None:
    text = " ".join(c.front + " " + c.back for c in worksheet.cards)
    assert "General Science Review" not in text
    assert "Page 1 of 3" not in text
    assert "Answer Key" not in text


def test_worksheet_sorted_by_confidence(worksheet: PipelineResult) -> None:
    confidences = [c.confidence for c in worksheet.cards]
    assert confidences == sorted(confidences, reverse=True)
    mcq = next(c for c in worksheet.cards if c.card_type is CardType.MULTIPLE_CHOICE)
    assert mcq.options == ["Venus", "Mars", "Jupiter", "Saturn"]


def test_glossary_cards() -> None:
    got = cards_by_front(run_pipeline(FIXTURES / "glossary.pdf"))
    assert got["Osmosis"][:2] == (
        "the movement of water across a semipermeable membrane",
        "term_definition",
    )
    assert got["Mitosis"][0] == "cell division that produces two identical daughter cells"
    assert got["Enzyme"][0] == "a protein that speeds up a chemical reaction"
    assert got["Photosynthesis"][:2] == (
        "The process by which plants convert light energy into chemical energy.",
        "definitional",
    )
    assert got["Gene"][0] == "A sequence of DNA that codes for a protein."
    assert "It" not in got
    assert len(got) == 5


def test_lecture_pptx_cards() -> None:
    result = run_pipeline(FIXTURES / "lecture.pptx")
    got = cards_by_front(result)
    assert result.sections == 5
    assert got["Functions of the cell membrane"] == (
        "- Controls what enters and leaves the cell\n- Protects the cell from its surroundings",
        "slide_title",
        "slide 2",
    )
    assert got["What is ATP?"] == ("The main energy currency of the cell", "slide_title", "slide 3")
    assert got["Ribosome"][:2] == ("the site of protein synthesis", "term_definition")
    assert got["Nucleus"][0] == "the organelle that holds the genetic material"
    assert got["Which organelle contains chlorophyll?"][:2] == ("Chloroplast", "multiple_choice")
    assert "Agenda" not in got
    assert "Term" not in got
    assert len(got) == 5


def test_scanned_pdf_goes_through_ocr() -> None:
    result = run_pipeline(FIXTURES / "scanned.pdf")
    assert result.ocr_sections == 1
    got = cards_by_front(result)
    assert got["What is the speed of light?"][0] == "About 300,000 kilometers per second"
    assert got["Gravity"][0] == "the force that attracts objects toward each other"
    assert all(c.confidence < 0.95 for c in result.cards)


def test_image_only_slide_goes_through_ocr() -> None:
    result = run_pipeline(FIXTURES / "image_slides.pptx")
    assert result.ocr_sections == 1
    assert cards_by_front(result)["What is the largest planet?"][0] == "Jupiter"


@pytest.mark.parametrize(
    ("name", "error"),
    [
        ("encrypted.pdf", EncryptedFileError),
        ("macro.pptm", MacroEnabledError),
        ("fake.pdf", UnsupportedFileError),
    ],
)
def test_rejected_fixtures(name: str, error: type[Exception]) -> None:
    with pytest.raises(error):
        run_pipeline(FIXTURES / name)
