"""Configure explicit material approval in LOCAL DB; default is read-only dry-run.

No records, existing workflow instances, form versions or permissions are rewritten.
Run in the local backend container, adding --apply only after backing up its DB.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
CODE = "material-application"
DOMAIN_CODE = "material-application-approval"
STATUSES = ["待提交", "待审批", "已通过", "已驳回"]


def workflow_config(approver_id: int) -> dict:
    return {
        "domainCode": DOMAIN_CODE,
        "steps": [
            {"name": "提交申请", "type": "start", "node_id": "material-start"},
            {"name": "料号审批", "type": "approval", "node_id": "material-approval",
             "assignee_rules": [{"type": "user", "value": [str(approver_id)]}]},
            {"name": "结束", "type": "end", "node_id": "material-end"},
        ],
    }


def parsed_config(value) -> dict:
    if isinstance(value, dict):
        return value
    try:
        result = json.loads(value or "{}")
        return result if isinstance(result, dict) else {}
    except (TypeError, ValueError):
        return {}


async def configure(db, tenant_id: int, apply: bool, approver_id: int | None = None) -> dict:
    """Caller owns transaction; dry-run performs SELECTs only, safe for SQLite tests."""
    from sqlalchemy import select
    from app.models.relational import (ApplicationForm, Form, FormField, Role, User, UserRole,
                                      WorkflowBinding, WorkflowDef, WorkflowDefVersion)
    form = (await db.execute(select(Form).where(Form.tenant_id == tenant_id, Form.code == CODE))).scalar_one()
    if form.storage_mode != "dynamic":
        raise ValueError("Material application must use independent dynamic storage")
    query = (select(User).join(UserRole, UserRole.user_id == User.id).join(Role, Role.id == UserRole.role_id)
             .where(User.tenant_id == tenant_id, User.is_active.is_(True),
                    UserRole.tenant_id == tenant_id, Role.tenant_id == tenant_id, Role.name == "admin")
             .order_by(User.id))
    candidates = (await db.execute(query)).scalars().unique().all()
    approver = next((user for user in candidates if user.id == approver_id), None) if approver_id else next((user for user in candidates if user.username == "admin"), candidates[0] if candidates else None)
    if not approver:
        raise ValueError("An active same-tenant admin-role approver is required; no account or permission is created")
    desired = workflow_config(approver.id)
    definitions = (await db.execute(select(WorkflowDef).where(WorkflowDef.tenant_id == tenant_id))).scalars().all()
    matches = [item for item in definitions if parsed_config(item.config).get("domainCode") == DOMAIN_CODE]
    if len(matches) > 1:
        raise ValueError("Multiple material approval definitions found; refusing ambiguous binding")
    definition = matches[0] if matches else None
    bindings = (await db.execute(select(WorkflowBinding).where(WorkflowBinding.tenant_id == tenant_id, WorkflowBinding.form_id == form.id))).scalars().all()
    if any(item.enabled and (item.trigger_action != "manual_submit" or not definition or item.workflow_id != definition.id) for item in bindings):
        raise ValueError("Unexpected enabled material workflow binding; review manually without changing old approvals")
    binding = next((item for item in bindings if definition and item.workflow_id == definition.id and item.trigger_action == "manual_submit"), None)
    status_field = (await db.execute(select(FormField).where(FormField.tenant_id == tenant_id, FormField.form_id == form.id, FormField.field_name == "status"))).scalar_one()
    app_bindings = (await db.execute(select(ApplicationForm).where(ApplicationForm.tenant_id == tenant_id, ApplicationForm.form_id == form.id))).scalars().all()
    if not app_bindings:
        raise ValueError("Material form has no application binding")
    current_version = int(definition.version or 1) if definition else 1
    snapshot = (await db.execute(select(WorkflowDefVersion).where(WorkflowDefVersion.tenant_id == tenant_id, WorkflowDefVersion.workflow_id == definition.id, WorkflowDefVersion.version == current_version))).scalar_one_or_none() if definition else None
    changed = bool(definition and (parsed_config(definition.config) != desired or definition.status != "published"))
    # Never mutate a published immutable snapshot, including a mismatched old snapshot.
    if snapshot and (parsed_config(snapshot.config) != desired or snapshot.status != "published"):
        changed = True
    next_version = current_version + 1 if changed else current_version
    need_snapshot = changed or snapshot is None
    desired_form_config = {**(form.config or {}), "approvalDomainCode": DOMAIN_CODE,
                           "description": "独立料号申请审批；迁移历史仅供追踪，保留原审批关联"}
    desired_binding_config = {"domainCode": DOMAIN_CODE}
    report = {
        "mode": "apply" if apply else "dry-run", "tenant_id": tenant_id, "form_id": form.id,
        "approver": {"id": approver.id, "username": approver.username},
        "workflow_id": definition.id if definition else None, "domain_code": DOMAIN_CODE,
        "version": next_version, "trigger_action": "manual_submit", "states": STATUSES,
        "changes": {"create_workflow": definition is None, "update_workflow": changed,
                    "publish_snapshot": need_snapshot,
                    "configure_binding": binding is None or not binding.enabled or binding.config != desired_binding_config,
                    "configure_status": status_field.default_value != "待提交" or status_field.enum_values != {"values": STATUSES},
                    "configure_form": form.config != desired_form_config,
                    "enable_draft_edit": any(not item.allow_create or not item.allow_edit for item in app_bindings)},
        "records_and_legacy_snapshots_unchanged": True,
        "limitations": ["单节点固定审批人；不新增权限或账号", "审批通过仅结束申请，不写入物料主数据", "迁移历史保留只读及旧审批关联"],
    }
    if not apply:
        return report
    if definition is None:
        definition = WorkflowDef(tenant_id=tenant_id, name="料号申请审批", description="本地独立料号申请单节点审批", config=json.dumps(desired, ensure_ascii=False), status="published", version=next_version)
        db.add(definition)
        await db.flush()
    elif changed:
        definition.config = json.dumps(desired, ensure_ascii=False)
        definition.status = "published"
        definition.version = next_version
    if need_snapshot:
        db.add(WorkflowDefVersion(tenant_id=tenant_id, workflow_id=definition.id, version=next_version,
                                 config=definition.config, form_config=definition.form_config, status="published",
                                 published_by=approver.id, published_at=datetime.now()))
    if binding is None:
        db.add(WorkflowBinding(tenant_id=tenant_id, form_id=form.id, workflow_id=definition.id,
                               trigger_action="manual_submit", enabled=True, config=desired_binding_config))
    else:
        binding.enabled = True
        binding.config = desired_binding_config
    status_field.default_value = "待提交"
    status_field.enum_values = {"values": STATUSES}
    form.config = desired_form_config
    for item in app_bindings:
        item.allow_create = True
        item.allow_edit = True
    await db.flush()
    report["workflow_id"] = definition.id
    return report


async def run(tenant_id: int, apply: bool, approver_id: int | None = None) -> dict:
    from sqlalchemy import text
    from app.config import settings
    from app.database import AsyncSessionLocal, _engine
    if urlparse(settings.APP_PUBLIC_URL).hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("This script is restricted to an explicitly local APP_PUBLIC_URL")
    try:
        async with AsyncSessionLocal() as db:
            async with db.begin():
                if db.bind.dialect.name == "postgresql":
                    if apply:
                        await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": 7322000 + tenant_id})
                    else:
                        await db.execute(text("SET TRANSACTION READ ONLY"))
                elif not apply:
                    await db.execute(text("PRAGMA query_only=ON"))
                return await configure(db, tenant_id, apply, approver_id)
    finally:
        await _engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tenant-id", type=int, default=1)
    parser.add_argument("--approver-id", type=int)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    print(json.dumps(asyncio.run(run(args.tenant_id, args.apply, args.approver_id)), ensure_ascii=False, indent=2))
