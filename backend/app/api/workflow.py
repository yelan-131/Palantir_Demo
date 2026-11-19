"""Workflow Engine API — definition CRUD, instance lifecycle, step-based execution, notifications."""

import json
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from app.services.workflow_definitions import WorkflowDefCreate, stage_workflow_definition, update_workflow_definition

router = APIRouter()

from app.api.deps import current_tenant_id, current_user_id, get_current_user, require_admin
from app.core.audit import write_audit_log
from app.core.permissions import evaluate_form_permission


# ── Schemas ───────────────────────────────────────────────

class WorkflowStartRequest(BaseModel):
    title: str
    form_data: Optional[dict] = None
    resource_type: Optional[str] = None
    resource_id: Optional[int] = None
    variables: Optional[dict] = None


class ApprovalAction(BaseModel):
    action: str  # approve / reject
    comment: Optional[str] = None
    expected_node_id: Optional[str] = None
    expected_step: Optional[int] = None


class StepApprovalRequest(BaseModel):
    """Request body for approve/reject current step.

    ``user_id`` is accepted for backward wire compatibility but ignored — the
    acting identity always comes from the authenticated token, never from the
    request body.
    """
    comment: Optional[str] = None
    user_id: Optional[int] = None
    expected_node_id: Optional[str] = None
    expected_step: Optional[int] = None


# DB session helper — unified via core.db.safe_db_call
from app.core.db import safe_db_call as _try_db  # noqa: E402
from app.services.workflow_views import (
    ACTIONABLE_INSTANCE_STATUSES,
    STARTABLE_DEFINITION_STATUSES,
    _configs_for_instances,
    _definition_config,
    _instance_steps,
    _safe_json,
    _workflow_business_dataset,
    _workflow_config_steps,
    _workflow_view_status,
)
from app.services.workflow_approvals import (
    _add_approval_notifications,
    _find_first_approval_step,
    _resolve_step_approver_ids,
    _set_current_assignees,
)


# ── Helper: resolve steps from a workflow definition ──────


def _find_next_actionable_step(steps: list[dict], current_step: int) -> Optional[int]:
    """Return the index of the next actionable step (approval) after current_step.

    Non-actionable steps (notification, condition) are auto-advanced past.
    Returns None if no more actionable steps remain.
    """
    for i in range(current_step + 1, len(steps)):
        step_type = steps[i].get("type")
        if step_type == "approval":
            return i
        # notification and condition steps are auto-advanced — skip them
        # but we still record them as visited for state tracking
    return None


def _is_last_step(steps: list[dict], current_step: int) -> bool:
    """Check if current_step is the last actionable step (before end)."""
    for i in range(current_step + 1, len(steps)):
        if steps[i].get("type") not in ("end",):
            return False
    return True


async def _instance_config(db, wf_def, workflow_version: Optional[int]) -> dict:
    """Config an instance executes against.

    Pinned to the snapshot taken when the instance started; falls back to the
    live definition for legacy instances created before snapshots existed.
    """
    if wf_def is None:
        return {}
    if workflow_version:
        from app.models.relational import WorkflowDefVersion

        row = await db.scalar(
            select(WorkflowDefVersion).where(
                WorkflowDefVersion.workflow_id == wf_def.id,
                WorkflowDefVersion.version == int(workflow_version),
            )
        )
        if row is not None:
            config = _safe_json(row.config, {})
            if isinstance(config, dict):
                return config
    return _definition_config(wf_def)


WORKFLOW_VIEW_STATUSES = {"draft", "pending", "running", "done", "returned", "rejected"}


def _workflow_view_status_for_user(inst, approvals: list, user: dict) -> Optional[str]:
    raw_view_status = _workflow_view_status(inst.status)
    if raw_view_status is None:
        return None
    user_id = current_user_id(user)
    if not user_id or user.get("is_admin"):
        return raw_view_status
    is_initiator = inst.initiator_id == user_id
    user_approvals = [approval for approval in approvals if approval.approver_id == user_id]
    has_pending_for_user = any(approval.action is None for approval in user_approvals)
    has_acted_by_user = any(approval.action is not None for approval in user_approvals)

    if raw_view_status == "pending":
        if has_pending_for_user:
            return "pending"
        if has_acted_by_user or is_initiator:
            return "running"
        return None
    if raw_view_status in {"done", "returned", "rejected"} and (user_approvals or is_initiator):
        return raw_view_status
    if raw_view_status == "running" and (user_approvals or is_initiator):
        return "running"
    return None


# ── Workflow Definition CRUD ─────────────────────────────

@router.get("/definitions")
async def list_definitions(user: dict = Depends(get_current_user)):
    """工作流定义列表."""
    async def _query(db):
        from app.models.relational import WorkflowDef
        tenant_id = current_tenant_id(user)
        result = await db.execute(select(WorkflowDef).where(WorkflowDef.tenant_id == tenant_id).order_by(WorkflowDef.id))
        defs = result.scalars().all()
        return {"data": [
            {"id": d.id, "name": d.name, "description": d.description,
             "config": json.loads(d.config) if isinstance(d.config, str) else d.config,
             "form_config": json.loads(d.form_config) if isinstance(d.form_config, str) else d.form_config,
             "status": d.status, "version": d.version}
            for d in defs
        ]}

    return await _try_db(_query)


@router.get("/definitions/{def_id}")
async def get_definition(def_id: int, user: dict = Depends(get_current_user)):
    """获取工作流定义详情."""
    async def _query(db):
        from app.models.relational import WorkflowDef
        tenant_id = current_tenant_id(user)
        d = await db.get(WorkflowDef, def_id)
        if not d or d.tenant_id != tenant_id:
            return None
        return {
            "id": d.id, "name": d.name, "description": d.description,
            "config": json.loads(d.config) if isinstance(d.config, str) else d.config,
            "form_config": json.loads(d.form_config) if isinstance(d.form_config, str) else d.form_config,
            "status": d.status, "version": d.version,
        }

    result = await _try_db(_query)
    if result is None:
        raise HTTPException(404, "Workflow not found")
    return result


