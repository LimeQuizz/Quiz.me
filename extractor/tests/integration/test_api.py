"""HTTP-level tests for the extractor API using httpx against the ASGI app.

These spawn the real worker subprocess, so they cover the timeout, the
temp-file cleanup, and error mapping end to end.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable
from pathlib import Path

import httpx
import pytest

from app.config import Settings
from app.main import SECRET_HEADER, create_app

FIXTURES = Path(__file__).parent.parent / "fixtures"
SECRET = "s" * 40


ClientFactory = Callable[..., httpx.AsyncClient]


@pytest.fixture
def tmp_upload_dir(tmp_path: Path) -> Path:
    d = tmp_path / "uploads"
    d.mkdir()
    return d


@pytest.fixture
def make_client(tmp_upload_dir: Path) -> ClientFactory:
    def factory(**overrides: object) -> httpx.AsyncClient:
        settings = Settings(
            shared_secret=SECRET,  # type: ignore[arg-type]
            tmp_dir=str(tmp_upload_dir),
            **overrides,  # type: ignore[arg-type]
        )
        app = create_app(settings)
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://extractor"
        )

    return factory


async def post_file(
    client: httpx.AsyncClient, content: bytes, secret: str | None = SECRET
) -> httpx.Response:
    headers = {"content-type": "application/octet-stream"}
    if secret is not None:
        headers[SECRET_HEADER] = secret
    return await client.post("/v1/extract", content=content, headers=headers)


def assert_no_temp_files(d: Path) -> None:
    assert list(d.iterdir()) == []


async def test_health_needs_no_secret(make_client: ClientFactory) -> None:
    async with make_client() as client:
        r = await client.get("/healthz")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


async def test_docs_are_disabled(make_client: ClientFactory) -> None:
    async with make_client() as client:
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert (await client.get(path)).status_code == 404


@pytest.mark.parametrize("secret", [None, "", "wrong", SECRET + "x", SECRET[:-1]])
async def test_missing_or_wrong_secret_is_rejected(
    make_client: ClientFactory, tmp_upload_dir: Path, secret: str | None
) -> None:
    async with make_client() as client:
        r = await post_file(client, (FIXTURES / "glossary.pdf").read_bytes(), secret)
    assert r.status_code == 401
    assert r.json() == {"error": "unauthorized"}
    assert_no_temp_files(tmp_upload_dir)


async def test_extracts_pdf_and_cleans_up(make_client: ClientFactory, tmp_upload_dir: Path) -> None:
    async with make_client() as client:
        r = await post_file(client, (FIXTURES / "qa_worksheet.pdf").read_bytes())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "pdf"
    assert body["sections"] == 3
    fronts = {c["front"]: c for c in body["cards"]}
    assert fronts["What is the capital of France?"]["back"] == "Paris"
    assert fronts["What is the capital of France?"]["source_ref"] == "page 1"
    confidences = [c["confidence"] for c in body["cards"]]
    assert confidences == sorted(confidences, reverse=True)
    assert_no_temp_files(tmp_upload_dir)


async def test_extracts_pptx(make_client: ClientFactory, tmp_upload_dir: Path) -> None:
    async with make_client() as client:
        r = await post_file(client, (FIXTURES / "lecture.pptx").read_bytes())
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "pptx"
    assert any(c["front"] == "What is ATP?" for c in r.json()["cards"])
    assert_no_temp_files(tmp_upload_dir)


async def test_size_limit_by_content_length(
    make_client: ClientFactory, tmp_upload_dir: Path
) -> None:
    async with make_client(max_bytes=1000) as client:
        r = await post_file(client, b"%PDF-" + b"0" * 2000)
    assert r.status_code == 413
    assert r.json()["error"] == "too_large"
    assert_no_temp_files(tmp_upload_dir)


async def test_size_limit_when_streamed_without_length(
    make_client: ClientFactory, tmp_upload_dir: Path
) -> None:
    async def body() -> AsyncIterator[bytes]:
        yield b"%PDF-"
        for _ in range(10):
            yield b"0" * 500

    async with make_client(max_bytes=1000) as client:
        r = await client.post("/v1/extract", content=body(), headers={SECRET_HEADER: SECRET})
    assert r.status_code == 413
    assert_no_temp_files(tmp_upload_dir)


async def test_bad_magic_bytes(make_client: ClientFactory, tmp_upload_dir: Path) -> None:
    async with make_client() as client:
        r = await post_file(client, (FIXTURES / "fake.pdf").read_bytes())
    assert r.status_code == 415
    assert r.json()["error"] == "unsupported_file"
    assert_no_temp_files(tmp_upload_dir)


async def test_empty_body(make_client: ClientFactory, tmp_upload_dir: Path) -> None:
    async with make_client() as client:
        r = await post_file(client, b"")
    assert r.status_code == 400
    assert_no_temp_files(tmp_upload_dir)


async def test_encrypted_pdf(make_client: ClientFactory, tmp_upload_dir: Path) -> None:
    async with make_client() as client:
        r = await post_file(client, (FIXTURES / "encrypted.pdf").read_bytes())
    assert r.status_code == 422
    assert r.json()["error"] == "encrypted_file"
    assert_no_temp_files(tmp_upload_dir)


async def test_macro_enabled_pptm(make_client: ClientFactory, tmp_upload_dir: Path) -> None:
    async with make_client() as client:
        r = await post_file(client, (FIXTURES / "macro.pptm").read_bytes())
    assert r.status_code == 422
    assert r.json()["error"] == "macro_enabled"
    assert_no_temp_files(tmp_upload_dir)


async def test_corrupt_pdf(make_client: ClientFactory, tmp_upload_dir: Path) -> None:
    async with make_client() as client:
        r = await post_file(client, b"%PDF-1.7\nthis is not really a pdf")
    assert r.status_code == 422
    assert_no_temp_files(tmp_upload_dir)


async def test_page_cap(make_client: ClientFactory, tmp_upload_dir: Path) -> None:
    async with make_client(max_pages=2) as client:
        r = await post_file(client, (FIXTURES / "qa_worksheet.pdf").read_bytes())
    assert r.status_code == 422
    assert r.json()["error"] == "too_many_pages"
    assert_no_temp_files(tmp_upload_dir)


async def test_timeout_kills_worker_and_cleans_up(
    make_client: ClientFactory, tmp_upload_dir: Path
) -> None:
    async with make_client(timeout_seconds=0.01) as client:
        r = await post_file(client, (FIXTURES / "scanned.pdf").read_bytes())
    assert r.status_code == 504
    assert r.json()["error"] == "timeout"
    assert_no_temp_files(tmp_upload_dir)


def test_settings_refuse_short_secret() -> None:
    with pytest.raises(ValueError, match="shared_secret"):
        Settings(shared_secret="too-short")  # type: ignore[arg-type]


def test_settings_cap_ocr_dpi() -> None:
    assert Settings(shared_secret=SECRET, ocr_dpi=1200).ocr_dpi == 300  # type: ignore[arg-type]


async def test_overload_sheds_with_503_and_retry_after(
    make_client: ClientFactory, tmp_upload_dir: Path
) -> None:
    """Stress: 12 simultaneous uploads against 1 slot and a queue of 1.

    Every request gets a definite answer (200 or 503 busy with Retry-After),
    nothing errors, the service stays healthy, and no temp files remain.
    """
    body = (FIXTURES / "glossary.pdf").read_bytes()
    async with make_client(max_concurrency=1, queue_size=1) as client:
        responses = await asyncio.gather(*(post_file(client, body) for _ in range(12)))
        health = await client.get("/healthz")
    statuses = sorted(r.status_code for r in responses)
    assert set(statuses) <= {200, 503}
    assert statuses.count(200) >= 1
    assert statuses.count(503) >= 1
    for r in responses:
        if r.status_code == 503:
            assert r.json() == {"error": "busy"}
            assert int(r.headers["retry-after"]) >= 1
    assert health.status_code == 200
    assert_no_temp_files(tmp_upload_dir)


async def test_slow_body_is_cut_off(make_client: ClientFactory, tmp_upload_dir: Path) -> None:
    async def trickle() -> AsyncIterator[bytes]:
        yield b"%PDF-1.7\n"
        await asyncio.sleep(1)
        yield b"never arrives in time"

    async with make_client(body_timeout_seconds=0.2) as client:
        r = await client.post(
            "/v1/extract",
            content=trickle(),
            headers={SECRET_HEADER: SECRET, "content-type": "application/octet-stream"},
        )
    assert r.status_code == 408
    assert r.json()["error"] == "body_timeout"
    assert_no_temp_files(tmp_upload_dir)
