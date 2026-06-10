from __future__ import annotations

import asyncio
import copy
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

from sqlalchemy import select

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.database import AsyncSessionLocal  # noqa: E402
from app.models.relational import DynamicRecord, Form, FormLayout, FormVersion, WorkflowDef  # noqa: E402


INITIAL_VERSION = 1
INITIAL_WORKFLOW_VERSION = "v1"


def _json_obj(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return copy.deepcopy(value)
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return copy.deepcopy(parsed) if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _reset_meta(meta: Any) -> dict[str, Any]:
    next_meta = _json_obj(meta)
    next_meta["draftVersion"] = INITIAL_VERSION
    next_meta["publishedVersion"] = INITIAL_VERSION
    return next_meta


def _reset_form_config(config: Any) -> dict[str, Any]:
    next_config = _json_obj(config)
    next_config["publishedSchemaVersion"] = INITIAL_VERSION
    for key in ("viewConfigMeta", "workflowDesigner", "analyticsDesignMeta"):
        if key in next_config or key == "viewConfigMeta":
            next_config[key] = _reset_meta(next_config.get(key))
    return next_config


def _reset_snapshot(snapshot: Any) -> dict[str, Any]:
    next_snapshot = _json_obj(snapshot)
    form_payload = _json_obj(next_snapshot.get("form"))
    if form_payload:
        form_payload["config"] = _reset_form_config(form_payload.get("config"))
        next_snapshot["form"] = form_payload
    return next_snapshot


def _reset_layout_config(config: Any) -> dict[str, Any]:
    next_config = _json_obj(config)
    if "meta" in next_config:
        next_config["meta"] = _reset_meta(next_config.get("meta"))
    return next_config


def _reset_workflow_config(config: Any) -> str:
    workflow_config = _json_obj(config)
    workflow_config["version"] = INITIAL_WORKFLOW_VERSION
    return json.dumps(workflow_config, ensure_ascii=False)


async def main() -> None:
    async with AsyncSessionLocal() as db:
        forms = (await db.execute(select(Form))).scalars().all()
        for form in forms:
            form.config = _reset_form_config(form.config)

        layouts = (await db.execute(select(FormLayout))).scalars().all()
        for layout in layouts:
            layout.config = _reset_layout_config(layout.config)

        workflows = (await db.execute(select(WorkflowDef))).scalars().all()
        for workflow in workflows:
            workflow.version = INITIAL_VERSION
            workflow.config = _reset_workflow_config(workflow.config)

        records = (await db.execute(select(DynamicRecord))).scalars().all()
        for record in records:
            record.schema_version = INITIAL_VERSION

        versions = (await db.execute(select(FormVersion).order_by(FormVersion.form_id, FormVersion.id))).scalars().all()
        versions_by_form: dict[int, list[FormVersion]] = defaultdict(list)
        for version in versions:
            versions_by_form[version.form_id].append(version)

        deleted_versions = 0
        for form_versions in versions_by_form.values():
            keep = max(form_versions, key=lambda item: item.id)
            for version in form_versions:
                if version.id != keep.id:
                    await db.delete(version)
                    deleted_versions += 1
            await db.flush()
            keep.version = INITIAL_VERSION
            keep.status = "published"
            keep.snapshot = _reset_snapshot(keep.snapshot)
            keep.impact_report = _json_obj(keep.impact_report)
            keep.impact_report["next_version"] = INITIAL_VERSION
            keep.impact_report["latest_version"] = INITIAL_VERSION

        await db.commit()
        print(
            "reset form versions:",
            f"forms={len(forms)}",
            f"workflows={len(workflows)}",
            f"records={len(records)}",
            f"versions_kept={len(versions_by_form)}",
            f"versions_deleted={deleted_versions}",
        )


if __name__ == "__main__":
    asyncio.run(main())
