"""Notifications — CRUD + mark-read + unread-count.

Supports in-app notifications for users with types: info, warning, error,
success.  Falls back to mock data when DB is unavailable.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select

from app.core.logging import get_logger

logger = get_logger(__name__)

router = APIRouter()


# ── Pydantic schemas ──────────────────────────────────────

class NotificationCreate(BaseModel):
    user_id: int
    title: str
    content: Optional[str] = None
    type: str = "info"  # info | warning | error | success
    resource_type: Optional[str] = None
    resource_id: Optional[int] = None


class MarkAllReadRequest(BaseModel):
    user_id: int


# ── Mock fallback data ────────────────────────────────────

MOCK_NOTIFICATIONS: list[dict] = [
    {
        "id": 1, "user_id": 1, "title": "设备健康分预警",
        "content": "CNC-001 健康分降至 58，请及时处理",
        "type": "warning", "is_read": False,
        "resource_type": "equipment", "resource_id": 1,
        "created_at": "2026-05-13T09:30:00",
    },
    {
        "id": 2, "user_id": 1, "title": "工单审批待处理",
        "content": "维修工单 WO-005 等待您的审批",
        "type": "info", "is_read": False,
        "resource_type": "work_orders", "resource_id": 5,
        "created_at": "2026-05-13T10:00:00",
    },
    {
        "id": 3, "user_id": 2, "title": "质量检测不合格",
        "content": "批次 B2026-0513 检测发现 3 个缺陷",
        "type": "error", "is_read": True,
        "resource_type": "inspections", "resource_id": 12,
        "created_at": "2026-05-13T08:15:00",
    },
    {
        "id": 4, "user_id": 1, "title": "生产任务完成",
        "content": "工单 WO-003 已完成全部数量",
        "type": "success", "is_read": True,
        "resource_type": "work_orders", "resource_id": 3,
        "created_at": "2026-05-12T16:00:00",
    },
]

_next_mock_id = max(n["id"] for n in MOCK_NOTIFICATIONS) + 1


# ── DB helper ─────────────────────────────────────────────

async def _try_db(fn):
    """Try DB operation, return None on failure (mock fallback)."""
    from app.core.db import safe_db_call
    return await safe_db_call(fn)


def _notification_to_dict(n) -> dict:
    """Convert a Notification ORM object to a dict."""
    return {
        "id": n.id,
        "user_id": n.user_id,
        "title": n.title,
        "content": n.content,
        "type": n.type,
        "is_read": n.is_read,
        "resource_type": n.resource_type,
        "resource_id": n.resource_id,
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }


# ── CRUD endpoints ────────────────────────────────────────

@router.get("")
async def list_notifications(
    user_id: int = Query(..., description="User ID (required for demo)"),
    is_read: Optional[bool] = Query(None, description="Filter by read status"),
    type: Optional[str] = Query(None, description="Filter by type"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """List notifications for a user with pagination and filters."""
    async def _query(db):
        from app.models.relational import Notification
        stmt = (
            select(Notification)
            .where(Notification.user_id == user_id)
            .order_by(Notification.created_at.desc())
        )
        if is_read is not None:
            stmt = stmt.where(Notification.is_read == is_read)
        if type is not None:
            stmt = stmt.where(Notification.type == type)

        # Count total
        count_stmt = (
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == user_id)
        )
        if is_read is not None:
            count_stmt = count_stmt.where(Notification.is_read == is_read)
        if type is not None:
            count_stmt = count_stmt.where(Notification.type == type)

        total = await db.scalar(count_stmt)

        # Unread count (unfiltered by is_read so this is always the real count)
        unread_stmt = (
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == user_id, Notification.is_read == False)
        )
        unread_count = await db.scalar(unread_stmt) or 0

        # Paginate
        stmt = stmt.offset((page - 1) * page_size).limit(page_size)
        result = await db.execute(stmt)
        notifications = result.scalars().all()
        return {
            "data": [_notification_to_dict(n) for n in notifications],
            "total": total or 0,
            "page": page,
            "page_size": page_size,
            "unread_count": unread_count,
        }

    result = await _try_db(_query)
    if result is not None:
        return result

    # Mock fallback
    notifications = [n for n in MOCK_NOTIFICATIONS if n["user_id"] == user_id]
    if is_read is not None:
        notifications = [n for n in notifications if n["is_read"] == is_read]
    if type is not None:
        notifications = [n for n in notifications if n["type"] == type]

    total = len(notifications)
    unread_count = sum(
        1 for n in MOCK_NOTIFICATIONS
        if n["user_id"] == user_id and not n["is_read"]
    )
    start = (page - 1) * page_size
    page_items = notifications[start:start + page_size]

    return {
        "data": page_items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "unread_count": unread_count,
    }


@router.post("")
async def create_notification(body: NotificationCreate):
    """Create a new notification."""
    if body.type not in ("info", "warning", "error", "success"):
        raise HTTPException(400, "type must be one of: info, warning, error, success")

    async def _query(db):
        from app.models.relational import Notification
        n = Notification(
            user_id=body.user_id,
            title=body.title,
            content=body.content,
            type=body.type,
            is_read=False,
            resource_type=body.resource_type,
            resource_id=body.resource_id,
        )
        db.add(n)
        await db.commit()
        await db.refresh(n)
        return _notification_to_dict(n)

    result = await _try_db(_query)
    if result is not None:
        return result

    # Mock fallback
    global _next_mock_id
    new_id = _next_mock_id
    _next_mock_id += 1
    now = datetime.now().isoformat(timespec="seconds")
    mock_notification = {
        "id": new_id,
        "user_id": body.user_id,
        "title": body.title,
        "content": body.content,
        "type": body.type,
        "is_read": False,
        "resource_type": body.resource_type,
        "resource_id": body.resource_id,
        "created_at": now,
    }
    MOCK_NOTIFICATIONS.append(mock_notification)
    return mock_notification


@router.post("/{notification_id}/read")
async def mark_notification_read(notification_id: int):
    """Mark a single notification as read."""
    async def _query(db):
        from app.models.relational import Notification
        n = await db.get(Notification, notification_id)
        if not n:
            return None
        n.is_read = True
        await db.commit()
        await db.refresh(n)
        return _notification_to_dict(n)

    result = await _try_db(_query)
    if result is not None:
        return result

    # Mock fallback
    for n in MOCK_NOTIFICATIONS:
        if n["id"] == notification_id:
            n["is_read"] = True
            return n
    raise HTTPException(404, "Notification not found")


@router.post("/read-all")
async def mark_all_read(body: MarkAllReadRequest):
    """Mark all notifications as read for a user."""
    async def _query(db):
        from app.models.relational import Notification
        stmt = (
            select(Notification)
            .where(Notification.user_id == body.user_id, Notification.is_read == False)
        )
        result = await db.execute(stmt)
        notifications = result.scalars().all()
        count = 0
        for n in notifications:
            n.is_read = True
            count += 1
        await db.commit()
        return {"marked_count": count}

    result = await _try_db(_query)
    if result is not None:
        return result

    # Mock fallback
    count = 0
    for n in MOCK_NOTIFICATIONS:
        if n["user_id"] == body.user_id and not n["is_read"]:
            n["is_read"] = True
            count += 1
    return {"marked_count": count}


@router.get("/unread-count")
async def get_unread_count(user_id: int = Query(..., description="User ID")):
    """Get unread notification count for a user."""
    async def _query(db):
        from app.models.relational import Notification
        stmt = (
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == user_id, Notification.is_read == False)
        )
        count = await db.scalar(stmt)
        return {"unread_count": count or 0}

    result = await _try_db(_query)
    if result is not None:
        return result

    # Mock fallback
    count = sum(
        1 for n in MOCK_NOTIFICATIONS
        if n["user_id"] == user_id and not n["is_read"]
    )
    return {"unread_count": count}


@router.delete("/{notification_id}")
async def delete_notification(notification_id: int):
    """Delete a notification."""
    async def _query(db):
        from app.models.relational import Notification
        n = await db.get(Notification, notification_id)
        if not n:
            return None
        await db.delete(n)
        await db.commit()
        return {"ok": True}

    result = await _try_db(_query)
    if result is not None:
        return result

    # Mock fallback
    global MOCK_NOTIFICATIONS
    original_len = len(MOCK_NOTIFICATIONS)
    MOCK_NOTIFICATIONS = [n for n in MOCK_NOTIFICATIONS if n["id"] != notification_id]
    if len(MOCK_NOTIFICATIONS) == original_len:
        raise HTTPException(404, "Notification not found")
    return {"ok": True}


# ── Helper for other modules ──────────────────────────────

async def send_notification(
    *,
    user_id: int,
    title: str,
    content: str,
    type: str = "info",
    **kwargs,
) -> None:
    """Best-effort notification creation. Never raises.

    Other modules can call this to push notifications without worrying
    about DB errors disrupting their own logic.
    """
    try:
        async def _query(db):
            from app.models.relational import Notification
            n = Notification(
                user_id=user_id,
                title=title,
                content=content,
                type=type,
                is_read=False,
            )
            db.add(n)
            await db.commit()
            return True

        result = await _try_db(_query)
        if result is not None:
            return

        # Mock fallback
        global _next_mock_id
        new_id = _next_mock_id
        _next_mock_id += 1
        now = datetime.now().isoformat(timespec="seconds")
        MOCK_NOTIFICATIONS.append({
            "id": new_id,
            "user_id": user_id,
            "title": title,
            "content": content,
            "type": type,
            "is_read": False,
            "resource_type": kwargs.get("resource_type"),
            "resource_id": kwargs.get("resource_id"),
            "created_at": now,
        })
    except Exception:
        logger.warning("Failed to send notification to user %s: %s", user_id, title)
