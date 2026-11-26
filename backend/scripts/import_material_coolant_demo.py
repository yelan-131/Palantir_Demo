"""Rehearse, install, or verify the material coolant case in the local default tenant.

From backend, run `python -m scripts.import_material_coolant_demo`.
Use `--apply` to save changes or `--verify` to read the installed case.
"""

import argparse
import asyncio
import json
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import func, select

from app.config import settings
from app.database import AsyncSessionLocal, _engine
from app.models.relational import OntologyObject, OntologyRelation, Tenant, User
from app.services import field_uniqueness, ontology_record_service, ontology_service, records
from app.services.form_schemas import DynamicRecordCreate
from scripts.import_relationship_demo import import_fixture


FIXTURE = Path(__file__).resolve().parents[2] / "data" / "seed" / "material_coolant_comparison.json"
TRIAL_INCLUDE = "![[材料耐介质试验]]"
RECORD_LINK = {"source_field": "material_grade", "target_field": "record_no"}


async def find_object(db, user, code):
    return await db.scalar(select(OntologyObject).where(
        OntologyObject.tenant_id == user["tenant_id"], OntologyObject.code == code,
    ))


async def ensure_record(db, user, obj, expected, *, verify_only):
    key = expected["record_no"]
    try:
        return await ontology_record_service.get_instance(db, user, obj.id, key), False
    except HTTPException as exc:
        if exc.status_code != 404 or verify_only:
            raise
    binding = (obj.metadata_json or {}).get("record_binding") or {}
    if binding.get("key_field") != "record_no" or any(
        binding.get("property_fields", {}).get(code) != code for code in expected
    ):
        raise ValueError(f"Object binding differs from the fixture: {obj.code}")
    await records.create_record(binding["form_id"], DynamicRecordCreate(data=expected), db, user,
                                defer_commit=True, source="relationship_demo")
    return await ontology_record_service.get_instance(db, user, obj.id, key), True


async def ensure_trial_link(db, user, data, *, verify_only):
    rel = await db.scalar(select(OntologyRelation).where(
        OntologyRelation.tenant_id == user["tenant_id"], OntologyRelation.code == data["code"],
    ))
    if rel is None and not verify_only:
        rel = await ontology_service.create_or_update_relation(
            db, tenant_id=user["tenant_id"], actor_id=user["uid"], data=data,
        )
        await ontology_record_service.set_record_link(db, user, rel.id, RECORD_LINK)
    if (rel is None or rel.status != "published" or not rel.graph_enabled
            or rel.source_object_code != data["source_object_code"]
            or rel.target_object_code != data["target_object_code"]
            or (rel.metadata_json or {}).get("record_link") != RECORD_LINK):
        raise ValueError(f"Trial relationship differs from the fixture: {data['code']}")


def legacy_section(trial):
    return (
        "## 冷冻液耐醇解试验\n\n"
        "试验介质为冷冻液，温度 **135 ℃**，时长 **240 h**。下表为厂家公开披露的该工况下试验数据。\n\n"
        "| 指标 | 初始值 | 冷冻液试验后 |\n"
        "| --- | ---: | ---: |\n"
        f"| 拉伸强度 | {trial['tensile_initial_mpa']} MPa | {trial['tensile_after_mpa']} MPa |\n"
        f"| 弯曲强度 | {trial['flexural_initial_mpa']} MPa | {trial['flexural_after_mpa']} MPa |\n\n"
        f"[{trial['source_name']}]({trial['source_url']})"
    )


async def ensure_markdown(db, user, material_id, key, *, legacy=None, apply=False):
    editor = await ontology_record_service.get_instance_editor(db, user, material_id, key)
    if not editor.get("can_edit_note_markdown"):
        raise ValueError(f"Object does not support a standalone Markdown note: {key}")
    original = editor["record_metadata"]
    note = original.get("note_markdown", "")
    if TRIAL_INCLUDE in note.splitlines():
        return "ready"
    if legacy is not None:
        before, matched, after = note.partition(legacy)
        if (not matched or (before and not before.endswith("\n\n"))
                or (after and not after.startswith("\n\n")) or legacy in after):
            return "custom_note_preserved"
        replacement = before + TRIAL_INCLUDE + after
    elif not note.strip():
        replacement = f"巴斯夫 A3WG6 是该组耐醇解试验中的对照材料牌号。\n\n{TRIAL_INCLUDE}"
    else:
        return "custom_note_preserved"
    if not apply:
        return "pending"
    await ontology_record_service.update_instance(
        db, user, material_id, key, {}, {}, editor["token"],
        record_metadata={**original, "note_markdown": replacement}, expected_record_metadata=original,
    )
    return "updated"


