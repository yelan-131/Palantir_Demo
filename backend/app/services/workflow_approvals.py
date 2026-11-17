"""Approval step resolution, assignee updates, and approval notifications."""

from typing import Any
from fastapi import HTTPException
from sqlalchemy import select


def _find_first_approval_step(steps: list[dict]) -> int:
    """Return the index of the first approval-type step, or 0 if none."""
    for i, step in enumerate(steps):
        if step.get("type") == "approval":
            return i
    return 0


def _append_unique_ids(target: list[int], values: list[int]) -> None:
    seen = set(target)
    for value in values:
        if value and value not in seen:
            target.append(value)
            seen.add(value)


async def _resolve_users_by_token(db, tenant_id: int, token: Any) -> list[int]:
    """Resolve a user token from id / username / display name / email."""
    from app.models.relational import User

    if token is None or token == "":
        return []
    if isinstance(token, list):
        result: list[int] = []
        for item in token:
            _append_unique_ids(result, await _resolve_users_by_token(db, tenant_id, item))
        return result
    token_text = str(token).strip()
    if not token_text:
        return []
    filters = [User.tenant_id == tenant_id, User.is_active == True]
    if token_text.isdigit():
        user = await db.scalar(select(User).where(*filters, User.id == int(token_text)))
        return [user.id] if user else []
    rows = (await db.execute(
        select(User.id).where(
            *filters,
            (User.username == token_text) | (User.display_name == token_text) | (User.email == token_text),
        )
    )).scalars().all()
    return [int(row) for row in rows]


async def _resolve_users_by_role(db, tenant_id: int, role_value: Any) -> list[int]:
    from app.models.relational import Role, User, UserRole

    if not role_value:
        return []
    role_text = str(role_value).strip()
    rows = (await db.execute(
        select(User.id)
        .join(UserRole, UserRole.user_id == User.id)
        .join(Role, Role.id == UserRole.role_id)
        .where(
            User.tenant_id == tenant_id,
            User.is_active == True,
            UserRole.tenant_id == tenant_id,
            Role.tenant_id == tenant_id,
            (Role.name == role_text) | (Role.label == role_text),
        )
        .order_by(User.id)
    )).scalars().all()
    return [int(row) for row in rows]


async def _resolve_users_by_org(db, tenant_id: int, org_value: Any, include_children: bool = False) -> list[int]:
    from app.models.relational import OrgUnit, User, UserOrgMembership

    if not org_value:
        return []
    org_text = str(org_value).strip()
    org_filters = [OrgUnit.tenant_id == tenant_id]
    if org_text.isdigit():
        org_filter = OrgUnit.id == int(org_text)
    else:
        org_filter = (OrgUnit.code == org_text) | (OrgUnit.name == org_text)
    orgs = (await db.execute(select(OrgUnit).where(*org_filters, org_filter))).scalars().all()
    org_ids = [org.id for org in orgs]
    if include_children and org_ids:
        children = (await db.execute(select(OrgUnit.id).where(OrgUnit.tenant_id == tenant_id, OrgUnit.parent_id.in_(org_ids)))).scalars().all()
        org_ids.extend(int(child) for child in children)
    if not org_ids:
        return []
    rows = (await db.execute(
        select(User.id)
        .join(UserOrgMembership, UserOrgMembership.user_id == User.id)
        .where(
            User.tenant_id == tenant_id,
            User.is_active == True,
            UserOrgMembership.tenant_id == tenant_id,
            UserOrgMembership.org_unit_id.in_(org_ids),
        )
        .order_by(User.id)
    )).scalars().all()
    return [int(row) for row in rows]


async def _resolve_initiator_org_users(db, tenant_id: int, initiator_id: int | None) -> list[int]:
    from app.models.relational import OrgUnit, UserOrgMembership

    if not initiator_id:
        return []
    membership = await db.scalar(
        select(UserOrgMembership).where(
            UserOrgMembership.tenant_id == tenant_id,
            UserOrgMembership.user_id == initiator_id,
        ).order_by(UserOrgMembership.is_primary.desc(), UserOrgMembership.id)
    )
    if not membership:
        return []
    org = await db.get(OrgUnit, membership.org_unit_id)
    if not org:
        return []
    return await _resolve_users_by_org(db, tenant_id, org.code or org.id)


