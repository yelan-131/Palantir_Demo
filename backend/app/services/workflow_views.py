"""Workflow instance views and the approval business dataset shared by routes and services."""

import json
from datetime import datetime
from typing import Any, Optional
from fastapi import HTTPException
from sqlalchemy import select
from app.core.principal import current_tenant_id, current_user_id
from app.core.permissions import allowed_form_fields, has_form_permission


# Instance statuses that still accept approve/reject/cancel actions.
ACTIONABLE_INSTANCE_STATUSES = {"pending", "running", "in_progress", "processing"}


# Definition statuses that may be instantiated.
STARTABLE_DEFINITION_STATUSES = {"published", "active"}


def _get_steps_from_workflow(wf_def: dict) -> list[dict]:
    """Extract ordered step list from a workflow definition.

    Steps can come from:
    1. The top-level ``steps`` key (simple linear flow), or
    2. The ``config.nodes`` key (visual flow designer format).
    """
    # Prefer top-level steps
    if wf_def.get("steps"):
        return wf_def["steps"]

    # Fall back to extracting from config.nodes (skip start/end)
    config = wf_def.get("config", {})
    nodes = config.get("nodes", [])
    edges = config.get("edges", [])

    node_by_id = {node.get("id"): node for node in nodes if node.get("id")}

    def _node_type(node: dict) -> str:
        raw_type = node.get("type") or node.get("data", {}).get("type") or ""
        mapping = {
            "startEvent": "start",
            "endEvent": "end",
            "userTask": "approval",
            "manualTask": "approval",
            "serviceTask": "notification",
            "ccTask": "notification",
            "exclusiveGateway": "condition",
            "parallelGateway": "condition",
            "joinGateway": "condition",
        }
        return mapping.get(raw_type, raw_type)

    def _node_label(node: dict) -> str:
        return node.get("label") or node.get("data", {}).get("label") or node.get("id", "节点")

    def _node_assignee(node: dict) -> Optional[str]:
        return (
            node.get("assigneeValue")
            or node.get("assignee_role")
            or node.get("data", {}).get("approver_role")
            or node.get("data", {}).get("assignee_role")
        )

    def _node_assignee_rules(node: dict) -> list[dict]:
        rules = node.get("assigneeRules") or node.get("assignee_rules") or node.get("data", {}).get("assigneeRules")
        if isinstance(rules, list) and rules:
            return [rule for rule in rules if isinstance(rule, dict)]
        assignee = _node_assignee(node)
        if assignee:
            source = node.get("assigneeSource") or node.get("assigneeType") or "role"
            rule_type = "user" if source == "fixed" else source
            return [{"id": f"{node.get('id', 'node')}-assignee", "type": rule_type, "value": assignee}]
        return []

    def _edge_source(edge: dict) -> Optional[str]:
        return edge.get("source") or edge.get("fromId")

    def _edge_target(edge: dict) -> Optional[str]:
        return edge.get("target") or edge.get("toId")

    # Build adjacency from edges. Multiple outgoing edges are sorted so graph
    # execution has deterministic behavior before expression evaluation exists.
    edge_map: dict[str, list[dict]] = {}
    for edge in edges:
        source = _edge_source(edge)
        target = _edge_target(edge)
        if not source or not target:
            continue
        edge_map.setdefault(source, []).append(edge)
    for outgoing in edge_map.values():
        outgoing.sort(key=lambda edge: (not bool(edge.get("isDefault")), edge.get("priority", 999), edge.get("id", "")))

    start_ids = [node["id"] for node in nodes if _node_type(node) == "start"]

    if not start_ids:
        # No start node; return nodes in order
        return [
            {"name": _node_label(n), "type": _node_type(n),
             "assignee_role": _node_assignee(n)}
            for n in nodes
        ]

    ordered = []
    visited = set()
    queue = start_ids.copy()
    while queue:
        current = queue.pop(0)
        if not current or current in visited:
            continue
        visited.add(current)
        node = node_by_id.get(current)
        if not node:
            continue
        step = {
            "name": _node_label(node),
            "type": _node_type(node),
            "node_id": node["id"],
        }
        assignee = _node_assignee(node)
        if assignee:
            step["assignee_role"] = assignee
        assignee_rules = _node_assignee_rules(node)
        if assignee_rules:
            step["assignee_rules"] = assignee_rules
        if node.get("fieldPermissions"):
            step["field_permissions"] = node["fieldPermissions"]
        if node.get("approvalMode"):
            step["approval_mode"] = node["approvalMode"]
        if node.get("externalAction"):
            step["external_action"] = node["externalAction"]
        raw_type = node.get("type") or node.get("data", {}).get("type")
        if raw_type == "ccTask" and node.get("ccRecipients"):
            step["cc_recipients"] = node["ccRecipients"]
        ordered.append(step)
        for edge in edge_map.get(current, []):
            target = _edge_target(edge)
            if target and target not in visited:
                queue.append(target)

    return ordered


