"""Tests for the Notifications system — CRUD, mark-read, unread-count."""
from __future__ import annotations

import copy
from unittest.mock import AsyncMock, patch

import pytest


# ── Fixtures ──────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _force_mock_fallback():
    """Force _try_db to return None so all tests use the mock fallback path.

    The test DB may have a stale schema (e.g. missing resource_type column)
    or contain no data, which would produce confusing results.  Patching
    ensures deterministic mock-only behaviour.
    """
    from app.api import notifications as notif_mod
    async_mock = AsyncMock(return_value=None)
    with patch.object(notif_mod, "_try_db", async_mock):
        yield


@pytest.fixture(autouse=True)
def _reset_mock_notifications():
    """Reset mock state between tests (deep copy to prevent mutation leaks)."""
    from app.api import notifications as notif_mod
    original = copy.deepcopy(notif_mod.MOCK_NOTIFICATIONS)
    original_id = notif_mod._next_mock_id
    yield
    notif_mod.MOCK_NOTIFICATIONS.clear()
    notif_mod.MOCK_NOTIFICATIONS.extend(original)
    notif_mod._next_mock_id = original_id


# ── List / pagination tests ───────────────────────────────

@pytest.mark.asyncio
async def test_list_notifications_user_1():
    """GET /notifications?user_id=1 returns notifications for user 1."""
    from app.api.notifications import list_notifications
    result = await list_notifications(
        user_id=1, is_read=None, type=None, page=1, page_size=20,
    )
    assert "data" in result
    assert all(n["user_id"] == 1 for n in result["data"])
    assert result["total"] >= 3  # mock has 3 notifications for user 1
    assert "unread_count" in result


@pytest.mark.asyncio
async def test_list_notifications_pagination():
    """Pagination works: page=1&page_size=1 returns 1 item."""
    from app.api.notifications import list_notifications
    result = await list_notifications(
        user_id=1, is_read=None, type=None, page=1, page_size=1,
    )
    assert len(result["data"]) == 1
    assert result["page"] == 1
    assert result["page_size"] == 1
    assert result["total"] >= 3  # total is unpaginated


@pytest.mark.asyncio
async def test_list_notifications_page2():
    """Page 2 returns fewer or equal items than page_size."""
    from app.api.notifications import list_notifications
    result = await list_notifications(
        user_id=1, is_read=None, type=None, page=2, page_size=2,
    )
    assert len(result["data"]) <= 2
    assert result["page"] == 2


# ── Filter tests ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_notifications_filter_unread():
    """Filter by is_read=False returns only unread notifications."""
    from app.api.notifications import list_notifications
    result = await list_notifications(
        user_id=1, is_read=False, type=None, page=1, page_size=20,
    )
    assert all(n["is_read"] is False for n in result["data"])


@pytest.mark.asyncio
async def test_list_notifications_filter_read():
    """Filter by is_read=True returns only read notifications."""
    from app.api.notifications import list_notifications
    result = await list_notifications(
        user_id=1, is_read=True, type=None, page=1, page_size=20,
    )
    assert all(n["is_read"] is True for n in result["data"])


@pytest.mark.asyncio
async def test_list_notifications_filter_type():
    """Filter by type returns only matching notifications."""
    from app.api.notifications import list_notifications
    result = await list_notifications(
        user_id=1, is_read=None, type="warning", page=1, page_size=20,
    )
    assert all(n["type"] == "warning" for n in result["data"])


@pytest.mark.asyncio
async def test_list_notifications_empty_for_unknown_user():
    """Unknown user returns empty list."""
    from app.api.notifications import list_notifications
    result = await list_notifications(
        user_id=999, is_read=None, type=None, page=1, page_size=20,
    )
    assert result["data"] == []
    assert result["total"] == 0
    assert result["unread_count"] == 0


# ── Create tests ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_notification():
    """POST /notifications creates a new notification in mock store."""
    from app.api.notifications import NotificationCreate, create_notification
    body = NotificationCreate(
        user_id=1,
        title="Test notification",
        content="This is a test",
        type="info",
    )
    result = await create_notification(body)
    assert result["title"] == "Test notification"
    assert result["content"] == "This is a test"
    assert result["type"] == "info"
    assert result["is_read"] is False
    assert result["id"] is not None
    assert result["user_id"] == 1


@pytest.mark.asyncio
async def test_create_notification_invalid_type():
    """POST /notifications rejects invalid type."""
    from fastapi import HTTPException
    from app.api.notifications import NotificationCreate, create_notification
    body = NotificationCreate(
        user_id=1,
        title="Bad type",
        type="invalid",
    )
    with pytest.raises(HTTPException) as exc_info:
        await create_notification(body)
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_create_notification_increments_list():
    """Creating a notification adds it to the list."""
    from app.api.notifications import NotificationCreate, create_notification, list_notifications
    before = await list_notifications(
        user_id=1, is_read=None, type=None, page=1, page_size=20,
    )
    count_before = before["total"]

    body = NotificationCreate(
        user_id=1, title="New item", content="Added", type="info",
    )
    await create_notification(body)

    after = await list_notifications(
        user_id=1, is_read=None, type=None, page=1, page_size=20,
    )
    assert after["total"] == count_before + 1


