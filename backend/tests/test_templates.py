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


@pytest.mark.asyncio
async def test_saved_application_template_round_trip_and_tenant_boundary(monkeypatch):
    from unittest.mock import AsyncMock

    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.api import templates
    from app.api.deps import get_current_user, get_db
    from app.models.relational import Application, ApplicationForm, ApplicationMenuNode, Base, Form, Tenant
    from app.services import application_templates

    engine = create_async_engine('sqlite+aiosqlite:///:memory:')
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            db.add_all([Tenant(id=1, name='Owner', slug='owner'), Tenant(id=2, name='Other', slug='other')])
            await db.flush()
            app = Application(tenant_id=1, name='Inspection', code='inspection', default_route='/dynamic/inspection')
            form = Form(tenant_id=1, name='Inspection records', code='inspection')
            db.add_all([app, form])
            await db.flush()
            group = ApplicationMenuNode(tenant_id=1, application_id=app.id, node_type='group', title='On site')
            db.add(group)
            await db.flush()
            db.add(ApplicationMenuNode(tenant_id=1, application_id=app.id, parent_id=group.id, node_type='form',
                                       title='Records', form_id=form.id, route_path=app.default_route, default_entry=True,
                                       config={'description': 'Daily log', 'permission_mode': 'custom', 'role_ids': [11]}))
            await db.commit()
            source_id, form_id, group_id = app.id, form.id, group.id

        actor = {'uid': 1, 'tenant_id': 1, 'is_admin': True}

        async def database():
            async with sessions() as db:
                yield db

        api = FastAPI()
        api.include_router(templates.router, prefix='/templates')
        api.dependency_overrides[get_db] = database
        api.dependency_overrides[get_current_user] = lambda: actor
        monkeypatch.setattr(application_templates, 'write_audit_log', AsyncMock())
        async with AsyncClient(transport=ASGITransport(app=api), base_url='http://test') as client:
            path = '/templates/applications'
            saved = await client.post(f'{path}/{source_id}')
            assert saved.status_code == 200, saved.text
            template_id = saved.json()['data']['id']
            repeated = await client.post(f'{path}/{source_id}')
            assert repeated.json()['data']['id'] == template_id
            listed = (await client.get(path)).json()['data']
            assert len(listed) == 1 and listed[0]['config']['forms'] == [form_id]

            actor['is_admin'] = False
            assert (await client.get(path)).status_code == 403
            actor.update(tenant_id=2, is_admin=True)
            assert (await client.get(path)).json()['data'] == []
            assert (await client.post(f'{path}/{template_id}/instantiate')).status_code == 404
            assert (await client.post(f'{path}/{source_id}')).status_code == 404
            actor['tenant_id'] = 1

            async with sessions() as db:
                original_group = await db.get(ApplicationMenuNode, group_id)
                original_group.title = 'Renamed after saving'
                await db.commit()
            created = await client.post(f'{path}/{template_id}/instantiate')
            assert created.status_code == 200, created.text
            draft_id = created.json()['data']['id']

        async with sessions() as db:
            draft = await db.get(Application, draft_id)
            assert draft.id != source_id and draft.status == 'draft' and draft.default_route == '/dynamic/inspection'
            rows = (await db.scalars(select(ApplicationMenuNode).where(ApplicationMenuNode.application_id == draft_id))).all()
            parent = next(row for row in rows if row.node_type == 'group')
            child = next(row for row in rows if row.node_type == 'form')
            assert parent.title == 'On site' and child.parent_id == parent.id
            assert child.form_id == form_id and child.default_entry and child.config == {'description': 'Daily log'}
            binding = await db.scalar(select(ApplicationForm).where(ApplicationForm.application_id == draft_id))
            assert binding.form_id == form_id and binding.enabled
    finally:
        await engine.dispose()
