"""Auth API — JWT login/logout/me.

Token transport: `Authorization: Bearer <jwt>` (preferred).
The legacy `?token=` query string is still accepted by `get_current_user`
for backward compatibility but should not be used by new clients.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_tenant_id, current_user_id, get_current_user, get_db
from app.core.audit import write_audit_log
from app.config import settings
from app.core.logging import get_logger
from app.core.security import create_access_token, hash_password, verify_password

logger = get_logger(__name__)
router = APIRouter()


# ── Mock users for demo (used when DB is unreachable) ─────
# Passwords are hashed at module load time — plaintext never stored at runtime.
_MOCK_USERS_RAW = [
    {
        "id": 1, "username": "admin", "display_name": "系统管理员",
        "email": "admin@manufoundry.local", "is_active": True, "is_admin": True,
        "plain_password": "admin123",
        "roles": [{"id": 1, "name": "admin", "label": "管理员"}],
    },
    {
        "id": 2, "username": "zhangsan", "display_name": "张三",
        "email": "zhangsan@manufoundry.local", "is_active": True, "is_admin": False,
        "plain_password": "123456",
        "roles": [{"id": 2, "name": "production_manager", "label": "生产主管"}],
    },
    {
        "id": 3, "username": "lisi", "display_name": "李四",
        "email": "lisi@manufoundry.local", "is_active": True, "is_admin": False,
        "plain_password": "123456",
        "roles": [{"id": 3, "name": "quality_inspector", "label": "质检员"}],
    },
]

_EXTRA_MOCK_USERS_RAW = [
    {
        "id": 4, "username": "pm_li", "display_name": "\u674e\u660e \u00b7 \u751f\u4ea7\u7ecf\u7406",
        "email": "pm.li@manufoundry.local", "is_active": True, "is_admin": False,
        "plain_password": "123456",
        "roles": [{"id": 2, "name": "production_manager", "label": "\u751f\u4ea7\u7ecf\u7406"}, {"id": 11, "name": "approval_lead", "label": "\u5ba1\u6279\u8d1f\u8d23\u4eba"}],
    },
    {
        "id": 5, "username": "qe_wang", "display_name": "\u738b\u654f \u00b7 \u8d28\u91cf\u5de5\u7a0b\u5e08",
        "email": "qe.wang@manufoundry.local", "is_active": True, "is_admin": False,
        "plain_password": "123456",
        "roles": [{"id": 4, "name": "quality_engineer", "label": "\u8d28\u91cf\u5de5\u7a0b\u5e08"}],
    },
    {
        "id": 6, "username": "mm_zhou", "display_name": "\u5468\u5f3a \u00b7 \u8bbe\u5907\u7ef4\u62a4\u7ecf\u7406",
        "email": "mm.zhou@manufoundry.local", "is_active": True, "is_admin": False,
        "plain_password": "123456",
        "roles": [{"id": 5, "name": "maintenance_manager", "label": "\u8bbe\u5907\u7ef4\u62a4\u7ecf\u7406"}],
    },
    {
        "id": 7, "username": "me_sun", "display_name": "\u5b59\u6d69 \u00b7 \u7ef4\u4fee\u5de5\u7a0b\u5e08",
        "email": "me.sun@manufoundry.local", "is_active": True, "is_admin": False,
        "plain_password": "123456",
        "roles": [{"id": 6, "name": "maintenance_engineer", "label": "\u7ef4\u4fee\u5de5\u7a0b\u5e08"}],
    },
    {
        "id": 8, "username": "pe_huang", "display_name": "\u9ec4\u5a77 \u00b7 \u5de5\u827a\u5de5\u7a0b\u5e08",
        "email": "pe.huang@manufoundry.local", "is_active": True, "is_admin": False,
        "plain_password": "123456",
        "roles": [{"id": 7, "name": "process_engineer", "label": "\u5de5\u827a\u5de5\u7a0b\u5e08"}],
    },
    {
        "id": 9, "username": "scm_liu", "display_name": "\u5218\u6d0b \u00b7 \u4f9b\u5e94\u94fe\u7ecf\u7406",
        "email": "scm.liu@manufoundry.local", "is_active": True, "is_admin": False,
        "plain_password": "123456",
        "roles": [{"id": 8, "name": "supply_chain_manager", "label": "\u4f9b\u5e94\u94fe\u7ecf\u7406"}],
    },
    {
        "id": 10, "username": "wh_feng", "display_name": "\u51af\u5b87 \u00b7 \u4ed3\u50a8\u64cd\u4f5c\u5458",
        "email": "wh.feng@manufoundry.local", "is_active": True, "is_admin": False,
        "plain_password": "123456",
        "roles": [{"id": 9, "name": "warehouse_operator", "label": "\u4ed3\u50a8\u64cd\u4f5c\u5458"}],
    },
    {
        "id": 11, "username": "ds_he", "display_name": "\u4f55\u9759 \u00b7 \u6570\u636e\u4e13\u5458",
        "email": "ds.he@manufoundry.local", "is_active": True, "is_admin": False,
        "plain_password": "123456",
        "roles": [{"id": 10, "name": "data_steward", "label": "\u6570\u636e\u4e13\u5458"}],
    },
    {
        "id": 12, "username": "auditor_gu", "display_name": "\u987e\u5b89 \u00b7 \u5ba1\u8ba1\u89c2\u5bdf\u5458",
        "email": "auditor.gu@manufoundry.local", "is_active": True, "is_admin": False,
        "plain_password": "123456",
        "roles": [{"id": 12, "name": "viewer", "label": "\u53ea\u8bfb\u89c2\u5bdf\u5458"}],
    },
]

_MOCK_USERS_RAW = _MOCK_USERS_RAW + _EXTRA_MOCK_USERS_RAW

_MOCK_USERS = [
    {**u, "hashed_password": hash_password(u.pop("plain_password"))}
    for u in [dict(u) for u in _MOCK_USERS_RAW]
]


# ── Schemas ───────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


# ── Helpers ───────────────────────────────────────────────

def _build_token_and_user(uid: int, username: str, is_admin: bool, user_payload: dict, tenant_id: int = 1) -> dict:
    token = create_access_token(
        subject=username,
        extra={"uid": uid, "is_admin": is_admin, "tenant_id": tenant_id},
    )
    return {"token": token, "user": {**user_payload, "tenant_id": tenant_id}}


def _set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=settings.IS_PRODUCTION,
        samesite="lax",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
    )


async def _db_login(db: AsyncSession, body: LoginRequest) -> Optional[dict]:
    """Try authenticating against the relational DB. Returns None on missing tables."""
    try:
        from app.models.relational import Role, User, UserRole
    except Exception as exc:
        logger.debug("Auth DB models unavailable: %s", exc)
        return None

    try:
        result = await db.execute(select(User).where(User.username == body.username))
        user = result.scalar_one_or_none()
    except Exception as exc:
        if settings.IS_PRODUCTION:
            raise HTTPException(503, "Authentication database unavailable") from exc
        logger.warning("Auth DB query failed (falling back to mock): %s", exc)
        return None

    if not user:
        return None
    if not user.is_active:
        raise HTTPException(401, "用户名或密码错误")
    if not verify_password(body.password, user.hashed_password):
        raise HTTPException(401, "用户名或密码错误")

    roles_result = await db.execute(
        select(Role.name, Role.label)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(UserRole.user_id == user.id)
    )
    roles = [{"name": r[0], "label": r[1]} for r in roles_result.fetchall()]

    return _build_token_and_user(
        user.id, user.username, user.is_admin,
        {
            "id": user.id, "username": user.username,
            "display_name": user.display_name, "email": user.email,
            "is_admin": user.is_admin, "roles": roles,
        },
        tenant_id=getattr(user, "tenant_id", None) or 1,
    )


def _mock_login(body: LoginRequest) -> dict:
    for u in _MOCK_USERS:
        if u["username"] == body.username and verify_password(body.password, u["hashed_password"]):
            return _build_token_and_user(
                u["id"], u["username"], u["is_admin"],
                {
                    "id": u["id"], "username": u["username"],
                    "display_name": u["display_name"], "email": u["email"],
                    "is_admin": u["is_admin"], "roles": u["roles"],
                },
                tenant_id=1,
            )
    raise HTTPException(401, "用户名或密码错误")


# ── Endpoints ─────────────────────────────────────────────

@router.post("/login")
async def login(body: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)):
    """用户登录（JWT 由 settings.SECRET_KEY 签发）."""
    db_result = await _db_login(db, body)
    if db_result is not None:
        _set_auth_cookie(response, db_result["token"])
        await write_audit_log(
            action="login_success",
            resource_type="auth",
            user_id=db_result["user"].get("id"),
            tenant_id=db_result["user"].get("tenant_id"),
            new_values={"username": body.username, "source": "database"},
        )
        return db_result
    if settings.IS_PRODUCTION:
        await write_audit_log(
            action="login_failed",
            resource_type="auth",
            new_values={"username": body.username, "reason": "invalid_credentials"},
        )
        raise HTTPException(401, "Invalid credentials")
    try:
        result = _mock_login(body)
    except HTTPException:
        await write_audit_log(
            action="login_failed",
            resource_type="auth",
            new_values={"username": body.username, "reason": "invalid_credentials"},
            tenant_id=1,
        )
        raise
    _set_auth_cookie(response, result["token"])
    await write_audit_log(
        action="login_success",
        resource_type="auth",
        user_id=result["user"].get("id"),
        tenant_id=result["user"].get("tenant_id"),
        new_values={"username": body.username, "source": "mock"},
    )
    return result


@router.post("/logout")
async def logout(response: Response, user: dict = Depends(get_current_user)):
    """登出（前端清除 token 即可，JWT 无状态）."""
    response.delete_cookie("access_token", path="/")
    await write_audit_log(
        action="logout",
        resource_type="auth",
        user_id=current_user_id(user),
        tenant_id=current_tenant_id(user),
        new_values={"username": user.get("sub")},
    )
    return {"ok": True}


@router.get("/me")
async def get_me(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取当前用户信息（从 Bearer token 解析）."""
    if user.get("_anonymous"):
        return {
            "id": 0, "username": "guest", "display_name": "访客",
            "email": "", "is_admin": False, "roles": [], "tenant_id": 1,
        }

    username = user.get("sub")

    try:
        from app.models.relational import Role, User, UserRole
        result = await db.execute(select(User).where(User.username == username))
        u = result.scalar_one_or_none()
        if u:
            roles_result = await db.execute(
                select(Role.name, Role.label)
                .join(UserRole, UserRole.role_id == Role.id)
                .where(UserRole.user_id == u.id)
            )
            roles = [{"name": r[0], "label": r[1]} for r in roles_result.fetchall()]
            return {
                "id": u.id, "username": u.username,
                "display_name": u.display_name, "email": u.email,
                "is_admin": u.is_admin, "roles": roles,
                "tenant_id": getattr(u, "tenant_id", None) or user.get("tenant_id") or 1,
            }
    except Exception as exc:
        logger.debug("/me DB lookup failed, using mock: %s", exc)

    for u in _MOCK_USERS:
        if u["username"] == username:
            return {
                "id": u["id"], "username": u["username"],
                "display_name": u["display_name"], "email": u["email"],
                "is_admin": u["is_admin"], "roles": u["roles"],
                "tenant_id": user.get("tenant_id") or 1,
            }
    raise HTTPException(401, "用户不存在")
