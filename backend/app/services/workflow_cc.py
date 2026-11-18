"""Validate and deliver in-app notifications for reached workflow CC nodes."""

from urllib.parse import quote

from fastapi import HTTPException

from app.models.relational import Notification
from app.services.workflow_approvals import _resolve_users_by_role, _resolve_users_by_token


def validate_recipients(node: dict) -> None:
    recipients = node.get("ccRecipients")
    if not isinstance(recipients, list) or not recipients or any(
        not isinstance(rule, dict)
        or rule.get("type") not in ("user", "role")
        or not isinstance(rule.get("value"), str)
        or not rule["value"].strip()
        for rule in recipients
    ):
        label = node.get("label") or node.get("id") or "抄送任务"
        raise HTTPException(422, f"抄送任务「{label}」至少需要配置一位用户或一个角色")


async def notify_reached(db, instance, state: dict, steps: list[dict]) -> None:
    """Write notifications with the workflow transition under its instance lock."""
    reached = set(state.get("cc_reached_nodes", []))
    for step in steps:
        node_id = step.get("node_id")
        rules = step.get("cc_recipients")
        if step.get("type") != "notification" or not isinstance(node_id, str) or not node_id or node_id in reached or not isinstance(rules, list) or not rules:
            continue

        recipients: set[int] = set()
        for rule in rules:
            if not isinstance(rule, dict) or not rule.get("value"):
                continue
            if rule.get("type") == "user":
                recipients.update(await _resolve_users_by_token(db, instance.tenant_id, rule["value"]))
            elif rule.get("type") == "role":
                recipients.update(await _resolve_users_by_role(db, instance.tenant_id, rule["value"]))

        for user_id in sorted(recipients):
            db.add(Notification(
                tenant_id=instance.tenant_id,
                user_id=user_id,
                title="流程抄送",
                content=f"流程 #{instance.id} 已到达「{step.get('name') or '抄送任务'}」。",
                type="workflow_cc",
                resource_type="workflow_instance",
                resource_id=instance.id,
                link=f"/workflow?instance_id={instance.id}&node_id={quote(node_id, safe='')}",
            ))
        state.setdefault("cc_reached_nodes", []).append(node_id)
        reached.add(node_id)
