"""HTTP API. ``GET /healthz`` is open; everything else needs the shared secret."""

from __future__ import annotations

import asyncio
import contextlib
import hmac
import json
import logging
import os
import signal
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from . import __version__
from .config import Settings, get_settings
from .logging import configure, log
from .pipeline.errors import ERRORS, ExtractionError
from .pipeline.filetype import sniff

logger = logging.getLogger("extractor")
SECRET_HEADER = "X-Extractor-Secret"  # noqa: S105 - header name, not a secret
CHUNK = 64 * 1024


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure(settings.log_level)
    app = FastAPI(
        title="quizme-extractor",
        version=__version__,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.settings = settings
    app.state.slots = asyncio.Semaphore(settings.max_concurrency)

    def require_secret(
        x_extractor_secret: Annotated[str | None, Header(alias=SECRET_HEADER)] = None,
    ) -> None:
        expected = settings.shared_secret.get_secret_value().encode()
        provided = (x_extractor_secret or "").encode()
        # compare_digest is constant-time for equal-length inputs and does not
        # short-circuit on the first differing byte.
        if not hmac.compare_digest(provided, expected):
            raise HTTPException(status_code=401, detail={"error": "unauthorized"})

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, dict) else {"error": str(exc.detail)}
        return JSONResponse(detail, status_code=exc.status_code, headers=exc.headers)

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    @app.post("/v1/extract", dependencies=[Depends(require_secret)])
    async def extract(request: Request) -> JSONResponse:
        request_id = str(uuid.uuid4())
        started = time.monotonic()
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > settings.max_bytes:
            log(logger, logging.INFO, "upload rejected", request_id=request_id, reason="too_large")
            raise HTTPException(413, {"error": "too_large", "max_bytes": settings.max_bytes})

        fd, name = tempfile.mkstemp(prefix="upload-", dir=settings.tmp_dir)
        path = Path(name)
        try:
            size = 0
            head = b""
            with os.fdopen(fd, "wb") as fh:
                os.fchmod(fh.fileno(), 0o600)
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > settings.max_bytes:
                        raise HTTPException(
                            413, {"error": "too_large", "max_bytes": settings.max_bytes}
                        )
                    if len(head) < 8:
                        head = (head + chunk)[:8]
                    fh.write(chunk)
            if size == 0:
                raise HTTPException(400, {"error": "empty_body"})
            try:
                kind = sniff(head)
            except ExtractionError as exc:
                raise HTTPException(
                    exc.status, {"error": exc.code, "message": exc.message}
                ) from exc

            async with app.state.slots:
                result = await _run_worker(path, settings)
            log(
                logger,
                logging.INFO,
                "extraction finished",
                request_id=request_id,
                kind=kind.value,
                bytes=size,
                cards=len(result.get("cards", [])),  # type: ignore[arg-type]
                sections=result.get("sections"),
                ocr_sections=result.get("ocr_sections"),
                duration_ms=int((time.monotonic() - started) * 1000),
            )
            return JSONResponse(result)
        except HTTPException as exc:
            code = exc.detail.get("error") if isinstance(exc.detail, dict) else None
            log(
                logger,
                logging.INFO,
                "extraction rejected",
                request_id=request_id,
                status=exc.status_code,
                error=code,
            )
            raise
        finally:
            with contextlib.suppress(FileNotFoundError):
                path.unlink()

    return app


async def _run_worker(path: Path, settings: Settings) -> dict[str, object]:
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": settings.tmp_dir,
        "TMPDIR": settings.tmp_dir,
        "OMP_THREAD_LIMIT": "1",
        "EXTRACTOR_MAX_PAGES": str(settings.max_pages),
        "EXTRACTOR_OCR_DPI": str(settings.ocr_dpi),
        "EXTRACTOR_OCR_MIN_CHARS": str(settings.ocr_min_chars),
        "EXTRACTOR_OCR_LANGUAGE": settings.ocr_language,
        "EXTRACTOR_MEMORY_LIMIT_MB": str(settings.memory_limit_mb),
    }
    if "TESSDATA_PREFIX" in os.environ:
        env["TESSDATA_PREFIX"] = os.environ["TESSDATA_PREFIX"]
    # The shared secret is deliberately not passed to the child.
    proc = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "app.pipeline.worker",
        str(path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
        cwd=str(Path(__file__).resolve().parent.parent),
        start_new_session=True,
    )
    try:
        stdout, _stderr = await asyncio.wait_for(proc.communicate(), settings.timeout_seconds)
    except TimeoutError:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGKILL)
        await proc.wait()
        raise HTTPException(
            504, {"error": "timeout", "message": "Extraction took too long."}
        ) from None
    except asyncio.CancelledError:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGKILL)
        raise
    finally:
        # Reap anything the worker spawned (tesseract) that is still running.
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(proc.pid, signal.SIGKILL)

    try:
        payload = json.loads(stdout.decode() or "{}")
    except json.JSONDecodeError:
        payload = {}
    if proc.returncode == 0 and isinstance(payload, dict) and "cards" in payload:
        return payload
    if proc.returncode == 2 and isinstance(payload, dict) and "error" in payload:
        err_cls = ERRORS.get(str(payload["error"]), ExtractionError)
        raise HTTPException(
            err_cls.status, {"error": payload["error"], "message": payload.get("message")}
        )
    raise HTTPException(500, {"error": "extraction_failed"})
