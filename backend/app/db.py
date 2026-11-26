"""Database engine, session management, and SQLite initialization."""

import os
from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "rent_tracker.db"


class Base(DeclarativeBase):
    """Base SQLAlchemy declarative class."""


def get_database_url() -> str:
    """Resolve the database URL from environment or default local SQLite path."""
    env_url = os.environ.get("RENT_TRACKER_DB_URL")
    if env_url:
        return env_url
    db_path_env = os.environ.get("RENT_TRACKER_DB_PATH")
    target_path = Path(db_path_env) if db_path_env else DEFAULT_DB_PATH
    target_path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{target_path.as_posix()}"


def create_db_engine(database_url: str | None = None):
    """Create a SQLAlchemy engine configured for SQLite concurrency safety."""
    url = database_url or get_database_url()
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    eng = create_engine(url, connect_args=connect_args, future=True)

    if url.startswith("sqlite"):
        @event.listens_for(eng, "connect")
        def _set_sqlite_pragma(dbapi_connection, _connection_record) -> None:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return eng


engine = create_db_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def init_db(target_engine=None) -> None:
    """Create all database tables."""
    from . import models  # noqa: F401

    Base.metadata.create_all(bind=target_engine or engine)


def get_session() -> Generator[Session, None, None]:
    """Yield a scoped SQLAlchemy session per FastAPI request."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
