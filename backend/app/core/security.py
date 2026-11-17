"""Security primitives: JWT encode/decode + password hashing.

All callers MUST use `settings.SECRET_KEY` from `app.config`. Inline
`SECRET_KEY` literals in routers are no longer permitted.
"""
from __future__ import annotations

import hashlib
import hmac
from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt
from passlib.hash import bcrypt as _bcrypt

from app.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

ALGORITHM = "HS256"


def create_access_token(
    subject: str,
    extra: dict[str, Any] | None = None,
    expires_minutes: int | None = None,
) -> str:
    """Create a signed JWT access token."""
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=expires_minutes or settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    payload: dict[str, Any] = {"sub": subject, "exp": expire}
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any] | None:
    """Decode and validate JWT. Returns payload dict or None on failure."""
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError as exc:
        logger.debug("JWT decode failed: %s", exc)
        return None


def hash_password(password: str) -> str:
    return _bcrypt.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    # Legacy unsalted hashes written by the removed demo fallback.
    if hashed.startswith("sha256$"):
        return hmac.compare_digest(hashed, "sha256$" + hashlib.sha256(password.encode()).hexdigest())
    try:
        return _bcrypt.verify(password, hashed)
    except (ValueError, TypeError):
        return False
