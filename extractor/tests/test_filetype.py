import zipfile
from pathlib import Path

import pytest

from app.pipeline.errors import (
    CorruptFileError,
    EncryptedFileError,
    MacroEnabledError,
    UnsupportedFileError,
)
from app.pipeline.filetype import Kind, sniff, validate_pptx

FIXTURES = Path(__file__).parent / "fixtures"


def test_sniff_by_magic_bytes() -> None:
    assert sniff(b"%PDF-1.7\n") is Kind.PDF
    assert sniff(b"PK\x03\x04rest") is Kind.PPTX
    with pytest.raises(UnsupportedFileError):
        sniff(b"This is plain text")
    with pytest.raises(EncryptedFileError):
        sniff(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")


def test_validate_pptx_accepts_real_presentation() -> None:
    validate_pptx(FIXTURES / "lecture.pptx")


def test_validate_pptx_rejects_macro_enabled() -> None:
    with pytest.raises(MacroEnabledError):
        validate_pptx(FIXTURES / "macro.pptm")


def test_validate_pptx_rejects_other_zip(tmp_path: Path) -> None:

    p = tmp_path / "x.pptx"
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("[Content_Types].xml", "<Types/>")
    with pytest.raises(UnsupportedFileError):
        validate_pptx(p)
    bad = tmp_path / "bad.pptx"
    bad.write_bytes(b"PK\x03\x04garbage")
    with pytest.raises(CorruptFileError):
        validate_pptx(bad)


def test_validate_pptx_rejects_zip_bomb(tmp_path: Path) -> None:

    p = tmp_path / "bomb.pptx"
    with zipfile.ZipFile(p, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", "<Types/>")
        zf.writestr("big.bin", b"\0" * (20 * 1024 * 1024))
    with pytest.raises(CorruptFileError):
        validate_pptx(p)
