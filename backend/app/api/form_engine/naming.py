"""Table/column naming and tenant namespace rules for form storage."""
from __future__ import annotations

import re
from typing import Optional

from fastapi import HTTPException

from app.api._model_driven_shared import assert_safe_identifier

PHYSICAL_FORM_STORAGE_MODES = {"physical_table", "business_table"}
ANALYTICS_FORM_KINDS = {"analysis", "analytics", "dashboard", "report", "bi_report", "metric_dashboard", "list_analysis"}

_PHYSICAL_TABLE_NAME_RE = re.compile(r"^(?:t(?P<tenant>\d+)_)?(?:business|analysis)_[a-z][a-z0-9_]*$")


def _is_analysis_form_config(config: Optional[dict]) -> bool:
    """Whether a form config describes an analysis/report assembly.

    NOTE: forms.py historically defined this twice; the later, narrower
    definition (kind matching only, no ``analyticsDesign`` key checks)
    shadowed the first at import time and is therefore the effective
    platform behavior. That behavior is preserved here.
    """
    config = config or {}
    kind = str(config.get("assemblyKind") or config.get("kind") or config.get("type") or "").lower()
    return kind in ANALYTICS_FORM_KINDS


def _physical_table_name_for_form(tenant_id: int, code: str, config: Optional[dict]) -> str:
    """Tenant-scoped physical table name, e.g. ``t3_business_material``.

    The ``t{tenant}_`` prefix keeps two tenants that pick the same form code
    from materializing into one shared table (schema/type collisions, DDL
    cross-talk). Existing forms keep whatever name is persisted in
    ``forms.table_name``; only newly created forms get the prefixed name.
    """
    normalized = re.sub(r"[^a-z0-9_]+", "_", str(code).lower()).strip("_")
    if not normalized:
        raise HTTPException(400, "Form code cannot produce a table name")
    prefix = "analysis" if _is_analysis_form_config(config) else "business"
    table_name = f"t{int(tenant_id)}_{prefix}_{normalized}"
    assert_safe_identifier(table_name)
    return table_name


def _validate_physical_table_name(tenant_id: int, table_name: str) -> str:
    """Constrain form-managed physical tables to the business/analysis namespace.

    Blocks a tenant admin from pointing a form at core tables (``users``,
    ``forms``, ...) — which the auto-DDL path would then ALTER — and from
    claiming another tenant's ``t{n}_`` namespace. Legacy unprefixed
    ``business_*``/``analysis_*`` names stay valid for seeded demo forms.
    """
    assert_safe_identifier(table_name)
    match = _PHYSICAL_TABLE_NAME_RE.match(table_name)
    if not match:
        raise HTTPException(400, "Physical table name must use the business_/analysis_ namespace")
    owner = match.group("tenant")
    if owner is not None and int(owner) != int(tenant_id):
        raise HTTPException(403, "Physical table name belongs to another tenant's namespace")
    return table_name


def _physical_column_name(field_name: str) -> str:
    field_name = re.sub(r"(?<=[a-z0-9])([A-Z])", r"_\1", str(field_name))
    normalized = re.sub(r"[^a-z0-9_]+", "_", field_name.lower()).strip("_")
    if not normalized:
        raise HTTPException(400, f"Invalid field name for physical storage: {field_name!r}")
    assert_safe_identifier(normalized)
    return normalized


def _uses_physical_form_table(form) -> bool:
    return bool(form.table_name and str(form.storage_mode or "").lower() in PHYSICAL_FORM_STORAGE_MODES)
