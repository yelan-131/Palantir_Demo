"""Identifier guards shared by dynamic SQL builders."""
from __future__ import annotations

import re

from fastapi import HTTPException

_IDENT_RE = re.compile(r"^[a-z][a-z0-9_]*$")


def assert_safe_identifier(name: str) -> None:
    """Defense-in-depth check on dynamic table/column names."""
    if not _IDENT_RE.match(name):
        raise HTTPException(400, f"Invalid identifier: {name!r}")
