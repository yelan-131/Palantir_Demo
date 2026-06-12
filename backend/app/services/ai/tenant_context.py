"""Tenant context helpers for AI runtime internals."""

from __future__ import annotations

from typing import Any


class TenantContextError(ValueError):
    """Raised when an AI runtime operation lacks explicit tenant context."""


def require_tenant_id(context: dict[str, Any] | None) -> int:
    """Return a positive tenant id from runtime context, or fail explicitly."""

    if not isinstance(context, dict):
        raise TenantContextError("Tenant context required")

    for key in ("tenant_id", "_tenant_id", "tenantId"):
        value = context.get(key)
        if isinstance(value, int) and value > 0:
            return value
        if isinstance(value, str) and value.isdigit() and int(value) > 0:
            return int(value)

    raise TenantContextError("Tenant context required")
