"""Runtime settings, read from environment variables prefixed ``EXTRACTOR_``."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Hard ceiling on rasterization resolution regardless of configuration, so a
# misconfiguration cannot turn OCR into a memory or CPU bomb.
MAX_OCR_DPI = 300


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="EXTRACTOR_", extra="ignore")

    shared_secret: SecretStr = Field(min_length=32)
    max_bytes: int = Field(default=25 * 1024 * 1024, gt=0)
    timeout_seconds: float = Field(default=60.0, gt=0, le=600)
    max_pages: int = Field(default=300, gt=0, le=1000)
    ocr_dpi: int = Field(default=200, ge=72)
    ocr_min_chars: int = Field(default=25, ge=0)
    ocr_language: str = "eng"
    tmp_dir: str = "/tmp"
    max_concurrency: int = Field(default=2, ge=1, le=16)
    memory_limit_mb: int = Field(default=1536, ge=256)
    log_level: str = "info"

    @field_validator("ocr_dpi")
    @classmethod
    def cap_dpi(cls, value: int) -> int:
        return min(value, MAX_OCR_DPI)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
