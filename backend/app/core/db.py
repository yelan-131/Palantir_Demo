"""Unified async DB session helper.

Replaces the per-router `_try_db()` pattern that silently swallowed
exceptions. Use `db_session()` as an async context manager; failures
are logged and re-raised with rollback.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.production_errors import database_unavailable
from app.core.logging import get_logger
from app.database import AsyncSessionLocal

logger = get_logger(__name__)


@asynccontextmanager
async def db_session() -> AsyncIterator[AsyncSession]:
    """Async context manager yielding an AsyncSession.

    On exception: rollback + log + re-raise so callers can decide how to fall
    back to mock data (instead of silently masking real errors).
    """
    session: AsyncSession = AsyncSessionLocal()
    try:
        yield session
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        await session.rollback()
        logger.exception("DB session error; rolling back")
        raise database_unavailable() from exc
    except Exception:
        await session.rollback()
        logger.exception("DB session error; rolling back")
        raise
    finally:
        await session.close()


async def safe_db_call(fn, *, default=None):
    """Compatibility helper for legacy `_try_db(fn)` usages.

    Logs errors instead of swallowing them silently. New code should use
    `db_session()` directly with explicit try/except for fallback paths.
    """
    try:
        async with db_session() as session:
            return await fn(session)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — intentional broad catch with logging
        logger.warning("safe_db_call database unavailable: %s", exc)
        raise database_unavailable() from exc
