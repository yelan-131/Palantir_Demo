"""Tests for app.core.security — JWT round-trip and password hashing.

Skips JWT tests if python-jose is not installed; the security module
falls back to a base64 encoder for demo bootstrap which we test instead.
"""
from __future__ import annotations

import importlib

import pytest


def test_create_decode_roundtrip():
    from app.core.security import create_access_token, decode_access_token

    token = create_access_token(subject="alice", extra={"uid": 42, "is_admin": True})
    assert isinstance(token, str) and len(token) > 10

    payload = decode_access_token(token)
    assert payload is not None
    assert payload["sub"] == "alice"
    assert payload["uid"] == 42
    assert payload["is_admin"] is True


def test_decode_invalid_token_returns_none():
    from app.core.security import decode_access_token

    assert decode_access_token("garbage-not-a-jwt") is None


def test_decode_tampered_token_returns_none():
    """Tampered signature must not validate when python-jose is present."""
    try:
        importlib.import_module("jose")
    except ImportError:
        pytest.skip("python-jose not installed; skipping signature tampering test")

    from app.core.security import create_access_token, decode_access_token

    token = create_access_token(subject="bob")
    # Flip the last character of the signature segment
    tampered = token[:-1] + ("A" if token[-1] != "A" else "B")
    assert decode_access_token(tampered) is None


def test_password_hash_roundtrip():
    from app.core.security import hash_password, verify_password

    hashed = hash_password("S3cr3t!")
    assert hashed != "S3cr3t!"
    assert verify_password("S3cr3t!", hashed)
    assert not verify_password("wrong", hashed)


def test_sha256_fallback_marker_is_namespaced():
    """Fallback hashes are prefixed `sha256$` so they cannot collide with bcrypt."""
    from app.core.security import hash_password

    h = hash_password("anything")
    # Either bcrypt ($2b$...) or our explicit sha256$ marker — never bare hex.
    assert h.startswith("$2") or h.startswith("sha256$")


def test_permission_match_helpers_support_aliases_and_wildcards():
    from app.core.permissions import _action_matches, _key_matches

    assert _action_matches("*", "delete")
    assert _action_matches("view", "read")
    assert _action_matches("edit", "update")
    assert not _action_matches("view", "delete")

    assert _key_matches("*", "quality-event")
    assert _key_matches("quality-event", "quality-event")
    assert not _key_matches("maintenance-order", "quality-event")
