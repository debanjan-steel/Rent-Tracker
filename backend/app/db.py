"""Database engine, session management, and non-destructive schema initialization."""

import os
from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "rent_tracker.db"


class Base(DeclarativeBase):
    """Base SQLAlchemy declarative class."""


def normalize_database_url(raw_url: str) -> str:
    """Normalize cloud Postgres URLs to use psycopg v3 driver."""
    trimmed = raw_url.strip()
    if trimmed.startswith("postgres://"):
        return "postgresql+psycopg://" + trimmed[len("postgres://") :]
    if trimmed.startswith("postgresql://") and not trimmed.startswith("postgresql+"):
        return "postgresql+psycopg://" + trimmed[len("postgresql://") :]
    return trimmed


def get_database_url() -> str:
    """Resolve the database URL from environment or default local SQLite path."""
    env_url = os.environ.get("RENT_TRACKER_DB_URL") or os.environ.get("DATABASE_URL")
    if env_url:
        return normalize_database_url(env_url)
    db_path_env = os.environ.get("RENT_TRACKER_DB_PATH")
    target_path = Path(db_path_env) if db_path_env else DEFAULT_DB_PATH
    target_path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{target_path.as_posix()}"


def create_db_engine(database_url: str | None = None):
    """Create a SQLAlchemy engine for SQLite or PostgreSQL."""
    url = normalize_database_url(database_url) if database_url else get_database_url()
    is_sqlite = url.startswith("sqlite")
    connect_args = {"check_same_thread": False} if is_sqlite else {}
    eng = create_engine(
        url,
        connect_args=connect_args,
        pool_pre_ping=not is_sqlite,
        future=True,
    )

    if is_sqlite:
        @event.listens_for(eng, "connect")
        def _set_sqlite_pragma(dbapi_connection, _connection_record) -> None:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return eng


engine = create_db_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def init_db(target_engine=None) -> None:
    """Create missing tables and run non-destructive schema/data migrations."""
    from . import models  # noqa: F401
    from .migrations import run_migrations

    eng = target_engine or engine
    Base.metadata.create_all(bind=eng)
    run_migrations(eng)


def get_session() -> Generator[Session, None, None]:
    """Yield a scoped SQLAlchemy session per FastAPI request."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