def _workflow_config_steps(config: dict, form_data: dict | None = None, *, trigger_action: str | None = None) -> list[dict]:
    """Resolve runtime steps from either simple steps or visual designer config."""
    steps = _get_steps_from_workflow({"steps": config.get("steps") or [], "config": config})
    if form_data is not None and config.get('nodes') and not config.get('steps'):
        from app.services.workflow_routing import route_node_ids
        by_id = {step['node_id']: step for step in steps}
        return [by_id[node] for node in route_node_ids(config, form_data, trigger_action=trigger_action)]
    return steps


def _instance_steps(config: dict, state: dict) -> list[dict]:
    steps = _workflow_config_steps(config)
    route = state.get('execution_node_ids')
    if isinstance(route, list):
        by_id = {step.get('node_id'): step for step in steps}
        if any(node not in by_id for node in route):
            raise HTTPException(409, '已固定的流程路径与版本不一致')
        return [by_id[node] for node in route]
    # Existing instances retain the execution order they started with.
    return steps


def _definition_config(wf_def) -> dict:
    config = _safe_json(wf_def.config, {}) if wf_def is not None else {}
    return config if isinstance(config, dict) else {}


async def _configs_for_instances(db, instances, defs_by_id: dict) -> dict[int, dict]:
    """Batch variant of :func:`_instance_config`, keyed by instance id."""
    from app.models.relational import WorkflowDefVersion

    wanted: set[tuple[int, int]] = set()
    for inst in instances:
        version = getattr(inst, "workflow_version", None)
        if version:
            wanted.add((inst.workflow_id, int(version)))
    snapshots: dict[tuple[int, int], dict] = {}
    if wanted:
        rows = (await db.execute(
            select(WorkflowDefVersion).where(
                WorkflowDefVersion.workflow_id.in_({workflow_id for workflow_id, _ in wanted})
            )
        )).scalars().all()
        for row in rows:
            key = (row.workflow_id, int(row.version or 0))
            if key in wanted:
                config = _safe_json(row.config, {})
                if isinstance(config, dict):
                    snapshots[key] = config
    configs: dict[int, dict] = {}
    for inst in instances:
        version = getattr(inst, "workflow_version", None)
        snapshot = snapshots.get((inst.workflow_id, int(version))) if version else None
        configs[inst.id] = snapshot if snapshot is not None else _definition_config(defs_by_id.get(inst.workflow_id))
    return configs


RECORD_STATUS_TO_VIEW_TAB = {
    "draft": "draft",
    "待提交": "draft",
    "待审批": "pending",
    "已通过": "done",
    "已驳回": "rejected",
    "pending": "pending",
    "submitted": "pending",
    "reviewing": "pending",
    "running": "running",
    "in_progress": "running",
    "processing": "running",
    "approved": "done",
    "done": "done",
    "completed": "done",
    "closed": "done",
    "returned": "returned",
    "rejected": "rejected",
}


def _safe_json(value: Any, default: Any) -> Any:
    if value in (None, ""):
        return default
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return default
    return default


