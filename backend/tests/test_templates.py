"""Tests for the Template Marketplace — package manifests, detail, instantiate."""
from __future__ import annotations

import json

import pytest
from fastapi import HTTPException


@pytest.fixture()
def template_root(tmp_path, monkeypatch):
    from app.api import templates as templates_mod

    root = tmp_path / "data" / "templates"
    for package_id, name, category in (
        ("alpha-pack", "Alpha 包", "production"),
        ("beta-pack", "Beta 包", "quality"),
    ):
        package_dir = root / package_id
        package_dir.mkdir(parents=True)
        (package_dir / "manifest.json").write_text(
            json.dumps({
                "id": package_id,
                "name": name,
                "category": category,
                "version": "0.1.0",
                "description": f"{name} 描述",
                "seedData": {"path": "data/seed", "mode": "optional"},
                "tables": {"legacyDemoTables": ["equipment", "suppliers"]},
            }, ensure_ascii=False),
            encoding="utf-8",
        )
    monkeypatch.setattr(templates_mod, "ROOT", tmp_path)
    monkeypatch.setattr(templates_mod, "TEMPLATE_ROOT", root)
    return root


@pytest.mark.asyncio
async def test_list_templates_reads_package_manifests(template_root):
    from app.api.templates import list_templates

    result = await list_templates()

    assert [t["package_id"] for t in result["data"]] == ["alpha-pack", "beta-pack"]
    assert [t["id"] for t in result["data"]] == [1, 2]
    assert set(result["categories"]) == {"production", "quality"}
    alpha = result["data"][0]
    assert alpha["name"] == "Alpha 包"
    assert alpha["is_public"] is True
    assert alpha["config"]["manifestPath"] == "data/templates/alpha-pack/manifest.json"
    assert alpha["config"]["models"] == [
        {"name": "equipment", "source": "legacy_demo_table"},
        {"name": "suppliers", "source": "legacy_demo_table"},
    ]


@pytest.mark.asyncio
async def test_list_templates_without_template_root_is_empty(tmp_path, monkeypatch):
    from app.api import templates as templates_mod

    monkeypatch.setattr(templates_mod, "TEMPLATE_ROOT", tmp_path / "missing")
    result = await templates_mod.list_templates()
    assert result == {"data": [], "categories": {}}


@pytest.mark.asyncio
async def test_get_template_by_id(template_root):
    from app.api.templates import get_template

    result = await get_template(template_id=2)
    assert result["data"]["package_id"] == "beta-pack"
    assert result["data"]["category"] == "quality"


@pytest.mark.asyncio
async def test_get_template_not_found(template_root):
    from app.api.templates import get_template

    with pytest.raises(HTTPException) as exc_info:
        await get_template(template_id=9999)
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_instantiate_registers_package_without_importing_seed_data(template_root):
    from app.api.templates import InstantiateRequest, instantiate_template

    result = await instantiate_template(
        template_id=1,
        body=InstantiateRequest(name="我的包", customizations={"theme": "dark"}),
    )

    assert result["ok"] is True
    assert result["status"] == "packaged"
    assert result["template"]["package_id"] == "alpha-pack"
    assert result["customizations"] == {"theme": "dark"}


@pytest.mark.asyncio
async def test_instantiate_default_body(template_root):
    from app.api.templates import instantiate_template

    result = await instantiate_template(template_id=2)
    assert result["status"] == "packaged"
    assert result["customizations"] == {}


@pytest.mark.asyncio
async def test_instantiate_not_found(template_root):
    from app.api.templates import InstantiateRequest, instantiate_template

    with pytest.raises(HTTPException) as exc_info:
        await instantiate_template(template_id=9999, body=InstantiateRequest())
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_repository_ships_manufacturing_demo_package():
    from app.api.templates import list_templates

    result = await list_templates()
    packages = {t["package_id"]: t for t in result["data"]}
    assert "manufacturing-demo" in packages
    assert packages["manufacturing-demo"]["config"]["seedData"]["mode"] == "optional"
