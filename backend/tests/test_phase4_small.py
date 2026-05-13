"""Tests for Phase 4 small features: Scheduler, Search, AI Builder."""
import copy
from unittest.mock import AsyncMock, patch

import pytest


# ══════════════════════════════════════════════════════════
# Scheduler tests
# ══════════════════════════════════════════════════════════

_SEED_JOBS = [
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


@pytest.fixture(autouse=True)
def _reset_scheduler():
    """Reset mock state between tests."""
    from app.api import scheduler as sched_mod
    with patch.object(sched_mod, "_try_db", new_callable=AsyncMock, return_value=None):
        sched_mod.MOCK_JOBS = copy.deepcopy(_SEED_JOBS)
        sched_mod._next_mock_id = 10
        yield


@pytest.mark.asyncio
async def test_list_jobs():
    """GET /scheduler/jobs returns seeded mock data."""
    from app.api.scheduler import list_jobs
    result = await list_jobs()
    assert "data" in result
    assert len(result["data"]) == 2
    assert result["data"][0]["name"] == "每日生产报告"


@pytest.mark.asyncio
async def test_create_job():
    """POST /scheduler/jobs creates a new job."""
    from app.api.scheduler import create_job, JobCreate
    body = JobCreate(name="每周清理", cron="0 2 * * 0", job_type="cleanup", is_active=False)
    result = await create_job(body)
    assert result["name"] == "每周清理"
    assert result["job_type"] == "cleanup"
    assert result["is_active"] is False
    assert result["id"] is not None

    # Verify it appears in listing
    from app.api.scheduler import list_jobs
    all_jobs = await list_jobs()
    assert len(all_jobs["data"]) == 3


@pytest.mark.asyncio
async def test_create_job_invalid_type():
    """POST /scheduler/jobs rejects invalid job_type."""
    from fastapi import HTTPException
    from app.api.scheduler import create_job, JobCreate
    body = JobCreate(name="Bad", cron="* * * * *", job_type="invalid")
    with pytest.raises(HTTPException) as exc_info:
        await create_job(body)
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_trigger_job():
    """POST /scheduler/jobs/{id}/trigger executes and updates last_run."""
    from app.api.scheduler import trigger_job
    result = await trigger_job(job_id=1)
    assert result["ok"] is True
    assert result["message"] == "Job executed"
    assert result["triggered_at"] is not None


@pytest.mark.asyncio
async def test_trigger_job_not_found():
    """POST /scheduler/jobs/{id}/trigger returns 404 for missing."""
    from fastapi import HTTPException
    from app.api.scheduler import trigger_job
    with pytest.raises(HTTPException) as exc_info:
        await trigger_job(job_id=9999)
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_update_job():
    """PUT /scheduler/jobs/{id} updates a job."""
    from app.api.scheduler import update_job, JobUpdate
    body = JobUpdate(name="更新后的报告", is_active=False)
    result = await update_job(job_id=1, body=body)
    assert result["name"] == "更新后的报告"
    assert result["is_active"] is False


@pytest.mark.asyncio
async def test_delete_job():
    """DELETE /scheduler/jobs/{id} removes a job."""
    from app.api.scheduler import delete_job, list_jobs
    result = await delete_job(job_id=1)
    assert result["ok"] is True

    all_jobs = await list_jobs()
    assert len(all_jobs["data"]) == 1
    assert all_jobs["data"][0]["id"] == 2


# ══════════════════════════════════════════════════════════
# Search tests
# ══════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_search_returns_results():
    """GET /search?q=keyword returns matching results from mock data."""
    from app.api.search import cross_entity_search
    result = await cross_entity_search(q="DMG")
    assert "results" in result
    assert result["total"] > 0
    # Should find in equipment mock data
    model_names = [r["model_name"] for r in result["results"]]
    assert "equipment" in model_names


@pytest.mark.asyncio
async def test_search_returns_supplier_results():
    """GET /search?q=宝钢 returns supplier results."""
    from app.api.search import cross_entity_search
    result = await cross_entity_search(q="宝钢")
    assert result["total"] > 0
    model_names = [r["model_name"] for r in result["results"]]
    assert "suppliers" in model_names


@pytest.mark.asyncio
async def test_search_no_results():
    """GET /search?q=nonexistent returns empty results."""
    from app.api.search import cross_entity_search
    result = await cross_entity_search(q="zzzznonexistent999")
    assert result["total"] == 0
    assert result["results"] == []


@pytest.mark.asyncio
async def test_search_filters_by_models():
    """GET /search?q=...&models=equipment limits search scope."""
    from app.api.search import cross_entity_search
    result = await cross_entity_search(q="DMG", models="equipment")
    assert result["total"] > 0
    model_names = [r["model_name"] for r in result["results"]]
    assert model_names == ["equipment"]


@pytest.mark.asyncio
async def test_search_respects_limit():
    """Search returns at most 5 records per model."""
    from app.api.search import cross_entity_search
    result = await cross_entity_search(q="a")
    for group in result["results"]:
        assert len(group["records"]) <= 5
    assert result["total"] <= 50


# ══════════════════════════════════════════════════════════
# AI Builder tests
# ══════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_ai_suggest_model_equipment():
    """POST /ai-builder/suggest-model returns equipment fields for 设备 keywords."""
    from app.api.ai_builder import suggest_model, ModelSuggestionRequest
    body = ModelSuggestionRequest(description="我想管理工厂里的设备维修记录")
    result = await suggest_model(body)
    s = result["suggestion"]
    assert "fields" in s
    assert s["name"] == "equipment_maintenance"
    field_names = [f["field_name"] for f in s["fields"]]
    assert "name" in field_names
    assert "fault_desc" in field_names


@pytest.mark.asyncio
async def test_ai_suggest_model_order():
    """POST /ai-builder/suggest-model returns order fields for 订单 keywords."""
    from app.api.ai_builder import suggest_model, ModelSuggestionRequest
    body = ModelSuggestionRequest(description="管理生产订单和工单")
    result = await suggest_model(body)
    s = result["suggestion"]
    assert s["name"] == "production_order"
    field_names = [f["field_name"] for f in s["fields"]]
    assert "order_no" in field_names
    assert "quantity" in field_names


@pytest.mark.asyncio
async def test_ai_suggest_model_supplier():
    """POST /ai-builder/suggest-model returns supplier fields for 供应商 keywords."""
    from app.api.ai_builder import suggest_model, ModelSuggestionRequest
    body = ModelSuggestionRequest(description="管理供应商和采购")
    result = await suggest_model(body)
    s = result["suggestion"]
    assert s["name"] == "supplier_info"
    field_names = [f["field_name"] for f in s["fields"]]
    assert "rating" in field_names


@pytest.mark.asyncio
async def test_ai_suggest_model_generic():
    """POST /ai-builder/suggest-model returns generic fields for unknown keywords."""
    from app.api.ai_builder import suggest_model, ModelSuggestionRequest
    body = ModelSuggestionRequest(description="some random thing")
    result = await suggest_model(body)
    s = result["suggestion"]
    assert s["name"] == "custom_model"
    assert len(s["fields"]) > 0


@pytest.mark.asyncio
async def test_ai_suggest_page_known_model():
    """POST /ai-builder/suggest-page returns layout for known model."""
    from app.api.ai_builder import suggest_page, PageSuggestionRequest
    body = PageSuggestionRequest(model_name="equipment")
    result = await suggest_page(body)
    s = result["suggestion"]
    assert s["paradigm"] == "master-detail"
    assert len(s["layout"]) > 0
    # Check that field types map correctly
    for item in s["layout"]:
        assert "type" in item
        assert "field_name" in item
        assert "col_span" in item
    # name field should be form-input with col_span=2
    name_item = next(i for i in s["layout"] if i["field_name"] == "name")
    assert name_item["type"] == "form-input"
    assert name_item["col_span"] == 2
    # status field should be form-select
    status_item = next(i for i in s["layout"] if i["field_name"] == "status")
    assert status_item["type"] == "form-select"


@pytest.mark.asyncio
async def test_ai_suggest_page_unknown_model():
    """POST /ai-builder/suggest-page returns fallback layout for unknown model."""
    from app.api.ai_builder import suggest_page, PageSuggestionRequest
    body = PageSuggestionRequest(model_name="nonexistent_model")
    result = await suggest_page(body)
    s = result["suggestion"]
    assert s["paradigm"] == "master-detail"
    assert len(s["layout"]) > 0
