"""
Database engine, session factories, and SQLAlchemy 2.x declarative base for IBMS.
Supports both asyncpg (FastAPI runtime) and psycopg2/asyncpg (Alembic, FastAPI sync dependencies & Pytest).
"""

from __future__ import annotations

import os
from typing import Generator

from dotenv import load_dotenv
from sqlalchemy import Engine, MetaData, create_engine
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

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


def build_sync_engine(raw_url: str | None = None) -> Engine:
    return create_engine(
        get_sync_database_url(raw_url),
        pool_pre_ping=True,
        pool_size=8,
        max_overflow=16,
    )


_sync_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def get_sync_engine() -> Engine:
    global _sync_engine, _SessionLocal
    if _sync_engine is None:
        _sync_engine = build_sync_engine()
        _SessionLocal = sessionmaker(bind=_sync_engine, autoflush=False, autocommit=False, expire_on_commit=False)
    return _sync_engine


def get_session_factory() -> sessionmaker[Session]:
    global _SessionLocal
    if _SessionLocal is None:
        get_sync_engine()
    assert _SessionLocal is not None
    return _SessionLocal


def get_db() -> Generator[Session, None, None]:
    """
    FastAPI dependency providing a transactional SQLAlchemy 2.x Session per request.
    Automatically rolls back uncommitted changes if an exception occurs.
    """
    factory = get_session_factory()
    session = factory()
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