@router.post("/definitions")
async def create_definition(body: WorkflowDefCreate, user: dict = Depends(require_admin)):
    """创建工作流定义（管理员）."""
    async def _query(db):
        tenant_id = current_tenant_id(user)
        d = await stage_workflow_definition(db, body, user)
        await db.commit()
        await db.refresh(d)
        await write_audit_log(
            tenant_id=tenant_id,
            user_id=current_user_id(user),
            action="create",
            resource_type="workflow_def",
            resource_id=d.id,
            new_values=body.dict(),
        )
        return {"id": d.id, "name": d.name, "status": d.status, "version": d.version}

    return await _try_db(_query)


@router.put("/definitions/{def_id}")
async def update_definition(def_id: int, body: WorkflowDefCreate, user: dict = Depends(require_admin)):
    """更新工作流定义（管理员）；每次更新生成新的版本快照，在途实例不受影响."""
    async def _query(db):
        from app.models.relational import WorkflowDef
        from app.services.field_uniqueness import lock

        tenant_id = current_tenant_id(user)
        await lock(db, tenant_id)
        d = await db.scalar(select(WorkflowDef).where(WorkflowDef.id == def_id, WorkflowDef.tenant_id == tenant_id).with_for_update())
        if d is None:
            return None
        update_workflow_definition(db, d, body, user)
        await db.commit()
        await write_audit_log(
            tenant_id=tenant_id,
            user_id=current_user_id(user),
            action="update",
            resource_type="workflow_def",
            resource_id=d.id,
            new_values={"version": d.version, "status": d.status},
        )
        return {"id": d.id, "version": d.version, "status": d.status}

    result = await _try_db(_query)
    if result is None:
        raise HTTPException(404, "Workflow not found")
    return result


@router.delete("/definitions/{def_id}")
async def delete_definition(def_id: int, user: dict = Depends(require_admin)):
    """删除工作流定义（管理员）；存在实例时拒绝删除."""
    async def _query(db):
        from app.models.relational import WorkflowDef, WorkflowDefVersion, WorkflowInstance
        tenant_id = current_tenant_id(user)
        d = await db.get(WorkflowDef, def_id)
        if not d or d.tenant_id != tenant_id:
            return None
        instance_count = await db.scalar(
            select(func.count(WorkflowInstance.id)).where(WorkflowInstance.workflow_id == def_id)
        )
        if int(instance_count or 0) > 0:
            raise HTTPException(409, "Workflow has instances; archive it instead of deleting")
        version_rows = (await db.execute(
            select(WorkflowDefVersion).where(WorkflowDefVersion.workflow_id == def_id)
        )).scalars().all()
        for row in version_rows:
            await db.delete(row)
        await db.delete(d)
        await db.commit()
        await write_audit_log(
            tenant_id=tenant_id,
            user_id=current_user_id(user),
            action="delete",
            resource_type="workflow_def",
            resource_id=def_id,
        )
        return {"ok": True}

    result = await _try_db(_query)
    if result is None:
        raise HTTPException(404, "Workflow not found")
    return result


# ── Instance Lifecycle ───────────────────────────────────

async def _workflow_bound_to_form(db, tenant_id: int, workflow_id: int, form_id: int) -> bool:
    from app.models.relational import WorkflowBinding
    return bool(await db.scalar(select(WorkflowBinding.id).where(
        WorkflowBinding.tenant_id == tenant_id, WorkflowBinding.workflow_id == workflow_id,
        WorkflowBinding.form_id == form_id).limit(1)))


async def _validate_start_source(db, user: dict, body: WorkflowStartRequest) -> None:
    """A manually started instance may reference a business record only with an explicit, readable source form."""
    variables = body.variables or {}
    form_id = variables.get("form_id")
    record_id = variables.get("record_id")
    if body.resource_type != "dynamic_record" and form_id is None and record_id is None:
        return
    if record_id is None:
        record_id = body.resource_id
    elif body.resource_id is not None and record_id != body.resource_id:
        raise HTTPException(422, "variables.record_id 与 resource_id 不一致")
    if type(form_id) is not int or (record_id is not None and type(record_id) is not int):
        raise HTTPException(422, "关联业务数据时须在 variables.form_id 指定来源表单")
    if body.resource_type == "dynamic_record" and record_id is None:
        raise HTTPException(422, "关联业务记录时须提供记录 ID")
    from app.models.relational import Form
    from app.services.records import read_raw, require_form_permission, require_record_permission
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != current_tenant_id(user):
        raise HTTPException(404, "Form not found")
    if record_id is None:
        await require_form_permission(db, user, form_id, "view")
    else:
        await require_record_permission(db, user, form, "view", await read_raw(db, form, record_id))


