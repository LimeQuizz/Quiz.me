"""Pipeline entry point: file on disk -> sorted candidate cards."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .cleanup import clean_sections
from .detect import detect_document, sort_by_confidence
from .errors import UnsupportedFileError
from .filetype import Kind, sniff, validate_pptx
from .text_pdf import extract_pdf
from .text_pptx import extract_pptx
from .types import Card, Section


@dataclass
class PipelineResult:
    kind: Kind
    cards: list[Card]
    sections: int
    ocr_sections: int

    def to_dict(self) -> dict[str, object]:
        return {
            "kind": self.kind.value,
            "sections": self.sections,
            "ocr_sections": self.ocr_sections,
            "cards": [c.to_dict() for c in self.cards],
        }


@dataclass(frozen=True)
class PipelineOptions:
    max_pages: int = 300
    ocr_dpi: int = 200
    ocr_min_chars: int = 25
    ocr_language: str = "eng"


def extract_sections(path: Path, options: PipelineOptions) -> tuple[Kind, list[Section]]:
    with path.open("rb") as fh:
        kind = sniff(fh.read(8))
    if kind is Kind.PDF:
        sections = extract_pdf(
            path,
            max_pages=options.max_pages,
            ocr_dpi=options.ocr_dpi,
            ocr_min_chars=options.ocr_min_chars,
            ocr_language=options.ocr_language,
        )
    elif kind is Kind.PPTX:
        validate_pptx(path)
        sections = extract_pptx(
            path,
            max_pages=options.max_pages,
            ocr_min_chars=options.ocr_min_chars,
            ocr_language=options.ocr_language,
        )
    else:  # pragma: no cover - sniff() already raised
        raise UnsupportedFileError()
    return kind, sections


def run_pipeline(path: Path, options: PipelineOptions | None = None) -> PipelineResult:
    options = options or PipelineOptions()
    kind, raw_sections = extract_sections(path, options)
    sections = clean_sections(raw_sections)
    cards = sort_by_confidence(detect_document(sections))
    return PipelineResult(
        kind=kind,
        cards=cards,
        sections=len(sections),
        ocr_sections=sum(1 for s in sections if s.ocr),
    )
