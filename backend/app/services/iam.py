"""Identity access helpers for auth, sessions, MFA, and policy decisions."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import struct
import time
from datetime import datetime, timedelta
from typing import Any, Optional
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException
from sqlalchemy import select

from app.config import settings
from app.core.security import verify_password


DEFAULT_SECURITY_SETTINGS = {
    "password": {
        "min_length": settings.PASSWORD_MIN_LENGTH,
        "require_complexity": settings.PASSWORD_REQUIRE_COMPLEXITY,
        "history_count": settings.PASSWORD_HISTORY_COUNT,
    },
    "login": {
        "lock_threshold": settings.LOGIN_LOCK_THRESHOLD,
        "lock_minutes": settings.LOGIN_LOCK_MINUTES,
    },
    "mfa": {
        "enabled": True,
        "require_for_sso": settings.OIDC_REQUIRE_PLATFORM_MFA,
    },
}

IAM_SETTINGS_KEY = "identity_access_settings"
IAM_RUNTIME_SETTINGS: dict[str, Any] = {
    "security": DEFAULT_SECURITY_SETTINGS,
    "oidc": {},
}


ROLE_TEMPLATES = [
    {
        "key": "platform_admin",
        "label": "平台管理员",
        "description": "全局配置、用户权限、应用和审计管理。",
        "permissions": [{"resource_type": "all", "resource_key": "*", "action": "*", "effect": "allow"}],
    },
    {
        "key": "business_admin",
        "label": "业务管理员",
        "description": "管理业务应用、表单、流程和报表。",
        "permissions": [
            {"resource_type": "application", "resource_key": "*", "action": "*", "effect": "allow"},
            {"resource_type": "form", "resource_key": "*", "action": "*", "effect": "allow"},
            {"resource_type": "workflow", "resource_key": "*", "action": "*", "effect": "allow"},
            {"resource_type": "report", "resource_key": "*", "action": "*", "effect": "allow"},
        ],
    },
    {
        "key": "approval_lead",
        "label": "审批负责人",
        "description": "跨模块审批和放行。",
        "permissions": [{"resource_type": "workflow", "resource_key": "*", "action": "approve", "effect": "allow"}],
    },
    {
        "key": "data_steward",
        "label": "数据专员",
        "description": "主数据维护、数据质量检查和配置导入导出。",
        "permissions": [{"resource_type": "data", "resource_key": "*", "action": "edit", "effect": "allow"}],
    },
    {
        "key": "auditor",
        "label": "只读审计员",
        "description": "只读查看业务、报表和审计链路。",
        "permissions": [
            {"resource_type": "menu", "resource_key": "*", "action": "view", "effect": "allow"},
            {"resource_type": "report", "resource_key": "*", "action": "view", "effect": "allow"},
            {"resource_type": "audit", "resource_key": "*", "action": "view", "effect": "allow"},
        ],
    },
    {
        "key": "member",
        "label": "普通成员",
        "description": "仅访问被明确授权的应用、表单和记录。",
        "permissions": [],
    },
]


def get_iam_security_settings() -> dict[str, Any]:
    security = IAM_RUNTIME_SETTINGS.get("security") if isinstance(IAM_RUNTIME_SETTINGS.get("security"), dict) else {}
    return {
        "password": {**DEFAULT_SECURITY_SETTINGS["password"], **(security.get("password") or {})},
        "login": {**DEFAULT_SECURITY_SETTINGS["login"], **(security.get("login") or {})},
        "mfa": {**DEFAULT_SECURITY_SETTINGS["mfa"], **(security.get("mfa") or {})},
    }


def validate_password_policy(password: str) -> None:
    policy = get_iam_security_settings()["password"]
    min_length = int(policy.get("min_length") or settings.PASSWORD_MIN_LENGTH)
    if len(password) < min_length:
        raise HTTPException(422, f"Password must be at least {min_length} characters")
    if bool(policy.get("require_complexity", settings.PASSWORD_REQUIRE_COMPLEXITY)):
        checks = [
            any(ch.islower() for ch in password),
            any(ch.isupper() for ch in password),
            any(ch.isdigit() for ch in password),
            any(not ch.isalnum() for ch in password),
        ]
        if sum(checks) < 3:
            raise HTTPException(422, "Password must include at least three character classes")


async def ensure_password_not_reused(db, user_id: int, password: str, tenant_id: int) -> None:
    from app.models.relational import PasswordHistory

    rows = (await db.execute(
        select(PasswordHistory)
        .where(PasswordHistory.user_id == user_id, PasswordHistory.tenant_id == tenant_id)
        .order_by(PasswordHistory.created_at.desc())
        .limit(int(get_iam_security_settings()["password"].get("history_count") or settings.PASSWORD_HISTORY_COUNT))
    )).scalars().all()
    if any(verify_password(password, row.password_hash) for row in rows):
        raise HTTPException(422, "Password was used recently")


async def add_password_history(db, user_id: int, tenant_id: int, password_hash: str) -> None:
    from app.models.relational import PasswordHistory

    db.add(PasswordHistory(tenant_id=tenant_id, user_id=user_id, password_hash=password_hash))


def generate_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _hotp(secret: str, counter: int, digits: int = 6) -> str:
    padded = secret + "=" * ((8 - len(secret) % 8) % 8)
    key = base64.b32decode(padded, casefold=True)
    msg = struct.pack(">Q", counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(code % (10 ** digits)).zfill(digits)


def verify_totp(secret: str, code: str, *, window: int = 1) -> bool:
    if not secret or not code:
        return False
    try:
        counter = int(time.time() // 30)
        normalized = str(code).strip().replace(" ", "")
        return any(hmac.compare_digest(_hotp(secret, counter + skew), normalized) for skew in range(-window, window + 1))
    except Exception:
        return False


async def create_user_session(
    db,
    *,
    user_id: int,
    tenant_id: int,
    login_method: str,
    ip_address: Optional[str],
    user_agent: Optional[str],
) -> str:
    from app.models.relational import UserSession

    sid = secrets.token_urlsafe(32)
    expires_at = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    db.add(UserSession(
        tenant_id=tenant_id,
        user_id=user_id,
        session_id=sid,
        login_method=login_method,
        ip_address=ip_address,
        user_agent=user_agent,
        expires_at=expires_at,
    ))
    return sid


async def revoke_session(db, session_id: str, revoked_by: Optional[int] = None) -> bool:
    from app.models.relational import UserSession

    session = await db.scalar(select(UserSession).where(UserSession.session_id == session_id))
    if not session:
        return False
    session.revoked_at = datetime.utcnow()
    session.revoked_by = revoked_by
    return True


async def is_session_active(session_id: Optional[str], *, user_id=None, tenant_id=None) -> bool:
    if not session_id:
        return True
    try:
        from app.core.db import db_session
        from app.models.relational import UserSession, User, Tenant

        async with db_session() as db:
            query = (select(UserSession).join(User, User.id == UserSession.user_id)
                     .join(Tenant, Tenant.id == UserSession.tenant_id)
                     .where(UserSession.session_id == session_id, User.is_active.is_(True),
                            User.tenant_id == UserSession.tenant_id, Tenant.status == 'active'))
            if user_id is not None:
                query = query.where(UserSession.user_id == user_id)
            if tenant_id is not None:
                query = query.where(UserSession.tenant_id == tenant_id)
            row = await db.scalar(query)
            return bool(row and row.revoked_at is None and row.expires_at > datetime.utcnow())
    except Exception:
        return False


def get_oidc_config() -> dict[str, Any]:
    persisted = IAM_RUNTIME_SETTINGS.get("oidc") if isinstance(IAM_RUNTIME_SETTINGS.get("oidc"), dict) else {}
    enabled = persisted.get("enabled", settings.OIDC_ENABLED)
    issuer = str(persisted.get("issuer") or settings.OIDC_ISSUER or "")
    authorization_endpoint = persisted.get("authorization_endpoint") or settings.OIDC_AUTHORIZATION_ENDPOINT or (
        f"{issuer.rstrip('/')}/authorize" if issuer else ""
    )
    token_endpoint = persisted.get("token_endpoint") or settings.OIDC_TOKEN_ENDPOINT or (
        f"{issuer.rstrip('/')}/token" if issuer else ""
    )
    userinfo_endpoint = persisted.get("userinfo_endpoint") or settings.OIDC_USERINFO_ENDPOINT or (
        f"{issuer.rstrip('/')}/userinfo" if issuer else ""
    )
    return {
        "enabled": bool(enabled),
        "issuer": issuer,
        "authorization_endpoint": authorization_endpoint,
        "token_endpoint": token_endpoint,
        "userinfo_endpoint": userinfo_endpoint,
        "client_id": persisted.get("client_id") or settings.OIDC_CLIENT_ID,
        "client_secret": persisted.get("client_secret") or settings.OIDC_CLIENT_SECRET,
        "redirect_uri": persisted.get("redirect_uri") or settings.OIDC_REDIRECT_URI,
        "scopes": persisted.get("scopes") or settings.OIDC_SCOPES,
        "username_claim": persisted.get("username_claim") or settings.OIDC_USERNAME_CLAIM,
        "email_claim": persisted.get("email_claim") or settings.OIDC_EMAIL_CLAIM,
        "display_name_claim": persisted.get("display_name_claim") or settings.OIDC_DISPLAY_NAME_CLAIM,
        "subject_claim": persisted.get("subject_claim") or settings.OIDC_SUBJECT_CLAIM,
        "require_platform_mfa": bool(persisted.get("require_platform_mfa", settings.OIDC_REQUIRE_PLATFORM_MFA)),
    }


def merge_iam_settings(incoming: dict[str, Any], existing: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    base = existing or IAM_RUNTIME_SETTINGS
    security = incoming.get("security") or {}
    oidc = incoming.get("oidc") or {}
    merged = {
        "security": {
            "password": {**DEFAULT_SECURITY_SETTINGS["password"], **((base.get("security") or {}).get("password") or {}), **(security.get("password") or {})},
            "login": {**DEFAULT_SECURITY_SETTINGS["login"], **((base.get("security") or {}).get("login") or {}), **(security.get("login") or {})},
            "mfa": {**DEFAULT_SECURITY_SETTINGS["mfa"], **((base.get("security") or {}).get("mfa") or {}), **(security.get("mfa") or {})},
        },
        "oidc": {**((base.get("oidc") or {})), **oidc},
    }
    merged["security"]["password"]["min_length"] = int(merged["security"]["password"].get("min_length") or settings.PASSWORD_MIN_LENGTH)
    merged["security"]["password"]["history_count"] = int(merged["security"]["password"].get("history_count") or settings.PASSWORD_HISTORY_COUNT)
    merged["security"]["login"]["lock_threshold"] = int(merged["security"]["login"].get("lock_threshold") or settings.LOGIN_LOCK_THRESHOLD)
    merged["security"]["login"]["lock_minutes"] = int(merged["security"]["login"].get("lock_minutes") or settings.LOGIN_LOCK_MINUTES)
    return merged


async def load_iam_settings(db) -> dict[str, Any]:
    from app.models.relational import SystemSetting

    row = await db.scalar(select(SystemSetting).where(SystemSetting.key == IAM_SETTINGS_KEY))
    merged = merge_iam_settings(row.value if row and isinstance(row.value, dict) else {})
    IAM_RUNTIME_SETTINGS.clear()
    IAM_RUNTIME_SETTINGS.update(merged)
    return merged


async def save_iam_settings(db, settings_data: dict[str, Any], updated_by: Optional[str] = None) -> dict[str, Any]:
    from app.models.relational import SystemSetting

    existing = await load_iam_settings(db)
    merged = merge_iam_settings(settings_data, existing)
    row = await db.scalar(select(SystemSetting).where(SystemSetting.key == IAM_SETTINGS_KEY))
    if row is None:
        row = SystemSetting(key=IAM_SETTINGS_KEY, value=merged, description="Identity, SSO, MFA, and password policy settings", updated_by=updated_by)
        db.add(row)
    else:
        row.value = merged
        row.updated_by = updated_by
    IAM_RUNTIME_SETTINGS.clear()
    IAM_RUNTIME_SETTINGS.update(merged)
    return merged


async def build_oidc_login_url(db, tenant_id: int, redirect_uri: Optional[str] = None) -> dict[str, str]:
    from app.models.relational import OidcState

    await load_iam_settings(db)
    config = get_oidc_config()
    if not config["enabled"] or not config["authorization_endpoint"] or not config["client_id"]:
        raise HTTPException(503, "OIDC is not configured")
    state = secrets.token_urlsafe(24)
    nonce = secrets.token_urlsafe(24)
    callback_uri = redirect_uri or config["redirect_uri"]
    db.add(OidcState(
        tenant_id=tenant_id,
        state=state,
        nonce=nonce,
        redirect_uri=callback_uri,
        expires_at=datetime.utcnow() + timedelta(minutes=10),
    ))
    params = {
        "response_type": "code",
        "client_id": config["client_id"],
        "redirect_uri": callback_uri,
        "scope": config["scopes"],
        "state": state,
        "nonce": nonce,
    }
    return {"url": f"{config['authorization_endpoint']}?{urlencode(params)}", "state": state}


def _decode_demo_claims(code: str) -> Optional[dict[str, Any]]:
    if not code.startswith("demo:"):
        return None
    raw = code[5:]
    padded = raw + "=" * ((4 - len(raw) % 4) % 4)
    try:
        return json.loads(base64.urlsafe_b64decode(padded.encode()).decode())
    except Exception as exc:
        raise HTTPException(400, "Invalid demo OIDC code") from exc


async def exchange_oidc_code(code: str, redirect_uri: Optional[str]) -> dict[str, Any]:
    demo_claims = _decode_demo_claims(code)
    if demo_claims is not None:
        return demo_claims
    config = get_oidc_config()
    if not config["enabled"] or not config["token_endpoint"] or not config["userinfo_endpoint"]:
        raise HTTPException(503, "OIDC is not configured")
    async with httpx.AsyncClient(timeout=15) as client:
        token_res = await client.post(
            config["token_endpoint"],
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri or config["redirect_uri"],
                "client_id": config["client_id"],
                "client_secret": settings.OIDC_CLIENT_SECRET,
            },
        )
        token_res.raise_for_status()
        access_token = token_res.json().get("access_token")
        if not access_token:
            raise HTTPException(400, "OIDC token response missing access_token")
        userinfo_res = await client.get(config["userinfo_endpoint"], headers={"Authorization": f"Bearer {access_token}"})
        userinfo_res.raise_for_status()
        return userinfo_res.json()


def claim_value(claims: dict[str, Any], claim_name: str, fallback: str = "") -> str:
    value = claims.get(claim_name)
    return str(value) if value is not None else fallback


def condition_matches(condition: Optional[dict], record_data: dict, user: dict) -> bool:
    if not condition:
        return True
    rules = condition.get("rules", condition if isinstance(condition, list) else [])
    if not isinstance(rules, list):
        return False
    for rule in rules:
        if not isinstance(rule, dict):
            return False
        field = str(rule.get("field") or "")
        op = str(rule.get("op") or "equals")
        expected = _resolve_policy_value(rule.get("value"), user)
        actual = record_data.get(field)
        if op == "equals" and str(actual) != str(expected):
            return False
        if op == "contains" and str(expected).lower() not in str(actual or "").lower():
            return False
        if op == "in":
            values = expected if isinstance(expected, list) else [expected]
            if actual not in values and str(actual) not in {str(item) for item in values}:
                return False
        if op == "between":
            if not isinstance(expected, list) or len(expected) != 2:
                return False
            text = str(actual or "")
            if expected[0] not in (None, "") and text < str(expected[0]):
                return False
            if expected[1] not in (None, "") and text > str(expected[1]):
                return False
    return True


def _resolve_policy_value(value: Any, user: dict) -> Any:
    if value == "$current_user_id":
        return user.get("uid")
    if value == "$current_tenant_id":
        return user.get("tenant_id")
    if value == "$current_org_ids":
        return user.get("org_unit_ids", [])
    return value
