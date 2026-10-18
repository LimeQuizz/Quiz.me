"""Errors raised by the pipeline. Each maps to an HTTP status and a stable code."""

from __future__ import annotations


class ExtractionError(Exception):
    code = "extraction_failed"
    status = 422
    message = "The file could not be processed."

    def __init__(self, message: str | None = None) -> None:
        super().__init__(message or self.message)
        if message:
            self.message = message


class UnsupportedFileError(ExtractionError):
    code = "unsupported_file"
    status = 415
    message = "Only PDF and PPTX files are supported."


class EncryptedFileError(ExtractionError):
    code = "encrypted_file"
    message = "Password-protected or encrypted files are not supported."


class MacroEnabledError(ExtractionError):
    code = "macro_enabled"
    message = "Macro-enabled presentations (.pptm) are not supported."


class TooManyPagesError(ExtractionError):
    code = "too_many_pages"
    message = "The file has more pages or slides than the limit."


class CorruptFileError(ExtractionError):
    code = "corrupt_file"
    message = "The file appears to be damaged."


ERRORS: dict[str, type[ExtractionError]] = {
    cls.code: cls
    for cls in (
        ExtractionError,
        UnsupportedFileError,
        EncryptedFileError,
        MacroEnabledError,
        TooManyPagesError,
        CorruptFileError,
    )
}
