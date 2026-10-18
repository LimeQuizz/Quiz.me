"""Child-process entry point: ``python -m app.pipeline.worker <path>``.

The API runs each extraction in a fresh process so it can enforce a hard
timeout (by killing the process group) and a memory ceiling (RLIMIT_AS),
and so a parser crash cannot take down the server. Prints one JSON object on
stdout and exits 0, or 2 for a known extraction error.
"""

from __future__ import annotations

import contextlib
import json
import os
import resource
import sys
from pathlib import Path

from .errors import ExtractionError
from .run import PipelineOptions, run_pipeline


def _limit_memory() -> None:
    mb = int(os.environ.get("EXTRACTOR_MEMORY_LIMIT_MB", "1536"))
    limit = mb * 1024 * 1024
    with contextlib.suppress(ValueError, OSError):
        resource.setrlimit(resource.RLIMIT_AS, (limit, limit))


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(json.dumps({"error": "usage"}))
        return 64
    _limit_memory()
    options = PipelineOptions(
        max_pages=int(os.environ.get("EXTRACTOR_MAX_PAGES", "300")),
        ocr_dpi=min(int(os.environ.get("EXTRACTOR_OCR_DPI", "200")), 300),
        ocr_min_chars=int(os.environ.get("EXTRACTOR_OCR_MIN_CHARS", "25")),
        ocr_language=os.environ.get("EXTRACTOR_OCR_LANGUAGE", "eng"),
    )
    try:
        result = run_pipeline(Path(argv[1]), options)
    except ExtractionError as exc:
        print(json.dumps({"error": exc.code, "message": exc.message}))
        return 2
    except MemoryError:
        print(json.dumps({"error": "too_complex", "message": "The file is too complex."}))
        return 2
    print(json.dumps(result.to_dict()))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
