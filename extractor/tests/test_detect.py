from app.pipeline.detect import (
    CONFIDENCE,
    OCR_PENALTY,
    Match,
    dedupe,
    detect_definitional_sentences,
    detect_document,
    detect_fill_blanks,
    detect_labeled_pairs,
    detect_multiple_choice,
    detect_numbered_questions,
    detect_section,
    detect_slide_title,
    detect_term_definitions,
    parse_answer_key,
    sort_by_confidence,
)
from app.pipeline.types import Card, CardType, Section


def fronts_backs(matches: list[Match]) -> list[tuple[str, str]]:
    return [(m.card.front, m.card.back) for m in matches]


# --- labeled pairs ---------------------------------------------------------


def test_labeled_pairs_q_a() -> None:
    lines = ["Q: What is 2 + 2?", "A: 4", "", "Question 3: Capital of Italy?", "Answer: Rome"]
    assert fronts_backs(detect_labeled_pairs(lines, "page 1")) == [
        ("What is 2 + 2?", "4"),
        ("Capital of Italy?", "Rome"),
    ]


def test_labeled_pairs_multiline_and_front_back() -> None:
    lines = ["Front: Mitochondria", "Back: produce ATP", "for the cell"]
    m = detect_labeled_pairs(lines, "slide 2")
    assert fronts_backs(m) == [("Mitochondria", "produce ATP for the cell")]
    assert m[0].card.source_ref == "slide 2"
    assert m[0].card.confidence == CONFIDENCE["labeled_pair"]


def test_labeled_pairs_requires_answer() -> None:
    assert detect_labeled_pairs(["Q: Lonely question?", "", "Unrelated text"], "p") == []


def test_question_word_prefix_is_not_a_label() -> None:
    assert detect_labeled_pairs(["Question-based learning works", "A: no"], "p") == []


# --- numbered / lettered questions ----------------------------------------


def test_numbered_question_answer_on_next_lines() -> None:
    lines = ["1. What is the symbol for gold?", "Au", "", "2) Name a noble gas?", "Neon"]
    assert fronts_backs(detect_numbered_questions(lines, "p")) == [
        ("What is the symbol for gold?", "Au"),
        ("Name a noble gas?", "Neon"),
    ]


def test_numbered_question_answer_on_same_line() -> None:
    m = detect_numbered_questions(["3. Why is the sky blue? Rayleigh scattering."], "p")
    assert fronts_backs(m) == [("Why is the sky blue?", "Rayleigh scattering.")]
    assert m[0].number == 3


def test_lettered_question() -> None:
    lines = ["a) What is the largest ocean?", "The Pacific", "b) What is the smallest?", "Arctic"]
    assert fronts_backs(detect_numbered_questions(lines, "p")) == [
        ("What is the largest ocean?", "The Pacific"),
        ("What is the smallest?", "Arctic"),
    ]


def test_numbered_item_without_question_mark_is_ignored() -> None:
    assert detect_numbered_questions(["1. Introduction", "Some text"], "p") == []


def test_numbered_question_without_answer_is_ignored() -> None:
    assert detect_numbered_questions(["1. What is love?", "", "2. Next?"], "p") == []


def test_answer_prefix_is_stripped() -> None:
    m = detect_numbered_questions(["1. What is H2O?", "Answer: water"], "p")
    assert fronts_backs(m) == [("What is H2O?", "water")]


# --- multiple choice ----------------------------------------------------------


MCQ = [
    "1. Which planet is red?",
    "A) Venus",
    "B) Mars",
    "C) Jupiter",
    "Answer: B",
]


def test_multiple_choice_inline_answer() -> None:
    (m,) = detect_multiple_choice(MCQ, "p")
    assert m.card.card_type is CardType.MULTIPLE_CHOICE
    assert m.card.front == "Which planet is red?"
    assert m.card.options == ["Venus", "Mars", "Jupiter"]
    assert m.card.back == "Mars"
    assert m.number == 1
    assert (m.start, m.end) == (0, 5)