def _workflow_view_status(raw_status: Optional[str]) -> Optional[str]:
    if not raw_status:
        return None
    return RECORD_STATUS_TO_VIEW_TAB.get(str(raw_status).lower())


def _personal_workflow_views(inst, approvals: list, user: dict, state: dict, *, record_owner=None) -> list[str]:
    """Personal inbox membership is based on real tasks, never admin visibility."""
    uid = current_user_id(user)
    if not uid:
        return []
    node = state.get("current_node")
    mine = [approval for approval in approvals if approval.approver_id == uid]
    pending = str(inst.status).lower() in ACTIONABLE_INSTANCE_STATUSES and any(
        approval.action is None and approval.node_id == node for approval in mine
    )
    processed = any(approval.action in {"approve", "reject"} and approval.acted_at is not None for approval in mine)
    return [name for name, include in (
        ("pending", pending), ("initiated", inst.initiator_id == uid or record_owner == uid),
        ("processed", processed),
    ) if include]


def _is_business_form(form) -> bool:
    config = form.config or {}
    assembly_kind = str(config.get("assemblyKind") or config.get("assembly_kind") or "").lower()
    if assembly_kind in {"analysis", "dashboard", "bi"}:
        return False
    return True


def _field_summary(fields: list, data: dict, *, limit: int | None = 4) -> list[dict]:
    values: list[dict] = []
    ordered_fields = sorted(
        [field for field in fields if not getattr(field, "archived", False)],
        key=lambda field: (getattr(field, "sort_order", 0), getattr(field, "id", 0)),
    )
    for field in ordered_fields:
        field_name = getattr(field, "field_name", "")
        if not field_name:
            continue
        value = data.get(field_name)
        if value in (None, "") and limit is not None and len(values) >= limit:
            continue
        values.append({
            "field_name": field_name,
            "label": getattr(field, "label", None) or field_name,
            "value": value,
            "field_type": getattr(field, "field_type", "string"),
            "required": bool(getattr(field, "required", False)),
            "control_type": (getattr(field, "ui_config", None) or {}).get("controlType"),
            "enum_values": getattr(field, "enum_values", None),
            "ui_config": getattr(field, "ui_config", None) or {},
        })
        if limit is not None and len(values) >= limit:
            break
    return values


def _record_title(form, fields: list, data: dict, record_id: int) -> str:
    for field in sorted(fields, key=lambda item: (getattr(item, "sort_order", 0), getattr(item, "id", 0))):
        field_name = getattr(field, "field_name", "")
        if not field_name:
            continue
        value = data.get(field_name)
        if value not in (None, ""):
            return f"{form.name} - {value}"
    return f"{form.name} - #{record_id}"


def _record_summary(fields: list, data: dict) -> str:
    parts = []
    for item in _field_summary(fields, data, limit=5):
        value = item.get("value")
        if value in (None, ""):
            continue
        parts.append(f"{item['label']}：{value}")
    return "；".join(parts) if parts else "暂无已填写字段"


def _source_record_route(form, app: Optional[dict], record_id: int) -> str:
    if getattr(form, "code", None):
        return f"/program/{form.code}?recordId={record_id}"
    return f"/dynamic/{form.id}?recordId={record_id}"


