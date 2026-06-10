"""Template Marketplace for optional application and industry demo packages."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

ROOT = Path(__file__).resolve().parents[3]
TEMPLATE_ROOT = ROOT / "data" / "templates"


class InstantiateRequest(BaseModel):
    name: Optional[str] = None
    customizations: Optional[dict] = None


def _load_template_manifests() -> list[dict]:
    templates: list[dict] = []
    if TEMPLATE_ROOT.exists():
        for manifest_path in sorted(TEMPLATE_ROOT.glob("*/manifest.json")):
            with open(manifest_path, encoding="utf-8") as handle:
                manifest = json.load(handle)
            templates.append(_template_from_manifest(len(templates) + 1, manifest, manifest_path))
    return templates


def _template_from_manifest(numeric_id: int, manifest: dict, manifest_path: Path) -> dict:
    legacy_tables = ((manifest.get("tables") or {}).get("legacyDemoTables") or [])
    config = {
        "packageId": manifest.get("id"),
        "version": manifest.get("version"),
        "seedData": manifest.get("seedData"),
        "entrypoints": manifest.get("entrypoints"),
        "assets": manifest.get("assets"),
        "models": [{"name": table_name, "source": "legacy_demo_table"} for table_name in legacy_tables],
        "pages": [],
        "rules": [],
        "menus": [],
        "manifestPath": str(manifest_path.relative_to(ROOT)).replace("\\", "/"),
    }
    return {
        "id": numeric_id,
        "package_id": manifest.get("id"),
        "name": manifest.get("name") or manifest.get("id") or f"Template {numeric_id}",
        "name_en": manifest.get("id"),
        "category": manifest.get("category") or "general",
        "description": manifest.get("description") or "",
        "icon": "AppstoreOutlined",
        "config": config,
        "is_public": True,
        "created_at": None,
    }


def _templates() -> list[dict]:
    return _load_template_manifests()


@router.get("")
async def list_templates():
    templates = _templates()
    categories: dict[str, list[dict]] = {}
    for template in templates:
        category = template["category"]
        categories.setdefault(category, []).append(template)
    return {"data": templates, "categories": categories}


@router.get("/{template_id}")
async def get_template(template_id: int):
    for template in _templates():
        if template["id"] == template_id:
            return {"data": template}
    raise HTTPException(404, f"Template {template_id} not found")


@router.post("/{template_id}/instantiate")
async def instantiate_template(template_id: int, body: InstantiateRequest | None = None):
    if body is None:
        body = InstantiateRequest()
    for template in _templates():
        if template["id"] == template_id:
            return {
                "ok": True,
                "status": "packaged",
                "message": "行业 Demo 包已在模板市场登记；平台核心不会自动导入种子数据。需要演示数据时请显式运行包内 seed 入口。",
                "template": template,
                "customizations": body.customizations or {},
            }
    raise HTTPException(404, f"Template {template_id} not found")
