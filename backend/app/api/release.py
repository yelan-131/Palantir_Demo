from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter

from app.config import settings

router = APIRouter()

PROJECT_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = Path(__file__).resolve().parents[2]
RELEASE_FILES = [
    PROJECT_ROOT / "release.json",
    BACKEND_ROOT / "release.json",
    Path("/app/release.json"),
]


def load_release_info() -> dict[str, Any]:
    release_path = next((path for path in RELEASE_FILES if path.exists()), None)
    if release_path is None:
        return {
            "version": settings.APP_VERSION,
            "released_at": None,
            "title": "当前版本",
            "summary": "",
            "highlights": [],
            "details": [],
            "records": [],
            "show_popup": False,
        }

    with release_path.open("r", encoding="utf-8") as release_file:
        data = json.load(release_file)

    data.setdefault("version", settings.APP_VERSION)
    data.setdefault("highlights", [])
    data.setdefault("details", [])
    data.setdefault("records", [])
    data.setdefault("show_popup", True)
    return data


@router.get("/current")
async def get_current_release():
    return load_release_info()
