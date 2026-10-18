"""Stage 2: OCR quality gate.

Pages or slides with little or no text layer are rasterized and run through
Tesseract. Resolution and pixel counts are capped so a hostile file cannot
exhaust memory.
"""

from __future__ import annotations

import io
import re

import pytesseract
from PIL import Image

# Pillow refuses images above this many pixels (decompression bomb guard).
MAX_IMAGE_PIXELS = 40_000_000
MAX_OCR_SIDE = 5000
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS


def text_chars(text: str) -> int:
    """Count letters and digits, the signal for "has a usable text layer"."""
    return len(re.findall(r"[A-Za-z0-9]", text))


def needs_ocr(text: str, min_chars: int) -> bool:
    return text_chars(text) < min_chars


def ocr_image(image: Image.Image, language: str = "eng", timeout: float = 30) -> str:
    """Run Tesseract on a PIL image, downscaling anything larger than the cap."""
    if image.mode not in ("L", "RGB"):
        image = image.convert("RGB")
    if max(image.size) > MAX_OCR_SIDE:
        image.thumbnail((MAX_OCR_SIDE, MAX_OCR_SIDE))
    try:
        result = pytesseract.image_to_string(
            image, lang=language, config="--psm 3", timeout=timeout
        )
    except RuntimeError:  # pytesseract raises RuntimeError on its own timeout
        return ""
    return str(result)


def ocr_image_bytes(data: bytes, language: str = "eng", timeout: float = 30) -> str:
    try:
        with Image.open(io.BytesIO(data)) as img:
            img.load()
            return ocr_image(img, language, timeout)
    except (Image.DecompressionBombError, OSError, ValueError):
        return ""
