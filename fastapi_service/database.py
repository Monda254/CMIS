"""
Database engine, session factories, and SQLAlchemy 2.x declarative base for IBMS.
Supports both asyncpg (FastAPI runtime) and psycopg2/asyncpg (Alembic & Pytest).
"""

from __future__ import annotations

import os
from datetime import datetime
from typing import AsyncGenerator
from urllib.parse import quote_plus, urlparse, urlunparse

from dotenv import load_dotenv
from sqlalchemy import MetaData, create_engine
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, sessionmaker

load_dotenv()

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION, schema="public")


def get_raw_database_url() -> str:
    url = os.getenv("DATABASE_URL", "")
    if not url:
        raise RuntimeError("DATABASE_URL environment variable is required")
    return url


def get_async_database_url(raw_url: str | None = None) -> str:
    url = raw_url or get_raw_database_url()
    if url.startswith("postgresql://"):
        return "postgresql+asyncpg://" + url[len("postgresql://") :]
    if url.startswith("postgres://"):
        return "postgresql+asyncpg://" + url[len("postgres://") :]
    return url


def get_sync_database_url(raw_url: str | None = None) -> str:
    url = raw_url or get_raw_database_url()
    if url.startswith("postgresql+asyncpg://"):
        return "postgresql+psycopg2://" + url[len("postgresql+asyncpg://") :]
    if url.startswith("postgresql://"):
        return "postgresql+psycopg2://" + url[len("postgresql://") :]
    if url.startswith("postgres://"):
        return "postgresql+psycopg2://" + url[len("postgres://") :]
    return url


def build_async_engine(raw_url: str | None = None) -> AsyncEngine:
    return create_async_engine(
        get_async_database_url(raw_url),
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
        connect_args={"statement_cache_size": 0},
    )


def build_sync_engine(raw_url: str | None = None):
    return create_engine(
        get_sync_database_url(raw_url),
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
    )
