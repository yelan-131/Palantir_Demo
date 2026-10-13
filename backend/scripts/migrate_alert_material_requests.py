"""Split explicitly identified material requests, retaining original approval records.

Run inside the LOCAL backend: python scripts/migrate_alert_material_requests.py
Default is read-only. Back up the local DB before adding --apply. No source row,
workflow instance, approval, or sequence is changed. Ambiguous titles are reported.
"""
from __future__ import annotations

import argparse
import asyncio
import copy
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
CODE = "material-application"
MARKER = "alert-material-split-v1"
TITLE_PATTERN = re.compile(r"^(?:前端)?新增料号申请\s*[：:]\s*(\S.*)$")


def is_material_request(payload: dict) -> bool:
    return bool(TITLE_PATTERN.fullmatch(str(payload.get("title") or "").strip()))


def request_payload(row: dict, form_id: int, storage: str, table: str | None) -> dict:
    """Only new display status is normalized; full original payload is retained."""
    title = str(row.get("title") or "").strip()
    part_no = TITLE_PATTERN.fullmatch(title).group(1)
    status = {"已关闭": "已完成", "已驳回": "已驳回", "处理中": "处理中"}.get(row.get("status"), "待处理")
    return {
        "request_no": f"MATREQ-HISTORY-{form_id}-{row['id']}",
        "title": title, "part_no": part_no, "applicant": row.get("owner"),
        "applied_at": row.get("occurred_at") or row.get("created_at"),
        "status": status, "process_status": row.get("process_status") or "未启动",
        "current_node": row.get("current_node"), "current_handler": row.get("current_handler"),
        "resolution": row.get("resolution"), "interaction_log": row.get("interaction_log"),
        "migration_marker": MARKER, "record_category": "material_application",
        "source_form_id": form_id, "source_record_id": row["id"],
        "source_storage": storage, "source_table": table,
        "source_route": f"/program/alert-center?recordId={row['id']}",
        "approval_source": {"form_id": form_id, "record_id": row["id"],
                            "source_dynamic_record_id": row.get("source_dynamic_record_id"),
                            "route": f"/workflow?tab=all&source_form_id={form_id}&source_record_id={row['id']}"},
        "source_payload": copy.deepcopy(row),
    }