async def run(mode):
    if (settings.IS_PRODUCTION or _engine.url.get_backend_name() != "sqlite"
            or Path(_engine.url.database or "").name != "manufoundry-local.db"):
        raise ValueError("The coolant case can only be installed in the designated local SQLite database")
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    reference = fixture["reference_grade"]
    comparison = fixture["comparison_grade"]
    trial_type = fixture["trial_type"]
    trial_link = fixture["trial_grade_relation"]
    verify_only = mode == "verify"
    async with AsyncSessionLocal() as db, db.begin() as transaction:
        tenant_id = await db.scalar(select(Tenant.id).where(Tenant.slug == "default"))
        admin_id = await db.scalar(select(func.min(User.id)).where(
            User.tenant_id == tenant_id, User.is_admin.is_(True), User.is_active.is_(True),
        ))
        if tenant_id is None or admin_id is None:
            raise ValueError("The default local tenant and an active administrator are required")
        user = {"tenant_id": tenant_id, "uid": admin_id, "is_admin": True}
        if not verify_only:
            await field_uniqueness.lock(db, tenant_id)
        material = await find_object(db, user, trial_link["target_object_code"])
        if material is None:
            raise ValueError("Import the water valve materials before installing the coolant case")
        material_id = material.id
        await ontology_record_service.get_instance(db, user, material_id, reference)
        _, grade_created = await ensure_record(db, user, material, comparison, verify_only=verify_only)

        trials = await find_object(db, user, trial_type["code"])
        trial_created = trials is None
        if trial_created:
            if verify_only:
                raise ValueError("The coolant trial type has not been installed")
            await import_fixture(db, user, {"objects": [trial_type], "relations": []})
            trials = await find_object(db, user, trial_type["code"])
        await ensure_trial_link(db, user, trial_link, verify_only=verify_only)
        trial_records_created = len(trial_type["records"]) if trial_created else 0
        for expected in trial_type["records"]:
            actual, created = await ensure_record(db, user, trials, expected, verify_only=verify_only)
            trial_records_created += created
            if any(code not in actual["values"] or actual["values"][code] != value for code, value in expected.items()):
                raise ValueError(f"Stored trial differs from the fixture: {expected['record_no']}")
            if not any(rel["code"] == trial_link["code"] and rel["state"] == "matched"
                       and any(row["key"] == expected["material_grade"] for row in rel["records"])
                       for rel in actual["relations"]):
                raise ValueError(f"Trial has no link to its material: {expected['record_no']}")

        reference_trial = next(row for row in trial_type["records"] if row["material_grade"] == reference)
        notes = {reference: legacy_section(reference_trial), comparison["record_no"]: None}
        card_status = {key: await ensure_markdown(db, user, material_id, key, legacy=legacy)
                       for key, legacy in notes.items()}
        if mode == "preview":
            await transaction.rollback()

    if mode == "apply":
        # The editor commits its own optimistic update. Keep these retryable after the fixture transaction.
        for key, legacy in notes.items():
            async with AsyncSessionLocal() as db:
                card_status[key] = await ensure_markdown(db, user, material_id, key, legacy=legacy, apply=True)
        async with AsyncSessionLocal() as db:
            for key, legacy in notes.items():
                if await ensure_markdown(db, user, material_id, key, legacy=legacy) == "pending":
                    raise ValueError(f"Markdown update could not be verified: {key}")
    print(json.dumps({"mode": mode, "material_created": grade_created,
                      "trial_records_created": trial_records_created, "markdown": card_status}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_const", dest="mode", const="apply")
    mode.add_argument("--verify", action="store_const", dest="mode", const="verify")
    args = parser.parse_args()
    asyncio.run(run(args.mode or "preview"))
