"""Scheduled Tasks — CRUD + manual trigger.

Supports cron-based job scheduling for reports, syncs and cleanup tasks.
Falls back to in-memory mock data when DB is unavailable.
"""
from __future__ import annotations

import copy
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.logging import get_logger

logger = get_logger(__name__)

router = APIRouter()


# ── Pydantic schemas ──────────────────────────────────────

class JobCreate(BaseModel):
    name: str
    cron: str
    job_type: str = "report"  # report | sync | cleanup
    config: Optional[dict] = None
    is_active: bool = True


class JobUpdate(BaseModel):
    name: Optional[str] = None
    cron: Optional[str] = None
    job_type: Optional[str] = None
    config: Optional[dict] = None
    is_active: Optional[bool] = None


# ── Mock fallback data ────────────────────────────────────

MOCK_JOBS: list[dict] = [
    {
        "id": 1, "name": "每日生产报告", "cron": "0 8 * * *", "job_type": "report",
        "config": {"report_type": "daily_production"}, "is_active": True,
        "last_run": "2026-05-13T08:00:00",
    },
    {
        "id": 2, "name": "设备健康检查", "cron": "*/30 * * * *", "job_type": "sync",
        "config": {"check_type": "health_score"}, "is_active": True,
        "last_run": None,
    },
]

_next_mock_id = max(j["id"] for j in MOCK_JOBS) + 1


# ── DB helper ─────────────────────────────────────────────

async def _try_db(fn):
    """Try DB operation, return None on failure (mock fallback)."""
    from app.core.db import safe_db_call
    return await safe_db_call(fn)


# ── CRUD endpoints ────────────────────────────────────────

@router.get("/jobs")
async def list_jobs():
    """List all scheduled jobs."""
    async def _query(db):
        from sqlalchemy import text
        rows = (await db.execute(text("SELECT * FROM scheduled_jobs ORDER BY id"))).mappings().all()
        return {"data": [dict(r) for r in rows]}

    result = await _try_db(_query)
    if result is not None:
        return result
    return {"data": copy.deepcopy(MOCK_JOBS)}


@router.post("/jobs")
async def create_job(body: JobCreate):
    """Create a new scheduled job."""
    if body.job_type not in ("report", "sync", "cleanup"):
        raise HTTPException(400, "job_type must be one of: report, sync, cleanup")

    async def _query(db):
        from sqlalchemy import text
        import json as _json
        sql = (
            "INSERT INTO scheduled_jobs (name, cron, job_type, config, is_active, last_run) "
            "VALUES (:name, :cron, :job_type, :config, :is_active, NULL) RETURNING id"
        )
        row = (await db.execute(text(sql), {
            "name": body.name, "cron": body.cron, "job_type": body.job_type,
            "config": _json.dumps(body.config) if body.config else None,
            "is_active": body.is_active,
        })).mappings().first()
        await db.commit()
        new_id = int(row["id"]) if row else None
        return {
            "id": new_id, "name": body.name, "cron": body.cron,
            "job_type": body.job_type, "config": body.config,
            "is_active": body.is_active, "last_run": None,
        }

    result = await _try_db(_query)
    if result is not None:
        return result

    global _next_mock_id
    new_id = _next_mock_id
    _next_mock_id += 1
    mock_job = {
        "id": new_id, "name": body.name, "cron": body.cron,
        "job_type": body.job_type, "config": body.config,
        "is_active": body.is_active, "last_run": None,
    }
    MOCK_JOBS.append(mock_job)
    return mock_job


@router.put("/jobs/{job_id}")
async def update_job(job_id: int, body: JobUpdate):
    """Update an existing scheduled job."""
    if body.job_type is not None and body.job_type not in ("report", "sync", "cleanup"):
        raise HTTPException(400, "job_type must be one of: report, sync, cleanup")

    async def _query(db):
        from sqlalchemy import text
        import json as _json
        sets, params = [], {"id": job_id}
        for key, val in body.model_dump(exclude_unset=True).items():
            if key == "config":
                sets.append(f"{key} = :{key}")
                params[key] = _json.dumps(val) if val else None
            else:
                sets.append(f"{key} = :{key}")
                params[key] = val
        if not sets:
            return None
        sql = f"UPDATE scheduled_jobs SET {','.join(sets)} WHERE id = :id RETURNING id"
        row = (await db.execute(text(sql), params)).mappings().first()
        await db.commit()
        return row is not None

    result = await _try_db(_query)
    if result is not None:
        for j in MOCK_JOBS:
            if j["id"] == job_id:
                j.update(body.model_dump(exclude_unset=True))
                return j
        return {"ok": True}

    for j in MOCK_JOBS:
        if j["id"] == job_id:
            j.update(body.model_dump(exclude_unset=True))
            return j
    raise HTTPException(404, "Job not found")


@router.delete("/jobs/{job_id}")
async def delete_job(job_id: int):
    """Delete a scheduled job."""
    async def _query(db):
        from sqlalchemy import text
        await db.execute(text("DELETE FROM scheduled_jobs WHERE id = :id"), {"id": job_id})
        await db.commit()
        return {"ok": True}

    result = await _try_db(_query)
    if result is not None:
        global MOCK_JOBS
        MOCK_JOBS = [j for j in MOCK_JOBS if j["id"] != job_id]
        return result

    original_len = len(MOCK_JOBS)
    MOCK_JOBS[:] = [j for j in MOCK_JOBS if j["id"] != job_id]
    if len(MOCK_JOBS) == original_len:
        raise HTTPException(404, "Job not found")
    return {"ok": True}


@router.post("/jobs/{job_id}/trigger")
async def trigger_job(job_id: int):
    """Manually trigger a scheduled job (logs execution)."""
    # Find job in mock data (DB or mock)
    job = None
    for j in MOCK_JOBS:
        if j["id"] == job_id:
            job = j
            break

    if job is None:
        # Try DB lookup
        async def _lookup(db):
            from sqlalchemy import text
            row = (await db.execute(
                text("SELECT id, name, job_type FROM scheduled_jobs WHERE id = :id"),
                {"id": job_id},
            )).mappings().first()
            return dict(row) if row else None

        result = await _try_db(_lookup)
        if result is None:
            raise HTTPException(404, "Job not found")
        job = result

    now = datetime.now().isoformat(timespec="seconds")
    logger.info("Job triggered: id=%s name=%s type=%s at %s", job_id, job.get("name"), job.get("job_type"), now)

    # Update last_run in mock
    if job is not None and "last_run" in job:
        job["last_run"] = now

    return {"ok": True, "message": "Job executed", "triggered_at": now}
