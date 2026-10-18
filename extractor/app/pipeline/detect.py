"""Stage 4: rule-based question detection.

Each ``detect_*`` function is pure: it takes cleaned lines (and a source
reference) and returns ``Match`` objects describing a card and the line span
it consumed. ``detect_section`` runs them in priority order so that a line is
used by at most one card; ``detect_document`` adds document-wide answer keys.

No LLM is involved. See docs/extraction.md for the interface a future model
based extractor would implement.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass

from .types import Card, CardType, Section

MAX_FIELD_CHARS = 2000
MAX_ANSWER_LINES = 6

# Confidence assigned per detector. OCR text is scaled down by OCR_PENALTY.
CONFIDENCE = {
    "labeled_pair": 0.95,
    "multiple_choice": 0.9,
    "multiple_choice_no_key": 0.55,
    "numbered_question": 0.85,
    "fill_blank": 0.8,
    "fill_blank_no_key": 0.45,
    "term_definition": 0.75,
    "slide_title_question": 0.8,
    "slide_title": 0.6,
    "definitional": 0.45,
}
OCR_PENALTY = 0.85


@dataclass(frozen=True)
class Match:
    card: Card
    start: int
    end: int  # exclusive
    number: int | None = None

    @property
    def span(self) -> range:
        return range(self.start, self.end)


# ---------------------------------------------------------------------------
# Shared patterns and helpers
# ---------------------------------------------------------------------------

_NUMBERED_RE = re.compile(r"^\s*(?:Q\s*)?\(?(?P<num>\d{1,3})\s*[.)]\s+(?P<text>.+)$", re.I)
_LETTERED_RE = re.compile(r"^\s*\(?(?P<letter>[a-z])[.)]\s+(?P<text>.+)$")
_OPTION_RE = re.compile(r"^\s*(?:- )?\(?(?P<letter>[A-Ea-e])\s*[.):]\s+(?P<text>.+)$")
_Q_LABEL_RE = re.compile(
    r"^\s*(?:Q|Ques|Question|Front|Term)\s*(?P<num>\d{1,3})?\s*(?:[:.)]|\s-\s)\s*(?P<text>.*)$",
    re.I,
)
_A_LABEL_RE = re.compile(
    r"^\s*(?:A|Ans|Answer|Back|Definition)\s*\d{0,3}\s*(?:[:.)]|\s-\s)\s*(?P<text>.*)$", re.I
)
_ANSWER_LETTER_RE = re.compile(
    r"^\s*(?:correct\s+)?(?:answer|ans|key|solution)\s*[:.\-]?\s*\(?(?P<letter>[A-Ea-e])\)?"
    r"(?:\s*[.)]|\s|$)",
    re.I,
)
_INLINE_ANSWER_RE = re.compile(
    r"^\s*(?:correct\s+)?(?:answer|ans|a)\s*[:.\-]\s*(?P<text>.+)$", re.I
)
_CORRECT_MARK_RE = re.compile(r"\s*(?:\*|✓|✔|\(correct\)|\[correct\])\s*$", re.I)
_BLANK_RE = re.compile(r"_{3,}|\[\s*blank\s*\]", re.I)
_TRAILING_PAREN_RE = re.compile(r"\s*[\(\[](?P<ans>[^()\[\]]{1,80})[\)\]]\s*\.?\s*$")
_ANSWER_KEY_HEADER_RE = re.compile(
    r"^\s*(?:answer\s+key|answers|key|solutions)\s*:?\s*(?P<rest>.*)$", re.I
)
_KEY_ENTRY_LETTER_RE = re.compile(
    r"(?P<num>\d{1,3})\s*[.):\-]\s*\(?(?P<ans>[A-Ea-e])\)?(?![A-Za-z])"
)
_KEY_ENTRY_TEXT_RE = re.compile(r"^\s*(?P<num>\d{1,3})\s*[.):\-]\s*(?P<ans>.+?)\s*$")
_TERM_DEF_RE = re.compile(
    r"^(?:- )?(?P<term>[A-Za-z0-9][^:?]{0,79}?)\s*(?::|\s[-–—]\s|\s=\s)\s*(?P<def>\S.*)$"
)
_DEFINITIONAL_RE = re.compile(
    r"^(?:- )?(?P<term>[A-Z][\w'\-]*(?:\s+[\w'\-()]+){0,5}?)\s+"
    r"(?P<verb>is defined as|is called|are defined as|refers to|refer to|means"
    r"|is an?|is the|are an?|are the|are)\s+"
    r"(?P<rest>.+?)\s*$"
)

_TERM_STOPWORDS = {
    "a", "an", "ans", "answer", "author", "back", "date", "definition", "e.g", "eg", "email",
    "example", "examples", "figure", "fig", "front", "http", "https", "i.e", "ie", "key",
    "name", "note", "notes", "page", "q", "question", "slide", "source", "step", "table",
    "tel", "time", "title", "total", "url", "www", "warning", "tip", "hint", "important",
    "remember", "see", "chapter", "section", "unit", "lesson", "module", "week", "day",
}  # fmt: skip
_DEFINITIONAL_SUBJECT_STOPWORDS = {
    "it", "this", "that", "there", "here", "he", "she", "they", "these", "those", "we",
    "you", "i", "which", "what", "who", "where", "when", "why", "how", "one", "each",
    "all", "some", "most", "many", "the answer", "the result", "the following",
}  # fmt: skip
_GENERIC_SLIDE_TITLES = {
    "agenda", "summary", "overview", "introduction", "outline", "contents",
    "table of contents", "questions", "q&a", "thank you", "thanks", "references",
    "bibliography", "conclusion", "conclusions", "objectives", "learning objectives",
    "review", "recap", "any questions?", "questions?", "the end", "appendix",
}  # fmt: skip


def _clip(text: str) -> str:
    text = text.strip()
    return text if len(text) <= MAX_FIELD_CHARS else text[: MAX_FIELD_CHARS - 1] + "…"


def _strip_bullet(line: str) -> str:
    return line[2:].strip() if line.startswith("- ") else line.strip()


def _card(  # noqa: PLR0917
    front: str,
    back: str,
    detector: str,
    ref: str,
    card_type: CardType = CardType.BASIC,
    options: list[str] | None = None,
    confidence_key: str | None = None,
) -> Card:
    return Card(
        front=_clip(front),
        back=_clip(back),
        card_type=card_type,
        confidence=CONFIDENCE[confidence_key or detector],
        source_ref=ref,
        detector=detector,
        options=options,
    )


def _is_item_start(line: str) -> bool:
    return bool(
        _NUMBERED_RE.match(line) or _Q_LABEL_RE.match(line) or _ANSWER_KEY_HEADER_RE.match(line)
    )


def _collect_answer(lines: Sequence[str], start: int) -> tuple[list[str], int]:
    """Collect answer lines from ``start`` until a blank line or a new item."""
    out: list[str] = []
    i = start
    while i < len(lines) and len(out) < MAX_ANSWER_LINES:
        line = lines[i]
        if not line.strip() or _is_item_start(line):
            break
        if _LETTERED_RE.match(line) and line.rstrip().endswith("?"):
            break
        out.append(line)
        i += 1
    return out, i


def _join_answer(lines: Iterable[str]) -> str:
    parts = [_strip_bullet(line) for line in lines if line.strip()]
    if not parts:
        return ""
    first = _INLINE_ANSWER_RE.match(parts[0])
    if first:
        parts[0] = first.group("text").strip()
    if len(parts) == 1:
        return parts[0]
    if any(line.startswith("- ") for line in lines):
        return "\n".join(f"- {p}" for p in parts)
    return " ".join(parts)


def _letter_index(letter: str) -> int:
    return ord(letter.upper()) - ord("A")


# ---------------------------------------------------------------------------
# Answer keys
# ---------------------------------------------------------------------------


def parse_answer_key(lines: Sequence[str]) -> tuple[dict[int, str], set[int]]:
    """Find an "Answer key" block and return ``{question_number: answer}``.

    Handles ``1. B  2. C``, ``1-B, 2-C`` and one ``3. Paris`` entry per line.
    Returns the parsed key and the indices of the lines it consumed.
    """
    key: dict[int, str] = {}
    used: set[int] = set()
    i = 0
    while i < len(lines):
        header = _ANSWER_KEY_HEADER_RE.match(lines[i])
        if not header:
            i += 1
            continue
        block_start = i
        entries_found = 0
        rest = header.group("rest")
        candidates: list[tuple[int, str]] = [(i, rest)] if rest else []
        j = i + 1
        while j < len(lines) and lines[j].strip():
            candidates.append((j, lines[j]))
            j += 1
        for idx, text in candidates:
            letter_entries = list(_KEY_ENTRY_LETTER_RE.finditer(text))
            if len(letter_entries) > 1 or (
                letter_entries and letter_entries[0].end() >= len(text.rstrip(" .;,"))
            ):
                for m in letter_entries:
                    key[int(m.group("num"))] = m.group("ans").upper()
                    entries_found += 1
                used.add(idx)
                continue
            text_entry = _KEY_ENTRY_TEXT_RE.match(text)
            if text_entry:
                key[int(text_entry.group("num"))] = text_entry.group("ans")
                entries_found += 1
                used.add(idx)
        if entries_found:
            used.add(block_start)
        i = j
    return key, used


# ---------------------------------------------------------------------------
# Detectors
# ---------------------------------------------------------------------------


def detect_multiple_choice(
    lines: Sequence[str], ref: str, answer_key: dict[int, str] | None = None
) -> list[Match]:
    """Stem followed by two to five options lettered A, B, C... in order.

    The correct option comes from a following "Answer: B" line, an option
    marked with ``*`` or "(correct)", or the document answer key.
    """
    answer_key = answer_key or {}
    matches: list[Match] = []
    i = 0
    while i < len(lines):
        opt = _OPTION_RE.match(lines[i])
        if not opt or _letter_index(opt.group("letter")) != 0:
            i += 1
            continue
        # Collect a run of sequential options A, B, C...
        options: list[str] = []
        marked: int | None = None
        j = i
        while j < len(lines):
            m = _OPTION_RE.match(lines[j])
            if not m or _letter_index(m.group("letter")) != len(options):
                break
            text = m.group("text").strip()
            if _CORRECT_MARK_RE.search(text):
                marked = len(options)
                text = _CORRECT_MARK_RE.sub("", text).strip()
            options.append(text)
            j += 1
        if len(options) < 2 or sum(o.endswith("?") for o in options) > len(options) // 2:
            i += 1
            continue
        # Stem: up to three non-blank, non-option lines directly above.
        k = i
        stem_lines: list[str] = []
        while k > 0 and len(stem_lines) < 3:
            prev = lines[k - 1]
            if not prev.strip() or _OPTION_RE.match(prev) or _ANSWER_LETTER_RE.match(prev):
                break
            stem_lines.insert(0, prev)
            k -= 1
            if _NUMBERED_RE.match(prev) or _Q_LABEL_RE.match(prev):
                break
        if not stem_lines:
            i = j
            continue
        stem = " ".join(_strip_bullet(s) for s in stem_lines)
        number: int | None = None
        numbered = _NUMBERED_RE.match(stem) or _Q_LABEL_RE.match(stem)
        if numbered:
            if numbered.groupdict().get("num"):
                number = int(numbered.group("num"))
            stem = numbered.group("text").strip()
        end = j
        correct = marked
        if j < len(lines):
            ans = _ANSWER_LETTER_RE.match(lines[j])
            if ans:
                correct = _letter_index(ans.group("letter"))
                end = j + 1
        if correct is None and number is not None and number in answer_key:
            key_val = answer_key[number]
            if len(key_val) == 1 and key_val.upper() in "ABCDE":
                correct = _letter_index(key_val)
        if correct is not None and correct >= len(options):
            correct = None
        back = options[correct] if correct is not None else ""
        matches.append(
            Match(
                _card(
                    stem,
                    back,
                    "multiple_choice",
                    ref,
                    CardType.MULTIPLE_CHOICE,
                    options=options,
                    confidence_key=None if correct is not None else "multiple_choice_no_key",
                ),
                k,
                end,
                number,
            )
        )
        i = end
    return matches


def detect_labeled_pairs(lines: Sequence[str], ref: str) -> list[Match]:
    """``Q: ... / A: ...``, ``Question 1: ... / Answer: ...``, ``Front/Back``."""
    matches: list[Match] = []
    i = 0
    while i < len(lines):
        q = _Q_LABEL_RE.match(lines[i])
        if not q:
            i += 1
            continue
        question = [q.group("text").strip()] if q.group("text").strip() else []
        j = i + 1
        while j < len(lines) and lines[j].strip() and not _A_LABEL_RE.match(lines[j]):
            if _Q_LABEL_RE.match(lines[j]):
                break
            question.append(lines[j])
            j += 1
        while j < len(lines) and not lines[j].strip():
            j += 1
        if j >= len(lines) or not question:
            i += 1
            continue
        a = _A_LABEL_RE.match(lines[j])
        if not a:
            i += 1
            continue
        answer = [a.group("text").strip()] if a.group("text").strip() else []
        k = j + 1
        while (
            k < len(lines)
            and lines[k].strip()
            and not _Q_LABEL_RE.match(lines[k])
            and not _NUMBERED_RE.match(lines[k])
            and len(answer) < MAX_ANSWER_LINES
        ):
            answer.append(lines[k])
            k += 1
        if answer:
            front = " ".join(_strip_bullet(x) for x in question)
            matches.append(Match(_card(front, _join_answer(answer), "labeled_pair", ref), i, k))
            i = k
        else:
            i += 1
    return matches


def detect_numbered_questions(lines: Sequence[str], ref: str) -> list[Match]:
    """``1. What is ...?`` or ``a) Why ...?`` followed by the answer.

    The answer is the rest of the line after ``?`` or the following lines up
    to a blank line or the next item.
    """
    matches: list[Match] = []
    i = 0
    while i < len(lines):
        m = _NUMBERED_RE.match(lines[i]) or _LETTERED_RE.match(lines[i])
        if not m or "?" not in m.group("text"):
            i += 1
            continue
        text = m.group("text").strip()
        qmark = text.rfind("?")
        question, tail = text[: qmark + 1].strip(), text[qmark + 1 :].strip()
        number = int(m.group("num")) if "num" in m.groupdict() and m.group("num") else None
        if tail:
            answer = _join_answer([tail])
            end = i + 1
        else:
            answer_lines, end = _collect_answer(lines, i + 1)
            answer = _join_answer(answer_lines)
        if answer:
            matches.append(Match(_card(question, answer, "numbered_question", ref), i, end, number))
            i = end
        else:
            i += 1
    return matches


def detect_fill_blanks(
    lines: Sequence[str], ref: str, answer_key: dict[int, str] | None = None
) -> list[Match]:
    """Lines containing ``____`` or ``[blank]``.

    The answer comes from a trailing ``(answer)``, a following "Answer: x"
    line, or the answer key. Without one the card is kept with an empty back
    and low confidence so the user can fill it in on the review screen.
    """
    answer_key = answer_key or {}
    matches: list[Match] = []
    for i, line in enumerate(lines):
        if not _BLANK_RE.search(line):
            continue
        text = _strip_bullet(line)
        number: int | None = None
        numbered = _NUMBERED_RE.match(text)
        if numbered:
            number = int(numbered.group("num"))
            text = numbered.group("text").strip()
        answer = ""
        end = i + 1
        paren = _TRAILING_PAREN_RE.search(text)
        if paren and not _BLANK_RE.search(paren.group(0)):
            answer = paren.group("ans").strip()
            text = text[: paren.start()].rstrip()
        elif i + 1 < len(lines) and (inline := _INLINE_ANSWER_RE.match(lines[i + 1])):
            answer = inline.group("text").strip()
            end = i + 2
        elif number is not None and number in answer_key:
            answer = answer_key[number]
        front = _BLANK_RE.sub("_____", text)
        matches.append(
            Match(
                _card(
                    front,
                    answer,
                    "fill_blank",
                    ref,
                    CardType.FILL_BLANK,
                    confidence_key=None if answer else "fill_blank_no_key",
                ),
                i,
                end,
                number,
            )
        )
    return matches


def _valid_term(term: str) -> bool:
    words = term.split()
    if not 1 <= len(words) <= 6 or len(term) > 60:
        return False
    lowered = term.lower().rstrip(".")
    if lowered in _TERM_STOPWORDS or words[0].lower() in {"http", "https", "www"}:
        return False
    if term.isdigit() or re.fullmatch(r"[\d\s.:/-]+", term):
        return False
    return not term.endswith((".", ","))


def detect_term_definitions(lines: Sequence[str], ref: str) -> list[Match]:
    """``Term: definition``, ``Term - definition``, ``Term = definition``."""
    matches: list[Match] = []
    for i, line in enumerate(lines):
        if _Q_LABEL_RE.match(line) or _A_LABEL_RE.match(line) or "://" in line:
            continue
        m = _TERM_DEF_RE.match(line)
        if not m:
            continue
        term, definition = m.group("term").strip(), m.group("def").strip()
        if not _valid_term(term) or len(definition.split()) < 2:
            continue
        separator = line[m.end("term") : m.start("def")].strip()
        if separator != ":" and len(term.split()) > 4:
            continue
        matches.append(Match(_card(term, definition, "term_definition", ref), i, i + 1))
    return matches


def detect_slide_title(section: Section, used: set[int]) -> list[Match]:
    """PPTX: the slide title becomes the question, its bullets the answer.

    Falls back to speaker notes when the slide has a title but no body text.
    Generic titles such as "Agenda" or "Thank you" are skipped.
    """
    title = (section.title or "").strip()
    if not section.is_slide or not title or title.lower() in _GENERIC_SLIDE_TITLES:
        return []
    body_idx = [i for i, line in enumerate(section.lines) if line.strip() and i not in used]
    body = [section.lines[i] for i in body_idx]
    if body:
        back_lines = body[: MAX_ANSWER_LINES * 2]
        start, end = body_idx[0], body_idx[-1] + 1
    elif section.notes:
        back_lines = [n for n in section.notes if n.strip()][:MAX_ANSWER_LINES]
        start, end = 0, 0
    else:
        return []
    if any(line.startswith("- ") for line in back_lines) or len(back_lines) > 1:
        back = "\n".join(f"- {_strip_bullet(x)}" for x in back_lines)
    else:
        back = _strip_bullet(back_lines[0])
    key = "slide_title_question" if title.endswith("?") else "slide_title"
    return [Match(_card(title, back, "slide_title", section.ref, confidence_key=key), start, end)]


def _sentences(line: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!])\s+(?=[A-Z])", line) if s.strip()]


def detect_definitional_sentences(lines: Sequence[str], ref: str) -> list[Match]:
    """Fallback: "X is a ...", "X refers to ...", "X is defined as ...".

    Only applies to lines no other detector used. Lowest confidence.
    """
    matches: list[Match] = []
    for i, line in enumerate(lines):
        if not line.strip() or line.rstrip().endswith("?") or _BLANK_RE.search(line):
            continue
        for sentence in _sentences(_strip_bullet(line)):
            m = _DEFINITIONAL_RE.match(sentence)
            if not m:
                continue
            term = m.group("term").strip()
            if term.lower() in _DEFINITIONAL_SUBJECT_STOPWORDS or term.split()[0].lower() in (
                _DEFINITIONAL_SUBJECT_STOPWORDS
            ):
                continue
            if not _valid_term(term):
                continue
            verb, rest = m.group("verb"), m.group("rest").rstrip(".").strip()
            if len(rest.split()) < 3:
                continue
            if verb.startswith(("is a", "is an", "is the", "are a", "are an", "are the")):
                article = verb.split(" ", 1)[1]
                rest = f"{article} {rest}"
            back = rest[0].upper() + rest[1:]
            term = re.sub(r"^(?:a|an|the)\s+", "", term, flags=re.I)
            term = term[0].upper() + term[1:]
            matches.append(Match(_card(term, back + ".", "definitional", ref), i, i + 1))
            break
    return matches


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

LineDetector = Callable[[Sequence[str], str], list[Match]]


def _accept(matches: Iterable[Match], used: set[int], out: list[Match]) -> None:
    for match in matches:
        span = set(match.span)
        if span & used:
            continue
        used.update(span)
        out.append(match)


def detect_section(
    section: Section,
    answer_key: dict[int, str] | None = None,
    reserved: set[int] | None = None,
) -> list[Card]:
    """Run every detector over one cleaned section in priority order."""
    lines = section.lines
    used: set[int] = set(reserved or ())
    found: list[Match] = []
    key = answer_key or {}

    _accept(detect_multiple_choice(lines, section.ref, key), used, found)
    _accept(detect_labeled_pairs(lines, section.ref), used, found)
    _accept(detect_numbered_questions(lines, section.ref), used, found)
    _accept(detect_fill_blanks(lines, section.ref, key), used, found)
    _accept(detect_term_definitions(lines, section.ref), used, found)
    if section.is_slide and not found:
        _accept(detect_slide_title(section, used), used, found)
    free = [line if i not in used else "" for i, line in enumerate(lines)]
    _accept(detect_definitional_sentences(free, section.ref), used, found)

    found.sort(key=lambda m: m.start)
    cards = [m.card for m in found]
    if section.ocr:
        for card in cards:
            card.confidence = round(card.confidence * OCR_PENALTY, 3)
    return cards


def detect_document(sections: Sequence[Section]) -> list[Card]:
    """Detect cards across a whole document, honoring a shared answer key."""
    answer_key: dict[int, str] = {}
    reserved: dict[int, set[int]] = {}
    for idx, section in enumerate(sections):
        key, used = parse_answer_key(section.lines)
        answer_key.update(key)
        reserved[idx] = used
    cards: list[Card] = []
    for idx, section in enumerate(sections):
        cards.extend(detect_section(section, answer_key, reserved[idx]))
    return dedupe(cards)


def dedupe(cards: Iterable[Card]) -> list[Card]:
    """Drop exact duplicate fronts (case-insensitive), keeping the best card."""
    best: dict[str, Card] = {}
    order: list[str] = []
    for card in cards:
        k = re.sub(r"\W+", " ", card.front.lower()).strip()
        if not k:
            continue
        if k not in best:
            order.append(k)
            best[k] = card
        elif card.confidence > best[k].confidence:
            best[k] = card
    return [best[k] for k in order]


def sort_by_confidence(cards: Iterable[Card]) -> list[Card]:
    """Stable sort, highest confidence first; ties keep document order."""
    return sorted(cards, key=lambda c: -c.confidence)