# ── Mark as read tests ────────────────────────────────────

@pytest.mark.asyncio
async def test_mark_notification_read():
    """POST /notifications/{id}/read marks a notification as read."""
    from app.api.notifications import mark_notification_read
    result = await mark_notification_read(notification_id=1)
    assert result["is_read"] is True
    assert result["id"] == 1


@pytest.mark.asyncio
async def test_mark_notification_read_not_found():
    """POST /notifications/{id}/read returns 404 for nonexistent ID."""
    from fastapi import HTTPException
    from app.api.notifications import mark_notification_read
    with pytest.raises(HTTPException) as exc_info:
        await mark_notification_read(notification_id=9999)
    assert exc_info.value.status_code == 404


# ── Mark all as read tests ────────────────────────────────

@pytest.mark.asyncio
async def test_mark_all_read():
    """POST /notifications/read-all marks all user notifications as read."""
    from app.api.notifications import MarkAllReadRequest, mark_all_read, list_notifications
    result = await mark_all_read(body=MarkAllReadRequest(user_id=1))
    assert result["marked_count"] >= 1  # user 1 has unread mock data

    # Verify all are now read
    after = await list_notifications(
        user_id=1, is_read=False, type=None, page=1, page_size=20,
    )
    assert after["total"] == 0


@pytest.mark.asyncio
async def test_mark_all_read_no_unread():
    """Mark all read when already all read returns 0 marked."""
    from app.api.notifications import MarkAllReadRequest, mark_all_read
    # User 2 has only read notifications in mock data
    result = await mark_all_read(body=MarkAllReadRequest(user_id=2))
    assert result["marked_count"] == 0


# ── Unread count tests ────────────────────────────────────

@pytest.mark.asyncio
async def test_get_unread_count():
    """GET /notifications/unread-count returns correct count."""
    from app.api.notifications import get_unread_count
    result = await get_unread_count(user_id=1)
    # User 1 has 2 unread in mock data (IDs 1 and 2)
    assert result["unread_count"] == 2


@pytest.mark.asyncio
async def test_get_unread_count_no_notifications():
    """Unknown user has 0 unread notifications."""
    from app.api.notifications import get_unread_count
    result = await get_unread_count(user_id=999)
    assert result["unread_count"] == 0


@pytest.mark.asyncio
async def test_unread_count_decreases_after_read():
    """Unread count decreases after marking a notification as read."""
    from app.api.notifications import get_unread_count, mark_notification_read
    before = await get_unread_count(user_id=1)
    await mark_notification_read(notification_id=1)
    after = await get_unread_count(user_id=1)
    assert after["unread_count"] == before["unread_count"] - 1


# ── Delete tests ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_notification():
    """DELETE /notifications/{id} removes a notification."""
    from app.api.notifications import delete_notification, list_notifications
    before = await list_notifications(
        user_id=1, is_read=None, type=None, page=1, page_size=20,
    )
    count_before = before["total"]

    result = await delete_notification(notification_id=1)
    assert result["ok"] is True

    after = await list_notifications(
        user_id=1, is_read=None, type=None, page=1, page_size=20,
    )
    assert after["total"] == count_before - 1


@pytest.mark.asyncio
async def test_delete_notification_not_found():
    """DELETE /notifications/{id} returns 404 for nonexistent ID."""
    from fastapi import HTTPException
    from app.api.notifications import delete_notification
    with pytest.raises(HTTPException) as exc_info:
        await delete_notification(notification_id=9999)
    assert exc_info.value.status_code == 404


# ── send_notification helper tests ────────────────────────

@pytest.mark.asyncio
async def test_send_notification_helper():
    """send_notification creates a notification via mock fallback."""
    from app.api.notifications import send_notification, list_notifications
    before = await list_notifications(
        user_id=1, is_read=None, type=None, page=1, page_size=20,
    )
    count_before = before["total"]

    await send_notification(
        user_id=1,
        title="Helper test",
        content="Sent via helper",
        type="warning",
    )

    after = await list_notifications(
        user_id=1, is_read=None, type=None, page=1, page_size=20,
    )
    assert after["total"] == count_before + 1


@pytest.mark.asyncio
async def test_send_notification_never_raises():
    """send_notification catches exceptions and never raises."""
    from app.api.notifications import send_notification
    # Even with bad input it should not raise (best-effort)
    await send_notification(
        user_id=1,
        title="Safe call",
        content="Should not raise",
    )
    # No assertion needed — just confirming no exception