def test_multiple_choice_answer_key() -> None:
    lines = ["7. Pick a prime", "(a) 4", "(b) 6", "(c) 7", "(d) 9"]
    (m,) = detect_multiple_choice(lines, "p", {7: "C"})
    assert m.card.back == "7"
    assert m.card.confidence == CONFIDENCE["multiple_choice"]


def test_multiple_choice_marked_option() -> None:
    lines = ["Best language?", "A. Python *", "B. COBOL"]
    (m,) = detect_multiple_choice(lines, "p")
    assert m.card.back == "Python"
    assert m.card.options == ["Python", "COBOL"]


def test_multiple_choice_without_answer_has_low_confidence() -> None:
    lines = ["Which is a mammal?", "A. Shark", "B. Whale"]
    (m,) = detect_multiple_choice(lines, "p")
    assert m.card.back == ""
    assert m.card.confidence == CONFIDENCE["multiple_choice_no_key"]


def test_lettered_questions_are_not_options() -> None:
    lines = ["Intro", "a) What is x?", "b) What is y?"]
    assert detect_multiple_choice(lines, "p") == []


def test_options_must_be_sequential() -> None:
    assert detect_multiple_choice(["Stem", "A) one", "C) three"], "p") == []


# --- fill in the blank --------------------------------------------------------


def test_fill_blank_trailing_parenthetical() -> None:
    (m,) = detect_fill_blanks(["The powerhouse of the cell is the ____. (mitochondria)"], "p")
    assert m.card.card_type is CardType.FILL_BLANK
    assert (m.card.front, m.card.back) == (
        "The powerhouse of the cell is the _____.",
        "mitochondria",
    )


def test_fill_blank_bracket_marker_and_next_line_answer() -> None:
    (m,) = detect_fill_blanks(["Water boils at [blank] degrees.", "Answer: 100"], "p")
    assert (m.card.front, m.card.back) == ("Water boils at _____ degrees.", "100")
    assert m.end == 2


def test_fill_blank_answer_key() -> None:
    (m,) = detect_fill_blanks(["4. H2O is ______."], "p", {4: "water"})
    assert m.card.back == "water"


def test_fill_blank_without_answer_kept_with_low_confidence() -> None:
    (m,) = detect_fill_blanks(["Plants need ____ to grow."], "p")
    assert m.card.back == ""
    assert m.card.confidence == CONFIDENCE["fill_blank_no_key"]


# --- term / definition -------------------------------------------------------


def test_term_definition_colon_and_dash() -> None:
    lines = [
        "Osmosis: movement of water across a membrane",
        "- Mitosis - division into two identical cells",
        "Allele – a variant form of a gene",
        "Speed = distance divided by time",
    ]
    assert fronts_backs(detect_term_definitions(lines, "p")) == [
        ("Osmosis", "movement of water across a membrane"),
        ("Mitosis", "division into two identical cells"),
        ("Allele", "a variant form of a gene"),
        ("Speed", "distance divided by time"),
    ]


def test_term_definition_rejects_noise() -> None:
    lines = [
        "Note: remember this",
        "Page: 4 of 9",
        "See https://example.org/page for more",
        "10:30 meeting starts",
        "Q: not a term",
        "Why: one",
        "The war ended in nineteen forty five - a turning point",
        "This is a very long term with too many words: definition here",
    ]
    assert detect_term_definitions(lines, "p") == []


# --- slide titles -------------------------------------------------------------


def test_slide_title_with_bullets() -> None:
    s = Section(
        ref="slide 2",
        title="Cell membrane",
        lines=["- Controls entry", "- Protects"],
        is_slide=True,
    )
    (m,) = detect_slide_title(s, set())
    assert m.card.front == "Cell membrane"
    assert m.card.back == "- Controls entry\n- Protects"
    assert m.card.confidence == CONFIDENCE["slide_title"]


