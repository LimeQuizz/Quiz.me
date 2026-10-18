"""Stage 1 for PDF: per-page text with PyMuPDF, OCR fallback per page."""

from __future__ import annotations

from pathlib import Path

import pymupdf
from PIL import Image

from .errors import CorruptFileError, EncryptedFileError, TooManyPagesError
from .ocr import MAX_IMAGE_PIXELS, needs_ocr, ocr_image
from .types import Section


def _render(page: pymupdf.Page, dpi: int) -> Image.Image:
    rect = page.rect
    scale = dpi / 72
    pixels = rect.width * scale * rect.height * scale
    if pixels > MAX_IMAGE_PIXELS:
        scale *= (MAX_IMAGE_PIXELS / pixels) ** 0.5
    pix = page.get_pixmap(
        matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csGRAY, alpha=False
    )
    return Image.frombytes("L", (pix.width, pix.height), pix.samples)


def _image_area_ratio(page: pymupdf.Page) -> float:
    page_area = abs(page.rect) or 1.0
    covered = 0.0
    for info in page.get_image_info():
        bbox = pymupdf.Rect(info["bbox"]) & page.rect
        covered += abs(bbox)
    return min(covered / page_area, 1.0)


def extract_pdf(
    path: Path,
    *,
    max_pages: int,
    ocr_dpi: int,
    ocr_min_chars: int,
    ocr_language: str = "eng",
) -> list[Section]:
    try:
        doc = pymupdf.open(path, filetype="pdf")
    except (pymupdf.FileDataError, RuntimeError, ValueError) as exc:
        raise CorruptFileError() from exc
    with doc:
        if doc.needs_pass or doc.is_encrypted or (doc.metadata or {}).get("encryption"):
            raise EncryptedFileError()
        if doc.page_count > max_pages:
            raise TooManyPagesError(
                f"The file has {doc.page_count} pages; the limit is {max_pages}."
            )
        sections: list[Section] = []
        for index in range(doc.page_count):
            page = doc.load_page(index)
            text = page.get_text("text", sort=True)
            ocr = False
            if needs_ocr(text, ocr_min_chars):
                ocr_text = ocr_image(_render(page, ocr_dpi), ocr_language)
                if ocr_text.strip():
                    text, ocr = ocr_text, True
            sections.append(
                Section(
                    ref=f"page {index + 1}",
                    lines=text.splitlines(),
                    ocr=ocr,
                    image_area_ratio=_image_area_ratio(page),
                )
            )
        return sections
