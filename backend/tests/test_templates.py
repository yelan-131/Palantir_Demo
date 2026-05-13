"""Tests for the Template Marketplace — list, detail, instantiate."""
from __future__ import annotations

import pytest


# ── List templates ───────────────────────────────────────

@pytest.mark.asyncio
async def test_list_templates_returns_3():
    """GET /templates returns 3 templates."""
    from app.api.templates import list_templates
    result = await list_templates()
    assert "data" in result
    assert len(result["data"]) == 3
    assert "categories" in result
    # Should be grouped into 3 categories
    assert len(result["categories"]) == 3


@pytest.mark.asyncio
async def test_list_templates_categories():
    """Templates are grouped into correct categories."""
    from app.api.templates import list_templates
    result = await list_templates()
    cats = result["categories"]
    assert "生产管理" in cats
    assert "质量管理" in cats
    assert "供应链" in cats
    # Each category summary has required fields
    for cat_items in cats.values():
        for item in cat_items:
            assert "id" in item
            assert "name" in item
            assert "icon" in item
            assert "field_count" in item


# ── Get template detail ─────────────────────────────────

@pytest.mark.asyncio
async def test_get_template_by_id():
    """GET /templates/{id} returns full template config."""
    from app.api.templates import get_template
    result = await get_template(template_id=1)
    assert "data" in result
    t = result["data"]
    assert t["id"] == 1
    assert t["name"] == "设备管理"
    assert "model" in t
    assert "fields" in t
    assert "page" in t
    assert len(t["fields"]) == 6  # equipment has 6 fields


@pytest.mark.asyncio
async def test_get_template_2_inspection():
    """GET /templates/2 returns quality inspection template."""
    from app.api.templates import get_template
    result = await get_template(template_id=2)
    t = result["data"]
    assert t["name"] == "质检流程"
    assert t["page"]["paradigm"] == "form-flow"


@pytest.mark.asyncio
async def test_get_template_3_supplier():
    """GET /templates/3 returns supplier management template."""
    from app.api.templates import get_template
    result = await get_template(template_id=3)
    t = result["data"]
    assert t["name"] == "供应商管理"
    assert t["page"]["paradigm"] == "master-detail"


@pytest.mark.asyncio
async def test_get_template_not_found():
    """GET /templates/{id} returns 404 for invalid ID."""
    from fastapi import HTTPException
    from app.api.templates import get_template
    with pytest.raises(HTTPException) as exc_info:
        await get_template(template_id=9999)
    assert exc_info.value.status_code == 404


# ── Instantiate template ────────────────────────────────

@pytest.mark.asyncio
async def test_instantiate_creates_records():
    """POST /templates/{id}/instantiate returns mock IDs (DB unavailable in test)."""
    from app.api.templates import instantiate_template, InstantiateRequest
    body = InstantiateRequest()
    result = await instantiate_template(template_id=1, body=body)
    assert "model_id" in result
    assert "page_id" in result
    assert "menu_id" in result
    assert "route_path" in result
    assert result["route_path"].startswith("/dynamic/")


@pytest.mark.asyncio
async def test_instantiate_with_custom_name():
    """POST /templates/{id}/instantiate with custom name uses that name."""
    from app.api.templates import instantiate_template, InstantiateRequest
    body = InstantiateRequest(name="我的设备管理")
    result = await instantiate_template(template_id=1, body=body)
    assert "model_id" in result
    assert "route_path" in result


@pytest.mark.asyncio
async def test_instantiate_not_found():
    """POST /templates/{id}/instantiate returns 404 for invalid ID."""
    from fastapi import HTTPException
    from app.api.templates import InstantiateRequest, instantiate_template
    body = InstantiateRequest()
    with pytest.raises(HTTPException) as exc_info:
        await instantiate_template(template_id=9999, body=body)
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_instantiate_default_body():
    """POST /templates/{id}/instantiate works with no body (uses defaults)."""
    from app.api.templates import instantiate_template
    # Pass None to simulate omitted body
    result = await instantiate_template(template_id=2)
    assert "model_id" in result
    assert "page_id" in result


# ── Template data integrity ─────────────────────────────

@pytest.mark.asyncio
async def test_all_templates_have_required_keys():
    """Each template has model, fields, page, and metadata keys."""
    from app.api.templates import list_templates
    result = await list_templates()
    for t in result["data"]:
        assert "id" in t
        assert "name" in t
        assert "category" in t
        assert "description" in t
        assert "icon" in t
        assert "model" in t
        assert "fields" in t
        assert "page" in t
        assert isinstance(t["fields"], list)
        assert len(t["fields"]) > 0
        assert "name" in t["model"]
        assert "table_name" in t["model"]
        assert "name" in t["page"]
        assert "paradigm" in t["page"]


@pytest.mark.asyncio
async def test_enum_fields_have_enum_values():
    """Fields with field_type 'enum' must have enum_values."""
    from app.api.templates import list_templates
    result = await list_templates()
    for t in result["data"]:
        for f in t["fields"]:
            if f["field_type"] == "enum":
                assert f.get("enum_values") is not None, (
                    f"Template '{t['name']}' field '{f['field_name']}' is enum but has no enum_values"
                )