async def _workflow_business_dataset(db, user: dict, *, source_form_id=None, source_record_id=None) -> dict:
    from app.models.relational import (
        Application,
        ApplicationForm,
        DynamicRecord,
        Form,
        FormField,
        WorkflowApproval,
        WorkflowDef,
        WorkflowInstance,
        WorkflowBinding,
        User,
    )

    tenant_id = current_tenant_id(user)
    form_rows = (await db.execute(
        select(Form, Application)
        .outerjoin(
            ApplicationForm,
            (ApplicationForm.form_id == Form.id)
            & (ApplicationForm.tenant_id == tenant_id)
            & (ApplicationForm.enabled.is_(True)),
        )
        .outerjoin(
            Application,
            (Application.id == ApplicationForm.application_id)
            & (Application.tenant_id == tenant_id),
        )
        .where(Form.tenant_id == tenant_id)
        .order_by(Form.created_at.desc(), Form.id.desc())
    )).all()

    from app.core.permissions import prefetch_form_permissions
    permission_cache = {}
    await prefetch_form_permissions(user, list({form.id: form for form, _ in form_rows if _is_business_form(form)}.values()), db, permission_cache)
    forms_by_id: dict[int, Any] = {}
    applications_by_form: dict[int, list[dict]] = {}
    for form, app in form_rows:
        if not _is_business_form(form):
            continue
        if not user.get("is_admin") and not await has_form_permission(user, form.id, "view", db, cache=permission_cache):
            continue
        forms_by_id[form.id] = form
        if app:
            applications_by_form.setdefault(form.id, [])
            if not any(existing["id"] == app.id for existing in applications_by_form[form.id]):
                applications_by_form[form.id].append({
                    "id": app.id,
                    "name": app.name,
                    "code": app.code,
                    "default_route": app.default_route,
                })

    if not forms_by_id:
        return {"applications": [], "forms": [], "items": [], "view_counts": {"pending": 0, "initiated": 0, "processed": 0}}

    # Published runtime fields are loaded below; loading draft fields here
    # repeated both schema reads and permission checks before overwriting them.
    fields_by_form: dict[int, list] = {}
    visible_fields_by_form: dict[int, list] = {}

    applications: dict[int, dict] = {}
    for apps in applications_by_form.values():
        for app in apps:
            applications[app["id"]] = app

    active_bindings = (await db.execute(select(WorkflowBinding).join(WorkflowDef,
        WorkflowDef.id == WorkflowBinding.workflow_id).where(
        WorkflowBinding.tenant_id == tenant_id, WorkflowDef.tenant_id == tenant_id,
        WorkflowBinding.form_id.in_(forms_by_id), WorkflowBinding.enabled.is_(True),
        WorkflowDef.status.in_(STARTABLE_DEFINITION_STATUSES)))).scalars().all()
    configured_forms = {binding.form_id for binding in active_bindings}
    submit_forms = {binding.form_id for binding in active_bindings if binding.trigger_action == "submit"}
    bound_forms_by_workflow: dict[int, set[int]] = {}
    for bound_form_id, bound_workflow_id in (await db.execute(
        select(WorkflowBinding.form_id, WorkflowBinding.workflow_id).where(
            WorkflowBinding.tenant_id == tenant_id, WorkflowBinding.form_id.in_(forms_by_id)))).all():
        bound_forms_by_workflow.setdefault(bound_workflow_id, set()).add(bound_form_id)
    form_payloads = []
    for form in forms_by_id.values():
        if str(form.status).lower() not in STARTABLE_DEFINITION_STATUSES:
            continue
        form_payloads.append({
            "id": form.id,
            "name": form.name,
            "code": form.code,
            "status": form.status,
            "applications": applications_by_form.get(form.id, []),
            "record_count": 0,
            "route_path": f"/program/{form.code}" if form.code else f"/dynamic/{form.id}",
            "can_create": await has_form_permission(user, form.id, "create", db, cache=permission_cache),
            "approval_configured": form.id in configured_forms,
            "runtime_submission_available": form.id in submit_forms or
                (form.code == "material-application" and form.id in configured_forms),
        })

    from types import SimpleNamespace
    from app.services.form_engine import _uses_physical_form_table
    from app.services.records import authorized_records, runtime_fields
    records = []
    raw_records = {}
    for form in forms_by_id.values():
        fields_by_form[form.id] = await runtime_fields(db, form, cache=permission_cache)
        visible_names = await allowed_form_fields(user, form.id, "view", fields_by_form[form.id], db, cache=permission_cache)
        visible_fields_by_form[form.id] = [field for field in fields_by_form[form.id] if field.field_name in visible_names]
        for payload in await authorized_records(db, user, form, decorate=False, cache=permission_cache, raw_records=raw_records):
            records.append(SimpleNamespace(id=payload["id"], form_id=form.id, data=payload["data"],
                created_by=payload.get("created_by"),
                status=payload.get("data", {}).get("status") if form.code == "material-application" else payload.get("status"),
                created_at=datetime.fromisoformat(payload["created_at"]) if payload.get("created_at") else None,
                updated_at=datetime.fromisoformat(payload["updated_at"]) if payload.get("updated_at") else None))
    records_by_key = {(record.form_id, record.id): record for record in records}
    records_by_id = {record.id: record for record in records if not _uses_physical_form_table(forms_by_id[record.form_id])}
    items_by_key: dict[str, dict] = {}
    record_count_by_form: dict[int, int] = {}
    for record in records:
        record_count_by_form[record.form_id] = record_count_by_form.get(record.form_id, 0) + 1
        form = forms_by_id.get(record.form_id)
        raw_status = (record.data or {}).get("status") if form and form.code == "material-application" else record.status
        view_status = _workflow_view_status(raw_status)
        if view_status is None:
            continue
        form = forms_by_id.get(record.form_id)
        if not form:
            continue
        fields = visible_fields_by_form.get(record.form_id, [])
        data = record.data or {}
        if record.created_by != current_user_id(user) or data.get("migration_marker"):
            continue
        apps = applications_by_form.get(record.form_id, [])
        primary_app = apps[0] if apps else None
        key = f"record:{form.id}:{record.id}"
        items_by_key[key] = {
            "id": key,
            "source": "dynamic_record",
            "views": ["initiated"],
            "can_approve": False,
            "status": view_status,
            "raw_status": raw_status,
            "title": _record_title(form, fields, data, record.id),
            "summary": _record_summary(fields, data),
            "application": primary_app,
            "applications": apps,
            "form": {"id": form.id, "name": form.name, "code": form.code},
            "record": {
                "id": record.id,
                "status": record.status,
                "created_at": record.created_at.isoformat() if record.created_at else None,
                "updated_at": record.updated_at.isoformat() if record.updated_at else None,
            },
            "fields": _field_summary(fields, data, limit=None),
            "current_node": "未提交" if view_status == "draft" else "表单记录",
            "updated_at": record.updated_at.isoformat() if record.updated_at else None,
            "created_at": record.created_at.isoformat() if record.created_at else None,
            "route_path": _source_record_route(form, primary_app, record.id),
        }

    workflow_instances = (await db.execute(
        select(WorkflowInstance).where(WorkflowInstance.tenant_id == tenant_id).order_by(WorkflowInstance.id.desc())
    )).scalars().all()
    # Batch-load definitions, approvals and pinned configs (no N+1).
    workflow_defs: dict[int, Any] = {}
    def_ids = {inst.workflow_id for inst in workflow_instances}
    if def_ids:
        def_rows = (await db.execute(select(WorkflowDef).where(WorkflowDef.id.in_(def_ids)))).scalars().all()
        workflow_defs = {row.id: row for row in def_rows}
    approvals_by_instance: dict[int, list] = {}
    instance_ids = [inst.id for inst in workflow_instances]
    if instance_ids:
        approval_rows = (await db.execute(
            select(WorkflowApproval)
            .where(WorkflowApproval.instance_id.in_(instance_ids))
            .order_by(WorkflowApproval.id)
        )).scalars().all()
        for approval in approval_rows:
            approvals_by_instance.setdefault(approval.instance_id, []).append(approval)
    configs_by_instance = await _configs_for_instances(db, workflow_instances, workflow_defs)
    user_ids: set[int] = set()
    for inst in workflow_instances:
        if inst.initiator_id is not None:
            user_ids.add(inst.initiator_id)
        state = _safe_json(inst.workflow_state, {})
        current_assignee_ids = state.get("current_assignee_ids") if isinstance(state, dict) else []
        if isinstance(current_assignee_ids, list):
            user_ids.update(user_id for user_id in current_assignee_ids if isinstance(user_id, int))
        for approval in approvals_by_instance.get(inst.id, []):
            if isinstance(approval.approver_id, int):
                user_ids.add(approval.approver_id)
    users_by_id: dict[int, Any] = {}
    if user_ids:
        users = (await db.execute(
            select(User).where(User.tenant_id == tenant_id, User.id.in_(user_ids))
        )).scalars().all()
        users_by_id = {user.id: user for user in users}

    represented_records = set()
    projection_cache = permission_cache
    for inst in workflow_instances:
        state = _safe_json(inst.workflow_state, {})
        form_data = _safe_json(inst.form_data, {})
        resource_id = state.get("resource_id")
        variables = state.get("variables") if isinstance(state.get("variables"), dict) else {}
        variable_form_id = variables.get("form_id")
        variable_record_id = variables.get("record_id") or resource_id
        # A linked form outside the permitted set must never become an untyped item.
        if isinstance(variable_form_id, int) and variable_form_id not in forms_by_id:
            continue
        legacy_record = records_by_id.get(resource_id) if state.get("resource_type") == "dynamic_record" and isinstance(resource_id, int) else None
        # Record ids are only unique per storage table; an untagged id is trusted only for a bound form.
        if legacy_record and legacy_record.form_id not in bound_forms_by_workflow.get(inst.workflow_id, ()):
            legacy_record = None
        linked_record = records_by_key.get((variable_form_id, variable_record_id)) if isinstance(variable_form_id, int) else legacy_record
        if linked_record and linked_record.form_id in forms_by_id:
            form = forms_by_id[linked_record.form_id]
            fields = visible_fields_by_form.get(linked_record.form_id, [])
            data = form_data if isinstance(form_data, dict) else {}
            apps = applications_by_form.get(form.id, [])
            primary_app = apps[0] if apps else None
            record_key = f"record:{form.id}:{linked_record.id}"
            # Distinct submissions retain their own approval history; only the latest replaces the record.
            key = record_key if record_key not in represented_records else f"workflow:{inst.id}"
            represented_records.add(record_key)
            linked_record_payload = {"id": linked_record.id, "status": linked_record.status}
            route_path = _source_record_route(form, primary_app, linked_record.id)
        elif isinstance(variable_form_id, int) and variable_form_id in forms_by_id:
            form = forms_by_id[variable_form_id]
            fields = visible_fields_by_form.get(form.id, [])
            data = form_data if isinstance(form_data, dict) else {}
            apps = applications_by_form.get(form.id, [])
            primary_app = apps[0] if apps else None
            key = f"workflow:{inst.id}"
            linked_record_payload = {
                "id": variable_record_id,
                "status": data.get("status") if isinstance(data, dict) else inst.status,
            } if isinstance(variable_record_id, int) else None
            route_path = _source_record_route(form, primary_app, variable_record_id) if isinstance(variable_record_id, int) else None
        else:
            form = None
            fields = []
            data = form_data if isinstance(form_data, dict) else {}
            apps = []
            primary_app = None
            key = f"workflow:{inst.id}"
            linked_record_payload = None
            route_path = None
        views = _personal_workflow_views(inst, approvals_by_instance.get(inst.id, []), user, state,
                                        record_owner=linked_record.created_by if linked_record else None)
        view_status = _workflow_view_status(inst.status)
        source_match = (source_form_id is not None and source_record_id is not None and form is not None
                        and form.id == source_form_id and linked_record_payload
                        and linked_record_payload.get("id") == source_record_id)
        if view_status is None or (not views and not source_match):
            if linked_record:
                record_key = f"record:{form.id}:{linked_record.id}"
                if items_by_key.get(record_key, {}).get("source") == "dynamic_record":
                    items_by_key.pop(record_key, None)
            continue
        if form:
            from app.services.records import read_raw, record_allowed, project_record
            source = {"id": variable_record_id, "data": data, "created_by": inst.initiator_id}
            if isinstance(variable_record_id, int) and (form.id, variable_record_id) in raw_records:
                source = raw_records[(form.id, variable_record_id)]
            elif isinstance(variable_record_id, int):
                try:
                    source = await read_raw(db, form, variable_record_id)
                except HTTPException as exc:
                    if exc.status_code != 404:
                        raise
            if not await record_allowed(db, user, form, "view", source, cache=permission_cache):
                continue
            projected = await project_record(db, user, form, {**source, "data": data}, fields_by_form.get(form.id), cache=projection_cache)
            data = projected["data"]
            fields = [field for field in fields_by_form.get(form.id, []) if field.field_name in data]
        wf_def = workflow_defs.get(inst.workflow_id)
        config = configs_by_instance.get(inst.id) or {}
        steps = _instance_steps(config, state) if isinstance(config, dict) else []
        current_step = state.get("current_step", 0) if isinstance(state, dict) else 0
        current_node = state.get("current_node") if isinstance(state, dict) else None
        current_assignee_ids = state.get("current_assignee_ids") if isinstance(state, dict) else []
        if not isinstance(current_assignee_ids, list):
            current_assignee_ids = []
        current_assignees = []
        for assignee_id in current_assignee_ids:
            user_row = users_by_id.get(assignee_id)
            current_assignees.append({
                "id": assignee_id,
                "name": (user_row.display_name or user_row.username) if user_row else f"用户 #{assignee_id}",
                "username": user_row.username if user_row else None,
            })
        if isinstance(steps, list) and isinstance(current_step, int) and 0 <= current_step < len(steps):
            current_node = steps[current_step].get("name") or current_node
        initiator = users_by_id.get(inst.initiator_id)
        item = {
            "id": key,
            "source": "workflow_instance",
            "views": views,
            "can_approve": "pending" in views,
            "status": view_status,
            "raw_status": inst.status,
            "title": _record_title(form, fields, data, linked_record_payload.get("id") if linked_record_payload else inst.id) if form else inst.title,
            "summary": _record_summary(fields, data) if fields else (wf_def.description if wf_def else "工作流实例"),
            "application": primary_app,
            "applications": apps,
            "form": {"id": form.id, "name": form.name, "code": form.code} if form else None,
            "record": linked_record_payload,
            "workflow": {
                "id": inst.id,
                "workflow_id": inst.workflow_id,
                "initiator_id": inst.initiator_id,
                "initiator_name": (initiator.display_name or initiator.username) if initiator else None,
                "current_node_id": state.get('current_node'),
                "current_step": current_step,
                "approvals": [
                    {"id": approval.id, "node_id": approval.node_id, "approver_id": approval.approver_id,
                     "approver_name": (
                         users_by_id[approval.approver_id].display_name or users_by_id[approval.approver_id].username
                     ) if approval.approver_id in users_by_id else None,
                     "action": approval.action, "comment": approval.comment,
                     "acted_at": approval.acted_at.isoformat() if approval.acted_at else None}
                    for approval in approvals_by_instance.get(inst.id, [])
                ],
                "current_assignees": current_assignees,
            },
            "fields": _field_summary(fields, data, limit=None) if fields else [
                {"field_name": key, "label": key, "value": value, "field_type": "string"}
                for key, value in list(data.items())[:12]
            ],
            "current_node": current_node or ("已完成" if view_status == "done" else "流程中"),
            "current_assignees": current_assignees,
            "updated_at": inst.updated_at.isoformat() if inst.updated_at else None,
            "created_at": inst.created_at.isoformat() if inst.created_at else None,
            "route_path": route_path,
        }
        items_by_key[key] = item

    for form_payload in form_payloads:
        form_payload["record_count"] = record_count_by_form.get(form_payload["id"], 0)

    personal_items = list(items_by_key.values())
    return {
        "view_counts": {view: sum(view in item.get("views", []) for item in personal_items)
                        for view in ("pending", "initiated", "processed")},
        "applications": sorted(applications.values(), key=lambda app: (app.get("name") or "", app.get("id") or 0)),
        "forms": sorted(form_payloads, key=lambda item: (item.get("name") or "", item.get("id") or 0)),
        "items": sorted(items_by_key.values(), key=lambda item: item.get("updated_at") or item.get("created_at") or "", reverse=True),
    }
