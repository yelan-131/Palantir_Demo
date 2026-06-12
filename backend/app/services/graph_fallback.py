"""Graph-first query utility.

Provides a unified query pattern: try Neo4j graph first, optionally try the
relational database, and raise explicit unavailability errors instead of
silently returning mock data.

All graph queries are wrapped with asyncio.wait_for to prevent
timeout cascades when Neo4j is slow or unavailable.
"""

import asyncio
from typing import Any, Callable, Coroutine, TypeVar

from app.core.logging import get_logger
from app.core.production_errors import database_unavailable, graph_unavailable

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
    """Try graph query first, then DB, without mock/default fallback.

    Args:
        graph_fn: Async function that queries Neo4j. Returns None if no results.
        db_fn: Async function that queries PostgreSQL/SQLite.
        default: Deprecated; ignored except for backwards-compatible signature.
    """
    # Try graph first (with timeout)
    try:
        result = await asyncio.wait_for(graph_fn(), timeout=GRAPH_TIMEOUT)
        if result is not None:
            return result
    except asyncio.TimeoutError:
        logger.debug("Graph query timed out (%ss), trying DB", GRAPH_TIMEOUT)
    except (RuntimeError, Exception) as exc:
        logger.debug("Graph query failed, trying DB: %s", exc)

    # Fall back to relational DB
    try:
        result = await db_fn()
        if result is not None:
            return result
    except Exception as exc:
        raise database_unavailable("Relational graph fallback database is unavailable") from exc

    return None


async def try_graph_or_mock(
    graph_fn: Callable[[], Coroutine[Any, Any, T | None]],
    mock_fn: Callable[[], T],
) -> T:
    """Try graph query and raise when unavailable.

    Args:
        graph_fn: Async function that queries Neo4j.
        mock_fn: Deprecated; not called.
    """
    try:
        result = await asyncio.wait_for(graph_fn(), timeout=GRAPH_TIMEOUT)
        if result is not None:
            return result
    except asyncio.TimeoutError:
        raise graph_unavailable(f"Graph query timed out after {GRAPH_TIMEOUT}s")
    except (RuntimeError, Exception) as exc:
        raise graph_unavailable("Graph query failed") from exc

    raise graph_unavailable("Graph query returned no data")
