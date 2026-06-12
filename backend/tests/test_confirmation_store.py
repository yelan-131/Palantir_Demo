"""Tests for confirmation token store implementations."""

from __future__ import annotations

import asyncio
import time

import pytest

from app.services.ai.confirmation_store import (
    ConfirmationStore,
    DatabaseConfirmationStore,
    InMemoryConfirmationStore,
)
from app.services.ai.confirmations import (
    CONFIRMATIONS,
    _user_key,
    async_consume_confirmation_token,
    async_create_confirmation_payload,
    async_verify_confirmation_token,
    consume_confirmation_token,
    create_confirmation_payload,
    reset_store,
    verify_confirmation_token,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _run(coro):
    """Run an async coroutine synchronously for test convenience."""
    return asyncio.get_event_loop().run_until_complete(coro)


# ---------------------------------------------------------------------------
# InMemoryConfirmationStore — unit tests
# ---------------------------------------------------------------------------


class TestInMemoryConfirmationStore:
    """Tests for the in-memory confirmation store backend."""

    def setup_method(self):
        self.store = InMemoryConfirmationStore()

    def test_create_returns_payload_with_token(self):
        payload = _run(self.store.create({"actions": [{"type": "save"}]}))
        assert "token" in payload
        assert payload["token"].startswith("confirm-")
        assert payload["status"] == "pending"

    def test_create_uses_provided_token(self):
        payload = _run(self.store.create({"token": "my-custom-token", "actions": []}))
        assert payload["token"] == "my-custom-token"

    def test_create_sets_defaults(self):
        payload = _run(self.store.create({"actions": []}))
        assert "created_at" in payload
        assert "expires_at" in payload
        assert payload["expires_at"] > time.time()

    def test_create_respects_custom_ttl(self):
        before = time.time()
        payload = _run(self.store.create({"actions": [], "ttl": 60}))
        assert payload["expires_at"] < before + 120
        assert payload["expires_at"] > before + 30

    def test_verify_valid_token(self):
        payload = _run(self.store.create({"actions": []}))
        result = _run(self.store.verify(payload["token"]))
        assert result["valid"] is True
        assert result["payload"]["token"] == payload["token"]

    def test_verify_missing_token(self):
        result = _run(self.store.verify("nonexistent-token"))
        assert result["valid"] is False
        assert "not found" in result["reason"].lower()

    def test_verify_expired_token(self):
        payload = _run(self.store.create({"actions": [], "ttl": 0}))
        # Force expiry into the past
        self.store._store[payload["token"]]["expires_at"] = time.time() - 1
        result = _run(self.store.verify(payload["token"]))
        assert result["valid"] is False
        assert "expired" in result["reason"].lower()

    def test_verify_user_mismatch(self):
        payload = _run(
            self.store.create({"actions": [], "user_key": "alice"})
        )
        result = _run(self.store.verify(payload["token"], user_key="bob"))
        assert result["valid"] is False
        assert "mismatch" in result["reason"].lower()

    def test_verify_matching_user(self):
        payload = _run(
            self.store.create({"actions": [], "user_key": "alice"})
        )
        result = _run(self.store.verify(payload["token"], user_key="alice"))
        assert result["valid"] is True

    def test_verify_no_user_key_check_when_none_provided(self):
        payload = _run(
            self.store.create({"actions": [], "user_key": "alice"})
        )
        result = _run(self.store.verify(payload["token"], user_key=None))
        assert result["valid"] is True

    def test_consume_valid_token(self):
        payload = _run(self.store.create({"actions": []}))
        result = _run(self.store.consume(payload["token"]))
        assert result["valid"] is True
        assert result["payload"]["status"] == "confirmed"
        assert "confirmed_at" in result["payload"]

    def test_consume_double_fails(self):
        payload = _run(self.store.create({"actions": []}))
        _run(self.store.consume(payload["token"]))
        result = _run(self.store.consume(payload["token"]))
        assert result["valid"] is False

    def test_consume_missing_token(self):
        result = _run(self.store.consume("nonexistent"))
        assert result["valid"] is False


# ---------------------------------------------------------------------------
# Protocol conformance
# ---------------------------------------------------------------------------


class TestProtocolConformance:
    """Verify the store classes implement the ConfirmationStore protocol."""

    def test_in_memory_is_confirmation_store(self):
        assert isinstance(InMemoryConfirmationStore(), ConfirmationStore)

    def test_database_is_confirmation_store(self):
        assert isinstance(DatabaseConfirmationStore(), ConfirmationStore)


# ---------------------------------------------------------------------------
# Legacy synchronous API — backward compatibility
# ---------------------------------------------------------------------------


class TestLegacySyncAPI:
    """Tests for the original synchronous confirmation functions."""

    def setup_method(self):
        CONFIRMATIONS.clear()
        reset_store()

    def teardown_method(self):
        CONFIRMATIONS.clear()
        reset_store()

    def test_create_confirmation_payload(self):
        payload = create_confirmation_payload(
            user={"sub": "user-1"},
            actions=[{"type": "save_draft"}],
            risk_level="medium",
        )
        assert payload["confirmation_token"].startswith("confirm-")
        assert payload["user"] == "user-1"
        assert payload["risk_level"] == "medium"
        assert len(payload["actions"]) == 1
        assert CONFIRMATIONS[payload["confirmation_token"]]["status"] == "pending"

    def test_verify_confirmation_token_success(self):
        payload = create_confirmation_payload(
            user={"sub": "user-1"},
            actions=[],
        )
        record = verify_confirmation_token(payload["confirmation_token"])
        assert record["confirmation_token"] == payload["confirmation_token"]

    def test_verify_confirmation_token_invalid(self):
        with pytest.raises(ValueError, match="invalid"):
            verify_confirmation_token("bad-token")

    def test_verify_confirmation_token_user_mismatch(self):
        payload = create_confirmation_payload(
            user={"sub": "user-1"},
            actions=[],
        )
        with pytest.raises(ValueError, match="does not belong"):
            verify_confirmation_token(
                payload["confirmation_token"],
                user={"sub": "user-2"},
            )

    def test_consume_confirmation_token(self):
        payload = create_confirmation_payload(
            user={"sub": "user-1"},
            actions=[],
        )
        record = consume_confirmation_token(payload["confirmation_token"])
        assert record["status"] == "confirmed"
        assert "confirmed_at" in record

    def test_consume_double_raises(self):
        payload = create_confirmation_payload(
            user={"sub": "user-1"},
            actions=[],
        )
        consume_confirmation_token(payload["confirmation_token"])
        with pytest.raises(ValueError, match="already been used"):
            consume_confirmation_token(payload["confirmation_token"])


# ---------------------------------------------------------------------------
# Async API with InMemoryConfirmationStore
# ---------------------------------------------------------------------------


class TestAsyncAPIInMemory:
    """Tests for the async confirmation functions backed by InMemory store."""

    def setup_method(self):
        CONFIRMATIONS.clear()
        reset_store()

    def teardown_method(self):
        CONFIRMATIONS.clear()
        reset_store()

    def test_async_create_and_verify(self):
        payload = _run(
            async_create_confirmation_payload(
                user={"sub": "user-1"},
                actions=[{"type": "save"}],
                risk_level="high",
            )
        )
        assert payload["confirmation_token"].startswith("confirm-")
        assert payload["user"] == "user-1"
        assert payload["risk_level"] == "high"
        # Token should also appear in legacy CONFIRMATIONS dict
        assert payload["confirmation_token"] in CONFIRMATIONS

        result = _run(
            async_verify_confirmation_token(
                payload["confirmation_token"],
                user={"sub": "user-1"},
            )
        )
        assert result["token"] == payload["confirmation_token"]

    def test_async_consume(self):
        payload = _run(
            async_create_confirmation_payload(
                user=None,
                actions=[],
            )
        )
        result = _run(
            async_consume_confirmation_token(payload["confirmation_token"])
        )
        assert result["status"] == "confirmed"
        # Legacy dict should reflect the change
        assert CONFIRMATIONS[payload["confirmation_token"]]["status"] == "confirmed"

    def test_async_consume_invalid_raises(self):
        with pytest.raises(ValueError):
            _run(async_consume_confirmation_token("no-such-token"))


# ---------------------------------------------------------------------------
# _user_key helper
# ---------------------------------------------------------------------------


class TestUserKey:
    def test_none_user(self):
        assert _user_key(None) == "system"

    def test_empty_dict(self):
        assert _user_key({}) == "system"

    def test_sub_field(self):
        assert _user_key({"sub": "sub-123"}) == "sub-123"

    def test_username_field(self):
        assert _user_key({"username": "alice"}) == "alice"

    def test_uid_field(self):
        assert _user_key({"uid": "42"}) == "42"

    def test_fallback(self):
        assert _user_key({"name": "bob"}) == "unknown"
