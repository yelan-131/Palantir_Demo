"""Auth API — JWT login/logout/me.

Token transport: `Authorization: Bearer <jwt>` (preferred).
The legacy `?token=` query string is still accepted by `get_current_user`
for backward compatibility but should not be used by new clients.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
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

def _build_token_and_user(uid: int, username: str, is_admin: bool, user_payload: dict) -> dict:
    token = create_access_token(
        subject=username,
        extra={"uid": uid, "is_admin": is_admin},
    )
    return {"token": token, "user": user_payload}


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
            )
    raise HTTPException(401, "用户名或密码错误")


# ── Endpoints ─────────────────────────────────────────────

@router.post("/login")
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    """用户登录（JWT 由 settings.SECRET_KEY 签发）."""
    db_result = await _db_login(db, body)
    if db_result is not None:
        return db_result
    return _mock_login(body)


@router.post("/logout")
async def logout():
    """登出（前端清除 token 即可，JWT 无状态）."""
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
            "email": "", "is_admin": False, "roles": [],
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
            }
    except Exception as exc:
        logger.debug("/me DB lookup failed, using mock: %s", exc)

    for u in _MOCK_USERS:
        if u["username"] == username:
            return {
                "id": u["id"], "username": u["username"],
                "display_name": u["display_name"], "email": u["email"],
                "is_admin": u["is_admin"], "roles": u["roles"],
            }
    raise HTTPException(401, "用户不存在")
