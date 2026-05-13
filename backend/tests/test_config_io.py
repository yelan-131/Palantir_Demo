"""Tests for Configuration Import/Export (config_io.py)."""

import copy
import pytest


# ── Fixtures ──────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _reset_mock_state():
    """Reset all shared mock stores between tests."""
    from app.api import config_io as cio
    from app.api import _model_driven_shared as shared
    from app.api import rules as rules_mod

    orig_models = copy.deepcopy(shared.MOCK_MODELS)
    orig_pages = copy.deepcopy(shared.MOCK_PAGES)
    orig_menus = copy.deepcopy(shared.MOCK_MENUS)
    orig_rules = copy.deepcopy(rules_mod.MOCK_RULES)
    yield
    shared.MOCK_MODELS.clear()
    shared.MOCK_MODELS.extend(orig_models)
    shared.MOCK_PAGES.clear()
    shared.MOCK_PAGES.extend(orig_pages)
    shared.MOCK_MENUS.clear()
    shared.MOCK_MENUS.extend(orig_menus)
    rules_mod.MOCK_RULES.clear()
    rules_mod.MOCK_RULES.extend(orig_rules)


# ── Export tests ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_export_returns_valid_structure():
    """GET /config/export returns a dict with all required sections."""
    from app.api.config_io import export_all_config
    result = await export_all_config()

    assert "version" in result
    assert "export_time" in result
    assert "models" in result
    assert "pages" in result
    assert "menus" in result
    assert "rules" in result

    assert isinstance(result["models"], list)
    assert isinstance(result["pages"], list)
    assert isinstance(result["menus"], list)
    assert isinstance(result["rules"], list)


@pytest.mark.asyncio
async def test_export_has_version_and_time():
    """Export payload contains version '1.0' and a valid ISO timestamp."""
    from app.api.config_io import export_all_config
    result = await export_all_config()

    assert result["version"] == "1.0"
    assert isinstance(result["export_time"], str)
    # Must be parseable as ISO datetime
    from datetime import datetime
    datetime.fromisoformat(result["export_time"])


@pytest.mark.asyncio
async def test_export_strips_ids():
    """Exported items should not contain internal 'id' fields."""
    from app.api.config_io import export_all_config
    result = await export_all_config()

    for model in result["models"]:
        assert "id" not in model
        for field in model.get("fields", []):
            assert "id" not in field
    for page in result["pages"]:
        assert "id" not in page
    for menu in result["menus"]:
        assert "id" not in menu
    for rule in result["rules"]:
        assert "id" not in rule


@pytest.mark.asyncio
async def test_export_includes_models_with_fields():
    """Exported models contain their field definitions."""
    from app.api.config_io import export_all_config
    result = await export_all_config()

    assert len(result["models"]) >= 3  # equipment, supplier, product
    equipment = next(m for m in result["models"] if m["name"] == "equipment")
    assert len(equipment["fields"]) >= 5
    field_names = [f["field_name"] for f in equipment["fields"]]
    assert "name" in field_names
    assert "status" in field_names
    assert "health_score" in field_names


# ── Import (merge mode) tests ─────────────────────────────


@pytest.mark.asyncio
async def test_import_merge_adds_new_items():
    """Merge mode adds items that don't already exist."""
    from app.api._model_driven_shared import MOCK_MODELS, MOCK_PAGES, MOCK_MENUS
    from app.api.config_io import import_config, ImportRequest
    from app.api.rules import MOCK_RULES

    config = {
        "models": [
            {
                "name": "new_model",
                "label": "新模型",
                "icon": "StarOutlined",
                "table_name": "new_table",
                "description": "Test new model",
                "is_system": False,
                "fields": [
                    {"field_name": "code", "label": "编码", "field_type": "string", "required": True},
                ],
            }
        ],
        "pages": [
            {"name": "new-page", "title": "新页面", "paradigm": "table",
             "model_name": "new_model", "is_published": False},
        ],
        "menus": [
            {"title": "新菜单", "icon": "StarOutlined", "sort_order": 200},
        ],
        "rules": [
            {"name": "新规则", "model_id": 1, "rule_type": "validation", "field_name": "code",
             "condition": '{"operator": "required"}', "message": "Code is required"},
        ],
    }

    body = ImportRequest(config=config, mode="merge")
    result = await import_config(body)

    assert result["imported"]["models"] == 1
    assert result["imported"]["pages"] == 1
    assert result["imported"]["menus"] == 1
    assert result["imported"]["rules"] == 1