async def _resolve_step_approver_ids(
    db,
    tenant_id: int,
    step: dict,
    form_data: dict,
    variables: dict,
    initiator_id: int | None,
    fallback_user_id: int | None,
    *, allow_fallback: bool = True,
    approval_groups: list[dict] | None = None,
) -> list[int]:
    rules = step.get("assignee_rules")
    if not isinstance(rules, list) or not rules:
        assignee_role = step.get("assignee_role")
        rules = [{"type": "role", "value": assignee_role}] if assignee_role else []

    # Explicit per-object policies opt into grouped approval. Legacy definitions
    # retain their node-wide policy, including already running instances.
    if any(isinstance(rule, dict) and ('approvalMode' in rule or 'approval_mode' in rule) for rule in rules):
        groups = []
        all_ids: list[int] = []
        for index, rule in enumerate(rules):
            if not isinstance(rule, dict):
                raise HTTPException(422, '处理人规则格式无效')
            mode = rule.get('approvalMode') or rule.get('approval_mode') or step.get('approval_mode') or 'single'
            if mode not in {'single', 'orSign', 'countersign'}:
                raise HTTPException(422, '处理对象审批方式无效')
            legacy_rule = {key: value for key, value in rule.items() if key not in {'approvalMode', 'approval_mode'}}
            members = await _resolve_step_approver_ids(db, tenant_id, {'assignee_rules': [legacy_rule]},
                form_data, variables, initiator_id, None, allow_fallback=False)
            if not members:
                raise HTTPException(409, f'第 {index + 1} 个处理对象没有有效审批人，请重新配置')
            if mode == 'single':
                members = members[:1]
            groups.append({'id': str(rule.get('id') or index), 'mode': mode, 'user_ids': members})
            _append_unique_ids(all_ids, members)
        if approval_groups is not None:
            approval_groups.extend(groups)
        return all_ids

    approver_ids: list[int] = []
    for rule in rules:
        if not isinstance(rule, dict):
            continue
        rule_type = str(rule.get("type") or "role")
        value = rule.get("value")
        if rule_type == "role":
            _append_unique_ids(approver_ids, await _resolve_users_by_role(db, tenant_id, value))
        elif rule_type in {"user", "fixed"}:
            if not allow_fallback:
                tokens = value if isinstance(value, list) else [value]
                for token in tokens:
                    resolved = await _resolve_users_by_token(db, tenant_id, token)
                    if not resolved:
                        raise HTTPException(409, "指定审批人已停用或不可用，请管理员恢复或重新配置后重试")
                    _append_unique_ids(approver_ids, resolved)
            else:
                _append_unique_ids(approver_ids, await _resolve_users_by_token(db, tenant_id, value))
        elif rule_type == "organization":
            _append_unique_ids(approver_ids, await _resolve_users_by_org(db, tenant_id, value, rule.get("scope") == "children"))
        elif rule_type == "field":
            field_value = form_data.get(str(value)) if value else None
            if field_value is None and value:
                field_value = variables.get(str(value))
            _append_unique_ids(approver_ids, await _resolve_users_by_token(db, tenant_id, field_value))
        elif rule_type == "departmentOwner":
            _append_unique_ids(approver_ids, await _resolve_initiator_org_users(db, tenant_id, initiator_id))
        elif rule_type == "initiatorManager":
            # No manager hierarchy exists yet; keep the workflow actionable by routing to initiator.
            if initiator_id:
                _append_unique_ids(approver_ids, [initiator_id])

    if allow_fallback and not approver_ids and fallback_user_id:
        _append_unique_ids(approver_ids, [fallback_user_id])
    if allow_fallback and not approver_ids and initiator_id:
        _append_unique_ids(approver_ids, [initiator_id])
    return approver_ids


def _set_current_assignees(state: dict, approver_ids: list[int], *, approval_groups: list[dict] | None = None) -> None:
    if approval_groups is not None:
        state['current_approval_groups'] = approval_groups
    elif not approver_ids:
        state.pop('current_approval_groups', None)
    state["current_assignee_ids"] = approver_ids
    state["current_assignee_id"] = approver_ids[0] if approver_ids else None


async def _add_approval_notifications(db, tenant_id: int, approver_ids: list[int], title: str, instance_id: int) -> None:
    from app.services.approval_notifications import notify_pending
    await notify_pending(db, tenant_id, approver_ids, title, instance_id)
