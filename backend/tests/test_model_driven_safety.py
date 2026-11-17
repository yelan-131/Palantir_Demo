"""Tests for model-driven dynamic CRUD identifier safety.

Covers:
- The strict identifier regex `_IDENT_RE` accepts known-good names and
  rejects anything containing whitespace, punctuation, or upper-case.
- `_resolve_table` enforces the SAFE_COLUMNS whitelist + identifier check.
- Every key in SAFE_COLUMNS itself is a safe identifier (catches accidental
  whitelist drift introducing a quoted/spaced name).
"""
from __future__ import annotations

import pytest


def test_safe_identifier_accepts_known_names():
    pytest.importorskip("fastapi")
    from app.core.identifiers import assert_safe_identifier

    for name in ["factories", "production_lines", "spc_points", "work_orders", "id"]:
        assert_safe_identifier(name)  # must not raise


@pytest.mark.parametrize("bad", [
    "Factories",                  # uppercase
    "factories;DROP TABLE x",     # injection attempt
    "factories--",
    "factories ",
    "1factories",
    "",
    "factories.id",
])
def test_safe_identifier_rejects_garbage(bad: str):
    pytest.importorskip("fastapi")
    from fastapi import HTTPException
    from app.core.identifiers import assert_safe_identifier

    with pytest.raises(HTTPException):
        assert_safe_identifier(bad)


def test_safe_columns_keys_are_all_valid():
    pytest.importorskip("fastapi")
    from app.api._model_driven_shared import SAFE_COLUMNS, assert_safe_identifier

    for table_name, cols in SAFE_COLUMNS.items():
        assert_safe_identifier(table_name)
        for c in cols:
            assert_safe_identifier(c)


def test_resolve_table_unknown_model_returns_404():
    pytest.importorskip("fastapi")
    from fastapi import HTTPException
    from app.api.model_driven_data import _resolve_table

    with pytest.raises(HTTPException) as exc:
        _resolve_table("definitelyNotARealModel")
    assert exc.value.status_code == 404


def test_resolve_table_known_alias_resolves(legacy_model_driven_demo):
    pytest.importorskip("fastapi")
    from app.api.model_driven_data import _resolve_table

    # ENTITY_TABLE_MAP maps "Equipment" → "equipment"
    assert _resolve_table("Equipment") == "equipment"
    # Lower-case fallback path
    assert _resolve_table("factories") == "factories"


def test_resolve_table_rejects_injection_attempt():
    pytest.importorskip("fastapi")
    from fastapi import HTTPException
    from app.api.model_driven_data import _resolve_table

    with pytest.raises(HTTPException) as exc:
        _resolve_table("factories; DROP TABLE x;--")
    # Either 404 (not in whitelist) or 400 (identifier regex). Both are safe.
    assert exc.value.status_code in (400, 404)
