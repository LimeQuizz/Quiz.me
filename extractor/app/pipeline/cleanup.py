"""Stage 3: text cleanup.

Every function here is pure: lists of strings in, lists of strings out. Blank
strings are kept as paragraph separators because detectors use them to find
where an answer ends.
"""

from __future__ import annotations

import re
import unicodedata
from collections import Counter
from collections.abc import Sequence

from .types import Section

_LIGATURES = {
    "ﬀ": "ff",
    "ﬁ": "fi",
    "ﬂ": "fl",
    "ﬃ": "ffi",
    "ﬄ": "ffl",
}
_INVISIBLE = dict.fromkeys(map(ord, "­\u200b‌‍﻿"), None)

# Bullet glyphs seen in PDFs and slide decks, plus ASCII stand-ins.
_BULLET_RE = re.compile(r"^\s*(?:[•●○◦▪▫■□‣⁃∙·➢➔➜✓✔*–—-]|o(?=\s))\s+")
_PAGE_NUMBER_RE = re.compile(
    r"^\s*(?:(?:page|slide|p\.)\s*)?[-–—(]?\s*\d{1,4}\s*[-–—)]?"
    r"(?:\s*(?:of|/)\s*\d{1,4})?\s*$",
    re.IGNORECASE,
)
# Lines that start a new logical item and must never be glued onto the
# previous line by join_wrapped_lines.
_STRUCTURAL_RE = re.compile(
    r"^\s*(?:- |\(?\d{1,3}[.)]\s|\(?[A-Za-z][.)]\s|\([A-Za-z]\)\s"
    r"|(?:q|question|a|ans|answer|front|back|term|definition)\s*\d*\s*[:.)]\s?)",
    re.IGNORECASE,
)
_SENTENCE_END = (".", "?", "!", ":", ";")


def normalize_text(text: str) -> str:
    """NFKC-normalize, expand ligatures, drop invisible characters, squeeze spaces."""
    for lig, repl in _LIGATURES.items():
        text = text.replace(lig, repl)
    text = unicodedata.normalize("NFKC", text).translate(_INVISIBLE)
    text = text.replace(" ", " ").replace("\t", " ")
    text = text.replace("‘", "'").replace("’", "'")
    text = text.replace("“", '"').replace("”", '"')
    return re.sub(r" {2,}", " ", text).strip()


def normalize_bullet(line: str) -> str:
    """Rewrite any bullet glyph prefix as ``- ``."""
    m = _BULLET_RE.match(line)
    if not m:
        return line
    rest = line[m.end() :].strip()
    return f"- {rest}" if rest else ""


def is_page_number(line: str) -> bool:
    return bool(_PAGE_NUMBER_RE.match(line))


def is_structural(line: str) -> bool:
    return bool(_STRUCTURAL_RE.match(line))


def dehyphenate(lines: Sequence[str]) -> list[str]:
    """Join words split across lines with a trailing hyphen: ``exam-`` + ``ple``."""
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        while (
            i + 1 < len(lines) and re.search(r"[a-z]-$", line) and re.match(r"^[a-z]", lines[i + 1])
        ):
            nxt = lines[i + 1]
            line = line[:-1] + nxt
            i += 1
        out.append(line)
        i += 1
    return out


def join_wrapped_lines(lines: Sequence[str]) -> list[str]:
    """Join soft-wrapped lines back into one logical line.

    A line is a continuation when the previous line does not end a sentence
    and the next one starts with a lowercase letter and is not a list item.
    """
    out: list[str] = []
    for line in lines:
        if (
            out
            and out[-1]
            and line
            and not out[-1].endswith(_SENTENCE_END)
            and line[0].islower()
            and not is_structural(line)
        ):
            out[-1] = f"{out[-1]} {line}"
        else:
            out.append(line)
    return out


def collapse_blank_lines(lines: Sequence[str]) -> list[str]:
    out: list[str] = []
    for line in lines:
        if not line and (not out or not out[-1]):
            continue
        out.append(line)
    while out and not out[-1]:
        out.pop()
    return out


def _signature(line: str) -> str:
    return re.sub(r"\d+", "#", line.strip().lower())


def find_repeated_lines(
    pages: Sequence[Sequence[str]], edge: int = 3, min_ratio: float = 0.5
) -> set[str]:
    """Return signatures of lines repeated at the top or bottom of many pages.

    Digits are folded so "Chapter 2 - page 7" matches across pages. Needs at
    least three pages to say anything.
    """
    if len(pages) < 3:
        return set()
    counts: Counter[str] = Counter()
    for page in pages:
        content = [line for line in page if line.strip()]
        edges = content[:edge] + content[-edge:] if len(content) > edge * 2 else content
        counts.update({_signature(line) for line in edges})
    threshold = max(2, int(len(pages) * min_ratio + 0.999))
    return {sig for sig, n in counts.items() if n >= threshold and sig}


def strip_lines_with_signatures(
    lines: Sequence[str], signatures: set[str], edge: int = 3
) -> list[str]:
    """Drop lines matching ``signatures`` from the top or bottom ``edge`` lines."""
    if not signatures:
        return list(lines)
    content_idx = [i for i, line in enumerate(lines) if line.strip()]
    edge_idx = set(content_idx[:edge] + content_idx[-edge:])
    return [
        line
        for i, line in enumerate(lines)
        if not (i in edge_idx and _signature(line) in signatures)
    ]


def clean_lines(lines: Sequence[str]) -> list[str]:
    """Clean one page or slide body."""
    normalized = [normalize_text(line) for line in lines]
    no_numbers = [line for line in normalized if not is_page_number(line) or not line]
    bulleted = [normalize_bullet(line) for line in no_numbers]
    joined = join_wrapped_lines(dehyphenate(bulleted))
    return collapse_blank_lines(joined)


def clean_sections(sections: Sequence[Section]) -> list[Section]:
    """Strip repeated headers/footers across sections, then clean each one."""
    raw = [[normalize_text(line) for line in s.lines] for s in sections]
    repeated = find_repeated_lines(raw)
    cleaned: list[Section] = []
    for section, lines in zip(sections, raw, strict=True):
        body = clean_lines(strip_lines_with_signatures(lines, repeated))
        title = normalize_text(section.title) if section.title else None
        notes = clean_lines(section.notes)
        cleaned.append(
            Section(
                ref=section.ref,
                lines=body,
                title=title or None,
                notes=notes,
                ocr=section.ocr,
                is_slide=section.is_slide,
                image_area_ratio=section.image_area_ratio,
            )
        )
    return cleaned
