"""Rehearse, install, or verify the two-way valve coolant case in local SQLite.

From backend, run `python -m scripts.import_valve_coolant_requirement`.
Use `--apply` to save changes or `--verify` to read the installed case.
"""

import argparse
import asyncio
import json
from pathlib import Path

from sqlalchemy import func, select

from app.config import settings
from app.database import AsyncSessionLocal, _engine
from app.models.relational import Tenant, User
from app.services import field_uniqueness, ontology_record_service
from scripts.import_material_coolant_demo import ensure_record, find_object
from scripts.import_relationship_demo import import_fixture


FIXTURE = Path(__file__).resolve().parents[2] / "data" / "seed" / "valve_coolant_requirement.json"


async def run(mode):
    if (settings.IS_PRODUCTION or _engine.url.get_backend_name() != "sqlite"
            or Path(_engine.url.database or "").name != "manufoundry-local.db"):
        raise ValueError("The valve case can only be installed in the designated local SQLite database")
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    requirement_type, = fixture["objects"]
    expected, = requirement_type["records"]
    relation, = fixture["relations"]
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

        product = await find_object(db, user, relation["target_object_code"])
        if product is None:
            raise ValueError("Import the water valve product specifications before installing this case")
        valve_no = expected["valve_no"]
        await ontology_record_service.get_instance(db, user, product.id, valve_no)

        requirement = await find_object(db, user, requirement_type["code"])
        type_created = requirement is None
        if type_created:
            if verify_only:
                raise ValueError("The valve coolant requirement type has not been installed")
            await import_fixture(db, user, fixture)
            requirement = await find_object(db, user, requirement_type["code"])

        saved, record_created = await ensure_record(db, user, requirement, expected, verify_only=verify_only)
        values = saved["values"]
        if values.get("valve_no") != valve_no or not expected.keys() <= values.keys():
            raise ValueError("The installed requirement has a different product or field binding")
        if (type_created or record_created) and any(values[field] != value for field, value in expected.items()):
            raise ValueError("The stored valve requirement differs from the fixture")

        product_card = await ontology_record_service.get_instance(db, user, product.id, valve_no)
        for card, direction, related_type, related_key in (
            (saved, "outgoing", product.id, valve_no),
            (product_card, "incoming", requirement.id, expected["record_no"]),
        ):
            if not any(item["code"] == relation["code"] and item["direction"] == direction
                       and item["related_object_id"] == related_type and item["state"] == "matched"
                       and any(row["key"] == related_key for row in item["records"])
                       for item in card["relations"]):
                raise ValueError("The valve requirement is missing from the product relationships")

        report = {"mode": mode, "record_created": type_created or record_created, "object_type_id": requirement.id,
                  "product": valve_no, "requirement": saved["key"], "condition_basis": values["condition_basis"],
                  "tensile_min_mpa": values["tensile_min_mpa"], "flexural_min_mpa": values["flexural_min_mpa"]}
        if mode == "preview":
            await transaction.rollback()
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_const", dest="mode", const="apply")
    mode.add_argument("--verify", action="store_const", dest="mode", const="verify")
    args = parser.parse_args()
    asyncio.run(run(args.mode or "preview"))
