"""File type validation by content, never by extension."""

from __future__ import annotations

import zipfile
from enum import StrEnum
from pathlib import Path

from .errors import CorruptFileError, EncryptedFileError, MacroEnabledError, UnsupportedFileError

PDF_MAGIC = b"%PDF-"
ZIP_MAGIC = b"PK\x03\x04"
OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"  # legacy .ppt and encrypted OOXML

PPTX_MAIN = "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"
PPTM_MAIN = "application/vnd.ms-powerpoint.presentation.macroenabled.main+xml"

MAX_ZIP_MEMBERS = 5000
MAX_ZIP_UNCOMPRESSED = 512 * 1024 * 1024
MAX_COMPRESSION_RATIO = 200


class Kind(StrEnum):
    PDF = "pdf"
    PPTX = "pptx"


def sniff(head: bytes) -> Kind:
    """Classify a file from its first bytes. Raises for anything else."""
    if head.startswith(PDF_MAGIC):
        return Kind.PDF
    if head.startswith(ZIP_MAGIC):
        return Kind.PPTX
    if head.startswith(OLE_MAGIC):
        raise EncryptedFileError(
            "Legacy .ppt files and password-protected Office files are not supported."
        )
    raise UnsupportedFileError()


def validate_pptx(path: Path) -> None:
    """Check the ZIP really is a macro-free PowerPoint presentation.

    Also guards against ZIP bombs by bounding member count, total
    uncompressed size, and per-member compression ratio.
    """
    try:
        with zipfile.ZipFile(path) as zf:
            infos = zf.infolist()
            if len(infos) > MAX_ZIP_MEMBERS:
                raise CorruptFileError("The presentation has too many parts.")
            total = 0
            for info in infos:
                total += info.file_size
                if info.flag_bits & 0x1:
                    raise EncryptedFileError()
                if (
                    info.compress_size
                    and info.file_size / info.compress_size > MAX_COMPRESSION_RATIO
                ):
                    raise CorruptFileError("The presentation is compressed suspiciously well.")
            if total > MAX_ZIP_UNCOMPRESSED:
                raise CorruptFileError("The presentation is too large when uncompressed.")
            names = {info.filename.lower() for info in infos}
            if any(n.endswith("vbaproject.bin") for n in names):
                raise MacroEnabledError()
            if "[content_types].xml" not in names:
                raise UnsupportedFileError()
            content_types = (
                zf.read("[Content_Types].xml")[: 2 * 1024 * 1024]
                .decode("utf-8", errors="replace")
                .lower()
            )
    except zipfile.BadZipFile as exc:
        raise CorruptFileError() from exc
    if PPTM_MAIN in content_types or "macroenabled" in content_types:
        raise MacroEnabledError()
    if PPTX_MAIN not in content_types:
        raise UnsupportedFileError()