async def migrate(tenant_id: int, apply: bool) -> dict:
    from sqlalchemy import select, text
    from app.database import AsyncSessionLocal, _engine
    from app.models.relational import (Application, ApplicationForm, ApplicationMenuNode,
                                      DynamicRecord, Form, FormField, FormPermission, FormVersion)
    async with AsyncSessionLocal() as db:
        async with db.begin():
            # Serialize repeat invocations; dry-run transactions remain read-only.
            if apply:
                await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": 7312000 + tenant_id})
            else:
                await db.execute(text("SET TRANSACTION READ ONLY"))
            source = (await db.execute(select(Form).where(Form.tenant_id == tenant_id, Form.code == "alert-center"))).scalar_one()
            if source.storage_mode == "physical_table":
                table = source.table_name
                if not table or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", table):
                    raise ValueError("Unsafe source table identifier")
                rows = (await db.execute(text(f'SELECT to_jsonb(t) FROM "{table}" t WHERE tenant_id=:tenant AND deleted_at IS NULL ORDER BY id'), {"tenant": tenant_id})).scalars().all()
            elif source.storage_mode == "dynamic":
                records = (await db.execute(select(DynamicRecord).where(DynamicRecord.tenant_id == tenant_id, DynamicRecord.form_id == source.id, DynamicRecord.deleted_at.is_(None)))).scalars().all()
                rows = [{**(record.data or {}), "id": record.id, "tenant_id": tenant_id,
                         "created_by": record.created_by, "updated_by": record.updated_by,
                         "created_at": record.created_at.isoformat() if record.created_at else None} for record in records]
            else:
                raise ValueError(f"Unsupported source storage: {source.storage_mode}")
            explicit = [row for row in rows if is_material_request(row)]
            ambiguous = [row["id"] for row in rows if "料号" in str(row.get("title") or "") and not is_material_request(row)]
            target = (await db.execute(select(Form).where(Form.tenant_id == tenant_id, Form.code == CODE))).scalar_one_or_none()
            mapped = set()
            if target:
                data_rows = (await db.execute(select(DynamicRecord.data).where(DynamicRecord.tenant_id == tenant_id, DynamicRecord.form_id == target.id))).scalars().all()
                mapped = {data.get("source_record_id") for data in data_rows if data and data.get("migration_marker") == MARKER and data.get("source_form_id") == source.id}
            report = {"mode": "apply" if apply else "dry-run", "tenant_id": tenant_id,
                      "source_form_id": source.id, "explicit_request_ids": [row["id"] for row in explicit],
                      "ambiguous_retained_ids": ambiguous, "already_mapped_ids": sorted(mapped),
                      "records_to_copy": sum(row["id"] not in mapped for row in explicit),
                      "create_form": target is None, "source_records_unchanged": True}
            if not apply:
                return report
            if target and (target.storage_mode != "dynamic" or (target.config or {}).get("migration_marker") != MARKER):
                raise ValueError("Existing material-application is not owned by this migration; refusing to modify")
            if not target:
                # Only copy same-tenant permission design, not workflow/actions/encoding.
                config = {"category": "business", "assemblyKind": "business", "migration_marker": MARKER,
                          "description": "料号申请独立入口；历史审批仍由原始告警记录承载",
                          "viewConfig": {
                              "filters": [{"id": "part_no", "fieldName": "part_no", "label": "申请料号", "placeholder": "搜索申请料号", "controlType": "keyword", "operator": "contains", "enabled": True},
                                          {"id": "title", "fieldName": "title", "label": "申请标题", "placeholder": "搜索申请标题", "controlType": "keyword", "operator": "contains", "enabled": True}],
                              "table": {"columns": [{"id": name, "fieldName": name, "label": label, "enabled": True, "renderType": "date" if name == "applied_at" else "text", "sortOrder": order}
                                                    for order, (name, label) in enumerate([("request_no", "申请编号"), ("part_no", "申请料号"), ("title", "申请标题"), ("applicant", "申请人"), ("applied_at", "申请时间"), ("status", "申请状态"), ("process_status", "审批状态")])],
                                        "rowActions": ["detail"], "toolbarActions": ["create", "refresh"], "rowClickAction": "detail", "pageSize": 20}}}
                if (source.config or {}).get("permission_design"):
                    config["permission_design"] = copy.deepcopy(source.config["permission_design"])
                target = Form(tenant_id=tenant_id, name="料号申请", code=CODE, storage_mode="dynamic", status="published", owner_id=source.owner_id, config=config)
                db.add(target)
                await db.flush()
                fields = [("request_no", "申请编号", "string"), ("part_no", "申请料号", "string"), ("title", "申请标题", "string"),
                          ("applicant", "申请人", "string"), ("applied_at", "申请时间", "datetime"),
                          ("status", "申请状态", "enum"), ("process_status", "审批状态", "string"),
                          ("current_node", "当前节点", "string"), ("current_handler", "当前处理人", "string"),
                          ("resolution", "处理结论", "text"), ("interaction_log", "处理记录", "json")]
                for order, (name, label, kind) in enumerate(fields):
                    db.add(FormField(tenant_id=tenant_id, form_id=target.id, field_name=name, label=label,
                                     field_type=kind, sort_order=order, searchable=kind == "string",
                                     required=name in {"part_no", "title"},
                                     default_value="待提交" if name == "status" else None,
                                     ui_config={"businessType": kind, "readonly": name in {"request_no", "status", "process_status", "current_node", "current_handler", "interaction_log", "resolution"}},
                                     enum_values={"values": ["待提交", "待处理", "处理中", "已完成", "已驳回"]} if name == "status" else None))
                permissions = (await db.execute(select(FormPermission).where(FormPermission.tenant_id == tenant_id, FormPermission.form_id == source.id))).scalars().all()
                for perm in permissions:
                    if perm.field_name is None or perm.field_name in {field[0] for field in fields}:
                        db.add(FormPermission(tenant_id=tenant_id, form_id=target.id, role_id=perm.role_id,
                                              action=perm.action, effect=perm.effect, field_name=perm.field_name))
                await db.flush()
                from app.api.forms import _form_snapshot
                db.add(FormVersion(tenant_id=tenant_id, form_id=target.id, version=1,
                                   status="published", snapshot=await _form_snapshot(db, tenant_id, target)))
            for row in explicit:
                if row["id"] in mapped:
                    continue
                db.add(DynamicRecord(tenant_id=tenant_id, form_id=target.id,
                                     data=request_payload(row, source.id, source.storage_mode, source.table_name),
                                     created_by=row.get("created_by"), updated_by=row.get("updated_by")))
            app = (await db.execute(select(Application).where(Application.tenant_id == tenant_id, Application.code == "production-dashboard"))).scalar_one()
            source_binding = (await db.execute(select(ApplicationForm).where(ApplicationForm.tenant_id == tenant_id, ApplicationForm.application_id == app.id, ApplicationForm.form_id == source.id))).scalar_one_or_none()
            existing = (await db.execute(select(ApplicationForm).where(ApplicationForm.tenant_id == tenant_id, ApplicationForm.application_id == app.id, ApplicationForm.form_id == target.id))).scalar_one_or_none()
            if not existing:
                db.add(ApplicationForm(tenant_id=tenant_id, application_id=app.id, form_id=target.id,
                                       alias="料号申请", data_scope=source_binding.data_scope if source_binding else None,
                                       allow_create=True, allow_edit=False, allow_delete=False,
                                       allow_export=source_binding.allow_export if source_binding else False, sort_order=100))
            nodes = (await db.execute(select(ApplicationMenuNode).where(ApplicationMenuNode.tenant_id == tenant_id, ApplicationMenuNode.application_id == app.id))).scalars().all()
            if not any(node.form_id == target.id for node in nodes):
                parent = next((node for node in nodes if node.node_type == "group" and node.title == "业务填报"), None)
                if parent is None:
                    raise ValueError("Missing production 业务填报 menu group; refusing guessed placement")
                db.add(ApplicationMenuNode(tenant_id=tenant_id, application_id=app.id, parent_id=parent.id,
                                           title="料号申请", node_type="form", form_id=target.id,
                                           route_path=f"/program/{CODE}", sort_order=100))
            report["target_form_id"] = target.id
        await _engine.dispose()
        return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tenant-id", type=int, default=1)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    print(json.dumps(asyncio.run(migrate(args.tenant_id, args.apply)), ensure_ascii=False, indent=2))
