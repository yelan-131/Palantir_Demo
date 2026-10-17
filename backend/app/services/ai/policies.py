"""Policy and risk gates for AI tool execution."""

from __future__ import annotations

from typing import Any
from fnmatch import fnmatchcase

from .schemas import AIPermissionDecision, SkillAction
from .skills import get_skill


FORBIDDEN_SKILLS = {
    "purchase.create_purchase_order",
    "security.change_permission",
    "data.delete_record",
    "supply.auto_order",
}


def action_is_forbidden(settings: dict[str, Any], name: str, *, side_effect: str | None = None) -> bool:
    categories = {
        "auto_order": ("*.auto_order", "*.create_purchase_order"),
        "delete_data": ("*.delete_*", "*.delete", "*.remove_record"),
        "change_permission": ("*.change_permission*", "*.grant_permission*", "*.revoke_permission*"),
    }
    for action in settings.get("forbiddenActions", []):
        if action == name or any(fnmatchcase(name, pattern) for pattern in categories.get(action, ())):
            return True
        if action == "publish_config" and side_effect == "configuration_write":
            return True
    return False

def apply_policy(action: SkillAction) -> SkillAction:
    if action.skill in FORBIDDEN_SKILLS:
        action.mode = "blocked"
        action.risk_level = "critical"
        action.requires_confirmation = True
        action.payload = {**action.payload, "blocked_reason": "Action is disabled by AI safety policy"}
        return action

    if action.mode in {"draft", "confirmed_write"} or action.risk_level in {"medium", "high", "critical"}:
        action.requires_confirmation = True
    return action


def _role_names(user: dict[str, Any]) -> set[str]:
    if user.get("is_admin"):
        return {"admin"}
    roles = user.get("roles") or []
    names = set()
    for role in roles:
        if isinstance(role, dict):
            if role.get("name"):
                names.add(str(role["name"]))
        elif isinstance(role, str):
            names.add(role)
    return names


def _risk_action(settings: dict[str, Any], risk_level: str) -> str:
    return (settings.get("riskPolicy") or {}).get(risk_level, "confirm" if risk_level in {"medium", "high"} else "allow")


def decide_ai_permission(
    user: dict[str, Any],
    settings: dict[str, Any],
    capability: str,
    *,
    skill: str | None = None,
    domain: str | None = None,
    risk_level: str = "low",
) -> AIPermissionDecision:
    reason = None
    if not settings.get("aiEnabled", True):
        reason = "AI 已关闭"
    elif settings.get("agentMode", "draft") == "off":
        reason = "Agent 已关闭"
    elif capability == "rag" and not (settings.get("ragPolicy") or {}).get("enabled", True):
        reason = "知识检索已关闭"
    elif capability in {"qa", "rag", "business_query", "report"} and not settings.get("qaEnabled", True):
        reason = "问答与查询能力已关闭"
    elif capability in {"draft", "save_draft", "workflow", "config"} and not settings.get("assistEnabled", True):
        reason = "辅助操作能力已关闭"
    elif settings.get("agentMode") == "readonly" and capability in {"draft", "save_draft", "workflow", "config"}:
        reason = "只读模式不允许生成或执行操作"
    elif domain and "domains" in settings and domain not in settings["domains"]:
        reason = "业务域未开放"
    if reason:
        return AIPermissionDecision(allowed=False, reason=reason, capability=capability)

    if skill and (skill in FORBIDDEN_SKILLS or action_is_forbidden(settings, skill)):
        return AIPermissionDecision(allowed=False, reason="Action is disabled by AI safety policy", capability=capability)

    if user.get("is_admin") and not settings.get("rolePolicies"):
        action = _risk_action(settings, risk_level)
        return AIPermissionDecision(
            allowed=action != "blocked",
            reason="Admin AI policy",
            requires_confirmation=action in {"confirm", "confirm_and_audit"},
            audit_required=action == "confirm_and_audit",
            matched_role="admin",
            capability=capability,
        )

    user_roles = _role_names(user)
    matched_role_names: list[str] = []
    for policy in settings.get("rolePolicies", []):
        if not policy.get("enabled", True):
            continue
        if policy.get("role") not in user_roles:
            continue
        matched_role_names.append(str(policy.get("role")))
        if capability not in set(policy.get("capabilities", [])):
            continue
        policy_domains = set(policy.get("domains", []))
        if domain and policy_domains and domain not in policy_domains:
            continue
        role_mode = policy.get("agentMode", "confirm")
        if role_mode == "off" or (role_mode == "readonly" and capability in {"draft", "save_draft", "workflow", "config"}):
            continue
        action = _risk_action(settings, risk_level)
        return AIPermissionDecision(
            allowed=action != "blocked",
            reason="Allowed by role AI policy",
            requires_confirmation=action in {"confirm", "confirm_and_audit"} or capability in {"draft", "save_draft", "workflow"},
            audit_required=action == "confirm_and_audit",
            matched_role=policy.get("role"),
            capability=capability,
        )

    if matched_role_names:
        return AIPermissionDecision(
            allowed=False,
            reason="AI capability or domain is not allowed for this role",
            matched_role=", ".join(matched_role_names),
            capability=capability,
        )

    return AIPermissionDecision(allowed=False, reason="No matching AI role policy", capability=capability)


