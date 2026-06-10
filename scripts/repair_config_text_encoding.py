"""Repair text encoding artifacts in platform configuration tables.

Configuration tables are allowed to use JSON for structured UI/layout metadata.
This script only fixes broken text values inside those config objects.
"""

from __future__ import annotations

import asyncio
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.relational import Form, FormVersion


UNICODE_ESCAPE_RE = re.compile(r"\\u[0-9a-fA-F]{4}")


def decode_literal_unicode_escapes(value: str) -> str:
    if not UNICODE_ESCAPE_RE.search(value):
        return value
    try:
        return value.encode("utf-8").decode("unicode_escape")
    except UnicodeDecodeError:
        return value


def repair_text(value: Any, *, form_code: str | None = None) -> tuple[Any, bool]:
    if isinstance(value, str):
        next_value = decode_literal_unicode_escapes(value)
        if next_value == "????" and form_code == "ai_material_master_form_5":
            next_value = "业务信息"
        return next_value, next_value != value
    if isinstance(value, list):
        changed = False
        next_items = []
        for item in value:
            next_item, item_changed = repair_text(item, form_code=form_code)
            changed = changed or item_changed
            next_items.append(next_item)
        return next_items, changed
    if isinstance(value, dict):
        changed = False
        next_dict = {}
        for key, item in value.items():
            next_item, item_changed = repair_text(item, form_code=form_code)
            changed = changed or item_changed
            next_dict[key] = next_item
        return next_dict, changed
    return value, False


def snapshot_form_code(snapshot: dict) -> str | None:
    form = snapshot.get("form") if isinstance(snapshot, dict) else None
    if isinstance(form, dict):
        return form.get("code")
    return None


async def main() -> None:
    changed_forms = 0
    changed_versions = 0
    async with AsyncSessionLocal() as db:
        forms = (await db.execute(select(Form))).scalars().all()
        for form in forms:
            if not isinstance(form.config, dict):
                continue
            next_config, changed = repair_text(form.config, form_code=form.code)
            if changed:
                form.config = next_config
                changed_forms += 1

        versions = (await db.execute(select(FormVersion))).scalars().all()
        for version in versions:
            form_code = snapshot_form_code(version.snapshot or {})
            next_snapshot, snapshot_changed = repair_text(version.snapshot, form_code=form_code)
            next_report, report_changed = repair_text(version.impact_report, form_code=form_code)
            if snapshot_changed:
                version.snapshot = next_snapshot
            if report_changed:
                version.impact_report = next_report
            if snapshot_changed or report_changed:
                changed_versions += 1

        await db.commit()

    print(f"changed_forms={changed_forms}")
    print(f"changed_versions={changed_versions}")


if __name__ == "__main__":
    asyncio.run(main())
