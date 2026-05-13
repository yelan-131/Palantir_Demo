"""Full-Text Search — cross-entity search across whitelisted tables.

Searches text columns in SAFE_COLUMNS using LIKE.  Falls back to mock
data when DB is unavailable.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query

from app.api._model_driven_shared import SAFE_COLUMNS, MOCK_DATA, assert_safe_identifier
from app.core.logging import get_logger

logger = get_logger(__name__)

router = APIRouter()

# Text-type columns eligible for LIKE search (string / text-like)
_TEXT_COLUMNS: dict[str, list[str]] = {}
for _tbl, _cols in SAFE_COLUMNS.items():
    _TEXT_COLUMNS[_tbl] = [
        c for c in sorted(_cols)
        if c != "id" and not any(
            kw in c for kw in ("_id", "score", "quantity", "rating", "price", "stock", "days", "rate")
        )
    ]


@router.get("")
async def cross_entity_search(
    q: str = Query(..., min_length=1, description="Search keyword"),
    models: Optional[str] = Query(None, description="Comma-separated model names to search"),
):
    """Cross-entity full-text search.

    Searches across multiple tables using LIKE on text columns from the
    SAFE_COLUMNS whitelist. Returns up to 5 records per model, 50 total.
    """
    keyword = f"%{q}%"

    # Determine which models to search
    # Guard: when called directly (not via FastAPI DI), default may be a Query object
    if models and isinstance(models, str):
        model_list = [m.strip() for m in models.split(",") if m.strip()]
    else:
        model_list = list(SAFE_COLUMNS.keys())

    # Validate model names
    model_list = [m for m in model_list if m in SAFE_COLUMNS]

    results: list[dict] = []
    total = 0
    MAX_PER_MODEL = 5
    MAX_TOTAL = 50

    # Try DB first
    db_attempted = False
    async def _search_db():
        from sqlalchemy import text
        from app.database import AsyncSessionLocal

        all_results: list[dict] = []
        all_total = 0

        async with AsyncSessionLocal() as session:
            for model_name in model_list:
                if all_total >= MAX_TOTAL:
                    break
                text_cols = _TEXT_COLUMNS.get(model_name, [])
                if not text_cols:
                    continue

                for col in text_cols:
                    assert_safe_identifier(col)
                assert_safe_identifier(model_name)

                like_clauses = " OR ".join([f"{c} LIKE :kw" for c in text_cols])
                sql = f"SELECT * FROM {model_name} WHERE {like_clauses} LIMIT :lim"
                try:
                    rows = (await session.execute(
                        text(sql), {"kw": keyword, "lim": MAX_PER_MODEL},
                    )).mappings().all()
                except Exception:
                    rows = []

                if rows:
                    records = [dict(r) for r in rows[:MAX_PER_MODEL]]
                    all_results.append({
                        "model_name": model_name,
                        "records": records,
                    })
                    all_total += len(records)

        return {"results": all_results, "total": all_total}

    try:
        from app.core.db import db_session
        async with db_session() as session:
            pass  # test connectivity
        db_attempted = True
        result = await _search_db()
        if result["total"] > 0 or not model_list:
            return result
    except Exception:
        pass

    # Mock fallback — search through MOCK_DATA
    for model_name in model_list:
        if total >= MAX_TOTAL:
            break
        mock_records = MOCK_DATA.get(model_name, [])
        text_cols = _TEXT_COLUMNS.get(model_name, [])

        matched = []
        for rec in mock_records:
            for col in text_cols:
                val = rec.get(col)
                if val is not None and q.lower() in str(val).lower():
                    matched.append(rec)
                    break
            if len(matched) >= MAX_PER_MODEL:
                break

        if matched:
            results.append({
                "model_name": model_name,
                "records": matched[:MAX_PER_MODEL],
            })
            total += len(matched)

    return {"results": results, "total": total}