def decide_skill_permission(user: dict[str, Any], settings: dict[str, Any], action: SkillAction, capability: str | None = None) -> AIPermissionDecision:
    skill = get_skill(action.skill)
    selected_capability = capability or (skill.permission_capability if skill else None) or "qa"
    return decide_ai_permission(
        user,
        settings,
        selected_capability,
        skill=action.skill,
        domain=skill.domain if skill else None,
        risk_level=action.risk_level,
    )


def decide_tool_permission(user: dict[str, Any], settings: dict[str, Any], tool_name: str, *, skill_name: str | None = None) -> AIPermissionDecision:
    """Mandatory gate shared by planning, both loops and confirmed execution."""
    from .tool_registry import get_tool
    from .permission_resolver import PermissionDecision, PermissionResolver, build_default_rules, load_permission_rules

    tool = get_tool(tool_name)
    if not tool:
        return AIPermissionDecision(allowed=False, reason="Tool is not registered", capability="qa")
    skill = get_skill(skill_name) if skill_name else None
    domain = tool.domain or (skill.domain if skill else None)
    if not domain and tool.permission_check == "config":
        domain = "low-code"
    elif not domain and tool.permission_check == "workflow":
        domain = "workflow"
    if domain in {"knowledge", "analysis", "dynamic-form"}:
        domain = None
    decision = decide_ai_permission(user, settings, tool.permission_check, skill=skill_name or tool_name, domain=domain, risk_level=tool.risk_level)
    if not decision.allowed:
        return decision
    if action_is_forbidden(settings, tool_name, side_effect=tool.side_effect) or action_is_forbidden(settings, tool.handler_key, side_effect=tool.side_effect):
        decision.allowed, decision.reason = False, "Tool is disabled by AI safety policy"
        return decision
    if tool.side_effect != "read":
        modes = [settings.get("agentMode", "draft")]
        modes.extend(p.get("agentMode", "confirm") for p in settings.get("rolePolicies", []) if p.get("role") in _role_names(user))
        if "readonly" in modes or "off" in modes or ("draft" in modes and tool.side_effect != "draft_write"):
            decision.allowed, decision.reason = False, "当前执行模式仅允许只读工具或草稿写入"
            return decision
        decision.requires_confirmation = True
    rules = PermissionResolver(build_default_rules() + load_permission_rules(settings))
    resolved, reason = rules.resolve(tool_name, user, tool.risk_level, domain)
    if resolved == PermissionDecision.DENY:
        decision.allowed, decision.reason = False, reason
    elif resolved == PermissionDecision.ASK:
        decision.requires_confirmation = True
        decision.reason = reason
    return decision
