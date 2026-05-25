"""Policy and risk gates for AI tool execution."""

from __future__ import annotations

from typing import Any

from .schemas import AIPermissionDecision, SkillAction


FORBIDDEN_SKILLS = {
    "purchase.create_purchase_order",
    "security.change_permission",
    "data.delete_record",
    "supply.auto_order",
}

CAPABILITY_BY_SKILL = {
    "knowledge.search": "rag",
    "maintenance.create_work_order_draft": "draft",
    "supply.create_purchase_request_draft": "draft",
    "material.create_material_application_draft": "draft",
    "quality.create_capa_draft": "draft",
}

DOMAIN_BY_SKILL = {
    "maintenance.create_work_order_draft": "maintenance",
    "supply.create_purchase_request_draft": "supply-chain",
    "material.create_material_application_draft": "supply-chain",
    "quality.create_capa_draft": "quality",
}


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
    if user.get("_anonymous"):
        if settings.get("guestAccess", "disabled") == "disabled":
            return AIPermissionDecision(allowed=False, reason="Guest access to AI is disabled", capability=capability)

    if skill and (skill in FORBIDDEN_SKILLS or skill in set(settings.get("forbiddenActions", []))):
        return AIPermissionDecision(allowed=False, reason="Action is disabled by AI safety policy", capability=capability)

    if user.get("is_admin"):
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
    selected_capability = capability or CAPABILITY_BY_SKILL.get(action.skill, "qa")
    return decide_ai_permission(
        user,
        settings,
        selected_capability,
        skill=action.skill,
        domain=DOMAIN_BY_SKILL.get(action.skill),
        risk_level=action.risk_level,
    )
