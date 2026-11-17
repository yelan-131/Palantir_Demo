"""Model-Driven aggregated router.

The original 643-line `model_driven.py` is now split into sibling modules:
    _model_driven_shared.py   — schemas, mocks, identifier safety, try_db
    model_driven_meta.py      — meta-model + page-config CRUD
    model_driven_data.py      — dynamic data CRUD (whitelisted tables)
    model_driven_menus.py     — menu items CRUD

This file remains the single import surface so `main.py` keeps using
`from app.api import model_driven` unchanged.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api import model_driven_data, model_driven_menus, model_driven_meta
from app.api.deps import require_platform_admin_for_writes

router = APIRouter(dependencies=[Depends(require_platform_admin_for_writes)])
router.include_router(model_driven_meta.router)
router.include_router(model_driven_data.router)
router.include_router(model_driven_menus.router)

__all__ = ["router"]