async def _instance_read_view(db, instance, approvals, user):
    """Authorize legacy reads and project immutable snapshots with current rules.

    Source-form access, row scope and field protection are the same boundary
    used by business pages. Participation alone must not bypass that boundary.
    Untyped workflows are visible only to their initiator/approvers or admins.
    """
    state = _safe_json(instance.workflow_state, {})
    snapshot = _safe_json(instance.form_data, {})
    if user.get('is_admin'):
        return snapshot, state, instance.title
    variables = state.get('variables') if isinstance(state.get('variables'), dict) else {}
    form_id = variables.get('form_id')
    record_id = variables.get('record_id') or state.get('resource_id')
    from app.models.relational import Form, DynamicRecord
    if form_id is None and state.get('resource_type') == 'dynamic_record' and type(record_id) is int:
        row = await db.get(DynamicRecord, record_id)
        if not row or row.tenant_id != current_tenant_id(user):
            return None
        if await _workflow_bound_to_form(db, row.tenant_id, instance.workflow_id, row.form_id):
            form_id = row.form_id
    if form_id is not None:
        if type(form_id) is not int:
            return None
        form = await db.get(Form, form_id)
        if not form or form.tenant_id != current_tenant_id(user):
            return None
        from app.services.records import read_raw, record_allowed, project_record
        source = {'id': record_id, 'created_by': instance.initiator_id, 'data': snapshot}
        if type(record_id) is int:
            try:
                source = await read_raw(db, form, record_id)
            except HTTPException as exc:
                if exc.status_code == 404:
                    return None
                raise
        if not await record_allowed(db, user, form, 'view', source):
            return None
        historical = {**source, 'data': snapshot}
        if not await record_allowed(db, user, form, 'view', historical):
            return None
        projected = await project_record(db, user, form, historical)
        safe_data = projected['data']
        # Variables may contain copied business values; return only known
        # routing metadata and the already-projected field values.
        routing = {'form_id', 'form_code', 'record_id', 'trigger_action'}
        safe_variables = {key: value for key, value in variables.items() if key in routing}
        safe_variables.update({key: safe_data[key] for key in variables if key in safe_data})
        state_keys = {'current_node', 'current_step', 'resource_type', 'resource_id',
                      'current_assignee_ids', 'current_assignee_id', 'current_approval_groups'}
        safe_state = {key: value for key, value in state.items() if key in state_keys}
        safe_state['variables'] = safe_variables
        title = instance.title
        if any(isinstance(value, str) and value and value in title and safe_data.get(key) != value
               for key, value in snapshot.items()):
            title = f'{form.name} #{instance.id}'
        return safe_data, safe_state, title
    uid = current_user_id(user)
    if uid and (instance.initiator_id == uid or uid in state.get('current_assignee_ids', [])
                or any(row.approver_id == uid for row in approvals)):
        return snapshot, state, instance.title
    return None

@router.get("/business-items")
async def list_business_workflow_items(
    status: Optional[str] = Query(default=None),
    view: Optional[str] = Query(default=None),
    source_form_id: Optional[int] = Query(default=None),
    source_record_id: Optional[int] = Query(default=None),
    user: dict = Depends(get_current_user),
):
    """Return workflow center items backed by real forms and dynamic records."""
    async def _query(db):
        dataset = await _workflow_business_dataset(db, user,
            source_form_id=source_form_id, source_record_id=source_record_id)
        if source_form_id is not None and source_record_id is not None:
            dataset["items"] = [item for item in dataset["items"]
                if (item.get("form") or {}).get("id") == source_form_id
                and (item.get("record") or {}).get("id") == source_record_id]
        if view:
            if view not in {"pending", "initiated", "processed"}:
                raise HTTPException(400, "Invalid personal workflow view")
            dataset["items"] = [item for item in dataset["items"] if view in item.get("views", [])]
        if status and status != "all":
            if status not in WORKFLOW_VIEW_STATUSES:
                raise HTTPException(400, "Invalid workflow tab status")
            dataset["items"] = [item for item in dataset["items"] if item.get("status") == status]
        counts = {"all": len(dataset["items"])}
        for key in WORKFLOW_VIEW_STATUSES:
            counts[key] = sum(1 for item in dataset["items"] if item.get("status") == key)
        dataset["counts"] = counts
        return {"data": dataset}

    return await _try_db(_query)


