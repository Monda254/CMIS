"""
Environment-driven configuration for the IBMS Backend API.
Never hardcodes production credentials or external secrets.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


def _parse_origins(raw: str) -> list[str]:
    items = [item.strip() for item in raw.split(",") if item.strip()]
    return items or ["http://localhost:3000", "http://127.0.0.1:3000"]


@dataclass(frozen=True)
class Settings:
    app_name: str = "IBMS · Ledgerly Enterprise API"
    app_version: str = "1.0.0"
    api_v1_prefix: str = "/api/v1"
    environment: str = field(default_factory=lambda: os.getenv("NODE_ENV", os.getenv("ENVIRONMENT", "development")))
    database_url: str = field(default_factory=lambda: os.getenv("DATABASE_URL", ""))
    internal_secret: str = field(
        default_factory=lambda: os.getenv("FASTAPI_INTERNAL_SECRET", "ledgerly-internal-dev-secret")
    )
    cors_origins: list[str] = field(
        default_factory=lambda: _parse_origins(os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"))
    )
    session_cookie_name: str = "ledgerly_session"
    session_ttl_days: int = 14
    upload_storage_dir: Path = field(
        default_factory=lambda: Path(os.getenv("IBMS_STORAGE_DIR", str(PROJECT_ROOT / ".storage" / "uploads")))
    )
    max_upload_size_bytes: int = 10 * 1024 * 1024  # 10 MB
    default_currency: str = "KES"
    public_app_origin: str = field(
        default_factory=lambda: os.getenv("NEXT_PUBLIC_APP_ORIGIN", "http://localhost:3000").rstrip("/")
    )


settings = Settings()
settings.upload_storage_dir.mkdir(parents=True, exist_ok=True)