def test_slide_title_question_uses_notes() -> None:
    s = Section(ref="slide 3", title="What is ATP?", notes=["Energy currency"], is_slide=True)
    (m,) = detect_slide_title(s, set())
    assert (m.card.front, m.card.back) == ("What is ATP?", "Energy currency")
    assert m.card.confidence == CONFIDENCE["slide_title_question"]


def test_slide_title_skips_generic_and_non_slides() -> None:
    assert (
        detect_slide_title(Section(ref="s", title="Agenda", lines=["- x"], is_slide=True), set())
        == []
    )
    assert detect_slide_title(Section(ref="p", title="Heading", lines=["x"]), set()) == []
    assert detect_slide_title(Section(ref="s", title="Empty", is_slide=True), set()) == []


# --- definitional sentences ---------------------------------------------------


def test_definitional_sentences() -> None:
    lines = [
        "Photosynthesis is the process by which plants make food.",
        "A gene refers to a sequence of DNA that codes for proteins.",
        "Entropy is defined as a measure of disorder in a system.",
        "It is a very important idea for the exam.",
        "Water is wet.",
    ]
    assert fronts_backs(detect_definitional_sentences(lines, "p")) == [
        ("Photosynthesis", "The process by which plants make food."),
        ("Gene", "A sequence of DNA that codes for proteins."),
        ("Entropy", "A measure of disorder in a system."),
    ]


# --- answer key, orchestration ------------------------------------------------


def test_parse_answer_key_formats() -> None:
    key, used = parse_answer_key(["Body", "Answer Key", "1. B 2. C", "3) a", "4. Paris"])
    assert key == {1: "B", 2: "C", 3: "A", 4: "Paris"}
    assert used == {1, 2, 3, 4}
    key, _ = parse_answer_key(["Answers: 1-B, 2-D"])
    assert key == {1: "B", 2: "D"}


def test_detect_section_priority_prevents_double_use() -> None:
    s = Section(ref="page 1", lines=[*MCQ, "", "Osmosis: movement of water across membranes"])
    cards = detect_section(s)
    assert [c.detector for c in cards] == ["multiple_choice", "term_definition"]


def test_detect_section_ocr_penalty() -> None:
    s = Section(ref="page 1", lines=["Q: a?", "A: b"], ocr=True)
    (card,) = detect_section(s)
    assert card.confidence == round(CONFIDENCE["labeled_pair"] * OCR_PENALTY, 3)


def test_detect_document_uses_answer_key_across_pages() -> None:
    pages = [
        Section(ref="page 1", lines=["2. Largest planet?", "A) Mars", "B) Jupiter"]),
        Section(ref="page 2", lines=["Answer key", "2. B"]),
    ]
    (card,) = detect_document(pages)
    assert card.back == "Jupiter"
    assert card.source_ref == "page 1"


def test_slide_title_only_when_body_has_no_cards() -> None:
    s = Section(ref="slide 1", title="Quiz", lines=["Q: one?", "A: two"], is_slide=True)
    assert [c.detector for c in detect_section(s)] == ["labeled_pair"]


def _card(front: str, conf: float) -> Card:
    return Card(front, "b", CardType.BASIC, conf, "p", "x")


def test_dedupe_keeps_best_and_sort_is_stable() -> None:
    cards = dedupe([_card("What?", 0.5), _card("what", 0.9), _card("Other", 0.5)])
    assert [(c.front, c.confidence) for c in cards] == [("what", 0.9), ("Other", 0.5)]
    ordered = sort_by_confidence([_card("a", 0.5), _card("b", 0.9), _card("c", 0.5)])
    assert [c.front for c in ordered] == ["b", "a", "c"]


def test_fields_are_clipped() -> None:
    (m,) = detect_labeled_pairs(["Q: " + "x" * 3000, "A: y"], "p")
    assert len(m.card.front) == 2000
