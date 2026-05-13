"""Graph-first fallback utility.

Provides a unified query pattern: try Neo4j graph first,
fall back to PostgreSQL/SQLite, then to mock data.

All graph queries are wrapped with asyncio.wait_for to prevent
timeout cascades when Neo4j is slow or unavailable.
"""

import asyncio
from typing import Any, Callable, Coroutine, TypeVar

from app.core.logging import get_logger

logger = get_logger(__name__)

T = TypeVar("T")

# Default timeout for individual Neo4j graph queries (seconds).
GRAPH_TIMEOUT = 3


class GraphUnavailableError(Exception):
    """Raised when Neo4j is not available."""


async def try_graph_then_db(
    graph_fn: Callable[[], Coroutine[Any, Any, T | None]],
    db_fn: Callable[[], Coroutine[Any, Any, T | None]],
    default: T | None = None,
) -> T | None:
    """Try graph query first, fall back to DB, then to default.

    Args:
        graph_fn: Async function that queries Neo4j. Returns None if no results.
        db_fn: Async function that queries PostgreSQL/SQLite.
        default: Fallback value if both fail.
    """
    # Try graph first (with timeout)
    try:
        result = await asyncio.wait_for(graph_fn(), timeout=GRAPH_TIMEOUT)
        if result is not None:
            return result
    except asyncio.TimeoutError:
        logger.debug("Graph query timed out (%ss), falling back to DB", GRAPH_TIMEOUT)
    except (RuntimeError, Exception) as exc:
        logger.debug("Graph query failed, falling back to DB: %s", exc)

    # Fall back to relational DB
    try:
        result = await db_fn()
        if result is not None:
            return result
    except Exception as exc:
        logger.debug("DB query also failed: %s", exc)

    return default


async def try_graph_or_mock(
    graph_fn: Callable[[], Coroutine[Any, Any, T | None]],
    mock_fn: Callable[[], T],
) -> T:
    """Try graph query, fall back to mock data generator.

    Args:
        graph_fn: Async function that queries Neo4j.
        mock_fn: Sync function that returns mock data.
    """
    try:
        result = await asyncio.wait_for(graph_fn(), timeout=GRAPH_TIMEOUT)
        if result is not None:
            return result
    except asyncio.TimeoutError:
        logger.debug("Graph query timed out (%ss), using mock", GRAPH_TIMEOUT)
    except (RuntimeError, Exception) as exc:
        logger.debug("Graph query failed, using mock: %s", exc)

    return mock_fn()
