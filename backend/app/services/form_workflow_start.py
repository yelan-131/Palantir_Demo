"""Starting bound workflows for form records and guarding records under approval."""
from __future__ import annotations

import json
from typing import Optional
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.principal import current_user_id


def _workflow_instance_title(form, record_payload: dict, binding_config: Optional[dict]) -> str:
    binding_config = binding_config or {}
    data = record_payload.get("data") if isinstance(record_payload, dict) else {}
    title_field = binding_config.get("title_field") or binding_config.get("titleField")
    if title_field and isinstance(data, dict) and data.get(str(title_field)):
        return str(data[str(title_field)])
    for key in ("title", "name", "material_code", "material_no", "code", "alertId", "risk_no"):
        if isinstance(data, dict) and data.get(key):
            return f"{form.name} - {data[key]}"
    return f"{form.name} #{record_payload.get('id')}"


async def _start_form_workflows(
    db: AsyncSession,
    *,
    tenant_id: int,
    form,
    record_payload: dict,
    user: dict,
    trigger_action: str = "submit",
) -> list[dict]:
    if form.code == "material-application" and trigger_action != "manual_submit":
        return []
    from app.services.workflow_approvals import _add_approval_notifications, _find_first_approval_step, _resolve_step_approver_ids, _set_current_assignees
    from app.services.workflow_views import _workflow_config_steps
    from app.models.relational import WorkflowApproval, WorkflowBinding, WorkflowDef, WorkflowDefVersion, WorkflowInstance

    bindings = (await db.execute(
        select(WorkflowBinding)
        .where(
            WorkflowBinding.tenant_id == tenant_id,
            WorkflowBinding.form_id == form.id,
            WorkflowBinding.trigger_action == trigger_action,
            WorkflowBinding.enabled == True,
        )
        .order_by(WorkflowBinding.id)
    )).scalars().all()
    if not bindings:
        return []

    started: list[dict] = []
    initiator_id = current_user_id(user)
    form_data = record_payload.get("data") if isinstance(record_payload.get("data"), dict) else {}
    for binding in bindings:
        workflow_def = await db.get(WorkflowDef, binding.workflow_id)
        if not workflow_def or workflow_def.tenant_id != tenant_id or workflow_def.status not in {"published", "active"}:
            raise HTTPException(409, "此表单的审批流程尚未发布，请联系管理员配置")
        snapshot = await db.scalar(select(WorkflowDefVersion).where(
            WorkflowDefVersion.tenant_id == tenant_id,
            WorkflowDefVersion.workflow_id == workflow_def.id,
            WorkflowDefVersion.version == int(workflow_def.version or 1),
            WorkflowDefVersion.status.in_(["published", "active"]),
        ))
        raw_config = snapshot.config if snapshot else workflow_def.config
        config = json.loads(raw_config) if isinstance(raw_config, str) else raw_config
        managed = str((config or {}).get("domainCode", "")).startswith("form-approval:") or (config or {}).get("domainCode") == "material-application-approval"
        if managed and not snapshot:
            raise HTTPException(409, "审批流程缺少已发布版本，请重新发布配置")
        steps = _workflow_config_steps(config if isinstance(config, dict) else {}, form_data, trigger_action=trigger_action)
        first_step_index = _find_first_approval_step(steps) if steps else 0
        current_step = steps[first_step_index] if steps and first_step_index < len(steps) else None
        variables = {
            "form_id": form.id,
            "form_code": form.code,
            "record_id": record_payload.get("id"),
            "trigger_action": trigger_action,
        }
        if managed:
            for step in steps:
                if step.get("type") != "approval":
                    continue
                stage_ids = await _resolve_step_approver_ids(db, tenant_id, step, form_data, variables,
                                                           initiator_id, None, allow_fallback=False)
                if not stage_ids:
                    raise HTTPException(409, f"审批节点 {step.get('name', '')} 没有有效审批人，请重新配置")
            if not current_step or current_step.get("type") != "approval":
                raise HTTPException(409, "审批流程没有有效审批节点")
        approval_groups: list[dict] = []
        approver_ids = await _resolve_step_approver_ids(
            db,
            tenant_id,
            current_step or {},
            form_data,
            variables,
            initiator_id,
            initiator_id,
            allow_fallback=not managed,
            approval_groups=approval_groups,
        ) if current_step and current_step.get("type") == "approval" else []
        state = {
            "current_node": current_step.get("node_id", current_step.get("name", "start")) if current_step else "end",
            "current_step": first_step_index,
            "resource_type": "dynamic_record",
            "resource_id": record_payload.get("id"),
            "variables": variables,
        }
        if config.get('nodes') and not config.get('steps'):
            state['execution_node_ids'] = [step['node_id'] for step in steps]
        _set_current_assignees(state, approver_ids, approval_groups=approval_groups)
        title = _workflow_instance_title(form, record_payload, binding.config)
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
        instance = WorkflowInstance(
            tenant_id=tenant_id,
            workflow_id=workflow_def.id,
            workflow_version=int(workflow_def.version or 1),
            title=title,
            initiator_id=initiator_id,
            form_data=json.dumps(form_data, ensure_ascii=False, default=str),
            workflow_state=json.dumps(state, ensure_ascii=False, default=str),
            status="approved" if completed else "pending",
        )
        db.add(instance)
        await db.flush()
        await notify_reached(db, instance, state, reached_steps)
        instance.workflow_state = json.dumps(state, ensure_ascii=False, default=str)
        if current_step and current_step.get("type") == "approval":
            for approver_id in approver_ids:
                db.add(WorkflowApproval(
                    instance_id=instance.id,
                    approver_id=approver_id,
                    node_id=current_step.get("node_id", current_step.get("name", "")),
                ))
            await _add_approval_notifications(db, tenant_id, approver_ids, title, instance.id)
        started.append({
            "instance_id": instance.id,
            "workflow_id": workflow_def.id,
            "status": instance.status,
            "current_step": state['current_step'],
            "current_step_name": current_step.get("name") if current_step else None,
            "approver_ids": approver_ids,
        })
    return started


async def _protect_pending_form_record(db, tenant_id, form_id, record_id):
    """Keep submitted source content stable while managed approval is pending."""
    from app.models.relational import WorkflowInstance, WorkflowDef, WorkflowDefVersion
    rows = (await db.execute(select(WorkflowInstance, WorkflowDef)
        .join(WorkflowDef, WorkflowDef.id == WorkflowInstance.workflow_id)
        .where(WorkflowInstance.tenant_id == tenant_id, WorkflowDef.tenant_id == tenant_id,
               WorkflowInstance.status.in_(["pending", "in_progress"])))).all()
    for instance, definition in rows:
        snapshot = await db.scalar(select(WorkflowDefVersion).where(
            WorkflowDefVersion.tenant_id == tenant_id, WorkflowDefVersion.workflow_id == definition.id,
            WorkflowDefVersion.version == instance.workflow_version)) if instance.workflow_version else None
        raw_config = snapshot.config if snapshot else definition.config
        try:
            config = json.loads(raw_config or "{}") if isinstance(raw_config, str) else raw_config or {}
            state = json.loads(instance.workflow_state or "{}") if isinstance(instance.workflow_state, str) else instance.workflow_state or {}
        except (ValueError, TypeError):
            continue
        variables = state.get("variables") or {}
        if (config.get("domainCode") == f"form-approval:{form_id}"
                and str(variables.get("form_id")) == str(form_id)
                and str(variables.get("record_id")) == str(record_id)):
            raise HTTPException(409, "记录正在审批中，不能修改或删除，请先完成审批")