@pytest.mark.asyncio
async def test_import_merge_skips_existing():
    """Merge mode skips items whose name/title already exists."""
    from app.api.config_io import import_config, ImportRequest
    from app.api._model_driven_shared import MOCK_MODELS, MOCK_PAGES, MOCK_MENUS
    from app.api.rules import MOCK_RULES

    original_model_count = len(MOCK_MODELS)
    original_page_count = len(MOCK_PAGES)
    original_menu_count = len(MOCK_MENUS)
    original_rule_count = len(MOCK_RULES)

    config = {
        "models": [
            {
                "name": "equipment",  # already exists in mock
                "label": "设备",
                "icon": "ToolOutlined",
                "table_name": "equipment",
                "fields": [],
            }
        ],
        "pages": [
            {"name": "equipment-list", "title": "设备管理"},  # already exists
        ],
        "menus": [
            {"title": "动态页面"},  # already exists (parent_id=None)
        ],
        "rules": [
            {"name": "设备名称必填", "model_id": 1},  # already exists
        ],
    }

    body = ImportRequest(config=config, mode="merge")
    result = await import_config(body)

    assert result["skipped"]["models"] == 1
    assert result["skipped"]["pages"] == 1
    assert result["skipped"]["menus"] == 1
    assert result["skipped"]["rules"] == 1
    assert result["imported"]["models"] == 0
    assert result["imported"]["pages"] == 0
    assert result["imported"]["menus"] == 0
    assert result["imported"]["rules"] == 0

    # Counts should remain unchanged
    assert len(MOCK_MODELS) == original_model_count
    assert len(MOCK_PAGES) == original_page_count
    assert len(MOCK_MENUS) == original_menu_count
    assert len(MOCK_RULES) == original_rule_count


# ── Import (replace mode) tests ───────────────────────────


@pytest.mark.asyncio
async def test_import_replace_clears_and_imports():
    """Replace mode deletes all existing items then imports the payload."""
    from app.api._model_driven_shared import MOCK_MODELS, MOCK_PAGES, MOCK_MENUS
    from app.api.config_io import import_config, ImportRequest
    from app.api.rules import MOCK_RULES

    config = {
        "models": [
            {
                "name": "only_model",
                "label": "唯一模型",
                "icon": "PlusOutlined",
                "table_name": "only_table",
                "fields": [
                    {"field_name": "id", "label": "ID", "field_type": "int"},
                ],
            }
        ],
        "pages": [],
        "menus": [],
        "rules": [],
    }

    body = ImportRequest(config=config, mode="replace")
    result = await import_config(body)

    assert result["imported"]["models"] == 1
    assert result["imported"]["pages"] == 0
    assert result["imported"]["menus"] == 0
    assert result["imported"]["rules"] == 0

    # After replace, only the imported model should remain
    assert len(MOCK_MODELS) == 1
    assert MOCK_MODELS[0]["name"] == "only_model"
    assert len(MOCK_PAGES) == 0
    assert len(MOCK_MENUS) == 0
    assert len(MOCK_RULES) == 0


# ── Single model export tests ────────────────────────────


@pytest.mark.asyncio
async def test_single_model_export():
    """GET /config/export/{model_name} returns only that model's config."""
    from app.api.config_io import export_single_model_config
    result = await export_single_model_config("equipment")

    assert result["version"] == "1.0"
    assert "export_time" in result
    assert len(result["models"]) == 1
    assert result["models"][0]["name"] == "equipment"
    assert len(result["models"][0]["fields"]) >= 5
    assert "id" not in result["models"][0]  # stripped

    # Should include related pages
    assert len(result["pages"]) >= 1
    assert result["pages"][0]["model_name"] == "equipment"

    # No menus or rules in single-model export
    assert result["menus"] == []
    assert result["rules"] == []


@pytest.mark.asyncio
async def test_single_model_export_not_found():
    """GET /config/export/{model_name} returns 404 for unknown model."""
    from fastapi import HTTPException
    from app.api.config_io import export_single_model_config

    with pytest.raises(HTTPException) as exc_info:
        await export_single_model_config("nonexistent_model_xyz")
    assert exc_info.value.status_code == 404


# ── Edge case tests ──────────────────────────────────────


@pytest.mark.asyncio
async def test_import_invalid_mode():
    """Import rejects invalid mode value."""
    from fastapi import HTTPException
    from app.api.config_io import import_config, ImportRequest

    body = ImportRequest(config={"models": []}, mode="invalid_mode")
    with pytest.raises(HTTPException) as exc_info:
        await import_config(body)
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_import_empty_config():
    """Import with empty config sections succeeds with zero counts."""
    from app.api.config_io import import_config, ImportRequest

    body = ImportRequest(config={"models": [], "pages": [], "menus": [], "rules": []}, mode="merge")
    result = await import_config(body)

    assert result["imported"]["models"] == 0
    assert result["imported"]["pages"] == 0
    assert result["imported"]["menus"] == 0
    assert result["imported"]["rules"] == 0