@router.get("/instances")
async def list_instances(
    status: Optional[str] = None,
    initiator_id: Optional[int] = None,
    workflow_id: Optional[int] = None,
    resource_type: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """工作流实例列表 (supports filtering by status, initiator, workflow, resource_type)."""
    async def _query(db):
        from app.models.relational import WorkflowApproval, WorkflowDef, WorkflowInstance
        tenant_id = current_tenant_id(user)
        query = select(WorkflowInstance).where(WorkflowInstance.tenant_id == tenant_id).order_by(WorkflowInstance.created_at.desc())
        if status:
            query = query.where(WorkflowInstance.status == status)
        if initiator_id:
            query = query.where(WorkflowInstance.initiator_id == initiator_id)
        if workflow_id:
            query = query.where(WorkflowInstance.workflow_id == workflow_id)
        result = await db.execute(query)
        instances = result.scalars().all()

        # Batch-load approvals, definitions and pinned configs (no N+1).
        instance_ids = [inst.id for inst in instances]
        approvals_by_instance: dict[int, list] = {}
        if instance_ids:
            approval_rows = (await db.execute(
                select(WorkflowApproval)
                .where(WorkflowApproval.instance_id.in_(instance_ids))
                .order_by(WorkflowApproval.id)
            )).scalars().all()
            for approval in approval_rows:
                approvals_by_instance.setdefault(approval.instance_id, []).append(approval)
        def_ids = {inst.workflow_id for inst in instances}
        defs_by_id: dict[int, Any] = {}
        if def_ids:
            def_rows = (await db.execute(
                select(WorkflowDef).where(WorkflowDef.id.in_(def_ids))
            )).scalars().all()
            defs_by_id = {row.id: row for row in def_rows}
        configs_by_instance = await _configs_for_instances(db, instances, defs_by_id)

        out = []
        for inst in instances:
            ws = _safe_json(inst.workflow_state, {})
            if resource_type and ws.get("resource_type") != resource_type:
                continue
            config = configs_by_instance.get(inst.id, {})
            steps = _instance_steps(config, ws) if isinstance(config, dict) else []
            approvals = approvals_by_instance.get(inst.id, [])
            visible = await _instance_read_view(db, inst, approvals, user)
            if visible is None:
                continue
            safe_data, ws, safe_title = visible

            out.append({
                "id": inst.id, "workflow_id": inst.workflow_id, "title": safe_title,
                "workflow_version": inst.workflow_version,
                "initiator_id": inst.initiator_id, "status": inst.status,
                "current_step": ws.get("current_step", 0),
                "resource_type": ws.get("resource_type"),
                "resource_id": ws.get("resource_id"),
                "variables": ws.get("variables"),
                "form_data": safe_data,
                "workflow_state": ws,
                "steps": steps,
                "created_at": inst.created_at.isoformat() if inst.created_at else None,
                "updated_at": inst.updated_at.isoformat() if inst.updated_at else None,
                "approvals": [
                    {"id": a.id, "node_id": a.node_id, "approver_id": a.approver_id,
                     "action": a.action, "comment": a.comment,
                     "acted_at": a.acted_at.isoformat() if a.acted_at else None}
                    for a in approvals
                ],
            })
        return {"data": out}

    return await _try_db(_query)


@router.get("/instances/{inst_id}")
async def get_instance(inst_id: int, user: dict = Depends(get_current_user)):
    """获取工作流实例详情 (with full step history)."""
    async def _query(db):
        from app.models.relational import WorkflowInstance, WorkflowApproval, WorkflowDef
        tenant_id = current_tenant_id(user)
        inst = await db.get(WorkflowInstance, inst_id)
        if not inst or inst.tenant_id != tenant_id:
            return None

        approvals_res = await db.execute(
            select(WorkflowApproval).where(WorkflowApproval.instance_id == inst_id).order_by(WorkflowApproval.id)
        )
        approvals = approvals_res.scalars().all()
        visible = await _instance_read_view(db, inst, approvals, user)
        if visible is None:
            raise HTTPException(403, 'Workflow access denied')
        safe_data, ws, safe_title = visible

        wf_def = await db.get(WorkflowDef, inst.workflow_id)
        config = await _instance_config(db, wf_def, inst.workflow_version)
        steps = _instance_steps(config, _safe_json(inst.workflow_state, {})) if isinstance(config, dict) else []

        return {
            "id": inst.id, "workflow_id": inst.workflow_id, "title": safe_title,
            "workflow_version": inst.workflow_version,
            "initiator_id": inst.initiator_id, "status": inst.status,
            "current_step": ws.get("current_step", 0),
            "resource_type": ws.get("resource_type"),
            "resource_id": ws.get("resource_id"),
            "variables": ws.get("variables"),
            "form_data": safe_data,
            "workflow_state": ws,
            "steps": steps,
            "created_at": inst.created_at.isoformat() if inst.created_at else None,
            "updated_at": inst.updated_at.isoformat() if inst.updated_at else None,
            "approvals": [
                {"id": a.id, "node_id": a.node_id, "approver_id": a.approver_id,
                 "action": a.action, "comment": a.comment,
                 "step_index": ws.get("current_step", 0),
                 "acted_at": a.acted_at.isoformat() if a.acted_at else None}
                for a in approvals
            ],
        }

    result = await _try_db(_query)
    if result is None:
        raise HTTPException(404, "Instance not found")
    return result


@router.post("/definitions/{def_id}/start")
async def start_instance(def_id: int, body: WorkflowStartRequest, user: dict = Depends(get_current_user)):
    """发起工作流实例 (creates WorkflowInstance + first WorkflowApproval).

    Only published/active definitions can be instantiated; the instance pins
    the definition version so later edits never reshape it mid-flight.
    """
    async def _query(db):
        from app.models.relational import WorkflowDef, WorkflowInstance, WorkflowApproval
        tenant_id = current_tenant_id(user)
        d = await db.get(WorkflowDef, def_id)
        if not d or d.tenant_id != tenant_id:
            return None
        if str(d.status or "").lower() not in STARTABLE_DEFINITION_STATUSES:
            raise HTTPException(409, "Workflow definition is not published")
        await _validate_start_source(db, user, body)
        config = await _instance_config(db, d, int(d.version or 1))
        if (config.get("domainCode") == "material-application-approval"
                or str(config.get("domainCode") or "").startswith("form-approval:")
                or (body.variables or {}).get("form_code") == "material-application"):
            raise HTTPException(409, "业务表单审批请通过对应表单提交入口发起")
        steps = _workflow_config_steps(config if isinstance(config, dict) else {}, body.form_data or {})

        # Determine the first step
        first_step_index = _find_first_approval_step(steps) if steps else 0
        current_step = steps[first_step_index] if steps and first_step_index < len(steps) else None
        initiator_id = current_user_id(user)
        form_data = body.form_data or {}
        variables = body.variables or {}
        approval_groups: list[dict] = []
        approver_ids = await _resolve_step_approver_ids(
            db,
            tenant_id,
            current_step or {},
            form_data,
            variables,
            initiator_id,
            initiator_id,
            approval_groups=approval_groups,
        ) if current_step and current_step.get("type") == "approval" else []

        # Build workflow state
        state = {
            "current_node": current_step.get("node_id", current_step.get("name", "start")) if current_step else "end",
            "current_step": first_step_index,
            "resource_type": body.resource_type,
            "resource_id": body.resource_id,
            "variables": variables,
        }
        if config.get('nodes') and not config.get('steps'):
            state['execution_node_ids'] = [step['node_id'] for step in steps]
        _set_current_assignees(state, approver_ids, approval_groups=approval_groups)

        from app.services.workflow_dispatch import enqueue
        from app.services.workflow_cc import notify_reached
        has_approval = any(step.get('type') == 'approval' for step in steps)
        reached_steps = steps[:first_step_index] if has_approval else steps
        enqueue(state, steps, 0, len(reached_steps))
        completed = not has_approval and (state.get('dispatch_jobs') or any(
            step.get('type') == 'notification' and step.get('cc_recipients') for step in reached_steps
        ))
        if completed:
            state.update(current_node='end', current_step=len(steps) - 1)
            current_step = steps[-1]
        inst = WorkflowInstance(
            tenant_id=tenant_id,
            workflow_id=def_id, title=body.title,
            workflow_version=int(d.version or 1),
            initiator_id=initiator_id,
            form_data=json.dumps(form_data, ensure_ascii=False),
            workflow_state=json.dumps(state, ensure_ascii=False),
            status="approved" if completed else "pending",
        )
        db.add(inst)
        await db.flush()
        await notify_reached(db, inst, state, reached_steps)
        inst.workflow_state = json.dumps(state, ensure_ascii=False)

        if current_step and current_step.get("type") == "approval":
            for approver_id in approver_ids:
                db.add(WorkflowApproval(
                    instance_id=inst.id,
                    approver_id=approver_id,
                    node_id=current_step.get("node_id", current_step.get("name", "")),
                ))
            await _add_approval_notifications(db, tenant_id, approver_ids, body.title, inst.id)
        await db.commit()
        await db.refresh(inst)
        await write_audit_log(
            tenant_id=tenant_id,
            user_id=current_user_id(user),
            action="start",
            resource_type="workflow_instance",
            resource_id=inst.id,
            new_values={"workflow_id": def_id, "title": body.title, "resource_type": body.resource_type, "resource_id": body.resource_id},
        )
        return {
            "instance_id": inst.id,
            "status": inst.status,
            "current_step": state["current_step"],
            "current_step_name": current_step.get("name") if current_step else None,
        }

    result = await _try_db(_query)
    if result is None:
        raise HTTPException(404, "Workflow definition not found")
    return result


@router.post("/instances/{inst_id}/approve")
async def approve_step(inst_id: int, body: StepApprovalRequest, user: dict = Depends(get_current_user)):
    """审批通过当前步骤 (moves to next step or completes workflow)."""
    return await _act_on_step(inst_id, body, action="approve", user=user)


@router.post("/instances/{inst_id}/reject")
async def reject_step(inst_id: int, body: StepApprovalRequest, user: dict = Depends(get_current_user)):
    """驳回当前步骤，按配置进入驳回路线或结束实例。"""
    return await _act_on_step(inst_id, body, action="reject", user=user)


async def _act_on_step(inst_id: int, body: StepApprovalRequest, action: str, user: dict | None = None, db=None):
    """Core step action logic for approval and rejection.

    Authorization: the acting identity comes from the auth token only. The
    actor must own a pending approval on the current node; admins (and, for
    nodes that ended up with no assignees, the initiator) may act as an
    override, recorded under their own identity — never by rewriting someone
    else's approval row.

    Concurrency: the instance row is locked (SELECT ... FOR UPDATE) so two
    approvers acting at once serialize instead of double-advancing the flow.
    """
    if action not in ("approve", "reject"):
        raise HTTPException(400, "action must be 'approve' or 'reject'")

    shared_db = db

    async def _query(db):
        from app.models.relational import WorkflowInstance, WorkflowApproval, WorkflowDef
        tenant_id = current_tenant_id(user or {})
        acting_user_id = current_user_id(user or {})
        if not acting_user_id:
            raise HTTPException(403, "Authenticated user required for workflow actions")

        # Use the same lock order as material endpoints: request then instance.
        candidate = await db.get(WorkflowInstance, inst_id)
        candidate_state = _safe_json(candidate.workflow_state, {}) if candidate else {}
        candidate_vars = candidate_state.get('variables') or {}
        if candidate and candidate.tenant_id == tenant_id and candidate_vars.get('form_code') == 'material-application':
            from app.models.relational import Form
            material_form = await db.scalar(select(Form).where(Form.id == candidate_vars.get('form_id'), Form.tenant_id == tenant_id))
            if material_form and material_form.code == 'material-application':
                from app.api.material_applications import _record
                await _record(db, user or {}, candidate_vars.get('record_id'), 'view', True)

        if candidate and candidate.tenant_id == tenant_id and candidate_vars.get('form_code') != 'material-application':
            from app.models.relational import Form
            from app.services.form_application_lifecycle import events, locked_record
            source_form = await db.get(Form, candidate_vars.get('form_id')) if candidate_vars.get('form_id') else None
            if source_form and source_form.tenant_id == tenant_id and candidate_vars.get('record_id'):
                if await events(db, source_form, candidate_vars['record_id']):
                    source_record = await locked_record(db, source_form, candidate_vars['record_id'])
                    from app.core.permissions import evaluate_form_permission
                    decision = await evaluate_form_permission(user or {}, source_form.id, 'view', db,
                                                              record_data=source_record.get('data') or {})
                    if not decision.get('allowed'):
                        raise HTTPException(403, '没有查看此申请表单的权限')
                    if action == 'reject' and not str(body.comment or '').strip():
                        raise HTTPException(422, '驳回时必须填写原因')

        if candidate and candidate.tenant_id==tenant_id and candidate_vars.get('form_id'):
            from app.models.relational import Form
            from app.services.designer_permissions import require_action
            permission_form=await db.get(Form,candidate_vars['form_id'])
            if permission_form and permission_form.tenant_id==tenant_id:
                await require_action(db,user or {},permission_form,'approve')

        # Row lock: concurrent actions on the same instance serialize here.
        # (SQLite ignores FOR UPDATE but serializes writes at the DB level.)
        inst = (await db.execute(
            select(WorkflowInstance).where(WorkflowInstance.id == inst_id).with_for_update().execution_options(populate_existing=True)
        )).scalar_one_or_none()
        if not inst or inst.tenant_id != tenant_id:
            return None
        if str(inst.status or "").lower() not in ACTIONABLE_INSTANCE_STATUSES:
            raise HTTPException(409, f"Instance is already {inst.status}; no further actions allowed")

        wf_def = await db.get(WorkflowDef, inst.workflow_id)
        if not wf_def or wf_def.tenant_id != tenant_id:
            return None

        config = await _instance_config(db, wf_def, inst.workflow_version)
        state = _safe_json(inst.workflow_state, {})
        steps = _instance_steps(config if isinstance(config, dict) else {}, state)
        bound_vars = state.get("variables") or {}
        if str(config.get("domainCode") or "").startswith("form-approval:"):
            from app.api.forms import _ensure_form_permission
            await _ensure_form_permission(db, user or {}, bound_vars.get("form_id"), "view")
            if action == "reject" and not str(body.comment or "").strip():
                raise HTTPException(422, "驳回时必须填写原因")
        current_step_idx = state.get("current_step", 0)
        form_data = _safe_json(inst.form_data, {})
        variables = state.get("variables") if isinstance(state.get("variables"), dict) else {}
        current_step = steps[current_step_idx] if steps and isinstance(current_step_idx, int) and 0 <= current_step_idx < len(steps) else {}
        current_node_id = current_step.get("node_id", current_step.get("name", state.get("current_node", "")))
        if body.expected_node_id is not None and body.expected_node_id != current_node_id:
            raise HTTPException(409, '审批节点已变化，请刷新后再处理')
        if body.expected_step is not None and body.expected_step != current_step_idx:
            raise HTTPException(409, '审批轮次已变化，请刷新后再处理')
        approval_mode = current_step.get("approval_mode") or "single"

        node_approvals = (await db.execute(
            select(WorkflowApproval)
            .where(
                WorkflowApproval.instance_id == inst_id,
                WorkflowApproval.node_id == current_node_id,
                WorkflowApproval.id > (state.get('current_approval_after_id') or 0),
            )
            .order_by(WorkflowApproval.id)
        )).scalars().all()
        pending_approvals = [approval for approval in node_approvals if approval.action is None]

        acting_approval = next((approval for approval in pending_approvals if approval.approver_id == acting_user_id), None)
        if acting_approval is None:
            if any(a.approver_id == acting_user_id and a.action is not None for a in node_approvals):
                raise HTTPException(409, "You have already acted on the current step")
            is_admin = bool((user or {}).get("is_admin"))
            unassigned_initiator = (not pending_approvals and inst.initiator_id == acting_user_id
                                    and config.get("domainCode") != "material-application-approval"
                                    and not str(config.get("domainCode") or "").startswith("form-approval:"))
            if not (is_admin or unassigned_initiator):
                raise HTTPException(403, "You are not an approver of the current step")
            # Admin override / unassigned-node fallback: record the action under
            # the actor's own identity instead of rewriting someone else's row.
            acting_approval = WorkflowApproval(
                instance_id=inst.id,
                approver_id=acting_user_id,
                node_id=current_node_id,
            )
            db.add(acting_approval)

        async def finalize():
            from app.services.material_workflow import sync_material_instance
            await sync_material_instance(db, inst, user=user or {}, action=action, comment=body.comment)
            from app.services.form_application_lifecycle import sync_form_application_instance
            await sync_form_application_instance(db, inst, user=user or {}, action=action, comment=body.comment)
            from app.services.approval_notifications import notify_result
            await notify_result(db, inst, action=action, comment=body.comment)
            from app.models.relational import AuditLog
            db.add(AuditLog(tenant_id=tenant_id, user_id=acting_user_id, action=action,
                            resource_type='workflow_instance', resource_id=inst.id))
            if shared_db is None:
                await db.commit()
            else:
                await db.flush()

        acting_approval.action = action
        acting_approval.comment = body.comment
        acting_approval.acted_at = datetime.now()

        groups = state.get('current_approval_groups') or []
        if action == 'reject':
            for approval in pending_approvals:
                if approval is not acting_approval:
                    approval.action = 'skipped'
                    approval.comment = '当前节点已被驳回'
                    approval.acted_at = datetime.now()
            from app.services.workflow_routing import rejection_route
            pinned_route = state.get('execution_node_ids') or []
            route = rejection_route(config, form_data, pinned_route[:current_step_idx + 1])
            if route is None:
                inst.status = 'rejected'
                state['current_node'] = 'end'
                _set_current_assignees(state, [])
                inst.workflow_state = json.dumps(state, ensure_ascii=False)
                await finalize()
                return {'id': inst.id, 'status': 'rejected', 'current_step': current_step_idx}
            state['execution_node_ids'] = route
            steps = _instance_steps(config, state)
        elif groups:
            from app.services.approval_groups import evaluate_approval_groups
            complete, outstanding = evaluate_approval_groups(groups, [*node_approvals, acting_approval])
            for approval in pending_approvals:
                if approval.action is None and approval.approver_id not in outstanding:
                    approval.action = 'skipped'
                    approval.comment = '该处理对象已满足审批条件'
                    approval.acted_at = datetime.now()
            if not complete:
                _set_current_assignees(state, outstanding)
                inst.workflow_state = json.dumps(state, ensure_ascii=False)
                await finalize()
                return {'id': inst.id, 'status': inst.status, 'current_step': current_step_idx,
                        'message': '已通过，等待其他处理对象满足审批条件'}
        elif approval_mode == 'countersign':
            remaining = [approval for approval in pending_approvals if approval.action is None]
            if remaining:
                _set_current_assignees(state, [approval.approver_id for approval in remaining])
                inst.status = 'pending'
                inst.workflow_state = json.dumps(state, ensure_ascii=False)
                await finalize()
                return {'id': inst.id, 'status': inst.status, 'current_step': current_step_idx, 'message': '已通过，等待其他会签人'}
        else:
            for approval in pending_approvals:
                if approval is not acting_approval:
                    approval.action = 'skipped'
                    approval.comment = '同节点其他待办已由他人处理'
                    approval.acted_at = datetime.now()

        next_step_idx = _find_next_actionable_step(steps, current_step_idx)
        from app.services.workflow_dispatch import enqueue
        from app.services.workflow_cc import notify_reached
        stop = next_step_idx if next_step_idx is not None else len(steps)
        enqueue(state, steps, current_step_idx + 1, stop, on_rejection=action == 'reject' and next_step_idx is None)
        await notify_reached(db, inst, state, steps[current_step_idx + 1:stop])
        if next_step_idx is not None:
            next_step = steps[next_step_idx]
            state["current_step"] = next_step_idx
            state["current_node"] = next_step.get("node_id", next_step.get("name", ""))
            inst.status = "pending"

            # Create new approval record for next step
            if next_step.get("type") == "approval":
                state.pop('current_approval_after_id', None)
                if any(step.get('node_id', step.get('name')) == state['current_node'] for step in steps[:next_step_idx]):
                    await db.flush()
                    state['current_approval_after_id'] = await db.scalar(select(func.max(WorkflowApproval.id)).where(
                        WorkflowApproval.instance_id == inst_id, WorkflowApproval.node_id == state['current_node'],
                    ))
                next_approval_groups: list[dict] = []
                approver_ids = await _resolve_step_approver_ids(
                    db,
                    tenant_id,
                    next_step,
                    form_data if isinstance(form_data, dict) else {},
                    variables,
                    inst.initiator_id,
                    acting_user_id,
                    allow_fallback=not (config.get("domainCode") == "material-application-approval"
                                        or str(config.get("domainCode") or "").startswith("form-approval:")),
                    approval_groups=next_approval_groups,
                )
                if not approver_ids and (config.get("domainCode") == "material-application-approval"
                                          or str(config.get("domainCode") or "").startswith("form-approval:")):
                    raise HTTPException(409, "下一审批步骤没有有效审批人，请管理员恢复审批人后重试")
                _set_current_assignees(state, approver_ids, approval_groups=next_approval_groups)
                for approver_id in approver_ids:
                    db.add(WorkflowApproval(
                        instance_id=inst.id,
                        approver_id=approver_id,
                        node_id=next_step.get("node_id", next_step.get("name", "")),
                    ))
                inst.workflow_state = json.dumps(state, ensure_ascii=False)
                await _add_approval_notifications(db, tenant_id, approver_ids, inst.title, inst.id)
            inst.workflow_state = json.dumps(state, ensure_ascii=False)
        else:
            # No more steps — workflow completed
            inst.status = "rejected" if action == "reject" else "approved"
            state["current_node"] = "end"
            state["current_step"] = len(steps) - 1 if steps else current_step_idx
            _set_current_assignees(state, [])
            inst.workflow_state = json.dumps(state, ensure_ascii=False)

        await finalize()
        return {
            "id": inst.id, "status": inst.status,
            "current_step": state.get("current_step", current_step_idx),
            "message": {"approved": "已通过", "rejected": "已驳回"}.get(inst.status, "已进入下一步"),
        }

    result = await _query(shared_db) if shared_db is not None else await _try_db(_query)
    if result is None:
        raise HTTPException(404, "Instance not found")
    return result


# Legacy act endpoint kept for backward compatibility
@router.post("/instances/{inst_id}/act")
async def approve_or_reject(inst_id: int, body: ApprovalAction, user: dict = Depends(get_current_user)):
    """审批/驳回工作流实例 (legacy endpoint)."""
    if body.action not in ("approve", "reject"):
        raise HTTPException(400, "action must be 'approve' or 'reject'")

    step_body = StepApprovalRequest(comment=body.comment, expected_node_id=body.expected_node_id, expected_step=body.expected_step)
    return await _act_on_step(inst_id, step_body, action=body.action, user=user)


@router.post("/instances/{inst_id}/cancel")
async def cancel_instance(inst_id: int, user: dict = Depends(get_current_user)):
    """撤销工作流实例（仅发起人或管理员，且实例仍在途）."""
    async def _query(db):
        from app.models.relational import WorkflowInstance
        tenant_id = current_tenant_id(user)
        inst = (await db.execute(
            select(WorkflowInstance).where(WorkflowInstance.id == inst_id).with_for_update()
        )).scalar_one_or_none()
        if not inst or inst.tenant_id != tenant_id:
            return None
        acting_user_id = current_user_id(user)
        if not user.get("is_admin") and (not acting_user_id or inst.initiator_id != acting_user_id):
            raise HTTPException(403, "Only the initiator or an admin can cancel this instance")
        if str(inst.status or "").lower() not in ACTIONABLE_INSTANCE_STATUSES:
            raise HTTPException(409, f"Instance is already {inst.status}; it cannot be cancelled")
        material_state = _safe_json(inst.workflow_state, {})
        if (material_state.get("variables") or {}).get("form_code") == "material-application":
            raise HTTPException(409, "料号申请请通过审批或驳回结束处理")
        from app.services.form_application_lifecycle import events
        from app.models.relational import Form
        cancel_vars = material_state.get("variables") or {}
        source_form = await db.get(Form, cancel_vars.get("form_id")) if cancel_vars.get("form_id") else None
        if source_form and source_form.tenant_id == tenant_id and cancel_vars.get("record_id"):
            if await events(db, source_form, cancel_vars["record_id"]):
                raise HTTPException(409, "表单申请请通过审批或驳回结束处理")
        inst.status = "cancelled"
        state = _safe_json(inst.workflow_state, {})
        state["current_node"] = "end"
        _set_current_assignees(state, [])
        inst.workflow_state = json.dumps(state, ensure_ascii=False)
        await db.commit()
        await write_audit_log(
            tenant_id=tenant_id,
            user_id=acting_user_id,
            action="cancel",
            resource_type="workflow_instance",
            resource_id=inst.id,
        )
        return {"id": inst.id, "status": "cancelled"}

    result = await _try_db(_query)
    if result is None:
        raise HTTPException(404, "Instance not found")
    return result


# ── Notifications ────────────────────────────────────────

@router.get("/notifications")
async def list_notifications(
    user_id: Optional[int] = Query(None, description="User ID; only admins may read another user's feed"),
    user: dict = Depends(get_current_user),
):
    """通知列表（默认当前用户；管理员可指定他人）."""
    tenant_id = current_tenant_id(user)
    effective_user_id = user_id or current_user_id(user)
    if effective_user_id != current_user_id(user) and not user.get("is_admin"):
        raise HTTPException(403, "Cannot read another user's notifications")

    async def _query(db):
        from app.models.relational import Notification
        result = await db.execute(
            select(Notification)
            .where(Notification.tenant_id == tenant_id, Notification.user_id == effective_user_id)
            .order_by(Notification.created_at.desc())
        )
        items = result.scalars().all()
        return {"data": [
            {"id": n.id, "user_id": n.user_id, "title": n.title, "content": n.content,
             "type": n.type, "is_read": n.is_read, "link": n.link,
             "target_path": n.link, "related_id": n.resource_id, "resource_type": n.resource_type,
             "resource_id": n.resource_id,
             "created_at": n.created_at.isoformat() if n.created_at else None}
            for n in items
        ]}

    return await _try_db(_query)


@router.post("/notifications/{notif_id}/read")
async def mark_read(notif_id: int, user: dict = Depends(get_current_user)):
    """标记通知已读（仅属主或管理员）."""
    async def _query(db):
        from app.models.relational import Notification
        tenant_id = current_tenant_id(user)
        n = await db.get(Notification, notif_id)
        if not n or n.tenant_id != tenant_id:
            return None
        if n.user_id != current_user_id(user) and not user.get("is_admin"):
            return None
        n.is_read = True
        await db.commit()
        return {"ok": True}

    result = await _try_db(_query)
    if result is None:
        raise HTTPException(404, "Notification not found")
    return result


@router.post("/notifications/read-all")
async def mark_all_read(
    user_id: Optional[int] = Query(None, description="User ID; only admins may act for another user"),
    user: dict = Depends(get_current_user),
):
    """全部标记已读（默认当前用户；管理员可指定他人）."""
    tenant_id = current_tenant_id(user)
    effective_user_id = user_id or current_user_id(user)
    if effective_user_id != current_user_id(user) and not user.get("is_admin"):
        raise HTTPException(403, "Cannot modify another user's notifications")

    async def _query(db):
        from app.models.relational import Notification
        from sqlalchemy import update
        await db.execute(
            update(Notification)
            .where(Notification.tenant_id == tenant_id, Notification.user_id == effective_user_id)
            .values(is_read=True)
        )
        await db.commit()
        return {"ok": True}

    return await _try_db(_query)


# ── Stats / Summary ──────────────────────────────────────

@router.get("/stats")
async def workflow_stats(user: dict = Depends(get_current_user)):
    """工作流统计概览."""
    async def _query(db):
        from app.models.relational import Notification, User, WorkflowDef, WorkflowInstance
        tenant_id = current_tenant_id(user)
        total_definitions = await db.scalar(
            select(func.count(WorkflowDef.id)).where(WorkflowDef.tenant_id == tenant_id)
        )
        total_instances = await db.scalar(
            select(func.count(WorkflowInstance.id)).where(WorkflowInstance.tenant_id == tenant_id)
        )
        status_rows = await db.execute(
            select(WorkflowInstance.status, func.count(WorkflowInstance.id))
            .where(WorkflowInstance.tenant_id == tenant_id)
            .group_by(WorkflowInstance.status)
        )
        by_status = {status: count for status, count in status_rows.all()}
        unread_notifications = await db.scalar(
            select(func.count(Notification.id))
            .join(User, User.id == Notification.user_id)
            .where(User.tenant_id == tenant_id, Notification.is_read.is_(False))
        )
        return {
            "total_definitions": int(total_definitions or 0),
            "total_instances": int(total_instances or 0),
            "instances_by_status": {
                "pending": int(by_status.get("pending", 0)),
                "approved": int(by_status.get("approved", 0)),
                "rejected": int(by_status.get("rejected", 0)),
                "cancelled": int(by_status.get("cancelled", 0)),
            },
            "unread_notifications": int(unread_notifications or 0),
        }

    return await _try_db(_query)


@router.get("/instances/{inst_id}/dispatches")
async def list_dispatches(inst_id: int, user: dict = Depends(require_admin)):
    async def query(db):
        from app.models.relational import WorkflowInstance
        instance=await db.get(WorkflowInstance,inst_id)
        if not instance or instance.tenant_id != current_tenant_id(user):
            raise HTTPException(404,'Workflow not found')
        jobs=json.loads(instance.workflow_state or '{}').get('dispatch_jobs') or []
        return {'items':[{key:value for key,value in job.items() if key!='action'} for job in jobs]}
    return await _try_db(query)


@router.post("/instances/{inst_id}/dispatches/{node_id}/retry")
async def retry_dispatch(inst_id: int, node_id: str, user: dict = Depends(require_admin)):
    async def query(db):
        from app.models.relational import WorkflowInstance
        from app.services.workflow_dispatch import dispatch_allowed
        instance=await db.scalar(select(WorkflowInstance).where(WorkflowInstance.id==inst_id,WorkflowInstance.tenant_id==current_tenant_id(user)).with_for_update())
        if not instance:
            raise HTTPException(404,'Workflow not found')
        state=json.loads(instance.workflow_state or '{}')
        job=next((job for job in state.get('dispatch_jobs',[]) if job['node_id']==node_id),None)
        if not dispatch_allowed(instance.status, job or {}):
            raise HTTPException(409,'已撤销或驳回的流程不能重试下发')
        if not job or job['status']!='failed':
            raise HTTPException(409,'只能重试失败的下发任务')
        job['status']='pending';state['dispatch_pending']=True
        instance.workflow_state=json.dumps(state,ensure_ascii=False)
        from app.services.records import change_audit
        await change_audit(db,tenant_id=instance.tenant_id,user_id=current_user_id(user),action='retry_workflow_dispatch',resource_type='workflow_instance',resource_id=instance.id,new_values={'node_id':node_id})
        await db.commit()
        return {'status':'pending'}
    return await _try_db(query)


@router.get('/definitions/{def_id}/dispatches')
async def definition_dispatches(def_id: int, user: dict = Depends(require_admin)):
    async def query(db):
        from app.models.relational import WorkflowDef, WorkflowInstance
        definition=await db.get(WorkflowDef,def_id)
        if not definition or definition.tenant_id!=current_tenant_id(user):
            raise HTTPException(404,'Workflow not found')
        instances=(await db.scalars(select(WorkflowInstance).where(WorkflowInstance.workflow_id==def_id,WorkflowInstance.tenant_id==current_tenant_id(user)).order_by(WorkflowInstance.id.desc()).limit(100))).all()
        return {'items':[{'instance_id':instance.id,'instance_title':instance.title,**{key:value for key,value in job.items() if key!='action'}} for instance in instances for job in json.loads(instance.workflow_state or '{}').get('dispatch_jobs',[])]}
    return await _try_db(query)
