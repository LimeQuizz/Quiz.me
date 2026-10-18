"""Plain data types shared by every pipeline stage."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class CardType(StrEnum):
    BASIC = "basic"
    MULTIPLE_CHOICE = "multiple_choice"
    FILL_BLANK = "fill_blank"


@dataclass
class Section:
    """One page of a PDF or one slide of a PPTX.

    ``lines`` holds body text, one visual line per entry. For slides, ``title``
    and ``notes`` are kept apart so the slide-title detector can use them.
    """

    ref: str
    lines: list[str] = field(default_factory=list)
    title: str | None = None
    notes: list[str] = field(default_factory=list)
    ocr: bool = False
    is_slide: bool = False
    image_area_ratio: float = 0.0


@dataclass
class Card:
    front: str
    back: str
    card_type: CardType
    confidence: float
    source_ref: str
    detector: str
    options: list[str] | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "front": self.front,
            "back": self.back,
            "card_type": self.card_type.value,
            "options": self.options,
            "confidence": round(self.confidence, 3),
            "source_ref": self.source_ref,
            "detector": self.detector,
        }
